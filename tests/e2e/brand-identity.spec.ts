import { mkdirSync } from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { allowAdaptations, unlinkChoicesFromTables } from "./adaptation-seed";
import { makePdf, uniqueEmail, uploadAndOpen, waitForAnalysis } from "./helpers";

test.describe.configure({ mode: "serial" });

/**
 * Identidad visual (Fase C): los recursos oficiales de la marca en cada punto de identidad, cargados y sin deformar, y la galería
 * comparativa. Con BRAND_GALLERY_DIR guarda una captura por pantalla y proyecto; con BRAND_BEFORE=1 solo captura (para la
 * referencia «antes», sobre el código anterior a la marca).
 */
const GALLERY = process.env.BRAND_GALLERY_DIR;
const BEFORE = process.env.BRAND_BEFORE === "1";
const WORDMARK = "/brand/adaptaula-logotipo.svg";
const SYMBOL = "/brand/adaptaula-simbolo.svg";
/** Natural proportions of the official pieces (viewBox width / height). */
const WORDMARK_RATIO = 1225.7 / 263;
const SYMBOL_RATIO = 829.7 / 713;

async function snap(page: Page, info: TestInfo, name: string, fullPage = false) {
  if (!GALLERY) return;
  mkdirSync(GALLERY, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(GALLERY, `${info.project.name}-${name}.png`), fullPage });
}

const serious = async (page: Page) => (await new AxeBuilder({ page }).analyze()).violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id);
const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

/** An official piece, loaded (not a broken image), decorative inside its named link, inside the viewport and not stretched. */
async function expectMark(img: Locator, src: string, ratio: number) {
  await expect(img).toBeVisible();
  await expect(img).toHaveAttribute("src", src);
  await expect(img).toHaveAttribute("alt", "");
  const { natural, box, vw } = await img.evaluate((el: HTMLImageElement) => ({ natural: el.naturalWidth, box: el.getBoundingClientRect().toJSON() as DOMRect, vw: window.innerWidth }));
  expect(natural).toBeGreaterThan(0);
  expect(box.height).toBeGreaterThanOrEqual(16);
  expect(box.left).toBeGreaterThanOrEqual(0);
  expect(box.right).toBeLessThanOrEqual(vw);
  expect(Math.abs(box.width / box.height - ratio) / ratio).toBeLessThan(0.03);
}

async function expectLockup(link: Locator, { wordmark = true }: { wordmark?: boolean } = {}) {
  await expect(link).toHaveAccessibleName("Adaptaula, inicio");
  await expectMark(link.locator(`img[src="${SYMBOL}"]`), SYMBOL, SYMBOL_RATIO);
  if (wordmark) await expectMark(link.locator(`img[src="${WORDMARK}"]`), WORDMARK, WORDMARK_RATIO);
  else await expect(link.locator(`img[src="${WORDMARK}"]`)).toBeHidden();
}

test("landing, cabecera, footer y acceso: logotipo oficial, favicon y sin desbordes", async ({ page, request }, info) => {
  await page.goto("/");
  await snap(page, info, "01-landing");
  await snap(page, info, "01-landing-completa", true);
  if (!BEFORE) {
    await expectLockup(page.getByRole("banner").getByRole("link", { name: "Adaptaula, inicio" }));
    await expectLockup(page.getByRole("contentinfo").getByRole("link", { name: "Adaptaula, inicio" }));
    expect(await noOverflow(page)).toBe(true);
    expect(await serious(page)).toEqual([]);
    // Browser and device icons as the page declares them (Next generates their URLs), all served by the app, never another host.
    const icons = await page.locator('head link[rel="icon"], head link[rel="apple-touch-icon"], head link[rel="manifest"]').evaluateAll((links) => links.map((l) => ({ rel: l.getAttribute("rel")!, href: l.getAttribute("href")!, type: l.getAttribute("type") })));
    expect(icons.map((i) => i.rel).sort()).toEqual(expect.arrayContaining(["apple-touch-icon", "icon", "manifest"]));
    expect(icons.some((i) => i.type === "image/svg+xml")).toBe(true);
    for (const icon of icons) {
      expect(icon.href.startsWith("/"), icon.href).toBe(true);
      const res = await request.get(icon.href);
      expect(res.status(), icon.href).toBe(200);
      expect(res.headers()["content-type"], icon.href).toMatch(icon.rel === "manifest" ? /manifest\+json|application\/json/ : /^image\//);
    }
    const manifest = (await (await request.get(icons.find((i) => i.rel === "manifest")!.href)).json()) as { icons: Array<{ src: string; sizes: string }> };
    for (const icon of manifest.icons) expect((await request.get(icon.src)).status(), icon.src).toBe(200);
    expect(manifest.icons.map((i) => i.sizes)).toEqual(expect.arrayContaining(["192x192", "512x512"]));
    // The form speaks the brand: titles in the display face closest to the wordmark, the steps in the colours of «aula» in order.
    expect(await page.getByRole("heading", { level: 1 }).first().evaluate((h) => getComputedStyle(h).fontFamily)).toMatch(/Outfit/i);
    const stepRules = await page.locator("#como-funciona ol > li").evaluateAll((items) => items.map((li) => getComputedStyle(li).borderTopColor));
    expect(stepRules.slice(0, 4)).toEqual(["rgb(219, 110, 1)", "rgb(28, 161, 69)", "rgb(0, 103, 253)", "rgb(1, 153, 186)"]);
    // Exactly one horizontal logo per header: never duplicated.
    await expect(page.getByRole("banner").locator(`img[src="${WORDMARK}"]:visible`)).toHaveCount(1);
  }
  await page.goto("/login");
  await snap(page, info, "02-login");
  if (!BEFORE) {
    await expect(page.locator(`main img[src="${WORDMARK}"]:visible, body img[src="${WORDMARK}"]:visible`)).toHaveCount(1);
    await expectLockup(page.getByRole("link", { name: "Adaptaula, inicio" }).locator("visible=true").first());
    expect(await noOverflow(page)).toBe(true);
    expect(await serious(page)).toEqual([]);
  }
});

test("espacio docente: bienvenida, escritorio, barra lateral expandida y plegada, «Hacer magia» y la ficha con su símbolo", async ({ page }, info) => {
  test.setTimeout(300_000);
  const email = uniqueEmail();
  await page.goto("/registro");
  await page.getByLabel("Nombre").fill("Ana Pérez");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Contraseña").fill("contraseña-segura-123");
  await page.getByRole("button", { name: "Crear cuenta" }).click();
  await expect(page).toHaveURL(/\/app\/bienvenida/);
  await snap(page, info, "03-bienvenida");
  if (!BEFORE) {
    await expectLockup(page.getByRole("link", { name: "Adaptaula, inicio" }));
    expect(await noOverflow(page)).toBe(true);
  }
  await page.getByRole("radio", { name: "Primaria" }).check();
  await page.getByText("Prefiero empezar de otra forma").click();
  await page.getByRole("radio", { name: "Explorar mi mesa de trabajo" }).check();
  await page.getByRole("button", { name: /Entrar en Adaptaula/ }).click();
  await expect(page).toHaveURL(/\/app$/);
  await snap(page, info, "04-escritorio");

  const desktop = info.project.name === "desktop";
  if (!BEFORE) {
    expect(await noOverflow(page)).toBe(true);
    expect(await serious(page)).toEqual([]);
    if (desktop) {
      await expectLockup(page.getByRole("complementary", { name: "Espacio docente" }).getByRole("link", { name: "Adaptaula, inicio" }));
    } else {
      // Mobile header: the horizontal logo once, beside the plan; the sidebar is not shown.
      await expectLockup(page.getByRole("banner").getByRole("link", { name: "Adaptaula, inicio" }));
    }
  }
  if (desktop) {
    await page.getByRole("button", { name: "Plegar barra" }).click();
    await snap(page, info, "05-barra-plegada");
    if (!BEFORE) {
      // Folded: the symbol alone, centred and still a named link home.
      await expectLockup(page.getByRole("complementary", { name: "Espacio docente" }).getByRole("link", { name: "Adaptaula, inicio" }), { wordmark: false });
      expect(await noOverflow(page)).toBe(true);
    }
    // By keyboard: in development the Next indicator sits over the folded bar's bottom corner and would take the pointer.
    await page.getByRole("button", { name: /Ampliar/ }).press("Enter");
  }

  await allowAdaptations(page);
  const materialId = await uploadAndOpen(page, { name: "Ficha.pdf", mimeType: "application/pdf", buffer: await makePdf({ marker: `brand-${Date.now()}-${Math.random()}` }) });
  await waitForAnalysis(page);
  await unlinkChoicesFromTables(page, materialId);
  await page.getByRole("link", { name: "Crear un perfil" }).click();
  await page.getByLabel("Alias o iniciales").fill("M.R.");
  await page.getByLabel("Etapa").selectOption({ label: "Educación Primaria" });
  await page.getByLabel("Curso").selectOption({ label: "5.º de Primaria" });
  await page.getByRole("button", { name: "Crear perfil" }).click();
  await expect(page.getByRole("heading", { name: "¿Cómo quieres preparar esta ficha?" })).toBeVisible();
  await snap(page, info, "06-hacer-magia");
  if (!BEFORE) {
    // What the AI does by itself is told apart from what the teacher decides: «Hacer magia» in the brand blue, «Revisar antes de
    // crear» a neutral control. Its white label keeps ≥ 4.5:1 on both ends of the gradient (measured in brand.css).
    const magic = page.getByRole("button", { name: "Hacer magia" });
    await expect(magic).toHaveClass(/btn-magic/);
    expect(await magic.evaluate((b) => getComputedStyle(b).backgroundImage)).toMatch(/linear-gradient/);
    expect(await magic.evaluate((b) => getComputedStyle(b).color)).toBe("rgb(255, 255, 255)");
    await expect(page.getByRole("button", { name: "Revisar antes de crear" })).not.toHaveClass(/btn-magic/);
    expect(await noOverflow(page)).toBe(true);
    expect(await serious(page)).toEqual([]);
  }

  await page.getByRole("button", { name: "Hacer magia" }).click();
  await expect(page).toHaveURL(/\/app\/adaptaciones\/[0-9a-f-]{36}\/vista$/, { timeout: 90_000 });
  const sheet = page.locator(".ms-sheet").first();
  await expect(sheet).toBeVisible();
  await snap(page, info, "07-vista-previa");
  if (!BEFORE) {
    // The sheet carries the official symbol, small and named, beside the subject and grade; never the horizontal logo.
    const symbol = sheet.locator(".ms-masthead svg.ms-symbol");
    await expect(symbol).toBeVisible();
    await expect(symbol).toHaveAccessibleName("Adaptaula");
    const height = await symbol.evaluate((el) => el.getBoundingClientRect().height);
    expect(height).toBeGreaterThan(12);
    expect(height).toBeLessThan(40);
    await expect(sheet.locator(`img[src="${WORDMARK}"]`)).toHaveCount(0);
    expect(await noOverflow(page)).toBe(true);
  }
});
