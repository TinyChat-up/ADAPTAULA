import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { createReviewedAdaptation, makePdf, signUpAndOnboard, uniqueEmail, uploadAndOpen, waitForAnalysis } from "./helpers";

test.describe.configure({ mode: "serial" });

/**
 * La UI de adaptación contra la app real (fake-supabase + pipeline simulado, cero llamadas a modelos): crear por «Revisar antes
 * de crear» (crear = empezar) hasta la propuesta, recargar, cancelar y aislamiento. El flujo completo está en
 * teacher-workflow.spec.ts y magic-flow.spec.ts.
 */
async function createProfile(page: Page) {
  await page.goto("/app/alumnos/nuevo");
  await page.getByLabel("Alias o iniciales").fill("M.R.");
  await page.getByLabel("Etapa").selectOption({ label: "Educación Primaria" });
  await page.getByLabel("Curso").selectOption({ label: "5.º de Primaria" });
  await page.getByRole("button", { name: "Crear perfil" }).click();
  await expect(page).toHaveURL(/\/app\/alumnos/);
}

async function analyzedMaterial(page: Page) {
  const id = await uploadAndOpen(page, { name: "Ficha.pdf", mimeType: "application/pdf", buffer: await makePdf({ marker: `ui-${Date.now()}-${Math.random()}` }) });
  await waitForAnalysis(page);
  return id;
}

test("material analizado → elegir perfil → Revisar antes de crear → la propuesta, accesible y recuperable", async ({ page }) => {
  await signUpAndOnboard(page, uniqueEmail());
  await createProfile(page);
  const materialId = await analyzedMaterial(page);

  await expect(page.getByRole("heading", { name: "Adaptar este material" })).toBeVisible();
  await expect(page.getByLabel("Perfil")).toHaveValue(await page.getByLabel("Perfil").inputValue());
  await page.getByLabel("Perfil").selectOption({ label: "M.R." });
  await expect(page.getByRole("heading", { name: "¿Cómo quieres preparar esta ficha?" })).toBeVisible();
  await page.getByRole("button", { name: "Revisar antes de crear" }).click();

  await expect(page).toHaveURL(/\/app\/adaptaciones\/[0-9a-f-]{36}$/);
  const url = page.url();
  await expect(page.getByRole("heading", { name: "Adaptación", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Así prepararemos esta ficha" })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/Anthropic|Claude|OpenAI|GPT|token|diagn/i)).toHaveCount(0);

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.reload();
  await expect(page.getByRole("heading", { name: "Así prepararemos esta ficha" })).toBeVisible();

  await page.goto(`/app/materiales/${materialId}`);
  await expect(page.getByRole("heading", { name: "Adaptaciones de este material" })).toBeVisible();
  // The row says what comes next (the review is waiting) and leads back to the adaptation; going back created nothing new.
  const rows = page.locator("section[aria-labelledby=adaptaciones-material]");
  await expect(rows.getByRole("link")).toHaveCount(1);
  await rows.getByRole("link", { name: /^Revisar adaptación/ }).click();
  await expect(page).toHaveURL(url);
});

test("cancelar pide confirmación, detiene la adaptación y ya no ofrece acciones", async ({ page }) => {
  await signUpAndOnboard(page, uniqueEmail());
  await createProfile(page);
  await analyzedMaterial(page);
  await createReviewedAdaptation(page, page.url());

  await page.getByRole("button", { name: "Cancelar adaptación" }).click();
  const dialog = page.getByRole("dialog", { name: "¿Cancelar esta adaptación?" });
  await expect(dialog.getByText("Se detendrá esta adaptación. Si aún no se había entregado, no contará como una adaptación utilizada.")).toBeVisible();
  await dialog.getByRole("button", { name: "Sí, cancelar" }).click();

  await expect(page.getByRole("heading", { name: "Adaptación cancelada" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Crear ficha" })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Adaptación cancelada" })).toBeVisible();
});

test("otra cuenta no puede abrir la adaptación (404)", async ({ page, browser }) => {
  await signUpAndOnboard(page, uniqueEmail());
  await createProfile(page);
  await analyzedMaterial(page);
  const url = `/app/adaptaciones/${await createReviewedAdaptation(page, page.url())}`;

  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await signUpAndOnboard(otherPage, uniqueEmail());
  const response = await otherPage.goto(url);
  expect(response?.status()).toBe(404);
  await expect(otherPage.getByRole("button", { name: "Crear ficha" })).toHaveCount(0);
  await other.close();
});
