/**
 * Operator recovery of ONE adaptation whose generation failed (`generator_validation`) under an earlier audit, after the fix is
 * deployed (`pnpm jobs:recover -- --id <uuid>`). docs/ADAPTATION.md § Recuperar una adaptación fallida.
 *
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
import { recoverFailedGeneration } from "@/lib/adaptation/orchestration/orchestrator";
import { orchestratorDeps } from "@/lib/adaptation/orchestration/server";

async function main() {
  const i = process.argv.indexOf("--id");
  const id = z.uuid().parse(i >= 0 ? process.argv[i + 1] : undefined);
  const report = await recoverFailedGeneration(orchestratorDeps(), id, { apply: process.argv.includes("--apply") });
  console.log(JSON.stringify(report, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
