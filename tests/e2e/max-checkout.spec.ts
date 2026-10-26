import { expect, test } from "@playwright/test";
import { signUpAndOnboard, uniqueEmail } from "./helpers";

// Needs a local server with FLAG_MAX_PLAN_ENABLED=true and fake sk_test_/whsec_/price_ values; Stripe is never called
// (the checkout request is answered by the test). Without E2E_MAX_CHECKOUT the default suite keeps Max sales off.
test("Max se contrata desde su tarjeta de Precios y desde Plan y cuenta, y un fallo se explica junto al botón", async ({ page }) => {
  test.skip(!process.env.E2E_MAX_CHECKOUT, "Requiere servidor local con la contratación de Max encendida.");
  await page.goto("/precios");
  await expect(page.getByRole("link", { name: "Entrar para contratar Max" })).toHaveAttribute("href", "/login?next=/precios");
  await signUpAndOnboard(page, uniqueEmail());
  await page.route("**/api/stripe/checkout", (route) =>
    route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { message: "No hemos podido abrir el pago. No se ha hecho ningún cargo; inténtalo de nuevo en unos minutos." } }) }));
  await page.goto("/precios");
  const buy = page.getByRole("button", { name: "Contratar Max" });
  await expect(buy).toBeVisible();
  await expect(page.getByText("Pago con Stripe en modo prueba: no se cobra nada.")).toBeVisible();
  await buy.click();
  await expect(page.getByRole("alert").filter({ hasText: "No se ha hecho ningún cargo" })).toBeVisible();
  await expect(buy).toBeEnabled();
  await page.goto("/app/uso");
  await expect(page.getByRole("button", { name: "Contratar Max" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Prueba privada de Max" })).toHaveCount(0);
});
