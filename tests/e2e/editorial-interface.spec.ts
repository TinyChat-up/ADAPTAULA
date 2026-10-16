import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { makePdf, signUpAndOnboard, uniqueEmail, uploadAndOpen, waitForAnalysis, workspaceOf, createReviewedAdaptation } from "./helpers";
import { requireVisuals, seedReadyDocument, seedWorking } from "./adaptation-seed";
import { TABLE_CHOICE_DRAFT, tableChoiceCase } from "../support/table-choice-case";

async function accessible(page: Page) {
  await expect(page.locator("h1").first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
}

test("portada: demostración fiel entre páginas, navegación y movimiento reducido", async ({ page }, info) => {
  await page.goto("/");
  await accessible(page);
  const original = page.getByRole("article", { name: "Ficha original", exact: true });
  const adapted = page.getByRole("article", { name: "Ficha adaptada", exact: true });
  expect(await original.locator("tr").allTextContents()).toEqual(await adapted.locator("tr").allTextContents());
  for (const option of TABLE_CHOICE_DRAFT.choice.options) { await expect(original).toContainText(option.text); await expect(adapted).toContainText(option.text); }
  await expect(adapted.locator(".sample-circle")).toHaveCount(3);
  await expect(page.getByText("Demostración preparada por nosotros.", { exact: true })).toBeVisible();
  expect(await page.locator(".sample-paper").evaluateAll((els) => els.every((el) => { const r = el.getBoundingClientRect(); return Math.abs(r.height / r.width - 297 / 210) < 0.04; }))).toBe(true);
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await page.locator("main").evaluate((el) => [el, ...el.querySelectorAll("*")].every((node) => getComputedStyle(node).animationName === "none"))).toBe(true);
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Saltar al contenido" })).toBeFocused();
  if (info.project.name === "mobile") await page.getByRole("button", { name: "Abrir menú" }).click();
  await page.getByRole("navigation", { name: "Principal", exact: true }).getByRole("link", { name: "Cómo funciona" }).click();
  await expect(page).toHaveURL(/\/como-funciona$/);
  await accessible(page);
});

test("mesa de trabajo: subida, perfiles, estados, filtros, navegación y resultado conservados", async ({ page }, info) => {
  test.setTimeout(240_000);
  const email = uniqueEmail();
  await signUpAndOnboard(page, email);
  // Wait for the onboarding navigation: do not race its redirect with the next goto.
  await expect(page).toHaveURL(/\/app\/alumnos\/nuevo/);
  await page.getByLabel("Alias o iniciales").fill("M.R.");
  await page.getByLabel("Etapa").selectOption({ label: "Educación Primaria" });
  await page.getByLabel("Curso").selectOption({ label: "5.º de Primaria" });
  await page.getByRole("button", { name: "Crear perfil", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/alumnos\?aviso=creado/);
  await accessible(page);

  await page.goto("/app/adaptar");
  await page.locator('input[type="file"]').setInputFiles({ name: "incorrecto.txt", mimeType: "text/plain", buffer: Buffer.from("fixture") });
  await expect(page.getByRole("alert").filter({ hasText: /formato/i })).toBeVisible();
  await expect(page.getByRole("button", { name: "Analizar material" })).toBeDisabled();
  const id = await uploadAndOpen(page, { name: "Tabla de animales.pdf", mimeType: "application/pdf", buffer: await makePdf({ marker: `editorial-${Date.now()}` }) });
  await waitForAnalysis(page);
  await accessible(page);
  const material = `/app/materiales/${id}`;
  const workspace = await workspaceOf(page, email);
  const result = await createReviewedAdaptation(page, material);
  const doc = tableChoiceCase().document;
  for (const p of doc.pages) for (const b of p.blocks) if (b.type === "activity") { b.prompt = TABLE_CHOICE_DRAFT.prompt; b.response = TABLE_CHOICE_DRAFT.choice; }
  await seedReadyDocument(page, workspace, result, doc);
  await requireVisuals(page, result, []);
  await createReviewedAdaptation(page, material);
  const working = await createReviewedAdaptation(page, material);
  await seedWorking(page, working);

  await page.goto("/app");
  await accessible(page);
  await page.screenshot({ path: info.outputPath("mesa-de-trabajo.png"), fullPage: true, style: "nextjs-portal { display: none; }" });
  expect(await page.locator("main h2").allTextContents()).toEqual(["Necesitan tu atención", "En curso", "Materiales recientes", "Fichas preparadas"]);
  await expect(page.getByRole("main").getByRole("link", { name: "Adaptar material", exact: true })).toHaveCount(1);
  if (info.project.name === "mobile") {
    await page.getByRole("button", { name: "Más", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Más opciones" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Más opciones" })).not.toBeVisible();
    await expect(page.getByRole("button", { name: "Más", exact: true })).toBeFocused();
    await page.getByRole("button", { name: "Más", exact: true }).click();
    await page.getByRole("dialog").getByRole("link", { name: "Adaptaciones", exact: true }).click();
  } else await page.getByRole("navigation", { name: "Principal", exact: true }).getByRole("link", { name: "Adaptaciones", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/historial$/);
  const filters = page.getByRole("navigation", { name: "Filtrar adaptaciones" });
  await filters.getByRole("link", { name: /Necesitan tu atención/ }).click();
  await expect(page).toHaveURL(/estado=atencion/);
  await expect(page.getByRole("main").getByText("Esperando tu revisión", { exact: true })).toHaveCount(1);
  await expect(page.getByRole("main").getByText("Ficha preparada", { exact: true })).toHaveCount(0);
  await accessible(page);

  for (const path of ["/app/materiales", "/app/alumnos", "/app/adaptar", "/app/uso", `/app/adaptaciones/${result}/vista`]) {
    await page.goto(path);
    await accessible(page);
    if (path === "/app/materiales") await page.screenshot({ path: info.outputPath("biblioteca.png"), fullPage: true, style: "nextjs-portal { display: none; }" });
  }
  await expect(page.locator(".ms-sheet")).toBeVisible();
  await expect(page.getByRole("button", { name: "Descargar PDF" })).toBeVisible();
  await expect(page.locator(".ms-sheet")).not.toContainText(/correcta|solución/i);
  // Narrow reflow and enlarged text exercise the shell, rows and controls without changing the student renderer.
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto("/app/materiales");
  await page.addStyleTag({ content: "html {font-size: 200%}" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});
