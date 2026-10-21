import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { restoreSeededFreePlan, seededPlans } from "./adaptation-seed";

/** /precios against the real (fake-supabase) plans table: only real, enforced differences; nothing unbuilt is sold. */
test("precios: solo diferencias reales y verificables, valores de lanzamiento y nada inexistente como incluido", async ({ page }) => {
  await restoreSeededFreePlan(page);
  await page.goto("/precios");
  await expect(page.getByRole("heading", { name: "Precios", level: 1 })).toBeVisible();
  // Every limit shown is the one the `plans` row enforces (the commercial policy lives in the database, migration 026), never a
  // number copied into the test: Free and Pro are always there (Max only behind its flag).
  for (const plan of await seededPlans(page, ["free", "pro"])) {
    const expected = [`${plan.monthly_adaptations} ${plan.monthly_adaptations === 1 ? "adaptación" : "adaptaciones"} al mes`, `Hasta ${plan.max_profiles} perfiles guardados`];
    if (plan.features.monthly_analyses !== undefined) expected.push(`${plan.features.monthly_analyses} análisis de materiales al mes`);
    if (plan.features.max_pages_per_material !== undefined) expected.push(`Materiales de hasta ${plan.features.max_pages_per_material} páginas`);
    for (const text of expected) await expect(page.getByText(text, { exact: true }).first()).toBeVisible();
  }
  for (const text of ["50 recursos visuales al mes", "Hasta 10 clases", "Hasta 30 clases", "Sin clases", "Varios perfiles a la vez", "Historial completo", "Historial de 30 días"]) {
    await expect(page.getByText(text, { exact: true })).toHaveCount(0);
  }
  await expect(page.getByText("Precios provisionales, IVA incluido. Pendientes de validar costes y demanda.")).toBeVisible();
  await expect(page.getByText(/todavía no están disponibles y no forman parte de ningún plan/)).toBeVisible();
  const serious = (await new AxeBuilder({ page }).analyze()).violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => v.id)).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
