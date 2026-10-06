import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { allowAdaptations, requireVisuals, seedReadyDocument } from "./adaptation-seed";
import { chooseFile, signUpAndOnboard, uniqueEmail, waitForAnalysis, workspaceOf } from "./helpers";
import { primaria } from "../support/render-fixtures";
import { visualFixturePdf } from "../support/visual-fixture";

/**
 * Localización humana de un visual necesario, de punta a punta en el navegador (proyectos desktop y mobile): vista docente con
 * el visual faltante → «Localizar en el original» → otra página → selección → confirmar → recorte producido en el servidor →
 * la vista del alumno ya se puede mostrar e imprimir. Sin IA: el análisis es el simulado y el recorte sale del PDF sintético.
 */
async function setup(page: Page) {
  const email = uniqueEmail();
  await signUpAndOnboard(page, email);
  await page.goto("/app/alumnos/nuevo");
  await page.getByLabel("Alias o iniciales").fill("M.R.");
  await page.getByLabel("Etapa").selectOption({ label: "Educación Primaria" });
  await page.getByLabel("Curso").selectOption({ label: "5.º de Primaria" });
  await page.getByRole("button", { name: "Crear perfil" }).click();
  await expect(page).toHaveURL(/\/app\/alumnos/);
  await page.goto("/app/adaptar");
  await chooseFile(page, { name: "Ficha con figuras.pdf", mimeType: "application/pdf", buffer: Buffer.from(await visualFixturePdf({ cropBoxPage: false })) });
  await page.getByRole("button", { name: "Analizar material" }).click();
  await expect(page).toHaveURL(/\/app\/materiales\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  await waitForAnalysis(page);
  const materialUrl = page.url();
  const workspaceId = await workspaceOf(page, email);
  await allowAdaptations(page);
  await page.getByLabel("Perfil").selectOption({ label: "M.R." });
  await page.getByRole("button", { name: "Adaptar material" }).click();
  await expect(page).toHaveURL(/\/app\/adaptaciones\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  const id = page.url().split("/").pop()!;
  await seedReadyDocument(page, workspaceId, id, primaria());
  await requireVisuals(page, id, ["vis_2"]);
  return { id, materialId: materialUrl.split("/").pop()! };
}

async function dragOnPage(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  const overlay = page.getByTestId("selection-overlay");
  await overlay.scrollIntoViewIfNeeded();
  const box = (await overlay.boundingBox())!;
  await page.mouse.move(box.x + box.width * from.x, box.y + box.height * from.y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * ((from.x + to.x) / 2), box.y + box.height * ((from.y + to.y) / 2), { steps: 4 });
  await page.mouse.move(box.x + box.width * to.x, box.y + box.height * to.y, { steps: 4 });
  await page.mouse.up();
}

test("visual necesario: no renderizable → localizar en el original → recorte del servidor → vista del alumno renderizable e imprimible", async ({ page, browser }) => {
  test.setTimeout(300_000);
  const { id, materialId } = await setup(page);
  const mobile = (page.viewportSize()?.width ?? 1280) < 640;

  // 1 · Student view is blocked; the teacher view says why and offers to locate it.
  await page.goto(`/app/adaptaciones/${id}/vista?modo=alumno`);
  await expect(page.getByText("Esta ficha todavía no se puede mostrar completa.")).toBeVisible();
  await page.goto(`/app/adaptaciones/${id}/vista`);
  await expect(page.getByText("todavía no se ha señalado dónde está en el original").first()).toBeVisible();
  await page.getByRole("link", { name: "Localizar en el original" }).click();
  await expect(page).toHaveURL(new RegExp(`/app/materiales/${materialId}/visuales/vis_2\\?volver=`));
  await expect(page.getByRole("heading", { name: "Localizar en el original", level: 1 })).toBeVisible();
  if (mobile) await expect(page.getByText("Para seleccionar con precisión, abre esta herramienta en una pantalla más grande.")).toBeVisible();
  await expect(page.getByText(/RESPUESTA|answer|diagn/i)).toHaveCount(0);

  // 2 · The figure is not on the page the analysis said: go to page 2. An empty selection cannot be confirmed.
  await expect(page.getByText("Página 1 de 5")).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirmar selección" })).toBeDisabled();
  await page.getByRole("button", { name: "Siguiente" }).click();
  await expect(page.getByText("Página 2 de 5")).toBeVisible();
  await expect(page.getByText("El análisis situaba este recurso en la página 1.")).toBeVisible();
  await expect(page.getByRole("img", { name: "Página 2 del original" })).toBeVisible();

  // 3 · Zoom does not change the stored (page) coordinates: select at 150 %, read the fine-tuning fields, zoom back.
  if (!mobile) await page.getByRole("button", { name: "Acercar" }).click();
  await dragOnPage(page, { x: 0.15, y: 0.22 }, { x: 0.58, y: 0.37 });
  const fields = page.getByRole("group", { name: "Ajuste fino de la selección (en % de la página)" }).getByRole("spinbutton");
  const values = async () => Promise.all([0, 1, 2, 3].map(async (i) => Number(await fields.nth(i).inputValue())));
  const atZoom = await values();
  expect(atZoom[0]).toBeCloseTo(15, 0);
  expect(atZoom[2]).toBeCloseTo(43, 0);
  if (!mobile) {
    await page.getByRole("button", { name: "Alejar" }).click();
    expect(await values()).toEqual(atZoom);
  }
  await expect(page.getByRole("img", { name: "Vista previa del recorte" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const serious = (await new AxeBuilder({ page }).include("main").analyze()).violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious).toEqual([]);

  // 4 · Confirm: the server crops the original and the viewer comes back with the visual ready.
  await page.getByRole("button", { name: "Confirmar selección" }).click();
  await expect(page).toHaveURL(new RegExp(`/app/adaptaciones/${id}/vista$`), { timeout: 60_000 });
  await expect(page.getByText(/localizada a mano en la página 2 \(revisión 1\)/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Corregir la localización" })).toBeVisible();

  // 5 · Student view: renderable, the crop loads from the authorised route, keeps its aspect ratio and fits the sheet.
  await page.goto(`/app/adaptaciones/${id}/vista?modo=alumno`);
  await expect(page.getByText("Esta ficha todavía no se puede mostrar completa.")).toHaveCount(0);
  const img = page.locator(`.ms-sheet img[src="/api/adaptations/${id}/visuals/vis_2"]`);
  await expect(img).toBeVisible();
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
  const geometry = async () =>
    img.evaluate((el: HTMLImageElement) => {
      const r = el.getBoundingClientRect();
      const sheet = el.closest(".ms-sheet")!.getBoundingClientRect();
      return { ratio: r.width / r.height, natural: el.naturalWidth / el.naturalHeight, inside: r.left >= sheet.left - 1 && r.right <= sheet.right + 1 };
    });
  const screen = await geometry();
  expect(screen.inside).toBe(true);
  expect(Math.abs(screen.ratio - screen.natural) / screen.natural).toBeLessThan(0.02);
  await page.emulateMedia({ media: "print" });
  const printed = await geometry();
  expect(printed.inside).toBe(true);
  expect(Math.abs(printed.ratio - printed.natural) / printed.natural).toBeLessThan(0.02);
  await page.emulateMedia({ media: "screen" });

  // 6 · Another account: no page preview, no crop, no locate.
  const other = await browser.newContext();
  const intruder = await other.newPage();
  await signUpAndOnboard(intruder, uniqueEmail());
  expect((await intruder.request.get(`/api/adaptations/${id}/visuals/vis_2`)).status()).toBe(404);
  expect((await intruder.request.get(`/api/materials/${materialId}/pages/2`)).status()).toBe(404);
  const forged = await intruder.request.post(`/api/materials/${materialId}/visuals/vis_2`, { data: { action: "locate", page: 2, bounds: { x: 0.1, y: 0.1, w: 0.3, h: 0.3 } }, headers: { origin: new URL(page.url()).origin } });
  expect(forged.status()).toBe(404);
  await other.close();
  // Without a session there is nothing either.
  const anonymous = await browser.newContext();
  expect((await (await anonymous.newPage()).request.get(`${new URL(page.url()).origin}/api/adaptations/${id}/visuals/vis_2`)).status()).toBe(401);
  await anonymous.close();
});
