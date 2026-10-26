import AxeBuilder from "@axe-core/playwright";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { password, signUpAndOnboard, uniqueEmail, workspaceOf } from "./helpers";

const visual = "Comprender con imágenes y ejemplos", load = "Regular la carga y los estímulos";
const strength = "Explica oralmente lo que sabe.", barrier = "Cuando responde por escrito, le cuesta mostrar todo lo que sabe.";

async function basics(page: Page, name = "Perfil ficticio") {
  await page.getByLabel("Alias o iniciales").fill(name);
  await page.getByLabel("Etapa", { exact: true }).selectOption("primaria");
  await page.getByLabel("Curso", { exact: true }).selectOption("4-primaria");
}
async function observations(page: Page) {
  await page.getByText("Fortalezas · ¿Qué se le da bien?", { exact: true }).click();
  await page.getByRole("checkbox", { name: strength, exact: true }).check();
  await page.getByText("Barreras · ¿Qué dificulta la tarea?", { exact: true }).click();
  await page.getByRole("checkbox", { name: barrier, exact: true }).check();
}
async function capture(page: Page, info: TestInfo, name: string) {
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true, style: "nextjs-portal {display:none}" });
}

test("tarjetas combinables, observaciones independientes, guardar, reabrir y duplicar", async ({ page }, info) => {
  await signUpAndOnboard(page, uniqueEmail());
  await basics(page);
  await page.getByText(visual, { exact: true }).click();
  await page.getByText(load, { exact: true }).click();
  await capture(page, info, "tarjetas");
  await page.getByRole("button", { name: "Crear perfil", exact: true }).click();
  await expect(page.getByText(/Pulsa «Añadir estos apoyos»/)).toBeVisible();
  await page.getByRole("button", { name: "Añadir estos apoyos", exact: true }).click();
  const summary = page.getByRole("complementary", { name: "Resumen del perfil" });
  await expect(summary.getByText("Todavía no indicadas. No las deducimos de los apoyos.")).toBeVisible();
  await observations(page);
  await expect(summary.getByText(strength, { exact: true })).toBeVisible();
  await expect(summary.getByText(barrier, { exact: true })).toBeVisible();
  await expect(page.getByText("Sugerencias para estas situaciones · no se activan automáticamente")).toBeVisible();
  await capture(page, info, "perfil-combinado");
  await summary.screenshot({ path: info.outputPath("resumen.png") });
  await page.getByRole("button", { name: "Crear perfil", exact: true }).click();
  await expect(page).toHaveURL(/aviso=creado/);
  await page.getByRole("link", { name: /Perfil ficticio/ }).click();
  await expect(page).toHaveURL(/\/app\/alumnos\/[0-9a-f-]{36}$/);
  const url = page.url();
  await page.getByText(/^Fortalezas ·/).click();
  await expect(page.getByRole("checkbox", { name: strength, exact: true })).toBeChecked();
  await page.getByText(/^Barreras ·/).click();
  await expect(page.getByRole("checkbox", { name: barrier, exact: true })).toBeChecked();
  await page.getByRole("button", { name: "Duplicar", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Perfil ficticio (copia)" })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Resumen del perfil" })).toContainText(strength);
  await page.goto(url);
  // Closing an area changes disclosure only, not supports or saved observations.
  await page.getByText("Personalizar más", { exact: true }).click();
  await page.getByText("Elegir otras áreas de apoyo", { exact: true }).click();
  const hearing = page.getByRole("button", { name: /^Acceso auditivo/ });
  await hearing.click();
  await hearing.click();
  await expect(summary).toContainText("apoyos visuales");
  await page.getByRole("button", { name: "Guardar cambios", exact: true }).click();
  await expect(page).toHaveURL(/aviso=guardado/);
});

test("V1 editable, añadir sin borrar, sustituir con confirmación y deshacer", async ({ page }) => {
  const email = uniqueEmail();
  await signUpAndOnboard(page, email);
  const ws = await workspaceOf(page, email);
  const client = createClient("http://127.0.0.1:54399", "sb_publishable_fakefakefakefakefake", { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: auth } = await client.auth.signInWithPassword({ email, password });
  // Seed a genuine V1 row; never downgrade V2 just to set up a historical fixture (032 deliberately rejects that).
  const { data: created, error } = await client.from("learner_profiles").insert({ workspace_id: ws, created_by: auth.user!.id, display_name: "Perfil anterior", stage_slug: "primaria", grade_slug: "4-primaria", functional_profile: { schema_version: 1, supports: { decoding_support: "high" }, limits: {}, allowances: {} } }).select("id").single();
  expect(error).toBeNull();
  await page.goto(`/app/alumnos/${created!.id}`);
  await expect(page).toHaveURL(/\/app\/alumnos\/[0-9a-f-]{36}$/);
  await expect(page.getByText("Los apoyos del perfil anterior se conservan.", { exact: false })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Resumen del perfil" })).toContainText("apoyo para decodificar al leer");
  await observations(page);
  await page.getByText("Comprender números y operaciones", { exact: true }).click();
  await page.getByRole("button", { name: "Añadir estos apoyos", exact: true }).click();
  await expect(page.getByRole("complementary", { name: "Resumen del perfil" })).toContainText("apoyo para decodificar al leer");
  await page.getByRole("button", { name: "Sustituir configuración", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect(page.getByRole("complementary", { name: "Resumen del perfil" })).toContainText("apoyo para decodificar al leer");
  await page.getByRole("button", { name: "Sustituir configuración", exact: true }).click();
  await page.getByRole("button", { name: "Sí, sustituir apoyos", exact: true }).click();
  await expect(page.getByRole("complementary", { name: "Resumen del perfil" })).not.toContainText("apoyo para decodificar al leer");
  await page.getByRole("button", { name: "Deshacer último cambio", exact: true }).click();
  await expect(page.getByRole("complementary", { name: "Resumen del perfil" })).toContainText("apoyo para decodificar al leer");
  await page.getByRole("button", { name: "Guardar cambios", exact: true }).click();
  await expect(page).toHaveURL(/aviso=guardado/);
  await page.getByRole("link", { name: /Perfil anterior/ }).click();
  await expect(page.getByRole("complementary", { name: "Resumen del perfil" })).toContainText(strength);
});

test("teclado, reflujo, movimiento reducido y controles accesibles", async ({ page }, info) => {
  await signUpAndOnboard(page, uniqueEmail());
  const checkbox = page.getByRole("checkbox", { name: visual, exact: true });
  await checkbox.focus();
  await expect(checkbox).toBeFocused();
  await checkbox.press("Space");
  await expect(checkbox).toBeChecked();
  await page.getByRole("button", { name: "Añadir estos apoyos", exact: true }).click();
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);
  await capture(page, info, "accesible");
  await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "active" });
  await page.setViewportSize({ width: 320, height: 900 });
  await page.addStyleTag({ content: "html {font-size:200%}" });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test("dos pestañas no sobrescriben observaciones guardadas por la otra", async ({ page }) => {
  await signUpAndOnboard(page, uniqueEmail());
  await basics(page, "Perfil compartido ficticio");
  await page.getByRole("button", { name: "Crear perfil", exact: true }).click();
  await expect(page).toHaveURL(/aviso=creado/);
  await page.getByRole("link", { name: /Perfil compartido ficticio/ }).click();
  await expect(page).toHaveURL(/\/app\/alumnos\/[0-9a-f-]{36}$/);
  const other = await page.context().newPage();
  await other.goto(page.url());
  await observations(page);
  await page.getByRole("button", { name: "Guardar cambios", exact: true }).click();
  await expect(page).toHaveURL(/aviso=guardado/);
  await other.getByLabel("Alias o iniciales").fill("Cambio desde pestaña antigua");
  await other.getByRole("button", { name: "Guardar cambios", exact: true }).click();
  await expect(other.getByText("El perfil ha cambiado o utiliza una versión más reciente.", { exact: false })).toBeVisible();
  await other.reload();
  await expect(other.getByLabel("Alias o iniciales")).toHaveValue("Perfil compartido ficticio");
  await expect(other.getByRole("complementary", { name: "Resumen del perfil" })).toContainText(strength);
  await other.close();
});
