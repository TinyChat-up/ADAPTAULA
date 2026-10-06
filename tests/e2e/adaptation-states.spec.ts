import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { allowAdaptations, seedAwaitingReview, seedReadyWithWarnings, seedWorking } from "./adaptation-seed";
import { makePdf, signUpAndOnboard, uniqueEmail, uploadAndOpen, waitForAnalysis, workspaceOf } from "./helpers";

/**
 * Las pantallas de los estados avanzados en el navegador (desktop y móvil con los proyectos de playwright.config.ts), con las
 * filas que escribiría el pipeline real y sin ninguna llamada a un proveedor.
 */
const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const seriousViolations = async (page: Page) => (await new AxeBuilder({ page }).analyze()).violations.filter((v) => v.impact === "serious" || v.impact === "critical");

async function createAdaptation(page: Page, materialUrl: string): Promise<string> {
  await page.goto(materialUrl);
  await page.getByLabel("Perfil").selectOption({ label: "M.R." });
  await page.getByRole("button", { name: "Adaptar material" }).click();
  await expect(page).toHaveURL(/\/app\/adaptaciones\/[0-9a-f-]{36}$/);
  return page.url().split("/").pop()!;
}

test("PlanReview, trabajando (con diálogo) y ready con observaciones: sin desbordes, apilado y utilizable", async ({ page }) => {
  test.setTimeout(300_000);
  const email = uniqueEmail();
  await signUpAndOnboard(page, email);
  await page.goto("/app/alumnos/nuevo");
  await page.getByLabel("Alias o iniciales").fill("M.R.");
  await page.getByLabel("Etapa").selectOption({ label: "Educación Primaria" });
  await page.getByLabel("Curso").selectOption({ label: "5.º de Primaria" });
  await page.getByRole("button", { name: "Crear perfil" }).click();
  await expect(page).toHaveURL(/\/app\/alumnos/);
  await uploadAndOpen(page, { name: "Ficha.pdf", mimeType: "application/pdf", buffer: await makePdf({ marker: `st-${Date.now()}-${Math.random()}` }) });
  await waitForAnalysis(page);
  const material = page.url();
  const workspaceId = await workspaceOf(page, email);
  await allowAdaptations(page);
  const mobile = (page.viewportSize()?.width ?? 1280) < 640;

  // 1 · PlanReview.
  const review = await createAdaptation(page, material);
  await seedAwaitingReview(page, workspaceId, review);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Adaptaula propone 5 cambios. Revísalos antes de crear la ficha." })).toBeVisible();
  expect(await noOverflow(page)).toBe(true);
  const cards = page.locator("fieldset").filter({ has: page.getByRole("radiogroup") });
  await expect(cards).toHaveCount(5);
  const boxes = await cards.evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => ({ top: r.top + window.scrollY, bottom: r.bottom + window.scrollY, left: r.left, width: r.width })));
  for (let i = 1; i < boxes.length; i++) {
    expect(boxes[i]!.top).toBeGreaterThanOrEqual(boxes[i - 1]!.bottom - 1);
    expect(Math.abs(boxes[i]!.left - boxes[0]!.left)).toBeLessThan(2);
    expect(Math.abs(boxes[i]!.width - boxes[0]!.width)).toBeLessThan(2);
  }
  const viewport = page.viewportSize()!.width;
  expect(boxes[0]!.left).toBeGreaterThanOrEqual(0);
  expect(boxes[0]!.left + boxes[0]!.width).toBeLessThanOrEqual(viewport);
  if (mobile) {
    const first = cards.first();
    const what = await first.getByText("Qué se propone").boundingBox();
    const why = await first.getByText("Por qué").boundingBox();
    expect(why!.y).toBeGreaterThan(what!.y + 10);
  }
  // Controls: radios are reachable and big enough; the blocked decision cannot be approved.
  const approve = cards.nth(0).getByRole("radio", { name: "Aprobar" });
  await approve.check();
  await expect(approve).toBeChecked();
  const target = await cards.nth(0).locator("label", { hasText: "Aprobar" }).boundingBox();
  expect(target!.height).toBeGreaterThanOrEqual(24);
  await expect(cards.nth(4).getByRole("radio", { name: "Aprobar" })).toBeDisabled();
  await expect(cards.nth(4).getByRole("radio", { name: "Descartar" })).toBeChecked();
  await expect(page.getByText(/MENSAJE_TECNICO|NOTA_INTERNA|need_|dec_\d/)).toHaveCount(0);
  // The primary CTA is reachable, and an incomplete review is explained instead of sent.
  const save = page.getByRole("button", { name: "Guardar revisión" });
  await save.scrollIntoViewIfNeeded();
  await expect(save).toBeVisible();
  await save.click();
  await expect(page.getByText("Elige qué hacer con este cambio.").first()).toBeVisible();
  // Adjust opens structured controls without breaking the layout.
  await cards.nth(1).getByRole("radio", { name: "Ajustar" }).check();
  await expect(cards.nth(1).getByText("Ajustar este cambio")).toBeVisible();
  expect(await noOverflow(page)).toBe(true);
  expect(await seriousViolations(page)).toEqual([]);

  // 2 · Trabajando: the cancel dialog is usable.
  const working = await createAdaptation(page, material);
  await seedWorking(page, working);
  await page.reload();
  await expect(page.getByText("Estamos creando el material con los cambios que has aprobado.")).toBeVisible();
  expect(await noOverflow(page)).toBe(true);
  await page.getByRole("button", { name: "Cancelar adaptación" }).click();
  const dialog = page.getByRole("dialog", { name: "¿Cancelar esta adaptación?" });
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  await expect(dialog.getByRole("button", { name: "Sí, cancelar" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Cancelar", exact: true })).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  // 3 · Ready con observaciones.
  const ready = await createAdaptation(page, material);
  await seedReadyWithWarnings(page, workspaceId, ready);
  await page.reload();
  await expect(page.getByText("Material preparado con observaciones")).toBeVisible();
  await expect(page.getByText("Hay una ayuda repetida")).toBeVisible();
  await expect(page.getByText("presentación final")).toBeVisible();
  await expect(page.getByText(/R1|blk_|need_|traceability_complete/)).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Volver al material" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Volver al material" }).last()).toBeInViewport({ ratio: 0.1 });
  expect(await noOverflow(page)).toBe(true);
  expect(await seriousViolations(page)).toEqual([]);
});
