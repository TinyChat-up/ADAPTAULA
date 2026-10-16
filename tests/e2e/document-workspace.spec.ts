import { createHash } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { signUpAndOnboard, uniqueEmail, waitForAnalysis, workspaceOf, uploadAndOpen } from "./helpers";
import { workspacePdf } from "../support/workspace-pdf";

const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
async function accessible(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
}
const capture = async (page: Page, path: string) => {
  const original = page.getByRole("region", { name: "Documento original", exact: true });
  if (await original.count()) await expect(original.getByRole("status").filter({ hasText: /Página \d+ visible/ })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path, fullPage: true, style: "nextjs-portal { display: none; }" });
};

test("workspace: arrastre, análisis simulado, páginas, apoyos, panel y estados sin alterar el original", async ({ page }, info) => {
  test.setTimeout(240000);
  const email = uniqueEmail();
  await signUpAndOnboard(page, email);
  await expect(page).toHaveURL(/\/app\/alumnos\/nuevo/);
  await page.goto("/app/adaptar");
  await accessible(page);
  await capture(page, info.outputPath("subida.png"));
  const buffer = await workspacePdf(email);
  const transfer = await page.evaluateHandle(({ bytes }) => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array(bytes)], "Exploramos las fracciones.pdf", { type: "application/pdf" }));
    return dt;
  }, { bytes: [...buffer] });
  await page.getByTestId("upload-surface").dispatchEvent("dragenter", { dataTransfer: transfer });
  await expect(page.getByText("Suelta tu ficha aquí", { exact: true })).toBeVisible();
  await page.getByTestId("upload-surface").dispatchEvent("drop", { dataTransfer: transfer });
  await expect(page.getByText("Exploramos las fracciones.pdf", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Analizar material" })).toBeEnabled();
  await page.getByRole("button", { name: "Analizar material" }).click();
  await expect(page).toHaveURL(/\/app\/materiales\/[0-9a-f-]{36}$/, { timeout: 60000 });
  const materialId = page.url().split("/").pop()!;
  await waitForAnalysis(page);
  // The React payload is public to the browser, even when a field is not rendered as HTML.
  expect(await (await page.request.get(page.url())).text()).not.toContain('storage_path');
  const original = page.getByRole("region", { name: "Documento original", exact: true });
  await expect(original.getByRole("img")).toBeVisible();
  await expect(original.getByRole("status").filter({ hasText: "Página 1 visible" })).toBeVisible();
  expect(hash(await (await page.request.get(`/api/materials/${materialId}/file`)).body())).toBe(hash(buffer));
  const requests: string[] = [];
  page.on("request", (r) => { if (/\/pages\/\d/.test(r.url())) requests.push(r.url()); });
  await original.getByRole("button", { name: "Ampliar original" }).click();
  await expect(original.getByLabel("Zoom del original")).toHaveText("125 %");
  await original.getByRole("button", { name: "Ajustar al ancho" }).click();
  await expect(original.getByLabel("Zoom del original")).toHaveText("100 %");
  expect(requests).toHaveLength(0); // Scaling never rerasterizes or prefetches the remaining pages.
  await original.getByRole("button", { name: "Página siguiente" }).click();
  await expect(original.getByRole("status").filter({ hasText: "Página 2 visible" })).toBeVisible();
  await expect(original.getByRole("button", { name: "Página siguiente" })).toBeDisabled();
  await original.getByLabel("Página del original", { exact: true }).selectOption("1");
  await expect(original.getByRole("status").filter({ hasText: "Página 1 visible" })).toBeVisible();
  await page.getByRole("button", { name: "Elegir apoyos", exact: true }).click();
  await expect(page.locator("[data-workspace-next]")).toBeFocused();
  await page.getByRole("link", { name: "Crear un perfil", exact: true }).click();
  await page.getByLabel("Alias o iniciales").fill("Perfil de prueba");
  await page.getByLabel("Etapa").selectOption({ label: "Educación Primaria" });
  await page.getByLabel("Curso").selectOption({ label: "5.º de Primaria" });
  await page.getByLabel("Punto de partida", { exact: true }).selectOption({ label: "Atención, planificación y organización" });
  await page.getByRole("button", { name: "Aplicar", exact: true }).click();
  await page.getByRole("button", { name: "Crear perfil", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/app/materiales/${materialId}\\?perfil=`));
  const selected = await page.getByLabel("Perfil", { exact: true }).inputValue();
  await expect(page.getByText("Apoyos de este perfil", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Ocultar panel" }).click();
  await expect(page.getByRole("complementary", { name: "Preparación de la ficha" })).toHaveCount(0);
  await page.getByRole("button", { name: "Mostrar panel" }).press("Enter");
  await expect(page.getByLabel("Perfil", { exact: true })).toHaveValue(selected);
  await accessible(page);
  await capture(page, info.outputPath("workspace.png"));
  await page.getByRole("button", { name: "Elegir apoyos", exact: true }).click();
  if (info.project.name === "desktop") await expect(original.getByRole("heading", { name: "Original", exact: true })).toBeInViewport();
  await page.screenshot({ path: info.outputPath("apoyos.png"), style: "nextjs-portal { display: none; }" });
  await page.getByRole("button", { name: "Ocultar panel" }).click();
  await capture(page, info.outputPath("documento.png"));
  // Continue returns to the existing decision; no second adaptation entry point.
  await page.getByRole("button", { name: "Elegir apoyos", exact: true }).click();
  await page.getByRole("button", { name: "Hacer magia", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/adaptaciones\/[0-9a-f-]{36}/, { timeout: 60000 });
  // The synthetic provider cannot resolve the required original figure. This is a real product stop, not a successful adaptation.
  await expect(page.getByText("No hemos podido completar automáticamente esta ficha", { exact: true })).toBeVisible({ timeout: 60000 });
  await expect(page.getByRole("button", { name: "Descargar PDF", exact: true })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Documento original", exact: true })).toBeVisible();
  expect(await (await page.request.get(page.url())).text()).not.toContain('storage_path');
  await accessible(page);
  await capture(page, info.outputPath("bloqueo.png"));
  expect(hash(await (await page.request.get(`/api/materials/${materialId}/file`)).body())).toBe(hash(buffer));
  await page.setViewportSize({ width: 320, height: 900 });
  await page.addStyleTag({ content: "html { font-size: 200%; }" });
  const reflow = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth,
    outside: [...document.querySelectorAll("main *")].filter((el) => el.getBoundingClientRect().right > innerWidth + 1).slice(0, 12).map((el) => ({ tag: el.tagName, text: el.textContent?.slice(0, 65), css: el.className, right: el.getBoundingClientRect().right })) }));
  expect(reflow.scroll, JSON.stringify(reflow)).toBeLessThanOrEqual(reflow.width + 1);
});

test("visor: error recuperable, rutas privadas y rol de solo lectura", async ({ page, browser }, info) => {
  test.setTimeout(240000);
  const email = uniqueEmail();
  await signUpAndOnboard(page, email);
  await expect(page).toHaveURL(/\/app\/alumnos\/nuevo/);
  const materialId = await uploadAndOpen(page, { name: "Prueba privada.pdf", mimeType: "application/pdf", buffer: await workspacePdf(email) });
  await waitForAnalysis(page);
  const matcher = `**/api/materials/${materialId}/pages/2*`;
  await page.route(matcher, (r) => r.fulfill({ status: 422, body: "No disponible" }));
  await page.getByRole("button", { name: "Página siguiente" }).click();
  await expect(page.getByText("No hemos podido mostrar esta página.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Abrir original en otra pestaña" })).toBeVisible();
  await page.unroute(matcher);
  await page.getByRole("button", { name: "Reintentar página" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Página 2 visible" })).toBeVisible();

  const other = await browser.newContext({ viewport: page.viewportSize()! });
  const visitor = await other.newPage();
  const viewerEmail = uniqueEmail();
  await signUpAndOnboard(visitor, viewerEmail);
  await expect(visitor).toHaveURL(/\/app\/alumnos\/nuevo/);
  await visitor.goto(`/app/materiales/${materialId}`);
  await expect(visitor.getByText("No encontramos lo que buscas")).toBeVisible();
  for (const path of ["file", "pages/1", "status"]) expect((await visitor.request.get(`/api/materials/${materialId}/${path}`)).status()).toBe(404);
  // Membership is set only in the local PGlite fixture. Production policies are untouched.
  const fake = `http://127.0.0.1:${process.env.FAKE_SUPABASE_PORT ?? 54399}`;
  const key = process.env.FAKE_SERVICE_KEY ?? "sb_secret_fakefakefakefakefake";
  const headers = { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" };
  const workspace = await workspaceOf(page, email);
  const { users } = await (await page.request.get(`${fake}/auth/v1/admin/users`, { headers })).json() as { users: Array<{ id: string; email: string }> };
  const user = users.find((u) => u.email === viewerEmail)!;
  expect((await page.request.post(`${fake}/rest/v1/workspace_members`, { headers, data: { workspace_id: workspace, user_id: user.id, role: "viewer" } })).ok()).toBe(true);
  await other.addCookies([{ name: "aw", value: workspace, url: new URL(page.url()).origin }]);
  const writes: string[] = [];
  visitor.on("request", (r) => { if (r.method() === "POST") writes.push(r.url()); });
  await visitor.goto(`/app/materiales/${materialId}`);
  await expect(visitor.getByText(/solo lectura/)).toBeVisible();
  await expect(visitor.getByRole("button", { name: /Hacer magia|Reintentar|Eliminar|Guardar datos|Volver a analizar/ })).toHaveCount(0);
  expect((await visitor.request.get(`/api/materials/${materialId}/pages/1`)).status()).toBe(200);
  await accessible(visitor);
  expect(writes).toEqual([]);
  await capture(visitor, info.outputPath("solo-lectura.png"));
  expect((await page.request.patch(`${fake}/rest/v1/materials?id=eq.${materialId}`, { headers, data: { status: "queued" } })).ok()).toBe(true);
  const observed = visitor.waitForResponse((r) => r.url().endsWith(`/materials/${materialId}/status`));
  await visitor.reload();
  await observed;
  await expect(visitor.getByRole("heading", { name: "Estamos preparando tu material" })).toBeVisible();
  expect(writes).toEqual([]); // A viewer observes queued analysis; it never dispatches it.
  expect((await page.request.patch(`${fake}/rest/v1/materials?id=eq.${materialId}`, { headers, data: { status: "analyzed" } })).ok()).toBe(true);
  await other.close();
  const anonymous = await browser.newContext();
  expect((await anonymous.request.get(`${new URL(page.url()).origin}/api/materials/${materialId}/pages/1`)).status()).toBe(401);
  await anonymous.close();
});
