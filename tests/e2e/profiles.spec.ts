import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { signUpAndOnboard, uniqueEmail as unique } from "./helpers";

test.describe.configure({ mode: "serial" });

async function createProfile(page: Page, alias: string, preset?: string) {
  await page.goto("/app/alumnos/nuevo");
  await page.getByLabel("Alias o iniciales").fill(alias);
  await page.getByLabel("Etapa").selectOption({ label: "Educación Primaria" });
  await page.getByLabel("Curso").selectOption({ label: "5.º de Primaria" });
  if (preset) {
    await page.getByLabel("Punto de partida", { exact: true }).selectOption({ label: preset });
    await page.getByRole("button", { name: "Aplicar" }).click();
  }
  await page.getByRole("button", { name: "Crear perfil" }).click();
}

test("rutas protegidas redirigen al login", async ({ page }) => {
  await page.goto("/app/alumnos");
  await expect(page).toHaveURL(/\/login\?next=%2Fapp%2Falumnos/);
  await expect(page.getByRole("heading", { name: "Entrar en Adaptaula" })).toBeVisible();
});

test("el destino tras el login no admite redirecciones externas", async ({ page }) => {
  await page.goto("/login?next=https://evil.example");
  await expect(page.locator(`input[name="next"]`).first()).toHaveValue("/app");
});

test("registro → onboarding → crear perfil desde un punto de partida → editar → listado", async ({ page }) => {
  await signUpAndOnboard(page, unique());
  await expect(page).toHaveURL(/\/app\/alumnos\/nuevo/);

  await page.getByLabel("Alias o iniciales").fill("M.R.");
  await page.getByLabel("Etapa").selectOption({ label: "Educación Primaria" });
  await page.getByLabel("Curso").selectOption({ label: "5.º de Primaria" });

  await expect(page.getByText("Todavía no has indicado ningún apoyo")).toBeVisible();
  await page.getByLabel("Punto de partida", { exact: true }).selectOption({ label: "Atención, planificación y organización" });
  await page.getByRole("button", { name: "Aplicar" }).click();

  await expect(page.getByText("instrucciones breves y divididas en pasos (mucho)")).toBeVisible();
  await expect(page.getByText("como máximo 3 tareas visibles a la vez")).toBeVisible();
  await expect(
    page.getByRole("radiogroup", { name: "Dividir instrucciones largas en pasos" }).getByRole("radio", { name: "Mucho" }),
  ).toBeChecked();

  // Todo sigue siendo editable tras aplicar la configuración.
  await page.getByRole("radiogroup", { name: "Dividir instrucciones largas en pasos" }).getByText("Sin adaptación").click();
  await expect(page.getByText("instrucciones breves y divididas en pasos")).toHaveCount(0);

  await page.getByRole("button", { name: "Crear perfil" }).click();
  await expect(page).toHaveURL(/\/app\/alumnos\?aviso=creado/);
  await expect(page.getByText("Perfil creado.")).toBeVisible();
  await expect(page.getByRole("link", { name: /M\.R\./ })).toBeVisible();

  await page.getByRole("link", { name: /M\.R\./ }).click();
  await expect(page).toHaveURL(/\/app\/alumnos\/[0-9a-f-]{36}$/);
  await expect(page.getByText(/Última actualización/)).toBeVisible();
  await page.getByLabel("Alias o iniciales").fill("M.R. (editado)");
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.getByText("Cambios guardados.")).toBeVisible();
  await expect(page.getByRole("link", { name: /M\.R\. \(editado\)/ })).toBeVisible();

  await page.goto("/app");
  await expect(page.getByRole("heading", { name: /Ana/ })).toBeVisible();
  await expect(page.getByText("1 de 2")).toBeVisible();
});

test("Free: el tercer perfil se bloquea con el mensaje del plan", async ({ page }) => {
  await signUpAndOnboard(page, unique());
  await expect(page).toHaveURL(/\/app\/alumnos\/nuevo/);
  await createProfile(page, "P1");
  await expect(page.getByText("Perfil creado.")).toBeVisible();
  await createProfile(page, "P2");
  await expect(page.getByText("Perfil creado.")).toBeVisible();

  await expect(page.getByText("Has utilizado los 2 perfiles incluidos en Free.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Ver Pro" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Nuevo perfil" })).toHaveCount(0);

  await page.goto("/app/alumnos/nuevo");
  await expect(page.getByText("Has utilizado los 2 perfiles incluidos en Free.")).toBeVisible();
  await expect(page.getByLabel("Alias o iniciales")).toHaveCount(0);
});

test("duplicar y eliminar con confirmación", async ({ page }) => {
  await signUpAndOnboard(page, unique());
  await createProfile(page, "Dup");
  await page.getByRole("link", { name: /Dup/ }).click();

  await page.getByRole("button", { name: "Duplicar" }).click();
  await expect(page.getByText("Perfil duplicado. Ya puedes ajustarlo.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Dup (copia)" })).toBeVisible();

  await page.getByRole("button", { name: "Eliminar" }).click();
  await page.getByRole("button", { name: "Eliminar perfil" }).click();
  await expect(page.getByText("Perfil eliminado.")).toBeVisible();
  await expect(page.getByRole("link", { name: /Dup \(copia\)/ })).toHaveCount(0);
});

test("otro usuario no puede ver un perfil ajeno: 404 sin pistas", async ({ page, browser }) => {
  await signUpAndOnboard(page, unique());
  await createProfile(page, "Privado");
  await page.getByRole("link", { name: /Privado/ }).click();
  await expect(page).toHaveURL(/\/app\/alumnos\/[0-9a-f-]{36}$/);
  const url = page.url();

  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await signUpAndOnboard(otherPage, unique());
  await otherPage.goto(url);
  await expect(otherPage.getByText("No encontramos lo que buscas")).toBeVisible();
  await expect(otherPage.getByText("Privado")).toHaveCount(0);

  await otherPage.goto("/app/alumnos/no-es-un-uuid");
  await expect(otherPage.getByText("No encontramos lo que buscas")).toBeVisible();
  await other.close();
});

test("accesibilidad (axe) en las pantallas principales de la app", async ({ page }) => {
  await signUpAndOnboard(page, unique());
  await createProfile(page, "A11y", "Lectura y decodificación");
  for (const path of ["/app", "/app/alumnos", "/app/alumnos/nuevo", "/app/uso", "/app/adaptar"]) {
    await page.goto(path);
    if (path === "/app/alumnos/nuevo") await page.getByRole("button", { name: /^Lectura/ }).click();
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
    expect(results.violations.map((v) => `${path}: ${v.id}`), path).toEqual([]);
  }
});

test("sin desbordamiento horizontal en móvil y escritorio", async ({ page }) => {
  await signUpAndOnboard(page, unique());
  await createProfile(page, "Resp", "Lenguaje explícito y estructura predecible");
  for (const path of ["/app", "/app/alumnos", "/app/alumnos/nuevo", "/app/uso"]) {
    await page.goto(path);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    expect(overflow, path).toBe(false);
  }
});
