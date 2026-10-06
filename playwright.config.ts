import { defineConfig } from "@playwright/test";

const PORT = 3100;
const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;
const FAKE_PORT = 54399;

/**
 * Por defecto arranca la app contra `tests/e2e/fake-supabase.mjs` (PGlite con las migraciones reales; sin red).
 * Con E2E_BASE_URL apunta a un despliegue real (proyecto Supabase de pruebas con confirmación de email desactivada),
 * que debe usar el proveedor simulado (AI_MODEL_STANDARD=mock:default): ver docs/SUPABASE_TESTING.md.
 */
export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "**/*.spec.ts",
  workers: 1,
  retries: 0,
  reporter: "list",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: BASE_URL,
    channel: process.env.CI ? undefined : "chrome",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1280, height: 900 } } },
    { name: "mobile", use: { viewport: { width: 390, height: 844 } } },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : [
        {
          command: "node tests/e2e/fake-supabase.mjs",
          url: `http://127.0.0.1:${FAKE_PORT}/rest/v1/plans`,
          reuseExistingServer: true,
        },
        {
          command: `pnpm exec next dev -p ${PORT}`,
          url: BASE_URL,
          reuseExistingServer: true,
          timeout: 120_000,
          env: {
            NEXT_DIST_DIR: ".next-e2e",
            NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${FAKE_PORT}`,
            NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fakefakefakefakefake",
            NEXT_PUBLIC_SITE_URL: BASE_URL,
            SUPABASE_SECRET_KEY: "sb_secret_fakefakefakefakefake",
            // El análisis usa el proveedor simulado: sin claves, sin gasto.
            AI_MODEL_STANDARD: "mock:default",
            // El E2E recorre el prompt activo (v3). E2E_PROMPT_VERSION=1 recorre material_analyzer@v1 (análisis v2, que se lee como v3).
            AI_ANALYSIS_PROMPT_VERSION: process.env.E2E_PROMPT_VERSION ?? "3",
            MOCK_AI_DELAY_MS: "400",
            CRON_SECRET: "e2e-cron-secret-0123456789",
          },
        },
      ],
});
