import { defineConfig } from "vitest/config";
import base from "./vitest.config.mjs";

/** `pnpm smoke:pdf`: real PDFs with the production engine (Chromium), one file at a time. Not part of `pnpm test`. */
export default defineConfig({
  resolve: base.resolve,
  test: {
    include: ["tests/pdf/**/*.test.ts"],
    testTimeout: 180_000,
    hookTimeout: 180_000,
    fileParallelism: false,
    environment: "node",
  },
});
