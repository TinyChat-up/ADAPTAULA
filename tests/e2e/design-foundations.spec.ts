import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { signUpAndOnboard, uniqueEmail } from "./helpers";

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}

test("navegación plegable, contexto, teclado y preferencias visuales", async ({ page, context }, info) => {
  test.setTimeout(120000);
  await signUpAndOnboard(page, uniqueEmail());
  await expect(page).toHaveURL(/\/app\/alumnos\/nuevo/);
  await page.goto("/app/materiales");
  await expect(page.getByRole("navigation", { name: "Ubicación", exact: true })).toHaveText("Materiales");
  await noOverflow(page);
  const desktop = page.getByRole("navigation", { name: "Principal", exact: true });
  if (info.project.name === "desktop") {
    const width = await page.locator("main").evaluate((el) => el.clientWidth);
    await page.getByRole("button", { name: "Plegar barra" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Ampliar barra lateral" })).toBeFocused();
    await expect(page.locator("[data-app-grid]")).toHaveAttribute("data-compact", "true");
    expect(await page.locator("main").evaluate((el) => el.clientWidth)).toBeGreaterThan(width);
    for (const label of ["Inicio", "Adaptar material", "Materiales", "Perfiles", "Adaptaciones"]) await expect(desktop.getByRole("link", { name: label, exact: true })).toBeVisible();
    await desktop.getByRole("link", { name: "Adaptaciones", exact: true }).click();
    await expect(page).toHaveURL(/\/app\/historial$/);
    await expect(desktop.getByRole("link", { name: "Adaptaciones", exact: true })).toHaveAttribute("aria-current", "page");
    await page.reload();
    await expect(page.locator("[data-app-grid]")).toHaveAttribute("data-compact", "true");
    await page.screenshot({ path: info.outputPath("navegacion-compacta.png"), fullPage: true, style: "nextjs-portal { display: none; }" });
    // Next's development indicator overlaps the bottom-left corner; exercise the same native button with the keyboard.
    await page.getByRole("button", { name: "Ampliar barra lateral" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("[data-app-grid]")).toHaveAttribute("data-compact", "false");
  } else {
    const more = page.getByRole("button", { name: "Más", exact: true });
    await more.click();
    const dialog = page.getByRole("dialog", { name: "Más opciones" });
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(more).toBeFocused();
    await more.click();
    await page.screenshot({ path: info.outputPath("navegacion-movil.png"), fullPage: true, style: "nextjs-portal { display: none; }" });
    await page.setViewportSize({ width: 1024, height: 900 });
    await expect(dialog).not.toBeVisible();
    await desktop.getByRole("link", { name: "Materiales", exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await more.click();
    await dialog.getByRole("link", { name: "Plan y cuenta", exact: true }).click();
    await expect(page).toHaveURL(/\/app\/uso$/);
    await expect(dialog).not.toBeVisible();
  }
  // The skip link moves real keyboard focus beyond the persistent navigation.
  await page.goto("/app/materiales");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Saltar al contenido" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();
  if (info.project.name === "mobile") {
    // Native Tab scrolling must keep controls above the fixed bottom navigation.
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press("Tab");
      const focused = await page.locator("main :focus").count();
      if (!focused) break;
      const box = await page.locator("main :focus").boundingBox();
      const bar = await page.getByRole("navigation", { name: "Navegación móvil" }).boundingBox();
      expect(box!.y + box!.height).toBeLessThanOrEqual(bar!.y);
    }
  }
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);

  // Media emulated through CDP applies asynchronously: the computed styles are polled, never read once.
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-transparency", value: "reduce" }, { name: "prefers-reduced-motion", value: "reduce" }] });
  await expect.poll(() => page.locator(".app-topbar").evaluate((el) => getComputedStyle(el).backdropFilter)).toBe("none");
  await expect.poll(() => page.locator(".nav-link").first().evaluate((el) => parseFloat(getComputedStyle(el).transitionDuration))).toBeLessThan(.001);
  await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-contrast", value: "more" }] });
  await expect.poll(() => page.locator(".app-topbar").evaluate((el) => getComputedStyle(el).backdropFilter)).toBe("none");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.emulateMedia({ forcedColors: "active" });
  const account = page.getByRole("link", { name: /Plan Free/ }).filter({ visible: true }).first();
  await account.focus();
  expect(await account.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe("none");
  await noOverflow(page);
  await page.emulateMedia({ forcedColors: "none" });
  await cdp.detach();
  await page.setViewportSize({ width: 320, height: 900 });
  await page.addStyleTag({ content: "html { font-size: 200%; }" });
  await noOverflow(page);
  await page.screenshot({ path: info.outputPath("texto-ampliado.png"), fullPage: true, style: "nextjs-portal { display: none; }" });
});
