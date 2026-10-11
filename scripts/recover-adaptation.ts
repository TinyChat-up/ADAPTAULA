/**
 * Operator recovery of ONE failed adaptation after the fix is deployed (`pnpm jobs:recover -- --id <uuid>`), by the stage that
 * failed: a generation (`generator_validation`, under an earlier audit) or a planning (`planner_schema`, before the bounded repair).
 * docs/ADAPTATION.md § Recuperar una adaptación fallida, § Hotfix planner_schema.
 *
 * Planning (`recoverFailedPlanning`): the dry run reads only (status, failure, planning jobs, unit reserved and not consumed, no
 * plan yet). `--apply` queues the planning job of the SAME adaptation again (`failed → queued`, inside the failure budget); the
 * teacher's next visit runs it (at most two planner calls). No new adaptation, no new unit, no usage event is touched.
 *
 * Generation (`recoverFailedGeneration`):
 *   · Default (dry run): reads only. Re-runs the current audit and deterministic review on the generation the adaptation ALREADY
 *     has, checks the unit is reserved and not consumed, and prints check names and states (no content, no learner data).
 *   · `--apply`: only if the dry run says «recoverable», queues the generation job with the SAME input (no generator call, no new
 *     generation cycle). Nothing runs here: the teacher's next visit to the adaptation runs it (one reviewer call) and the delivery
 *     consumes the unit already reserved. No new adaptation, no new unit, no usage event is touched.
 *
 *   pnpm jobs:recover -- --id a33778c7-acd5-46f7-9882-cb05872f5b83
 *   pnpm jobs:recover -- --id a33778c7-acd5-46f7-9882-cb05872f5b83 --apply
 */
import { z } from "zod";
import { recoverFailedGeneration, recoverFailedPlanning } from "@/lib/adaptation/orchestration/orchestrator";
import { orchestratorDeps } from "@/lib/adaptation/orchestration/server";

async function main() {
  const i = process.argv.indexOf("--id");
  const id = z.uuid().parse(i >= 0 ? process.argv[i + 1] : undefined);
  const deps = orchestratorDeps();
  const apply = process.argv.includes("--apply");
  const stage = (await deps.store.getPipeline(id))?.jobs.at(-1)?.stage;
  const report = stage === "planning" ? await recoverFailedPlanning(deps, id, { apply }) : await recoverFailedGeneration(deps, id, { apply });
  console.log(JSON.stringify(report, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
