import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@prompts": fileURLToPath(new URL("./prompts", import.meta.url)),
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)),
    },
  },
  test: {
    include: ["src/**/*.test.ts", "tests/unit/**/*.test.ts", "tests/db/**/*.test.ts", "tests/rls-real/**/*.test.ts"],
    testTimeout: 20_000,
    environment: "node",
  },
});
