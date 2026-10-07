import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createRunDispatcher, RERUN_INTERVAL_MS } from "@/lib/jobs/run-dispatcher";

/**
 * User-triggered jobs run immediately; Vercel Cron is recovery-only. Guards of that architecture: no `after()` or fire-and-forget on
 * the server, polling endpoints that only read, screens that ask for the run at once, and cron schedules that are daily.
 */

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}
const read = (p: string) => readFileSync(p, "utf8");

describe("no work after the response", () => {
  it("no server code uses after() or waitUntil to run jobs", () => {
    for (const file of walk("src")) {
      const text = read(file);
      expect(text, file).not.toMatch(/from\s+["']next\/server["'][^;]*\bafter\b|\bafter\(\s*(async\s*)?\(|waitUntil\(/);
    }
  });

  it("the status polls only read; the run endpoints await the shared processors", () => {
    expect(read("src/app/api/materials/[id]/status/route.ts")).not.toMatch(/runAnalysisJob|processMaterialAnalysis|findRecoverableJob/);
    expect(read("src/app/api/adaptations/[id]/status/route.ts")).not.toMatch(/process|worker/);
    expect(read("src/app/api/materials/[id]/analysis/run/route.ts")).toMatch(/await processMaterialAnalysis\(id\)/);
    expect(read("src/app/api/adaptations/[id]/run/route.ts")).toMatch(/await processAdaptationStage\(orchestratorDeps\(\), id\)/);
    for (const route of ["src/app/api/materials/[id]/analysis/run/route.ts", "src/app/api/adaptations/[id]/run/route.ts"]) {
      expect(read(route), route).toMatch(/export const maxDuration = 300;/);
      expect(read(route), route).toMatch(/getApiContext\(request, \{ mutating: true \}\)/);
      expect(read(route), route).not.toMatch(/export (async function|const) (GET|PUT|PATCH|DELETE)\b/);
    }
  });

  it("the commands only persist the job (fast); the screens ask for the run as soon as the job exists", () => {
    expect(read("src/app/app/(shell)/adaptaciones/actions.ts")).not.toMatch(/processAdaptationJobs|runPlanningStage|runGenerationStage/);
    expect(read("src/app/app/(shell)/materiales/actions.ts")).not.toMatch(/runAnalysisJob/);
    expect(read("src/app/api/uploads/[id]/complete/route.ts")).not.toMatch(/runAnalysisJob/);
    expect(read("src/components/materials/analysis-progress.tsx")).toMatch(/\/api\/materials\/\$\{materialId\}\/analysis\/run`, \{ method: "POST"/);
    expect(read("src/components/materials/analysis-progress.tsx")).toMatch(/runner\.kick\(true\)/);
    const view = read("src/components/adaptation/adaptation-view.tsx");
    expect(view).toMatch(/\/api\/adaptations\/\$\{id\}\/run`, \{ method: "POST"/);
    for (const command of ["actions.start, runNow", "runNow();", "acknowledge }), runNow"]) expect(view).toContain(command);
  });
});

describe("authorization and the human gate", () => {
  it("both run endpoints check the writer capability before anything is read or processed", () => {
    const materials = read("src/app/api/materials/[id]/analysis/run/route.ts");
    expect(materials.indexOf("hasRole(auth.ctx.role, WRITE_ROLES)")).toBeGreaterThan(-1);
    expect(materials.indexOf("hasRole(auth.ctx.role, WRITE_ROLES)")).toBeLessThan(materials.indexOf("getMaterialDetail("));
    const adaptations = read("src/app/api/adaptations/[id]/run/route.ts");
    expect(adaptations.indexOf("authorizeStageRun(")).toBeGreaterThan(-1);
    expect(adaptations.indexOf("authorizeStageRun(")).toBeLessThan(adaptations.indexOf("processAdaptationStage("));
    expect(read("src/lib/adaptation/orchestration/service.ts")).toMatch(/export async function authorizeStageRun[\s\S]*?const no = denied\(actor\);\s*if \(no\) return no;/);
  });

  it("recovery never starts an adaptation: no reconciler, no enqueue from the worker", () => {
    const worker = read("src/lib/adaptation/orchestration/worker.ts");
    expect(worker).not.toMatch(/reconcile|enqueuePlanning|enqueueGeneration|listAdaptationsNeedingJob/i);
    expect(read("src/lib/adaptation/orchestration/store.ts")).not.toMatch(/listAdaptationsNeedingJob/);
    expect(read("src/lib/config/env.server-schema.ts")).not.toMatch(/RECONCILE/);
  });

  it("the progress copy no longer promises a wait in a queue", () => {
    expect(read("src/components/materials/analysis-progress.tsx")).not.toMatch(/en cola|en cuanto sea posible/);
  });
});

describe("cron is recovery-only and daily", () => {
  const crons = (JSON.parse(read("vercel.json")) as { crons: Array<{ path: string; schedule: string }> }).crons;

  it("both crons exist, run once a day, never at the same minute", () => {
    expect(crons.map((c) => c.path).sort()).toEqual(["/api/cron/adaptations", "/api/cron/materials"]);
    for (const c of crons) {
      const [minute, hour, ...rest] = c.schedule.split(" ");
      expect(minute, c.path).toMatch(/^\d+$/);
      expect(hour, c.path).toMatch(/^\d+$/);
      expect(rest, c.path).toEqual(["*", "*", "*"]);
    }
    expect(new Set(crons.map((c) => c.schedule)).size).toBe(2);
  });

  it("the cron handlers run the same processors as the requests", () => {
    expect(read("src/app/api/cron/materials/route.ts")).toMatch(/recoverAnalysisJobs\(/);
    expect(read("src/lib/materials/analysis-job.ts")).toMatch(/for \(const job of free\) outcomes\[await runAnalysisJob\(job\.id\)\]/);
    expect(read("src/app/api/cron/adaptations/route.ts")).toMatch(/runAdaptationWorkerCycle\(/);
    expect(read("src/lib/adaptation/orchestration/worker.ts")).toMatch(/const outcome = await runStageJob\(deps, job\.adaptationId, job\.stage\)/);
    expect(read("src/lib/adaptation/orchestration/worker.ts")).toMatch(/const outcome = await runStageJob\(deps, adaptationId, job\.stage\)/);
  });
});

describe("createRunDispatcher (client)", () => {
  it("runs at once, never twice in flight, re-asks only after the interval, and ignores results after stop", async () => {
    let clock = 0;
    const resolvers: Array<(v: string) => void> = [];
    const run = vi.fn(() => new Promise<string | null>((resolve) => resolvers.push(resolve)));
    const results: string[] = [];
    const d = createRunDispatcher<string>({ run, onResult: (r) => results.push(r), now: () => clock });

    d.kick(true);
    d.kick(true); // in flight: ignored
    expect(run).toHaveBeenCalledTimes(1);
    resolvers[0]!("primero");
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(results).toEqual(["primero"]);

    d.kick(); // too soon
    expect(run).toHaveBeenCalledTimes(1);
    clock += RERUN_INTERVAL_MS;
    d.kick();
    expect(run).toHaveBeenCalledTimes(2);
    d.stop();
    resolvers[1]!("tarde");
    await Promise.resolve();
    await Promise.resolve();
    expect(results).toEqual(["primero"]);
    d.kick(true);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("a failed request does not block the next one", async () => {
    let clock = 0;
    const run = vi.fn().mockRejectedValueOnce(new Error("red")).mockResolvedValueOnce("ok");
    const results: string[] = [];
    const d = createRunDispatcher<string>({ run, onResult: (r) => results.push(r), now: () => clock });
    d.kick(true);
    for (let i = 0; i < 4; i++) await Promise.resolve();
    clock += RERUN_INTERVAL_MS;
    d.kick();
    for (let i = 0; i < 4; i++) await Promise.resolve();
    expect(results).toEqual(["ok"]);
  });
});
