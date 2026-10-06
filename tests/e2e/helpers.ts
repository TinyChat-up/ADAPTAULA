import { expect, type Page } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";

export const password = "contraseña-segura-123";
export const uniqueEmail = () => `docente-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;

export async function signUpAndOnboard(page: Page, email: string, start: RegExp = /Crear un perfil/) {
  await page.goto("/registro");
  await page.getByLabel("Nombre").fill("Ana Pérez");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Contraseña").fill(password);
  await page.getByRole("button", { name: "Crear cuenta" }).click();

  await expect(page).toHaveURL(/\/app\/bienvenida/);
  await page.getByRole("radio", { name: "Primaria" }).check();
  await page.getByRole("button", { name: "Siguiente" }).click();
  await page.getByRole("radio", { name: start }).check();
  await page.getByRole("button", { name: "Siguiente" }).click();
  await expect(page.getByText("Puedes utilizar iniciales o alias")).toBeVisible();
  await page.getByRole("button", { name: "Entrar en Adaptaula" }).click();
}

/** A real, valid PDF. `marker` makes the content unique (distinct hash) or drives the mock provider (MOCK_*). */
export async function makePdf(options: { pages?: number; marker?: string } = {}): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < (options.pages ?? 1); i++) {
    const page = doc.addPage();
    page.drawText(`Ficha de fracciones ${options.marker ?? ""}`, { x: 50, y: 700, size: 14, font });
  }
  const bytes = Buffer.from(await doc.save({ useObjectStreams: false }));
  // pdf-lib writes text as hex strings, so the marker is appended as a plain PDF comment after %%EOF:
  // still a valid PDF, and the mock provider can find it in the raw bytes.
  return options.marker ? Buffer.concat([bytes, Buffer.from(`\n% ${options.marker}\n`)]) : bytes;
}

export const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

export async function chooseFile(page: Page, file: { name: string; mimeType: string; buffer: Buffer }) {
  await page.locator('input[type="file"]').setInputFiles(file);
}

/** Uploads a PDF from /app/adaptar and waits for the material page. Returns the material id. */
export async function uploadAndOpen(page: Page, file: { name: string; mimeType: string; buffer: Buffer }): Promise<string> {
  await page.goto("/app/adaptar");
  await chooseFile(page, file);
  await page.getByRole("button", { name: "Analizar material" }).click();
  await expect(page).toHaveURL(/\/app\/materiales\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  return page.url().split("/").pop()!;
}

export async function waitForAnalysis(page: Page) {
  await expect(page.getByRole("heading", { name: "Adaptaula ha identificado" })).toBeVisible({ timeout: 45_000 });
}

/** Page alerts, excluding Next's route announcer (which is also role="alert"). */
export const alertOf = (page: Page) => page.locator('[role="alert"]:not(#__next-route-announcer__)');

const FAKE_SUPABASE = `http://127.0.0.1:${process.env.FAKE_SUPABASE_PORT ?? 54399}`;
const FAKE_SERVICE_KEY = process.env.FAKE_SERVICE_KEY ?? "sb_secret_fakefakefakefakefake";
const serviceHeaders = { apikey: FAKE_SERVICE_KEY, authorization: `Bearer ${FAKE_SERVICE_KEY}`, "content-type": "application/json" };

/** Workspace of a user created in this run, looked up with the (fake) service key. Only for the local test double. */
export async function workspaceOf(page: Page, email: string): Promise<string> {
  const users = (await (await page.request.get(`${FAKE_SUPABASE}/auth/v1/admin/users`, { headers: serviceHeaders })).json()) as { users: Array<{ id: string; email: string }> };
  const user = users.users.find((u) => u.email === email);
  if (!user) throw new Error("usuario de prueba no encontrado");
  const rows = (await (await page.request.get(`${FAKE_SUPABASE}/rest/v1/workspaces?select=id&owner_id=eq.${user.id}`, { headers: serviceHeaders })).json()) as Array<{ id: string }>;
  return rows[0]!.id;
}

/** Net analysis units reserved by a workspace this month (reservations minus refunds). */
export async function analysisUnits(page: Page, workspaceId: string): Promise<number> {
  const rows = (await (await page.request.get(`${FAKE_SUPABASE}/rest/v1/usage_events?select=units&workspace_id=eq.${workspaceId}&kind=eq.analysis`, { headers: serviceHeaders })).json()) as Array<{ units: number }>;
  return rows.reduce((n, r) => n + r.units, 0);
}

/** Pretends the workspace already used `units` analyses (a prior reservation), so a limit can be reached without ten uploads. */
export async function reserveAnalyses(page: Page, workspaceId: string, units: number) {
  const response = await page.request.post(`${FAKE_SUPABASE}/rest/v1/usage_events`, {
    headers: serviceHeaders,
    data: { workspace_id: workspaceId, kind: "analysis", units, idempotency_key: `e2e-prefill:${workspaceId}` },
  });
  expect(response.ok()).toBe(true);
}
