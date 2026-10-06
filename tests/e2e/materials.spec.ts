import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { PNG_1X1, alertOf, analysisUnits, chooseFile, makePdf, reserveAnalyses, signUpAndOnboard, uniqueEmail, uploadAndOpen, waitForAnalysis, workspaceOf } from "./helpers";

test.describe.configure({ mode: "serial" });

const pdf = async (marker = `${Date.now()}-${Math.random()}`, pages = 1) => ({
  name: "Ficha de fracciones.pdf",
  mimeType: "application/pdf",
  buffer: await makePdf({ marker, pages }),
});

test("subir una ficha → progreso → material analizado → el resultado persiste al recargar", async ({ page }) => {
  await signUpAndOnboard(page, uniqueEmail());
  await page.goto("/app/adaptar");
  await expect(page.getByRole("heading", { name: "Adapta un material" })).toBeVisible();
  await expect(page.getByText("Sube una ficha que ya utilizas y prepararemos una versión adaptada.")).toBeVisible();
  await expect(page.getByText("Arrastra tu ficha aquí")).toBeVisible();
  await expect(page.getByText("Evita incluir información personal innecesaria del alumnado en los archivos que subas.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Analizar material" })).toBeDisabled();

  const file = await pdf("MOCK_SLOW");
  await chooseFile(page, file);
  await expect(page.getByText(file.name)).toBeVisible();
  await expect(page.getByText(/PDF · \d+ KB/)).toBeVisible();
  await page.getByRole("button", { name: "Analizar material" }).click();

  await expect(page).toHaveURL(/\/app\/materiales\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  await expect(page.getByRole("heading", { name: "Estamos preparando tu material" })).toBeVisible();
  await expect(page.getByText("Puedes seguir usando Adaptaula mientras terminamos.")).toBeVisible();
  await expect(page.getByText("Archivo recibido")).toBeVisible();

  await waitForAnalysis(page);
  await expect(page.getByRole("heading", { name: "Fracciones equivalentes", level: 1 })).toBeVisible();
  await expect(page.getByText("Matemáticas").first()).toBeVisible();
  await expect(page.getByText("Educación Primaria").first()).toBeVisible();
  await expect(page.getByText("5.º de Primaria").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Actividades detectadas" })).toBeVisible();
  await expect(page.getByText("Calcula 2/3 + 1/6.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Lo que conviene conservar" })).toBeVisible();
  await expect(page.getByText("Decorativo", { exact: true })).toBeVisible();
  await expect(page.getByText("Necesario para resolver")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Adaptar este material" })).toBeVisible();
  await expect(page.getByText("Para adaptar el material necesitas un perfil")).toBeVisible();
  await expect(page.getByRole("link", { name: "Crear un perfil" })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: "Adaptaula ha identificado" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Estamos preparando tu material" })).toHaveCount(0);
  await expect(page.getByText(/Anthropic|Claude|OpenAI|GPT|token/i)).toHaveCount(0);
});

test("recargar durante el análisis recupera el estado y termina igualmente", async ({ page }) => {
  await signUpAndOnboard(page, uniqueEmail());
  await uploadAndOpen(page, await pdf("MOCK_SLOW"));
  await page.reload();
  await expect(page.getByRole("heading", { name: "Estamos preparando tu material" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Estamos preparando tu material|Adaptaula ha identificado/ })).toBeVisible();
  await waitForAnalysis(page);
});

test("un formato no compatible se rechaza con un mensaje humano", async ({ page }) => {
  await signUpAndOnboard(page, uniqueEmail());
  await page.goto("/app/adaptar");
  await chooseFile(page, { name: "ficha.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: Buffer.from("PK") });
  await expect(alertOf(page)).toContainText("Este formato todavía no es compatible");
  await expect(page.getByRole("button", { name: "Analizar material" })).toBeDisabled();
});

test("el servidor rechaza un archivo cuyo contenido no es lo que dice su extensión", async ({ page }) => {
  await signUpAndOnboard(page, uniqueEmail());
  await page.goto("/app/adaptar");
  await chooseFile(page, { name: "falso.pdf", mimeType: "application/pdf", buffer: PNG_1X1 });
  await page.getByRole("button", { name: "Analizar material" }).click();
  await expect(alertOf(page)).toContainText("El contenido del archivo no coincide con su extensión");
  await page.goto("/app/materiales");
  await expect(page.getByText("Todavía no has subido ningún material.")).toBeVisible();
});

test("un PDF con más páginas de las permitidas en Free se rechaza y no deja rastro", async ({ page }) => {
  await signUpAndOnboard(page, uniqueEmail());
  await page.goto("/app/adaptar");
  await chooseFile(page, await pdf(undefined, 6));
  await page.getByRole("button", { name: "Analizar material" }).click();
  await expect(alertOf(page)).toContainText("más páginas de las permitidas en tu plan (máximo 5)");
  await page.goto("/app/materiales");
  await expect(page.getByText("Todavía no has subido ningún material.")).toBeVisible();
});

test("la imagen se acepta y se analiza como una página", async ({ page }) => {
  await signUpAndOnboard(page, uniqueEmail());
  await uploadAndOpen(page, { name: "foto.png", mimeType: "image/png", buffer: PNG_1X1 });
  await waitForAnalysis(page);
  await expect(page.getByRole("img", { name: /Vista previa de foto\.png/ })).toBeVisible();
});

test("el mismo archivo no se vuelve a analizar: se reutiliza el análisis de la misma cuenta", async ({ page }) => {
  await signUpAndOnboard(page, uniqueEmail());
  const file = await pdf("reutilizable");
  await uploadAndOpen(page, file);
  await waitForAnalysis(page);

  await uploadAndOpen(page, file);
  // Sin cola ni progreso: llega directamente analizado.
  await expect(page.getByRole("heading", { name: "Adaptaula ha identificado" })).toBeVisible();
  await expect(page.getByText("Hemos reutilizado el análisis de este mismo archivo")).toBeVisible();
});

test("cada análisis nuevo consume una unidad de la cuota mensual; reutilizar uno no consume; al agotarla, aviso claro y el material queda guardado", async ({ page }) => {
  const email = uniqueEmail();
  await signUpAndOnboard(page, email);
  const workspace = await workspaceOf(page, email);
  await reserveAnalyses(page, workspace, 8); // Free incluye 10: quedan 2

  const first = await pdf("cuota-a");
  await uploadAndOpen(page, first);
  await waitForAnalysis(page);
  expect(await analysisUnits(page, workspace)).toBe(9);

  // Mismo archivo: se reutiliza el análisis y no se gasta nada.
  await uploadAndOpen(page, first);
  await expect(page.getByText("Hemos reutilizado el análisis de este mismo archivo")).toBeVisible();
  expect(await analysisUnits(page, workspace)).toBe(9);

  // Volver a analizar es una petición explícita de saltarse la caché: gasta la última unidad.
  await page.getByRole("button", { name: "Volver a analizar" }).click();
  await waitForAnalysis(page);
  expect(await analysisUnits(page, workspace)).toBe(10);

  // Cuota agotada: el archivo es válido y queda guardado, pero no se analiza.
  await uploadAndOpen(page, await pdf("cuota-b"));
  await expect(page.getByText("Has utilizado los 10 análisis incluidos este mes.")).toBeVisible();
  await expect(page.getByText(/Se renuevan el \d{1,2} de \w+/)).toBeVisible();
  await expect(page.getByText("El material queda guardado")).toBeVisible();
  await expect(page.getByRole("link", { name: "Ver Pro" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Estamos preparando tu material" })).toHaveCount(0);
  expect(await analysisUnits(page, workspace)).toBe(10);

  await page.getByRole("button", { name: "Analizar" }).click();
  await expect(alertOf(page)).toContainText("Has utilizado los 10 análisis incluidos este mes. Se renuevan el");
  await expect(page.getByText(/quota|límite excedido|403|402|429|analysis_quota/i)).toHaveCount(0);
  expect(await analysisUnits(page, workspace)).toBe(10);
});

test("el análisis no se comparte entre cuentas: otro docente con el mismo archivo lo analiza por su cuenta", async ({ page, browser }) => {
  const file = await pdf("compartido-entre-cuentas");
  await signUpAndOnboard(page, uniqueEmail());
  await uploadAndOpen(page, file);
  await waitForAnalysis(page);

  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await signUpAndOnboard(otherPage, uniqueEmail());
  await uploadAndOpen(otherPage, file);
  await waitForAnalysis(otherPage);
  await expect(otherPage.getByText("Hemos reutilizado")).toHaveCount(0);
  await other.close();
});

test("un análisis fallido muestra un mensaje genérico, permite reintentar o eliminar y devuelve la unidad de cuota", async ({ page }) => {
  const email = uniqueEmail();
  await signUpAndOnboard(page, email);
  await uploadAndOpen(page, { ...(await pdf("MOCK_INVALID")), name: "rota.pdf" });
  await expect(page.getByText("No hemos podido analizar este material.").first()).toBeVisible({ timeout: 45_000 });
  expect(await analysisUnits(page, await workspaceOf(page, email))).toBe(0);
  await expect(page.getByRole("button", { name: "Reintentar" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Eliminar" })).toBeVisible();
  await expect(page.getByText(/Anthropic|Claude|OpenAI|GPT|token|stack|mock/i)).toHaveCount(0);

  await page.goto("/app/materiales");
  await expect(page.getByRole("listitem").getByText("No se pudo analizar")).toBeVisible();
});

test("listado, filtros y borrado (con el archivo)", async ({ page }) => {
  await signUpAndOnboard(page, uniqueEmail());
  await page.goto("/app/materiales");
  await expect(page.getByText("Todavía no has subido ningún material.")).toBeVisible();
  await page.getByRole("link", { name: "Subir mi primera ficha" }).click();
  await expect(page).toHaveURL(/\/app\/adaptar/);

  const id = await uploadAndOpen(page, await pdf());
  await waitForAnalysis(page);
  await page.goto("/app/materiales");
  await expect(page.getByRole("link", { name: "Fracciones equivalentes" })).toBeVisible();
  await expect(page.getByRole("listitem").getByText("Analizado", { exact: true })).toBeVisible();

  await page.getByLabel("Asignatura").selectOption({ label: "Matemáticas" });
  await page.getByRole("button", { name: "Filtrar" }).click();
  await expect(page.getByRole("link", { name: "Fracciones equivalentes" })).toBeVisible();
  await page.getByLabel("Asignatura").selectOption({ label: "Música" });
  await page.getByRole("button", { name: "Filtrar" }).click();
  await expect(page.getByText("No hay materiales con estos filtros")).toBeVisible();
  await page.getByRole("link", { name: "Limpiar filtros" }).click();

  await page.getByRole("button", { name: "Eliminar" }).click();
  await page.getByRole("button", { name: "Eliminar material" }).click();
  await expect(page.getByText("Material eliminado.")).toBeVisible();
  await expect(page.getByText("Todavía no has subido ningún material.")).toBeVisible();
  const gone = await page.request.get(`/api/materials/${id}/file`);
  expect(gone.status()).toBe(404);
});

test("el docente corrige el contexto y su corrección prevalece, también tras volver a analizar", async ({ page }) => {
  await signUpAndOnboard(page, uniqueEmail());
  await uploadAndOpen(page, await pdf());
  await waitForAnalysis(page);

  await expect(page.getByText("Detectado automáticamente").first()).toBeVisible();
  await page.getByLabel(/^Etapa/).selectOption({ label: "ESO" });
  await page.getByLabel(/^Curso/).selectOption({ label: "1.º de ESO" });
  await page.getByLabel(/^Tema/).fill("Fracciones en secundaria");
  await page.getByRole("button", { name: "Guardar datos" }).click();
  await expect(page.getByText("Datos guardados.")).toBeVisible();

  await page.reload();
  await expect(page.getByLabel(/^Etapa/)).toHaveValue("eso");
  await expect(page.getByText("Confirmado por ti").first()).toBeVisible();

  await page.getByRole("button", { name: "Volver a analizar" }).click();
  await waitForAnalysis(page);
  await expect(page.getByLabel(/^Etapa/)).toHaveValue("eso");
  await expect(page.getByLabel(/^Tema/)).toHaveValue("Fracciones en secundaria");
  // Lo no confirmado sí se actualiza desde la detección.
  await expect(page.getByLabel(/^Asignatura/)).toHaveValue("matematicas");
});

test("otro usuario no accede al material, a su archivo ni a su estado; sin sesión, 401", async ({ page, browser }) => {
  await signUpAndOnboard(page, uniqueEmail());
  const id = await uploadAndOpen(page, await pdf());
  await waitForAnalysis(page);

  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await signUpAndOnboard(otherPage, uniqueEmail());
  await otherPage.goto(`/app/materiales/${id}`);
  await expect(otherPage.getByText("No encontramos lo que buscas")).toBeVisible();
  expect((await otherPage.request.get(`/api/materials/${id}/file`)).status()).toBe(404);
  expect((await otherPage.request.get(`/api/materials/${id}/status`)).status()).toBe(404);
  expect((await otherPage.request.post(`/api/uploads/${id}/complete`, { headers: { origin: new URL(otherPage.url()).origin } })).status()).toBe(404);
  await other.close();

  const anonymous = await browser.newContext();
  const anonymousPage = await anonymous.newPage();
  expect((await anonymousPage.request.get(`${new URL(page.url()).origin}/api/materials/${id}/file`)).status()).toBe(401);
  await anonymous.close();
});

test("las APIs que modifican datos rechazan peticiones de otro origen", async ({ page }) => {
  await signUpAndOnboard(page, uniqueEmail());
  const origin = new URL(page.url()).origin;
  const hostile = await page.request.post("/api/uploads", { headers: { origin: "https://evil.example" }, data: { name: "a.pdf", size: 10, mime: "application/pdf" } });
  expect(hostile.status()).toBe(403);
  const missing = await page.request.post("/api/uploads", { data: { name: "a.pdf", size: 10, mime: "application/pdf" } });
  expect(missing.status()).toBe(403);
  const ok = await page.request.post("/api/uploads", { headers: { origin }, data: { name: "ficha.docx", size: 10, mime: "" } });
  expect(ok.status()).toBe(422);
  expect((await ok.json()).error.message).toContain("Este formato todavía no es compatible");
});

test("el cron de limpieza exige su secreto", async ({ page }) => {
  expect((await page.request.get("/api/cron/materials")).status()).toBe(401);
  expect((await page.request.get("/api/cron/materials", { headers: { authorization: "Bearer otro-secreto" } })).status()).toBe(401);
  const ok = await page.request.get("/api/cron/materials", { headers: { authorization: "Bearer e2e-cron-secret-0123456789" } });
  expect(ok.status()).toBe(200);
});

test("accesibilidad (axe) y sin desbordamiento en subida, listado y resultado", async ({ page }) => {
  await signUpAndOnboard(page, uniqueEmail());
  const checks: string[] = [];
  const audit = async (name: string) => {
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
    checks.push(...results.violations.map((v) => `${name}: ${v.id}`));
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), `${name} desborda`).toBe(false);
  };

  await page.goto("/app/materiales");
  await audit("materiales (vacío)");
  await page.goto("/app/adaptar");
  await audit("adaptar (vacío)");
  await chooseFile(page, await pdf("MOCK_SLOW"));
  await expect(page.getByText(/PDF · /)).toBeVisible();
  await audit("adaptar (archivo)");
  await page.getByRole("button", { name: "Analizar material" }).click();
  await expect(page.getByRole("heading", { name: "Estamos preparando tu material" })).toBeVisible();
  await audit("progreso");
  await waitForAnalysis(page);
  await audit("resultado");
  await page.goto("/app/materiales");
  await audit("materiales (lista)");
  expect(checks).toEqual([]);
});
