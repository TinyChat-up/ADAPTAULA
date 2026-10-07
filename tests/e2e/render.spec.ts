import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { allowAdaptations, seedReadyDocument } from "./adaptation-seed";
import { makePdf, signUpAndOnboard, uniqueEmail, uploadAndOpen, waitForAnalysis, workspaceOf } from "./helpers";
import { ANSWER_KEY_SECRET, BLANK_SECRET, bachillerato, geografia, primaria, stress } from "../support/render-fixtures";

/**
 * El visor de la ficha en el navegador (proyectos desktop y mobile de playwright.config.ts): geometría, impresión y separación
 * alumno/docente, con documentos sintéticos sembrados como los dejaría el pipeline. Sin PDF, sin proveedores.
 */
async function createAdaptation(page: Page, materialUrl: string): Promise<string> {
  await page.goto(materialUrl);
  await page.getByLabel("Perfil").selectOption({ label: "M.R." });
  await page.getByRole("button", { name: "Adaptar material" }).click();
  await expect(page).toHaveURL(/\/app\/adaptaciones\/[0-9a-f-]{36}$/);
  return page.url().split("/").pop()!;
}

/** Every element inside each sheet stays within it horizontally, and flow siblings do not overlap vertically. */
async function geometry(page: Page) {
  return page.evaluate(() => {
    const out = { outside: [] as string[], overlaps: [] as string[], sheets: 0, tableOverflow: [] as string[] };
    document.querySelectorAll<HTMLElement>(".ms-sheet").forEach((sheet) => {
      out.sheets += 1;
      const box = sheet.getBoundingClientRect();
      sheet.querySelectorAll<HTMLElement>("*").forEach((el) => {
        if (el.closest(".ms-sr") || el.classList.contains("ms-sr")) return;
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) return;
        if (r.right > box.right + 1.5 || r.left < box.left - 1.5) out.outside.push(`${el.tagName}.${el.className}`);
      });
      sheet.querySelectorAll<HTMLElement>(".ms-table").forEach((t) => {
        const holder = t.closest(".ms-sheet")!.querySelector<HTMLElement>(".ms-flow")!.getBoundingClientRect();
        if (t.getBoundingClientRect().width > holder.width + 1.5) out.tableOverflow.push(t.className);
      });
      const kids = [...(sheet.querySelector(".ms-flow")?.children ?? [])] as HTMLElement[];
      for (let i = 1; i < kids.length; i++) if (kids[i]!.getBoundingClientRect().top < kids[i - 1]!.getBoundingClientRect().bottom - 1.5) out.overlaps.push(kids[i]!.className);
    });
    return out;
  });
}
const serious = async (page: Page) => (await new AxeBuilder({ page }).include(".ms-stage").analyze()).violations.filter((v) => v.impact === "serious" || v.impact === "critical");

test("visor: Primaria, Geografía, Bachillerato y estrés: sin desbordes ni solapes, sin clave de respuestas, vista docente aparte y modo impresión", async ({ page }) => {
  test.setTimeout(480_000);
  const email = uniqueEmail();
  await signUpAndOnboard(page, email);
  await page.goto("/app/alumnos/nuevo");
  await page.getByLabel("Alias o iniciales").fill("M.R.");
  await page.getByLabel("Etapa").selectOption({ label: "Educación Primaria" });
  await page.getByLabel("Curso").selectOption({ label: "5.º de Primaria" });
  await page.getByRole("button", { name: "Crear perfil" }).click();
  await expect(page).toHaveURL(/\/app\/alumnos/);
  await uploadAndOpen(page, { name: "Ficha.pdf", mimeType: "application/pdf", buffer: await makePdf({ marker: `rd-${Date.now()}-${Math.random()}` }) });
  await waitForAnalysis(page);
  const material = page.url();
  const workspaceId = await workspaceOf(page, email);
  await allowAdaptations(page);

  const docs = { primaria: primaria(), geografia: geografia(), bachillerato: bachillerato(), estres: stress() };
  const ids: Record<string, string> = {};
  for (const [name, document] of Object.entries(docs)) {
    ids[name] = await createAdaptation(page, material);
    await seedReadyDocument(page, workspaceId, ids[name]!, document);
  }

  for (const name of Object.keys(docs)) {
    await page.goto(`/app/adaptaciones/${ids[name]}/vista?modo=alumno`);
    await expect(page.locator(".ms-sheet").first()).toBeVisible();
    const g = await geometry(page);
    expect(g.sheets, name).toBeGreaterThan(0);
    expect(g.outside, name).toEqual([]);
    expect(g.overlaps, name).toEqual([]);
    expect(g.tableOverflow, name).toEqual([]);
    // The page itself never grows sideways (the sheet scrolls inside its own stage on a phone).
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), name).toBe(true);
    const content = await page.content();
    expect(content).not.toContain(ANSWER_KEY_SECRET);
    expect(content).not.toContain(BLANK_SECRET);
    expect(content).not.toMatch(/blk_|source_refs|material_renderer|Información para la docente/);
    // Nothing is clipped: every sheet grows with its content.
    expect(await page.evaluate(() => [...document.querySelectorAll<HTMLElement>(".ms-sheet")].every((s) => s.scrollHeight <= s.clientHeight + 1))).toBe(true);
  }

  // material_renderer@v2: the sheet uses its own local font (the same file the PDF embeds) and numbered steps show their numbers.
  await page.goto(`/app/adaptaciones/${ids.primaria}/vista?modo=alumno`);
  const sheet = await page.evaluate(async () => {
    await document.fonts.ready;
    const root = document.querySelector(".ms-root")!;
    const ordered = document.querySelector(".ms-steps, ol.ms-list, .ms-match ol");
    return {
      family: getComputedStyle(root).fontFamily.split(",")[0]!.replace(/["']/g, "").trim(),
      loaded: [...document.fonts].some((f) => f.family.replace(/["']/g, "") === "Adaptaula Inter" && f.status === "loaded"),
      marker: ordered ? getComputedStyle(ordered).listStyleType : null,
    };
  });
  expect(sheet.family).toBe("Adaptaula Inter");
  expect(sheet.loaded).toBe(true);
  if (sheet.marker !== null) expect(sheet.marker).toBe("decimal");

  // Stress sheet: the long word, the ten-column table and the long lists are all there.
  await page.goto(`/app/adaptaciones/${ids.estres}/vista?modo=alumno`);
  await expect(page.getByText(/Supercalifragilistico/)).toBeVisible();
  await expect(page.getByText("Columna 10")).toBeVisible();
  await expect(page.getByText(/Elemento 12 de una lista/)).toBeVisible();
  await expect(page.getByText("Apartado 8")).toBeVisible();

  // Bachillerato: planner and checklist are real areas; the 150–180 word answer gets room.
  await page.goto(`/app/adaptaciones/${ids.bachillerato}/vista?modo=alumno`);
  expect(await page.locator(".ms-checklist .ms-box").count()).toBe(4);
  expect(await page.locator(".ms-planner .ms-lines > div").count()).toBe(10);
  expect(await page.locator(".ms-activity .ms-lines > div").count()).toBeGreaterThanOrEqual(17);

  // Geografía: table and unnamed series are shown as data without legend or invented names.
  await page.goto(`/app/adaptaciones/${ids.geografia}/vista?modo=alumno`);
  await expect(page.locator(".ms-table").first()).toBeVisible();
  await expect(page.getByText(/Serie \d/)).toHaveCount(0);
  await expect(page.locator(".ms-data").first()).toBeVisible();

  // Primaria: the original figures are not available as assets, so the student sheet never pretends they exist.
  await page.goto(`/app/adaptaciones/${ids.primaria}/vista?modo=alumno`);
  await expect(page.locator(".ms-sheet img")).toHaveCount(0);
  await expect(page.locator(".ms-missing")).toHaveCount(0);

  // Teacher view: same sheet plus the panel outside it; the missing figures are marked there.
  await page.goto(`/app/adaptaciones/${ids.primaria}/vista`);
  await expect(page.getByRole("complementary", { name: "Información para la docente" })).toBeVisible();
  await expect(page.getByText("material_renderer@v2")).toBeVisible();
  await expect(page.locator(".ms-missing").first()).toBeVisible();
  expect(await serious(page)).toEqual([]);

  // Print: app chrome, controls and the teacher panel disappear; the sheet stays, within the page.
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".ms-teacher")).toBeHidden();
  await expect(page.locator(".ms-chrome").first()).toBeHidden();
  await expect(page.locator("[data-app-chrome]").first()).toBeHidden();
  await expect(page.locator(".ms-sheet").first()).toBeVisible();
  const g = await geometry(page);
  expect(g.outside).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const styles = await page.evaluate(() => ({
    sheetBreak: getComputedStyle(document.querySelector(".ms-sheet")!).breakAfter,
    keep: [...document.querySelectorAll<HTMLElement>(".ms-activity[data-keep], .ms-checklist[data-keep]")].map((e) => getComputedStyle(e).breakInside),
    heading: getComputedStyle(document.querySelector(".ms-h")!).breakAfter,
  }));
  expect(styles.sheetBreak).toBe("page");
  expect(styles.keep.every((v) => v === "avoid")).toBe(true);
  expect(styles.heading).toBe("avoid");
  await page.emulateMedia({ media: "screen" });

  // An unfinished adaptation has no sheet; another account gets a 404.
  const pending = await createAdaptation(page, material);
  await page.goto(`/app/adaptaciones/${pending}/vista`);
  await expect(page.getByText("Esta adaptación todavía no tiene una ficha entregada")).toBeVisible();
  const other = await page.context().browser()!.newContext();
  const otherPage = await other.newPage();
  await signUpAndOnboard(otherPage, uniqueEmail());
  expect((await otherPage.goto(`/app/adaptaciones/${ids.primaria}/vista`))?.status()).toBe(404);
  await other.close();
});
