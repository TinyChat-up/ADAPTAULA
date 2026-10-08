import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { allowAdaptations } from "./adaptation-seed";
import { makePdf, signUpAndOnboard, uniqueEmail, uploadAndOpen, waitForAnalysis, workspaceOf } from "./helpers";

test.describe.configure({ mode: "serial" });

/**
 * El flujo del docente de punta a punta en el navegador (proyectos desktop y mobile), contra la app real (fake-supabase con las
 * migraciones reales) y el pipeline simulado: el análisis con el proveedor simulado y el plan, la ficha y la revisión con los dobles
 * deterministas. Cero llamadas a modelos. Demuestra la integración (qué ve el docente y qué hace después), no los detalles internos.
 */

const FAKE = `http://127.0.0.1:${process.env.FAKE_SUPABASE_PORT ?? 54399}`;
const KEY = process.env.FAKE_SERVICE_KEY ?? "sb_secret_fakefakefakefakefake";
const service = { apikey: KEY, authorization: `Bearer ${KEY}`, "content-type": "application/json" };
const TECHNICAL = /Anthropic|Claude|OpenAI|GPT|token|lease|job|attempt|intento \d|provider|stack|undefined|null\b|diagn/i;

async function serious(page: Page) {
  return (await new AxeBuilder({ page }).analyze()).violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id);
}

async function newProfileFromMaterial(page: Page, materialId: string) {
  await page.getByRole("link", { name: "Crear un perfil" }).click();
  await expect(page).toHaveURL(new RegExp(`/app/alumnos/nuevo\\?material=${materialId}`));
  await expect(page.getByRole("link", { name: "Volver al material" })).toBeVisible();
  await page.getByLabel("Alias o iniciales").fill("M.R.");
  await page.getByLabel("Etapa").selectOption({ label: "Educación Primaria" });
  await page.getByLabel("Curso").selectOption({ label: "5.º de Primaria" });
  // Needs, so the plan has decisions to show and change (the profile is the only source: nothing is asked again later).
  await page.getByLabel("Punto de partida", { exact: true }).selectOption({ label: "Atención, planificación y organización" });
  await page.getByRole("button", { name: "Aplicar" }).click();
  await page.getByRole("button", { name: "Crear perfil" }).click();
  // Back to the same material, with the new profile already chosen.
  await expect(page).toHaveURL(new RegExp(`/app/materiales/${materialId}\\?perfil=[0-9a-f-]{36}`));
  await expect(page.getByLabel("Perfil")).not.toHaveValue("");
}

test("revisar antes de crear: material → análisis → perfil → «Así prepararemos esta ficha» → cambiar → Crear ficha → ficha → PDF", async ({ page }) => {
  test.setTimeout(300_000);
  await signUpAndOnboard(page, uniqueEmail());
  await page.goto("/app");
  await expect(page.getByText("Empieza subiendo una ficha que ya utilizas.")).toBeVisible();
  await page.goto("/app/historial");
  await expect(page.getByRole("heading", { name: "Aún no hay adaptaciones" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Adaptar material" }).last()).toBeVisible();
  await allowAdaptations(page);

  // 1–2. Upload: the analysis starts by itself, with visible progress, and ends without a manual refresh.
  const materialId = await uploadAndOpen(page, { name: "Ficha.pdf", mimeType: "application/pdf", buffer: await makePdf({ marker: `tw-${Date.now()}-${Math.random()}` }) });
  await waitForAnalysis(page);
  const adapt = page.getByRole("heading", { name: "Adaptar este material" });
  await expect(adapt).toBeVisible();
  // The next step comes before the details of the analysis.
  const adaptBox = await adapt.boundingBox();
  const activitiesBox = await page.getByRole("heading", { name: "Actividades detectadas" }).boundingBox();
  expect(adaptBox!.y).toBeLessThan(activitiesBox!.y);
  expect(await serious(page)).toEqual([]);

  // 3–4. For whom: a profile created from here comes back here, chosen, straight to the decision.
  await newProfileFromMaterial(page, materialId);
  await expect(page.getByRole("heading", { name: "¿Cómo quieres preparar esta ficha?" })).toBeVisible();

  // 5. «Revisar antes de crear»: a double click creates (and starts) one adaptation.
  await page.getByRole("button", { name: "Revisar antes de crear" }).dblclick();
  await expect(page).toHaveURL(/\/app\/adaptaciones\/[0-9a-f-]{36}$/);
  const adaptationUrl = page.url();
  const adaptationId = adaptationUrl.split("/").pop()!;
  await expect(page.getByRole("heading", { name: "Adaptación", level: 1 })).toBeVisible();
  await expect(page.getByText("para M.R.")).toBeVisible();

  // 6. The proposal is prepared by itself (reloading while it is prepared finds it again) and waits for the teacher.
  await page.reload();
  const heading = page.getByRole("heading", { name: "Así prepararemos esta ficha" });
  await expect(heading).toBeVisible({ timeout: 60_000 });
  expect(await serious(page)).toEqual([]);
  // Human gate: nothing is created until «Crear ficha».
  await page.reload();
  await expect(heading).toBeVisible();
  await expect(page.getByRole("button", { name: "Descargar PDF" })).toHaveCount(0);

  // One change: leave out the first decision; then create the sheet.
  const first = page.locator("form ol > li > fieldset").first();
  await first.getByRole("button", { name: /^Cambiar/ }).click();
  await first.getByRole("radio", { name: "No aplicar" }).check();
  await expect(first.getByText("No se aplicará", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Restaurar recomendación" })).toBeVisible();
  await page.getByRole("button", { name: "Crear ficha" }).click();

  // 7–8. Creating and checking the sheet, in product words; reloading while it works; it ends on its own.
  await expect(heading).toHaveCount(0, { timeout: 30_000 });
  await page.reload();
  await expect(page.getByText(/La ficha está lista/).first()).toBeVisible({ timeout: 60_000 });
  expect(await page.locator("main").innerText()).not.toMatch(TECHNICAL);
  expect(await serious(page)).toEqual([]);

  // 10. PDF straight from the result.
  const downloading = page.waitForEvent("download", { timeout: 60_000 });
  await page.getByRole("button", { name: "Descargar PDF" }).click();
  const download = await downloading;
  expect(readFileSync((await download.path())!).subarray(0, 5).toString("latin1")).toBe("%PDF-");
  await expect(page.getByText(/^Descarga iniciada: .+\.pdf$/)).toBeVisible();

  // 9. The sheet as the student sees it: subject by name, no teacher panel.
  await page.getByRole("link", { name: "Ver la ficha" }).click();
  await expect(page).toHaveURL(`${adaptationUrl}/vista`);
  await page.getByRole("link", { name: "Vista del alumno" }).click();
  await expect(page.locator(".ms-sheet").first()).toBeVisible();
  await expect(page.locator(".ms-sheet").first()).toContainText("Matemáticas");
  await expect(page.getByRole("complementary", { name: "Información para la docente" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Descargar PDF" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  // Where it is found again: history, home, the material and the profile; exactly one adaptation (the double click).
  await page.goto("/app/historial");
  await expect(page.getByText("Ficha preparada")).toHaveCount(1);
  await page.getByRole("link", { name: /Ver ficha/ }).click();
  await expect(page).toHaveURL(`${adaptationUrl}/vista`);
  await page.goto("/app");
  await expect(page.locator("section[aria-labelledby=preparadas]").getByText("Fracciones equivalentes")).toBeVisible();
  expect(await serious(page)).toEqual([]);
  await page.goto(`/app/materiales/${materialId}`);
  await expect(page.locator("section[aria-labelledby=adaptaciones-material]").getByText("Ficha preparada")).toBeVisible();
  await page.goto("/app/alumnos");
  await page.getByRole("link", { name: /M\.R\./ }).click();
  await expect(page.getByRole("heading", { name: "Adaptar un material con este perfil" })).toBeVisible();
  await expect(page.locator("section[aria-labelledby=adaptaciones-perfil]").getByText("Fracciones equivalentes")).toBeVisible();
  await page.getByRole("link", { name: "Fracciones equivalentes" }).first().click();
  await expect(page).toHaveURL(new RegExp(`/app/materiales/${materialId}\\?perfil=`));
  await expect(page.getByLabel("Perfil")).not.toHaveValue("");
  expect(adaptationId).toMatch(/^[0-9a-f-]{36}$/);
});

test("solo lectura: ve el estado, sin comandos ni ejecución", async ({ page, browser }) => {
  test.setTimeout(240_000);
  const ownerEmail = uniqueEmail();
  await signUpAndOnboard(page, ownerEmail);
  await allowAdaptations(page);
  const materialId = await uploadAndOpen(page, { name: "Ficha.pdf", mimeType: "application/pdf", buffer: await makePdf({ marker: `ro-${Date.now()}-${Math.random()}` }) });
  await waitForAnalysis(page);
  await newProfileFromMaterial(page, materialId);
  await page.getByRole("button", { name: "Revisar antes de crear" }).click();
  await expect(page).toHaveURL(/\/app\/adaptaciones\/[0-9a-f-]{36}$/);
  const adaptationUrl = page.url();
  await expect(page.getByRole("heading", { name: "Así prepararemos esta ficha" })).toBeVisible({ timeout: 60_000 });
  const workspaceId = await workspaceOf(page, ownerEmail);

  const other = await browser.newContext({ viewport: page.viewportSize() ?? undefined });
  const viewer = await other.newPage();
  const viewerEmail = uniqueEmail();
  await signUpAndOnboard(viewer, viewerEmail);
  const users = (await (await viewer.request.get(`${FAKE}/auth/v1/admin/users`, { headers: service })).json()) as { users: Array<{ id: string; email: string }> };
  const viewerId = users.users.find((u) => u.email === viewerEmail)!.id;
  expect((await viewer.request.post(`${FAKE}/rest/v1/workspace_members`, { headers: service, data: { workspace_id: workspaceId, user_id: viewerId, role: "viewer" } })).ok()).toBe(true);
  await other.addCookies([{ name: "aw", value: workspaceId, url: new URL(page.url()).origin }]);

  const runs: string[] = [];
  viewer.on("request", (r) => {
    if (r.method() === "POST" && r.url().includes("/run")) runs.push(r.url());
  });
  await viewer.goto(adaptationUrl);
  await expect(viewer.getByText("Tienes acceso de solo lectura en este espacio de trabajo.")).toBeVisible();
  await expect(viewer.getByRole("button", { name: /Crear ficha|^Cambiar|Cancelar adaptación|Restaurar recomendación/ })).toHaveCount(0);
  await viewer.goto(`/app/materiales/${materialId}`);
  await expect(viewer.getByText(/solo lectura/)).toBeVisible();
  await expect(viewer.getByRole("button", { name: /Hacer magia|Revisar antes de crear/ })).toHaveCount(0);
  expect(runs).toEqual([]);

  // The owner's review was not decided by anyone else while the viewer looked at it.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Así prepararemos esta ficha" })).toBeVisible();
  await other.close();
});

test("error y reintento: un análisis fallido se explica sin detalles técnicos y se puede reintentar", async ({ page }) => {
  test.setTimeout(180_000);
  await signUpAndOnboard(page, uniqueEmail());
  await uploadAndOpen(page, { name: "rota.pdf", mimeType: "application/pdf", buffer: await makePdf({ marker: `MOCK_INVALID-${Date.now()}` }) });
  await expect(page.getByText("No hemos podido analizar este material.")).toBeVisible({ timeout: 60_000 });
  expect(await page.locator("main").innerText()).not.toMatch(TECHNICAL);
  await page.getByRole("button", { name: "Reintentar" }).click();
  // The retry really runs again (progress), and ends in the same explained state: the teacher always has a way forward.
  await expect(page.getByText("No hemos podido analizar este material.")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("button", { name: "Reintentar" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Eliminar" })).toBeVisible();
});
