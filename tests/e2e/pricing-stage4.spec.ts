import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { restoreSeededFreePlan } from "./adaptation-seed";
import { signUpAndOnboard, uniqueEmail } from "./helpers";

test("precios reales, planes sin compra y cuota coherente con cuenta", async ({ page }, info) => {
  await restoreSeededFreePlan(page);
  await page.goto("/precios");
  for (const name of ["Free", "Pro", "Max"]) await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  await expect(page.getByText("24,90", { exact: false })).toBeVisible();
  await expect(page.getByText("49,90", { exact: false })).toBeVisible();
  await expect(page.getByText("En preparación", { exact: true })).toBeVisible();
  await expect(page.locator('main a[href="/registro"]')).toHaveCount(1);
  await expect(page.getByText("1 adaptación al mes", { exact: true })).toBeVisible();
  await expect(page.getByText("2 análisis de materiales al mes", { exact: true })).toBeVisible();
  await expect(page.locator('a[href*="checkout"], a[href*="stripe"]')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("precios.png"), fullPage: true, caret: "initial", style: "nextjs-portal { display: none; }" });
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze()).violations).toEqual([]);
  await signUpAndOnboard(page, uniqueEmail());
  await page.goto("/app/uso");
  await expect(page.getByRole("progressbar", { name: "Adaptaciones este periodo" })).toHaveAttribute("aria-valuemax", "1");
  await expect(page.getByRole("progressbar", { name: "Análisis este periodo" })).toHaveAttribute("aria-valuemax", "2");
  await expect(page.getByRole("progressbar", { name: "Perfiles guardados" })).toHaveAttribute("aria-valuemax", "2");
  await expect(page.getByText("Te queda una adaptación este periodo", { exact: true })).toBeVisible();
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.screenshot({ path: info.outputPath("cuenta.png"), fullPage: true, caret: "initial", style: "nextjs-portal { display: none; }" });
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze()).violations).toEqual([]);
  await page.goto("/precios");
  // Signed in, the public header leads back to the app instead of looking signed out; with Max sales off, nothing can be bought.
  await expect(page.getByRole("banner").getByRole("link", { name: "Entrar", exact: true })).toHaveCount(0);
  await expect(page.getByText("En preparación", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Contratar Max" })).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "active" });
  await page.setViewportSize({ width: 320, height: 900 });
  await page.addStyleTag({ content: "html { font-size: 200%; }" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("link", { name: "Empezar gratis", exact: true }).focus();
  await expect(page.getByRole("link", { name: "Empezar gratis", exact: true })).toBeFocused();
});
