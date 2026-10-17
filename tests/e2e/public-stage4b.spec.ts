import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { makePdf, password, uniqueEmail, waitForAnalysis } from "./helpers";

async function capture(page: Page, info: TestInfo, name: string) {
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true, caret: "initial", style: "nextjs-portal { display: none; }" });
}
async function accessible(page: Page) {
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}

test("landing y demo sintética públicas: comparar, alternar, revisión y registro", async ({ page }, info) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Tus materiales de siempre/ })).toBeVisible();
  await expect(page.getByText("Demostración preparada por nosotros.", { exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Adaptación" })).toHaveAttribute("aria-selected", "true");
  await capture(page, info, "landing");
  await page.getByRole("tab", { name: "Comparar" }).click();
  await expect(page.getByRole("article", { name: "Ficha original de demostración" }).first()).toBeVisible();
  if (info.project.name === "mobile") {
    await page.getByRole("button", { name: "Adaptación", exact: true }).click();
    await expect(page.getByRole("article", { name: "Ficha adaptada de demostración" }).first()).toBeVisible();
  } else await expect(page.getByRole("article", { name: "Ficha adaptada de demostración" }).first()).toBeVisible();
  await capture(page, info, "comparar");
  await page.getByRole("tab", { name: "Revisión" }).click();
  await expect(page.getByRole("complementary", { name: "Ejemplo del inspector" })).toBeVisible();
  await expect(page.getByText("Esta muestra es estática", { exact: false })).toBeVisible();
  await capture(page, info, "revision-demo");
  await accessible(page);
  await page.goto("/como-funciona");
  await expect(page.getByRole("listitem").filter({ hasText: "Descarga el PDF" }).first()).toBeVisible();
  await accessible(page);
  await page.goto("/precios");
  await expect(page.getByText("En preparación", { exact: true })).toBeVisible();
  await expect(page.locator('main a[href="/registro"]')).toHaveCount(1);
  await page.goto("/");
  await page.getByRole("link", { name: "Empezar gratis" }).first().click();
  await expect(page).toHaveURL(/\/registro$/);
});

test("registro, acceso, contraseña y onboarding conducen a la primera subida", async ({ page }, info) => {
  const email = uniqueEmail();
  await page.goto("/registro");
  await capture(page, info, "registro");
  await page.getByRole("button", { name: "Crear cuenta" }).click();
  await expect(page.getByText("Escribe un email válido.")).toBeVisible();
  await page.getByRole("textbox", { name: "Email" }).fill(email);
  await page.getByLabel("Contraseña", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Crear cuenta" }).click();
  await expect(page).toHaveURL(/\/app\/bienvenida/);
  await expect(page.getByText(/1 adaptación y 2 análisis por periodo/)).toBeVisible();
  await expect(page.getByText("Un perfil funcional describe apoyos, no diagnósticos.")).toBeVisible();
  await capture(page, info, "onboarding");
  await page.getByRole("radio", { name: "Primaria" }).check();
  await page.getByRole("button", { name: "Subir mi primera ficha" }).click();
  await expect(page).toHaveURL(/\/app\/adaptar$/);
  await page.locator('input[type="file"]').setInputFiles({ name: "Ficha sintética.pdf", mimeType: "application/pdf", buffer: await makePdf({ marker: `4b-${Date.now()}` }) });
  await page.getByRole("button", { name: "Analizar material" }).click();
  await expect(page).toHaveURL(/\/app\/materiales\/[0-9a-f-]{36}$/);
  await waitForAnalysis(page);
  await page.goto("/app/uso");
  await expect(page.getByRole("progressbar", { name: "Análisis este periodo" })).toHaveAttribute("aria-valuenow", "1");
  await page.locator("main").getByRole("button", { name: "Cerrar sesión" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/login");
  await capture(page, info, "acceso");
  await page.getByRole("textbox", { name: "Email" }).fill(email);
  await page.getByLabel("Contraseña").fill("incorrecta");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page.getByText("El email o la contraseña no son correctos.")).toBeVisible();
  await page.getByRole("link", { name: "Olvidé mi contraseña" }).click();
  await expect(page).toHaveURL(/\/forgot-password$/);
  await page.getByRole("textbox", { name: "Email" }).fill(email);
  await page.getByRole("button", { name: "Enviar enlace" }).click();
  await expect(page.getByText("Si hay una cuenta con ese email, recibirás un enlace para elegir una contraseña nueva.")).toBeVisible();
  await page.goto("/login");
  await page.getByRole("textbox", { name: "Email" }).fill(email);
  await page.getByLabel("Contraseña").fill(password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/app(?:\/.*)?$/);
  await accessible(page);
});

test("reflow, teclado, contraste y movimiento reducido en páginas públicas", async ({ page }) => {
  for (const path of ["/", "/como-funciona", "/registro", "/login", "/forgot-password"]) {
    await page.goto(path);
    await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "active" });
    await page.setViewportSize({ width: 320, height: 900 });
    await page.addStyleTag({ content: "html { font-size: 200%; }" });
    await accessible(page);
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Saltar al contenido" })).toBeFocused();
  }
});
