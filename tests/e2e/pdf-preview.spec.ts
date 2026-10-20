import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import AxeBuilder from "@axe-core/playwright";
import { test, expect, type Page, type TestInfo } from "@playwright/test";
import { createReviewedAdaptation, signUpAndOnboard, uniqueEmail, uploadAndOpen, waitForAnalysis, workspaceOf } from "./helpers";
import { requireVisuals, seedReadyDocument } from "./adaptation-seed";
import { reviewDocument, reviewOriginal } from "../support/review-documents";
import { printPreviewDocument } from "../support/print-preview-document";

const fake = "http://127.0.0.1:54399";
const key = "sb_secret_fakefakefakefakefake";
const headers = { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" };
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
async function fixture(page: Page, long = false) {
  const email = uniqueEmail();
  await signUpAndOnboard(page, email);
  await page.getByLabel("Alias o iniciales").fill("Perfil sintético");
  await page.getByLabel("Etapa").selectOption({ label: "Educación Primaria" });
  await page.getByLabel("Curso").selectOption({ label: "5.º de Primaria" });
  await page.getByRole("button", { name: "Crear perfil", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/alumnos/);
  const bytes = await reviewOriginal(email);
  const materialId = await uploadAndOpen(page, { name: "Prueba de impresión.pdf", mimeType: "application/pdf", buffer: bytes });
  await waitForAnalysis(page);
  const id = await createReviewedAdaptation(page, `/app/materiales/${materialId}`, "Perfil sintético");
  const workspace = await workspaceOf(page, email);
  const document = long ? printPreviewDocument() : reviewDocument();
  await seedReadyDocument(page, workspace, id, document);
  await requireVisuals(page, id, []);
  return { id, workspace, materialId, bytes, document };
}
async function capture(page: Page, info: TestInfo, name: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: false, style: "nextjs-portal { display: none; }" });
}
async function accessible(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
}

test("PDF real de once hojas: preparación a petición, visor y descarga idénticos", async ({ page }, info) => {
  test.setTimeout(180000);
  const w = await fixture(page, true);
  let calls = 0;
  page.on("request", (r) => { if (r.url().endsWith(`/api/adaptations/${w.id}/pdf?version=1`)) calls++; });
  await page.goto(`/app/adaptaciones/${w.id}/vista`);
  expect(calls).toBe(0);
  const response = page.waitForResponse((r) => r.url().endsWith(`/api/adaptations/${w.id}/pdf?version=1`));
  const trigger = page.getByRole("button", { name: "Vista previa de impresión", exact: true });
  // Two immediate clicks must still start one expensive request.
  await trigger.evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  const dialog = page.getByRole("dialog", { name: "Vista previa de impresión" });
  const res = await response;
  expect(res.status()).toBe(200);
  expect(res.headers()["cache-control"]).toBe("private, no-store");
  expect(res.headers()["x-pdf-page-count"]).toBe("11");
  await expect(dialog.getByText("11 hojas A4 · PDF definitivo", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Adaptación generada", { exact: true })).toBeVisible();
  const source = (await dialog.getByRole("link", { name: "Descargar PDF", exact: true }).getAttribute("href"))!;
  // Chromium's DevTools can return an empty network body once its native PDF viewer takes over. Read the actual Blob instead.
  const prepared = new Uint8Array(await page.evaluate(async (url) => [...new Uint8Array(await (await fetch(url)).arrayBuffer())], source));
  expect((await PDFDocument.load(prepared)).getPageCount()).toBe(11);
  const viewer = dialog.locator("iframe");
  if (await page.evaluate(() => navigator.pdfViewerEnabled)) {
    await expect(viewer).toBeVisible();
    const url = (await viewer.getAttribute("src"))!.split("#")[0]!;
    const viewedHash = await page.evaluate(async (url) => {
      const bytes = await (await fetch(url)).arrayBuffer();
      return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((n) => n.toString(16).padStart(2, "0")).join("");
    }, url);
    expect(viewedHash).toBe(hash(prepared));
    // A full Chromium build exposes its real PDF extension. Serverless builds may only expose the fallback.
    await expect.poll(() => page.frames().some((f) => f.url().startsWith("chrome-extension://"))).toBe(true);
    const native = page.frames().find((f) => f.url().startsWith("chrome-extension://"))!;
    await expect(native.locator("pdf-viewer")).toBeVisible();
    await expect(native.locator("viewer-toolbar #progress")).toHaveAttribute("aria-valuenow", "100");
    if (info.project.name === "desktop") {
      const number = native.locator("viewer-page-selector input");
      await number.fill("11"); await number.press("Enter");
      await expect(number).toHaveValue("11");
      const zoom = native.getByRole("textbox", { name: "Zoom level" });
      await zoom.fill("125%"); await zoom.press("Enter");
      await expect(zoom).toHaveValue("125%");
      await capture(page, info, "pdf-hoja-11-zoom");
      await number.fill("3"); await number.press("Enter");
      await zoom.fill("75%"); await zoom.press("Enter");
      await capture(page, info, "pdf-tabla-y-figura");
      await number.fill("1"); await number.press("Enter");
      await zoom.fill("100%"); await zoom.press("Enter");
    }
  }
  await accessible(page);
  await capture(page, info, "pdf-generado-once-hojas");
  const download = page.waitForEvent("download");
  await dialog.getByRole("link", { name: "Descargar PDF", exact: true }).click();
  const file = await download;
  expect(await file.failure()).toBeNull();
  await file.saveAs(info.outputPath("mismo-pdf-once-hojas.pdf"));
  expect(hash(readFileSync((await file.path())!))).toBe(hash(prepared));
  expect(calls).toBe(1);
  await dialog.getByRole("button", { name: "Cerrar vista previa de impresión" }).click();
  await expect(trigger).toBeFocused();
  expect(hash(await (await page.request.get(`/api/materials/${w.materialId}/file`)).body())).toBe(hash(w.bytes));
  const persisted = await (await page.request.get(`${fake}/rest/v1/adaptation_versions?adaptation_id=eq.${w.id}&select=document`, { headers })).json();
  expect(persisted[0].document).toEqual(w.document);
});

test("revisión guardada fija, cambios pendientes y alternativa sin visor", async ({ page }, info) => {
  test.setTimeout(180000);
  const w = await fixture(page);
  const origin = new URL(page.url()).origin;
  const changes = { presentation: { font_scale: 1.15, spacing: "wide" }, activities: [{ blockId: "blk_task1", prompt: "Compara las dos medidas y justifica tu elección.", lines: 8 }] };
  const save = async (revision: number) => expect((await page.request.put(`/api/adaptations/${w.id}/draft`, { headers: { origin }, data: { baseVersion: 1, revision, changes: revision === 3 ? { ...changes, activities: [{ blockId: "blk_task1", prompt: "Revisión posterior distinta que no debe reemplazar la vista.", lines: 4 }] } : changes, acknowledged: true } })).ok()).toBe(true);
  await save(0); await save(1); await save(2);
  await page.goto(`/app/adaptaciones/${w.id}/editar`);
  const prompt = page.getByLabel("Enunciado", { exact: true });
  await prompt.fill("Cambios locales pendientes.");
  const trigger = page.getByRole("button", { name: "Vista previa de impresión", exact: true });
  await expect(trigger).toBeDisabled();
  await expect(page.getByText(/guarda los cambios para previsualizar/)).toBeVisible();
  await page.getByRole("button", { name: "Recuperar último guardado", exact: true }).click();
  await expect(prompt).toHaveValue(changes.activities[0]!.prompt);
  await expect(trigger).toBeEnabled();
  // Explicitly exercise the capability fallback; this is not a Safari validation.
  await page.evaluate(() => Object.defineProperty(navigator, "pdfViewerEnabled", { configurable: true, value: false }));
  const request = page.waitForRequest((r) => r.url().endsWith(`/api/adaptations/${w.id}/pdf?borrador=3&version=1`));
  await trigger.click(); await request;
  const dialog = page.getByRole("dialog", { name: "Vista previa de impresión" });
  await expect(dialog.getByText("Tu navegador no ofrece un visor PDF integrado.", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Borrador guardado · revisión 3", { exact: true })).toBeVisible();
  const source = (await dialog.getByRole("link", { name: "Descargar PDF", exact: true }).getAttribute("href"))!;
  const prepared = new Uint8Array(await page.evaluate(async (url) => [...new Uint8Array(await (await fetch(url)).arrayBuffer())], source));
  await save(3);
  await expect(dialog.getByText("Borrador guardado · revisión 3", { exact: true })).toBeVisible();
  const download = page.waitForEvent("download");
  await dialog.getByRole("link", { name: "Descargar PDF", exact: true }).click();
  const file = await download;
  expect(await file.failure()).toBeNull();
  expect(hash(readFileSync((await file.path())!))).toBe(hash(prepared));
  await capture(page, info, "revision-3-alternativa-accesible");
  await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "active" });
  await accessible(page);
  await page.emulateMedia({ forcedColors: "none" });
  await page.setViewportSize({ width: 320, height: 900 });
  await page.addStyleTag({ content: "html { font-size: 200%; }" });
  await accessible(page);
  await dialog.getByRole("button", { name: "Volver a editar", exact: true }).click();
  await expect(prompt).toHaveValue(changes.activities[0]!.prompt);
  await expect(trigger).toBeFocused();
});

test("errores, cuerpo interrumpido, reintento explícito y cierre durante preparación", async ({ page }) => {
  test.setTimeout(180000);
  const w = await fixture(page);
  await page.goto(`/app/adaptaciones/${w.id}/vista`);
  const path = `**/api/adaptations/${w.id}/pdf?version=1`;
  await page.route(path, (route) => route.fulfill({ status: 503, json: { error: { code: "render_failed", message: "No hemos podido preparar el PDF." } } }));
  const trigger = page.getByRole("button", { name: "Vista previa de impresión", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Vista previa de impresión" });
  await expect(dialog.getByText("No se ha podido preparar la vista previa.", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("link", { name: "Descargar PDF" })).toHaveCount(0);
  await page.unroute(path);
  // Deliberately truncated payload AFTER PDF headers, not a real export or a successful preview.
  await page.route(path, (route) => route.fulfill({ status: 200, headers: { "content-type": "application/pdf", "x-pdf-page-count": "2", "x-pdf-byte-length": "1000", "x-pdf-revision": "generated" }, body: "%PDF-1.7\npartial" }));
  await dialog.getByRole("button", { name: "Volver a intentarlo" }).click();
  await expect(dialog.getByText("No se ha podido preparar la vista previa.", { exact: true })).toBeVisible();
  await expect(dialog.locator("iframe")).toHaveCount(0);
  await page.unroute(path);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route(path, async (route) => { await gate; await route.abort().catch(() => { /* closing the dialog already aborted this intercepted request */ }); });
  await dialog.getByRole("button", { name: "Volver a intentarlo" }).click();
  await expect(dialog.getByText(/Preparando el PDF definitivo/)).toBeVisible();
  await dialog.getByRole("button", { name: "Cerrar vista previa de impresión" }).press("Escape");
  await expect(dialog).toHaveCount(0);
  release(); await page.unroute(path);
  await expect(trigger).toBeEnabled();
  await trigger.click();
  await expect(dialog.getByText(/hojas A4 · PDF definitivo/)).toBeVisible();
  const source = (await dialog.getByRole("link", { name: "Descargar PDF", exact: true }).getAttribute("href"))!;
  await dialog.getByRole("button", { name: "Cerrar vista previa de impresión" }).click();
  expect(await page.evaluate(async (url) => fetch(url).then(() => true, () => false), source)).toBe(false);
});
