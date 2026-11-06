import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { summarizeCost, type CostRow } from "@/lib/ai/cost-report";
import { as, createTestDb, createUser } from "./harness";
import { seedMaterial } from "./orchestration-harness";
import { fractionsAnalysis } from "../../evals/adaptation/fixtures";

/**
 * Migration 035 (ADR-046) on the real migrations: the pilot's spend ledger, its cost report and the rules hash in ai_runs. Only
 * service_role reaches any of it; a teacher (authenticated) or anon can read nothing and execute nothing.
 */
let db: PGlite;
beforeAll(async () => {
  db = await createTestDb();
}, 60_000);

const svc = <T>(sql: string, params: unknown[] = []) => as(db, "service_role", null, () => db.query<T>(sql, params)).then((r) => r.rows);
const admit = (campaign: string, budget: number, reserved: number) =>
  svc<{ reservation_id: string | null; committed_usd: string }>("select * from public.ai_spend_admit($1, $2, 'anthropic', 'claude-sonnet-5-5', 1000, 4000, $3)", [campaign, budget, reserved]).then((r) => r[0]!);
const committed = (campaign: string) => svc<{ c: string }>("select public.ai_spend_committed($1) as c", [campaign]).then((r) => Number(r[0]!.c));

describe("libro de gasto", () => {
  it("admite mientras cabe; lo pendiente y lo retenido cuentan por su cota, lo liquidado por su coste real", async () => {
    const a = await admit("prueba-uno", 1, 0.4);
    const b = await admit("prueba-uno", 1, 0.4);
    expect(a.reservation_id).not.toBeNull();
    expect(b.reservation_id).not.toBeNull();
    // 0.8 committed while both are pending: a third reservation of 0.4 does not fit.
    expect((await admit("prueba-uno", 1, 0.4)).reservation_id).toBeNull();
    await svc("select public.ai_spend_settle($1, $2)", [a.reservation_id, 0.05]);
    await svc("select public.ai_spend_settle($1, null)", [b.reservation_id]);
    expect(await committed("prueba-uno")).toBeCloseTo(0.45, 6);
    expect((await admit("prueba-uno", 1, 0.5)).reservation_id).not.toBeNull();
    // Another campaign has its own account.
    expect(await committed("prueba-dos")).toBe(0);
  });

  it("una reserva se liquida una sola vez y no se puede rebajar después", async () => {
    const r = await admit("prueba-tres", 1, 0.3);
    expect((await svc<{ ok: boolean }>("select public.ai_spend_settle($1, $2) as ok", [r.reservation_id, 0.1]))[0]!.ok).toBe(true);
    expect((await svc<{ ok: boolean }>("select public.ai_spend_settle($1, $2) as ok", [r.reservation_id, 0]))[0]!.ok).toBe(false);
    expect(await committed("prueba-tres")).toBeCloseTo(0.1, 6);
    const summary = (await svc<{ committed_usd: string; pending_count: string; kept_count: string; requests: string }>("select * from public.ai_spend_summary('prueba-tres')"))[0]!;
    expect({ committed: Number(summary.committed_usd), pending: Number(summary.pending_count), kept: Number(summary.kept_count), requests: Number(summary.requests) }).toEqual({ committed: 0.1, pending: 0, kept: 0, requests: 1 });
    await expect(svc("select * from public.ai_spend_admit('prueba-tres', 0, 'anthropic', 'm', 1, 1, 0.1)")).rejects.toThrow(/invalid_input/);
  });

  it("ningún usuario lee el libro ni ejecuta sus funciones o el informe", async () => {
    const u = await createUser(db, "ledger-rls@example.com");
    for (const role of ["authenticated", "anon"] as const) {
      const id = role === "authenticated" ? u.id : null;
      await expect(as(db, role, id, () => db.query("select * from public.ai_spend_reservations"))).rejects.toThrow(/permission denied/);
      await expect(as(db, role, id, () => db.query("select * from public.ai_spend_admit('x-campaign', 100, 'anthropic', 'm', 1, 1, 0.1)"))).rejects.toThrow(/permission denied/);
      await expect(as(db, role, id, () => db.query("select public.ai_spend_settle(gen_random_uuid(), 0)"))).rejects.toThrow(/permission denied/);
      await expect(as(db, role, id, () => db.query("select * from public.ai_cost_report(now() - interval '1 day', null)"))).rejects.toThrow(/permission denied/);
    }
  });
});

describe("informe de costes y huella de reglas", () => {
  it("record_ai_run guarda la huella de las reglas; el informe asigna cada llamada a su fase", async () => {
    const u = await createUser(db, "report@example.com");
    const material = await seedMaterial(db, u, fractionsAnalysis());
    const run = (purpose: string, extra: Record<string, unknown> = {}) =>
      svc("select public.record_ai_run($1::jsonb)", [JSON.stringify({ workspace_id: u.workspaceId, material_id: material, purpose, model_alias: "STANDARD", provider: "anthropic", model: "claude-sonnet-5-5", status: "success", input_tokens: 1000, output_tokens: 100, estimated_cost_usd: 0.003, ...extra })]);
    await run("analyze");
    await run("plan", { rules_sha256: "d".repeat(64), call_kind: "initial" });
    await run("plan", { call_kind: "repair", estimated_cost_usd: null });
    await run("generate");
    await run("review");
    await run("visual_support");
    expect((await svc<{ r: string | null }>("select rules_sha256 as r from public.ai_runs where workspace_id = $1 and purpose = 'plan' order by created_at", [u.workspaceId])).map((x) => x.r)).toEqual(["d".repeat(64), null]);
    const rows = await svc<CostRow>("select * from public.ai_cost_report(now() - interval '1 hour', $1)", [u.workspaceId]);
    expect(rows.map((r) => r.phase)).toEqual(["analysis", "planning", "planning", "generation", "review", "visual_supports"]);
    expect(rows[0]!.material_title).toBeTypeOf("string");
    const report = summarizeCost(rows);
    // No adaptation id in these rows: everything is attributed to the material, the plan's unknown cost makes it a lower bound.
    expect(report.materials).toHaveLength(1);
    expect(report.totals.planning).toMatchObject({ calls: 2, repairs: 1, unknownCost: 1 });
    expect(report.incomplete).toBe(true);
  });
});
