/**
 * Exportación del piloto V3 desde la interfaz (ADR-046). SOLO LECTURA: consulta el proyecto Supabase del piloto con la clave de
 * servicio y escribe en la carpeta privada `evals/adaptation/private/pilot-ui/` (ignorada por Git). No llama a ningún proveedor
 * de IA y no cambia nada.
 *
 *   node --env-file=.env.pilot --import tsx scripts/pilot/report.ts --since 2026-11-10            costes por llamada y resumen
 *   node --env-file=.env.pilot --import tsx scripts/pilot/report.ts --since 2026-11-10 --decisions   + decisiones de cada adaptación
 *
 * Escribe:
 *   calls.csv       una fila por llamada de IA: fase, modelo, tokens, coste estimado, estado, reparación, huella de reglas
 *   summary.json    por adaptación y fase (análisis aparte, por material), totales y el libro de gasto de la campaña
 *   decisions.json  (--decisions) por adaptación: plan, declaraciones V2.2, revisiones, veredicto y el registro de decisiones
 *                   recalculado bajo demanda con los controles de la ficha generada
 * Contiene títulos y contenido de los materiales del piloto: es privado. Nunca nombres de alumnado (el perfil es solo su id).
 * Se niega si NEXT_PUBLIC_SUPABASE_URL no es exactamente AI_PLANNER_V3_PILOT_SUPABASE_URL (para no leer otro proyecto).
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { auditAdaptation } from "../../src/lib/adaptation/v22/audit";
import { AdaptationStore, type RpcClient } from "../../src/lib/adaptation/orchestration/store";
import type { PlannerDeclarations } from "../../src/lib/adaptation/plan-v3";
import { parseStoredAnalysis } from "../../src/lib/analysis/parse";
import { costRowsCsv, summarizeCost, type CostRow } from "../../src/lib/ai/cost-report";
import { AdaptationContextSchema } from "../../src/lib/schemas/adaptation-context";
import { AdaptationPlanSchema, type PlanValidation } from "../../src/lib/schemas/adaptation-plan";
import { MaterialDocumentSchema } from "../../src/lib/schemas/material-document";

const OUT = path.resolve(import.meta.dirname, "../../evals/adaptation/private/pilot-ui");
const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
};

async function main() {
  const since = arg("--since");
  if (!since || Number.isNaN(Date.parse(since))) throw new Error("Uso: report.ts --since <fecha ISO> [--workspace <uuid>] [--decisions]");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  const pilotUrl = process.env.AI_PLANNER_V3_PILOT_SUPABASE_URL;
  if (!url || !key) throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SECRET_KEY (del proyecto de staging, nunca en Git).");
  if (!pilotUrl || new URL(url).href !== new URL(pilotUrl).href) throw new Error("NEXT_PUBLIC_SUPABASE_URL no es el backend del piloto (AI_PLANNER_V3_PILOT_SUPABASE_URL): no se lee.");
  const workspace = arg("--workspace") ?? process.env.AI_PLANNER_V3_PILOT_WORKSPACE_ID ?? null;
  const campaign = process.env.AI_PILOT_CAMPAIGN || "piloto-v22-1";
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const report = await db.rpc("ai_cost_report", { p_since: new Date(since).toISOString(), p_workspace: workspace });
  if (report.error) throw new Error(`ai_cost_report: ${report.error.message}`);
  const rows = (report.data ?? []) as CostRow[];
  const spend = await db.rpc("ai_spend_summary", { p_campaign: campaign });
  if (spend.error) throw new Error(`ai_spend_summary: ${spend.error.message}`);

  const dir = path.join(OUT, new Date().toISOString().replace(/[:.]/g, "-"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "calls.csv"), costRowsCsv(rows));
  const summary = { since, workspace, campaign, budgetUsd: Number(process.env.AI_PILOT_BUDGET_USD) || null, ledger: (spend.data as unknown[])[0] ?? null, ...summarizeCost(rows) };
  writeFileSync(path.join(dir, "summary.json"), JSON.stringify(summary, null, 2));

  if (process.argv.includes("--decisions")) {
    const store = new AdaptationStore(db as unknown as RpcClient);
    const ids = [...new Set(rows.map((r) => r.adaptation_id).filter((id): id is string => id !== null))];
    const out = [];
    for (const id of ids) out.push(await decisionsOf(store, db, id));
    writeFileSync(path.join(dir, "decisions.json"), JSON.stringify(out, null, 2));
  }
  console.log(`Exportado: ${rows.length} llamadas · ${summary.adaptations.length} adaptaciones · ${summary.usd.toFixed(4)} USD estimados${summary.incomplete ? " (cota inferior: hay llamadas sin precio)" : ""}`);
  console.log(`Carpeta privada: ${path.relative(process.cwd(), dir)}`);
}

async function decisionsOf(store: AdaptationStore, db: SupabaseClient, id: string) {
  const snapshot = await store.getPipeline(id);
  if (!snapshot) return { adaptationId: id, error: "no encontrada" };
  const artifacts = await store.listArtifacts(id, null);
  const plan = artifacts.filter((a) => a.kind === "plan").at(-1);
  const validation = artifacts.filter((a) => a.kind === "plan_validation").at(-1)?.payload as { validation?: PlanValidation; classification?: unknown; declarations?: PlannerDeclarations } | undefined;
  const reviews = artifacts.filter((a) => a.kind === "plan_review").map((a) => a.payload as { reviewer?: { kind?: string }; entries?: unknown });
  const { data } = await db.from("adaptation_versions").select("version, document, review").eq("adaptation_id", id).order("version", { ascending: false }).limit(1).maybeSingle();
  const version = data as { version: number; document: unknown; review: unknown } | null;
  const base = {
    adaptationId: id,
    materialId: snapshot.adaptation.material_id,
    learnerProfileId: snapshot.adaptation.learner_profile_id,
    status: snapshot.adaptation.status,
    creationMode: snapshot.adaptation.creation_mode,
    plannerVersion: snapshot.adaptation.pipeline_versions?.planner.prompt_version ?? null,
    rules: snapshot.adaptation.pipeline_versions?.rules ?? null,
    plan: plan?.payload ?? null,
    classification: validation?.classification ?? null,
    declarations: validation?.declarations ?? null,
    reviews: reviews.map((r) => ({ reviewer: r.reviewer?.kind ?? null, entries: r.entries ?? [] })),
    finalVersion: version ? { version: version.version, verdict: (version.review as { verdict?: string } | null)?.verdict ?? null } : null,
  };
  // The ledger is recomputed on demand (decision of 2026-11-04): from the raw plan, its validation, the frozen context, the
  // analysis and, when it exists, the generated sheet (its checks are reported as not checked otherwise).
  const parsedPlan = AdaptationPlanSchema.safeParse(plan?.payload);
  const context = AdaptationContextSchema.safeParse(snapshot.adaptation.context_snapshot);
  const analysis = parseStoredAnalysis(snapshot.analysis.analysis).analysis;
  if (!parsedPlan.success || !context.success || !analysis || !validation?.validation) return { ...base, audit: null };
  const document = version ? MaterialDocumentSchema.safeParse(version.document) : null;
  const audit = auditAdaptation({ plan: parsedPlan.data, validation: validation.validation, context: context.data, analysis, declarations: validation.declarations ?? null, ...(document?.success ? { document: document.data } : {}) });
  return { ...base, audit };
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
