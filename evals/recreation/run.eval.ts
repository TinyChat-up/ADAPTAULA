import { mkdirSync } from "node:fs";
import path from "node:path";
import { it } from "vitest";
import { parseArgs, runEvaluation } from "./run-real";

/** `pnpm eval:recreation` (vitest.eval.config.mts). Arguments in RECREATION_EVAL_ARGS; see run-real.ts. Never part of `pnpm check`. */
it("evaluación de la recreación del estanque", async () => {
  mkdirSync(path.join(process.cwd(), "evals", "results", "recreation"), { recursive: true });
  const result = await runEvaluation(parseArgs((process.env.RECREATION_EVAL_ARGS ?? "").split(/\s+/).filter(Boolean)));
  if (result.status === "blocked") throw new Error(`Bloqueada: ${result.blockers.join("; ")}`);
}, 30 * 60_000);
