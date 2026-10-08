import { defineConfig } from "vitest/config";
import base from "./vitest.config.mjs";

/**
 * `pnpm qa:visual`: renders the Phase 8 visual-QA sheets (tests/visual-qa) to PDF, per-page PNG (colour and greyscale) and a
 * screen screenshot, for a person to look at (docs/qa/phase8). Real Chromium, no model. Not part of `pnpm test` or `pnpm check`.
 */
export default defineConfig({
  resolve: base.resolve,
  test: {
    include: ["tests/visual-qa/**/*.qa.test.ts"],
    testTimeout: 180_000,
    hookTimeout: 180_000,
    fileParallelism: false,
    environment: "node",
  },
});
