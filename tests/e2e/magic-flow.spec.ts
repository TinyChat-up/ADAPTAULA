import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { allowAdaptations, seedBlockedMagic, unlinkChoicesFromTables } from "./adaptation-seed";
import { createReviewedAdaptation, expectPdfDownload, makePdf, signUpAndOnboard, uniqueEmail, uploadAndOpen, waitForAnalysis, workspaceOf } from "./helpers";

test.describe.configure({ mode: "serial" });

/**
 * «Hacer magia» en el navegador (proyectos desktop y mobile), contra la app real (fake-supabase con las migraciones reales) y el
 * pipeline simulado: el mismo pipeline que «Revisar antes de crear», sin la aprobación humana del plan. Cero llamadas a modelos.
 */

const FAKE = `http://127.0.0.1:${process.env.FAKE_SUPABASE_PORT ?? 54399}`;
const KEY = process.env.FAKE_SERVICE_KEY ?? "sb_secret_fakefakefakefakefake";
const service = { apikey: KEY, authorization: `Bearer ${KEY}`, "content-type": "application/json" };
/** Machinery words that must never reach the teacher (plus vendors, money and fake percentages). */
const INTERNAL = /planner|generator|reviewer|revisor|\bjob\b|\bcola\b|queue|schema|pipeline|Anthropic|Claude|OpenAI|GPT|token|\d+ ?%/i;
/** What the teacher reads in `main`, without the zoom readout of the original's viewer («100 %» is a zoom level, not progress). */
const mainText = async (page: Page) => {
  const zooms = await page.locator("main").getByRole("status", { name: "Zoom del original" }).allInnerTexts();
  return zooms.reduce((text, zoom) => text.replace(zoom, ""), await page.locator("main").innerText());
};

const serious = async (page: Page) => (await new AxeBuilder({ page }).analyze()).violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id);
const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

async function teacherWithMaterial(page: Page) {
  const email = uniqueEmail();
  await signUpAndOnboard(page, email);
  await allowAdaptations(page);
  const materialId = await uploadAndOpen(page, { name: "Ficha.pdf", mimeType: "application/pdf", buffer: await makePdf({ marker: `mg-${Date.now()}-${Math.random()}` }) });
  await waitForAnalysis(page);
  await unlinkChoicesFromTables(page, materialId);
  await page.getByRole("link", { name: "Crear un perfil" }).click();
  await page.getByLabel("Alias o iniciales").fill("M.R.");
  await page.getByLabel("Etapa").selectOption({ label: "Educación Primaria" });
  await page.getByLabel("Curso").selectOption({ label: "5.º de Primaria" });
  // Needs, so the plan has decisions to show and change (the profile is the only source: nothing is asked again later).
  await page.getByLabel("Punto de partida", { exact: true }).selectOption({ label: "Atención, planificación y organización" });
  await page.getByRole("button", { name: "Aplicar" }).click();
  await page.getByRole("button", { name: "Crear perfil" }).click();
  // Back on the material with the profile chosen: straight to the decision, nothing asked again.
  await expect(page).toHaveURL(new RegExp(`/app/materiales/${materialId}\\?perfil=`));
  await expect(page.getByLabel("Perfil")).not.toHaveValue("");
  return { email, materialId, workspaceId: await workspaceOf(page, email) };
}

const adaptationIdOf = (page: Page) => /\/app\/adaptaciones\/([0-9a-f-]{36})/.exec(page.url())![1]!;
const downloadPdf = (page: Page) => expectPdfDownload(page, adaptationIdOf(page), () => page.getByRole("button", { name: "Descargar PDF" }).first().click());

/** The stages the progress list shows, by their label only (each item also carries its state: «(hecho)», «(en curso)»…). */
const MAGIC_STAGES = ["Analizando el material", "Preparando la adaptación", "Organizando las actividades", "Creando la ficha", "Comprobando el resultado", "Ficha lista"];

test("Hacer magia: material + perfil → progreso → ficha final → PDF, sin aprobar nada", async ({ page }) => {
  test.setTimeout(300_000);
  const { materialId } = await teacherWithMaterial(page);

  await expect(page.getByRole("heading", { name: "¿Cómo quieres preparar esta ficha?" })).toBeVisible();
  await expect(page.getByText("Adaptaula usará el perfil del alumno para preparar y revisar la ficha automáticamente.")).toBeVisible();
  await expect(page.getByText("Revisa cómo se adaptará el material y cambia lo que necesites antes de crear la ficha.")).toBeVisible();
  expect(await serious(page)).toEqual([]);
  expect(await noOverflow(page)).toBe(true);

  // A double click creates (and starts) one adaptation.
  await page.getByRole("button", { name: "Hacer magia" }).dblclick();
  await expect(page).toHaveURL(/\/app\/adaptaciones\/[0-9a-f-]{36}/);
  const adaptationUrl = new URL(page.url()).pathname.replace(/\/vista$/, "");

  // Progress in product language (rendered by the server before the first stage ends), then the sheet itself.
  if (!page.url().endsWith("/vista")) {
    const stages = page.getByRole("list", { name: "Fases de la adaptación" });
    if (await stages.isVisible()) {
      const items = (await stages.getByRole("listitem").allInnerTexts()).map((t) => t.split("\n")[0]!.trim());
      // Every stage of the automatic route, in order; the teacher's review is never one of them.
      expect(items.filter((label) => MAGIC_STAGES.includes(label))).toEqual(MAGIC_STAGES);
      expect(items).not.toContain("Tu revisión");
      expect((await stages.innerText())).not.toMatch(INTERNAL);
      // Refreshing in the middle resumes it; nothing is created twice.
      await page.reload();
    }
  }
  await expect(page).toHaveURL(new RegExp(`${adaptationUrl}/vista$`), { timeout: 60_000 });
  await expect(page.locator(".ms-sheet").first()).toBeVisible();
  expect(await mainText(page)).not.toMatch(INTERNAL);
  expect(await noOverflow(page)).toBe(true);
  await downloadPdf(page);

  // The adaptation page of a delivered magic sheet: the result, never the plan review.
  await page.goto(adaptationUrl);
  await expect(page.getByText(/La ficha está lista/).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Así prepararemos esta ficha" })).toHaveCount(0);

  // Exactly one adaptation (the double click), delivered; going back to the material creates nothing.
  await page.goBack();
  await page.goto(`/app/materiales/${materialId}`);
  await expect(page.locator("section[aria-labelledby=adaptaciones-material]").getByText("Ficha preparada")).toHaveCount(1);
  await page.goto("/app/historial");
  await expect(page.getByText("Ficha preparada")).toHaveCount(1);
  await expect(page.getByText(/Esperando tu revisión|Preparando la adaptación/)).toHaveCount(0);
});

test("Hacer magia y la revisión bloquea: no se entrega, se explica sin tecnicismos y se corrige", async ({ page }) => {
  test.setTimeout(300_000);
  const { materialId, workspaceId } = await teacherWithMaterial(page);
  const id = await createReviewedAdaptation(page, `/app/materiales/${materialId}`);
  await seedBlockedMagic(page, workspaceId, id);
  await page.reload();

  // «Hacer magia» never says «La ficha necesita una revisión»: it stops with the reason and offers editing (docs/UX.md).
  await expect(page.getByText("No hemos podido completar automáticamente esta ficha")).toBeVisible();
  await expect(page.getByText("Al comprobar el resultado hemos encontrado algo que no podemos corregir automáticamente sin perder lo que el perfil necesita.")).toBeVisible();
  await expect(page.getByText("La ficha necesita una revisión antes de estar lista")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Descargar PDF" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Ver la ficha" })).toHaveCount(0);
  expect(await mainText(page)).not.toMatch(INTERNAL);
  expect(await serious(page)).toEqual([]);
  expect(await noOverflow(page)).toBe(true);

  // Nothing runs again by itself: reloading keeps it blocked.
  await page.reload();
  await expect(page.getByText("No hemos podido completar automáticamente esta ficha")).toBeVisible();

  // «Revisar y editar» (only an option, only when clicked) → the review, set to the recommendation → correct → «Crear ficha».
  await page.getByRole("button", { name: "Revisar y editar" }).click();
  await expect(page.getByRole("heading", { name: "Así prepararemos esta ficha" })).toBeVisible();
  await expect(page.getByText("Corrige lo que necesites y vuelve a crear la ficha.")).toBeVisible();
  const first = page.locator("form ol > li > fieldset").first();
  await first.getByRole("button", { name: /^Cambiar/ }).click();
  await first.getByRole("radio", { name: "No aplicar" }).check();
  await page.getByRole("button", { name: "Crear ficha" }).click();
  await expect(page).toHaveURL(new RegExp(`/app/adaptaciones/${id}/vista$`), { timeout: 60_000 });
  await expect(page.getByRole("button", { name: "Descargar PDF" }).first()).toBeVisible();
});

async function viewerOf(browser: Browser, owner: Page, workspaceId: string) {
  const other = await browser.newContext({ viewport: owner.viewportSize() ?? undefined });
  const viewer = await other.newPage();
  const email = uniqueEmail();
  await signUpAndOnboard(viewer, email);
  const users = (await (await viewer.request.get(`${FAKE}/auth/v1/admin/users`, { headers: service })).json()) as { users: Array<{ id: string; email: string }> };
  const viewerId = users.users.find((u) => u.email === email)!.id;
  expect((await viewer.request.post(`${FAKE}/rest/v1/workspace_members`, { headers: service, data: { workspace_id: workspaceId, user_id: viewerId, role: "viewer" } })).ok()).toBe(true);
  await other.addCookies([{ name: "aw", value: workspaceId, url: new URL(owner.url()).origin }]);
  return { viewer, close: () => other.close() };
}

test("solo lectura: ve la ficha mágica y descarga el PDF; no puede hacer magia, crear, aprobar ni regenerar", async ({ page, browser }) => {
  test.setTimeout(300_000);
  const { materialId, workspaceId } = await teacherWithMaterial(page);
  await page.getByRole("button", { name: "Hacer magia" }).click();
  await expect(page).toHaveURL(/\/app\/adaptaciones\/[0-9a-f-]{36}\/vista$/, { timeout: 60_000 });
  const vista = new URL(page.url()).pathname;
  const adaptationUrl = vista.replace(/\/vista$/, "");

  const { viewer, close } = await viewerOf(browser, page, workspaceId);
  const writes: string[] = [];
  viewer.on("request", (r) => {
    if (r.method() === "POST" && (r.url().includes("/run") || r.headers()["next-action"])) writes.push(r.url());
  });

  await viewer.goto(adaptationUrl);
  await expect(viewer.getByText(/La ficha está lista/).first()).toBeVisible();
  await expect(viewer.getByRole("link", { name: "Ver la ficha" })).toBeVisible();
  await expect(viewer.getByRole("button", { name: /Revisar adaptación|Crear ficha|Cancelar adaptación|Reintentar|^Cambiar/ })).toHaveCount(0);
  await viewer.goto(vista);
  await expect(viewer.locator(".ms-sheet").first()).toBeVisible();
  await downloadPdf(viewer);
  await viewer.goto(`/app/materiales/${materialId}`);
  await expect(viewer.getByText(/solo lectura/).first()).toBeVisible();
  await expect(viewer.getByRole("button", { name: /Hacer magia|Revisar antes de crear/ })).toHaveCount(0);
  expect(writes).toEqual([]);
  await close();
});
