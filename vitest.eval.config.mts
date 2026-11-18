import { defineConfig } from "vitest/config";
import base from "./vitest.config.mjs";

/** `pnpm eval:recreation`: the recreation evaluation (evals/recreation/run-real.ts). Spends money only with every lock open. */
export default defineConfig({
  resolve: base.resolve,
  test: {
    include: ["evals/recreation/run.eval.ts"],
    testTimeout: 30 * 60_000,
    fileParallelism: false,
    environment: "node",
  },
});
