import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { applyProfilePreset, reserveAnalyses, signUpAndOnboard, uniqueEmail, workspaceOf } from "./helpers";

const fake = `http://127.0.0.1:${process.env.FAKE_SUPABASE_PORT ?? 54399}`;
const key = process.env.FAKE_SERVICE_KEY ?? "sb_secret_fakefakefakefakefake";
const headers = { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json", prefer: "return=representation" };

async function create(page: Page) {
  await page.goto("/app/alumnos/nuevo");
  await page.getByLabel("Alias o iniciales").fill("Perfil de lectura");
  await page.getByLabel("Etapa", { exact: true }).selectOption("primaria");
  await page.getByLabel("Curso", { exact: true }).selectOption("3-primaria");
  await applyProfilePreset(page, "Lectura y decodificación");
  await page.getByRole("button", { name: "Crear perfil", exact: true }).click();
  await expect(page).toHaveURL(/aviso=creado/);
}

async function capture(page: Page, info: TestInfo, name: string) {
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true, caret: "initial", style: "nextjs-portal { display: none; }" });
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze()).violations).toEqual([]);
}

async function reflow(page: Page) {
  await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "active" });
  await page.setViewportSize({ width: 320, height: 900 });
  await page.addStyleTag({ content: "html { font-size: 200%; }" });
  const overflow = await page.evaluate(() => [...document.querySelectorAll("main *")].filter((el) => el.getBoundingClientRect().right > innerWidth + 1).slice(0, 8).map((el) => ({ text: el.textContent?.slice(0, 45), right: Math.round(el.getBoundingClientRect().right), tag: el.tagName })));
  expect(overflow).toEqual([]);
}

test("perfiles: buscar, conservar apoyos al duplicar, límite real y adaptación contextual", async ({ page }, info) => {
  await signUpAndOnboard(page, uniqueEmail());
  await create(page);
  await expect(page.getByText("1 de 2 perfiles utilizados en Free · 1 disponible")).toBeVisible();
  await page.getByLabel("Buscar por alias").fill("LECTURA");
  await expect(page.locator("ul.editorial-list li")).toHaveCount(1);
  await page.getByLabel("Buscar por alias").fill("inexistente");
  await expect(page.getByText("No hay perfiles que coincidan con tu búsqueda.")).toBeVisible();
  await page.getByRole("button", { name: "Limpiar filtros" }).click();
  await page.getByLabel("Filtrar por curso").selectOption("3-primaria");
  await capture(page, info, "perfiles");
  await page.getByRole("link", { name: /Perfil de lectura/ }).click();
  await expect(page.getByRole("heading", { name: "Adaptar un material con este perfil" })).toBeVisible();
  await page.getByRole("button", { name: "Duplicar", exact: true }).click();
  await expect(page.getByText("Perfil duplicado. Ya puedes ajustarlo.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Duplicar", exact: true })).toBeDisabled();
  await expect(page.getByRole("complementary", { name: "Resumen del perfil" })).toContainText("apoyo para decodificar al leer (habitual o imprescindible)");
  await page.getByLabel("Curso", { exact: true }).selectOption("5-primaria");
  await page.getByRole("button", { name: "Guardar cambios", exact: true }).click();
  await expect(page.getByText("Cambios guardados.", { exact: true })).toBeVisible();
  await expect(page.locator("ul.editorial-list li")).toHaveCount(2);
  await page.getByLabel("Filtrar por curso").selectOption("3-primaria");
  await expect(page.locator("ul.editorial-list li")).toHaveCount(1);
  await expect(page.locator("ul.editorial-list")).not.toContainText("(copia)");
  await page.getByLabel("Filtrar por curso").selectOption("5-primaria");
  await expect(page.locator("ul.editorial-list li")).toHaveCount(1);
  await page.getByRole("link", { name: /Perfil de lectura \(copia\)/ }).click();
  await expect(page.getByLabel("Curso", { exact: true })).toHaveValue("5-primaria");
  await capture(page, info, "perfil");
  const summary = page.getByText("Elegir otras áreas de apoyo", { exact: true });
  await page.getByText("Personalizar más", { exact: true }).click();
  await summary.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: /^Lectura/ })).toBeVisible();
  await page.getByText("Ajustes avanzados (opcional)", { exact: true }).click();
  await page.getByText("Ajustar lectura", { exact: true }).click();
  await reflow(page);
});

test("cuenta: contadores reales separados, nombre persistido y acceso seguro", async ({ page, browser }, info) => {
  const email = uniqueEmail();
  await signUpAndOnboard(page, email);
  const workspace = await workspaceOf(page, email);
  await reserveAnalyses(page, workspace, 2);
  await create(page);
  await page.goto("/app/uso");
  await expect(page.getByRole("progressbar", { name: "Análisis este periodo" })).toHaveAttribute("aria-valuenow", "2");
  await expect(page.getByRole("progressbar", { name: "Adaptaciones este periodo" })).toHaveAttribute("aria-valuenow", "0");
  await expect(page.getByRole("progressbar", { name: "Perfiles guardados" })).toHaveAttribute("aria-valuenow", "1");
  await expect(page.getByText(email, { exact: true }).last()).toBeVisible();
  await page.getByLabel("Nombre visible", { exact: true }).fill("Clara Docente");
  await expect(page.getByText("Cambios sin guardar", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Guardar nombre" }).click();
  await expect(page.getByText("Nombre guardado.", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Nombre visible", { exact: true })).toHaveValue("Clara Docente");
  await capture(page, info, "cuenta");
  await reflow(page);
  await page.goto("/app");
  await expect(page.getByRole("heading", { name: /Clara/ })).toBeVisible();
  const context = await browser.newContext();
  const other = await context.newPage();
  await signUpAndOnboard(other, uniqueEmail());
  await other.goto("/app/uso");
  await expect(other.getByLabel("Nombre visible", { exact: true })).toHaveValue("Ana Pérez");
  await expect(other.getByRole("progressbar", { name: "Análisis este periodo" })).toHaveAttribute("aria-valuenow", "0");
  await context.close();
  await page.goto("/app/uso");
  await page.getByRole("link", { name: "Cambiar contraseña" }).click();
  await expect(page).toHaveURL(/\/reset-password$/);
  await expect(page.getByRole("heading", { name: "Elige una contraseña nueva" })).toBeVisible();
  await page.goto("/app/uso");
  await page.locator("main").getByRole("button", { name: "Cerrar sesión" }).click();
  await expect(page).toHaveURL(new URL("/", page.url()).href);
  await page.goto("/app/uso");
  await expect(page).toHaveURL(/\/login/);
});

test("perfiles: aislamiento y vista de lectura sin acciones de escritura", async ({ page, browser }) => {
  const email = uniqueEmail();
  await signUpAndOnboard(page, email);
  await create(page);
  await page.getByRole("link", { name: /Perfil de lectura/ }).click();
  await expect(page).toHaveURL(/\/app\/alumnos\/[0-9a-f-]{36}$/);
  const url = page.url();
  const workspace = await workspaceOf(page, email);
  const context = await browser.newContext({ viewport: page.viewportSize()! });
  const reader = await context.newPage();
  const readerEmail = uniqueEmail();
  await signUpAndOnboard(reader, readerEmail);
  await reader.goto(url);
  await expect(reader.getByText("No encontramos lo que buscas")).toBeVisible();
  const { users } = await (await page.request.get(`${fake}/auth/v1/admin/users`, { headers })).json() as { users: Array<{ id: string; email: string }> };
  const user = users.find((u) => u.email === readerEmail)!;
  expect((await page.request.post(`${fake}/rest/v1/workspace_members`, { headers, data: { workspace_id: workspace, user_id: user.id, role: "viewer" } })).ok()).toBe(true);
  await context.addCookies([{ name: "aw", value: workspace, url: new URL(url).origin }]);
  await reader.goto(url);
  await expect(reader.getByText(/Tu acceso es de solo lectura/)).toBeVisible();
  await expect(reader.getByRole("heading", { name: "Así acompañaremos su aprendizaje" })).toBeVisible();
  await expect(reader.getByRole("button", { name: /Duplicar|Eliminar|Guardar cambios/ })).toHaveCount(0);
  await expect(reader.getByLabel("Alias o iniciales")).toHaveCount(0);
  await reader.goto("/app/alumnos/nuevo");
  await expect(reader.getByText("Tu rol no permite crear perfiles")).toBeVisible();
  await reader.goto("/app/alumnos");
  await expect(reader.getByRole("link", { name: "Nuevo perfil" })).toHaveCount(0);
  await context.close();
});
