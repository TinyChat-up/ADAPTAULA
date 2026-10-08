import { expect, test } from "@playwright/test";
import { restoreSeededFreePlan } from "./adaptation-seed";
import { makePdf, signUpAndOnboard, uniqueEmail, uploadAndOpen, waitForAnalysis } from "./helpers";

/**
 * The Free plan exactly as seeded (no `allowAdaptations` here): 5 adaptations a month, PROVISIONAL. A Free teacher can really try
 * the product (create 5), the 6th is refused with the plan-limit copy (never a technical error) and the usage screens agree.
 */
test("Free: 5 adaptaciones al mes; la sexta se rechaza con un mensaje claro y el uso lo refleja", async ({ page }) => {
  test.setTimeout(240_000);
  await restoreSeededFreePlan(page);
  await signUpAndOnboard(page, uniqueEmail());
  await page.goto("/app/uso");
  await expect(page.getByText("0 de 5").first()).toBeVisible();

  const materialId = await uploadAndOpen(page, { name: "Ficha.pdf", mimeType: "application/pdf", buffer: await makePdf({ marker: `free-${Date.now()}-${Math.random()}` }) });
  await waitForAnalysis(page);
  await page.getByRole("link", { name: "Crear un perfil" }).click();
  await page.getByLabel("Alias o iniciales").fill("F.P.");
  await page.getByLabel("Etapa").selectOption({ label: "Educación Primaria" });
  await page.getByLabel("Curso").selectOption({ label: "5.º de Primaria" });
  await page.getByRole("button", { name: "Crear perfil" }).click();
  await expect(page).toHaveURL(new RegExp(`/app/materiales/${materialId}\\?perfil=`));

  // Both paths take the same single unit: three with «Hacer magia», two with «Revisar antes de crear».
  for (let i = 1; i <= 5; i++) {
    await page.goto(`/app/materiales/${materialId}`);
    await page.getByRole("button", { name: i <= 3 ? "Hacer magia" : "Revisar antes de crear" }).click();
    await expect(page).toHaveURL(/\/app\/adaptaciones\/[0-9a-f-]{36}/);
  }

  await page.goto(`/app/materiales/${materialId}`);
  await page.getByRole("button", { name: "Hacer magia" }).click();
  await expect(page.getByText("Has utilizado las adaptaciones disponibles de este periodo.")).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/app/materiales/${materialId}`));
  expect(await page.locator("main").innerText()).not.toMatch(/entitlement|quota|exhausted|402|error \d/i);

  await page.goto("/app/uso");
  await expect(page.getByText("5 de 5").first()).toBeVisible();
  await page.goto("/app");
  await expect(page.getByText("5 de 5").first()).toBeVisible();
  await page.goto("/app/historial");
  await expect(page.locator("main").getByRole("link", { name: /Ver ficha|Ver progreso|Revisar adaptación/ })).toHaveCount(5);
});
