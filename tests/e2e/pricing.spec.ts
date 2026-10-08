import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { restoreSeededFreePlan } from "./adaptation-seed";

/** /precios against the real (fake-supabase) plans table: only real, enforced differences; nothing unbuilt is sold. */
test("precios: solo diferencias reales y verificables, valores de lanzamiento y nada inexistente como incluido", async ({ page }) => {
  await restoreSeededFreePlan(page);
  await page.goto("/precios");
  await expect(page.getByRole("heading", { name: "Precios", level: 1 })).toBeVisible();
  for (const text of ["5 adaptaciones al mes", "75 adaptaciones al mes", "150 adaptaciones al mes", "10 análisis de materiales al mes", "Hasta 2 perfiles guardados", "Materiales de hasta 5 páginas"]) {
    await expect(page.getByText(text, { exact: true })).toBeVisible();
  }
  for (const text of ["50 recursos visuales al mes", "Hasta 10 clases", "Hasta 30 clases", "Sin clases", "Varios perfiles a la vez", "Historial completo", "Historial de 30 días"]) {
    await expect(page.getByText(text, { exact: true })).toHaveCount(0);
  }
  await expect(page.getByText("Precios y límites de lanzamiento: pueden ajustarse antes de que se activen los planes de pago.")).toBeVisible();
  await expect(page.getByText(/todavía no están disponibles y no forman parte de ningún plan/)).toBeVisible();
  const serious = (await new AxeBuilder({ page }).analyze()).violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => v.id)).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
