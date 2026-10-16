import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { signUpAndOnboard, uniqueEmail, workspaceOf } from "./helpers";

const fake = `http://127.0.0.1:${process.env.FAKE_SUPABASE_PORT ?? 54399}`;
const key = process.env.FAKE_SERVICE_KEY ?? "sb_secret_fakefakefakefakefake";
const service = { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json", prefer: "return=representation" };

async function seed(page: import("@playwright/test").Page, workspace: string, title: string, grade: string, subject: string) {
  const response = await page.request.post(`${fake}/rest/v1/materials`, { headers: service, data: { workspace_id: workspace, title, stage_slug: "primaria", grade_slug: grade, subject_slug: subject, source_type: "pdf", status: "analyzed", page_count: 1 } });
  expect(response.ok()).toBe(true);
  return (await response.json())[0].id as string;
}
async function filtersOpen(page: import("@playwright/test").Page, open: boolean) {
  if (await page.locator("form details").evaluate((element: HTMLDetailsElement) => element.open) !== open) {
    await page.getByText("Filtros y orden", { exact: true }).click();
  }
}

test("biblioteca: busca y filtra antes del límite, ordena y aísla cada workspace", async ({ page, browser }, info) => {
  const email = uniqueEmail();
  await signUpAndOnboard(page, email);
  const workspace = await workspaceOf(page, email);
  const a = await seed(page, workspace, "Ficha de animales", "3-primaria", "lengua-castellana");
  const b = await seed(page, workspace, "Ficha de medidas", "5-primaria", "matematicas");
  await seed(page, workspace, "Ficha de plantas", "5-primaria", "conocimiento-medio");
  await page.goto("/app/materiales");
  const rows = page.locator("ul.editorial-list li");
  await expect(rows).toHaveCount(3);
  await expect(rows.first()).toContainText("Ficha de plantas");
  await filtersOpen(page, true);
  await page.getByLabel("Ordenar").selectOption("title");
  await page.getByRole("button", { name: "Filtrar" }).click();
  await expect(rows.first()).toContainText("Ficha de animales");
  await expect(rows.last()).toContainText("Ficha de plantas");
  await page.getByLabel("Buscar por título").fill("MEDIDAS");
  await page.getByRole("button", { name: "Filtrar" }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Ficha de medidas");
  await expect(rows.first().getByRole("link", { name: "Abrir ficha" })).toHaveAttribute("href", `/app/materiales/${b}`);
  await page.getByRole("link", { name: "Limpiar", exact: true }).click();
  await filtersOpen(page, true);
  await page.getByLabel("Etapa").selectOption("primaria");
  await page.getByLabel("Curso").selectOption("3-primaria");
  await page.getByLabel("Asignatura").selectOption("lengua-castellana");
  await page.getByRole("button", { name: "Filtrar" }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first().getByRole("link", { name: "Ficha de animales" })).toHaveAttribute("href", `/app/materiales/${a}`);
  await filtersOpen(page, false);
  await page.screenshot({ path: info.outputPath("biblioteca-filtrada.png"), fullPage: true, style: "nextjs-portal { display: none; }" });
  expect((await new AxeBuilder({ page }).analyze()).violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
  await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "active" });
  await page.setViewportSize({ width: 320, height: 900 });
  await page.addStyleTag({ content: "html { font-size: 200%; }" });
  await filtersOpen(page, true);
  const overflow = await page.evaluate(() => [...document.querySelectorAll("main *")].filter((el) => el.getBoundingClientRect().right > innerWidth + 1).slice(0, 12).map((el) => ({ tag: el.tagName, className: el.className, text: el.textContent?.slice(0, 45), right: Math.round(el.getBoundingClientRect().right) })));
  expect(overflow).toEqual([]);
  const other = await browser.newContext({ viewport: page.viewportSize()! });
  const visitor = await other.newPage();
  await signUpAndOnboard(visitor, uniqueEmail());
  await visitor.goto("/app/materiales");
  await expect(visitor.getByText("Todavía no has subido ningún material.")).toBeVisible();
  await visitor.goto(`/app/materiales/${a}`);
  await expect(visitor.getByText("No encontramos lo que buscas")).toBeVisible();
  await other.close();
});
