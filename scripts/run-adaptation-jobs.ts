/**
 * Local runner for the adaptation job worker (`pnpm jobs:adaptations`). It runs ONE scheduler tick against the database the
 * environment points to.
 *
 *   ⚠ With real providers configured (ANTHROPIC_API_KEY and a non-mock model) this MAKES REAL, BILLED MODEL CALLS for every job
 *     it claims. It is not part of `pnpm check`. Use `--dry-run` to only list what would be done, and the mock provider
 *     (AI_MODEL_STANDARD=mock:default, never in production) to exercise the flow for free.
 *
 *   pnpm jobs:adaptations -- --dry-run
 *   pnpm jobs:adaptations -- --limit 1
 */
import { adaptationStore, orchestratorDeps } from "@/lib/adaptation/orchestration/server";
import { runAdaptationWorkerCycle } from "@/lib/adaptation/orchestration/worker";

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

async function main() {
  const limit = Number(arg("--limit") ?? "1");
  if (!Number.isInteger(limit) || limit < 1 || limit > 10) throw new Error("--limit debe ser un entero entre 1 y 10.");
  if (process.argv.includes("--dry-run")) {
    const store = adaptationStore();
    const jobs = await store.listClaimableJobs(limit);
    console.log(JSON.stringify({ dryRun: true, claimableJobs: jobs.length }));
    return;
  }
  console.log(JSON.stringify(await runAdaptationWorkerCycle(orchestratorDeps(), { limit })));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
