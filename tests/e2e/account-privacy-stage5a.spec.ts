import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { makePdf, password, signUpAndOnboard, uniqueEmail, uploadAndOpen } from "./helpers";

const fake = `http://127.0.0.1:${process.env.FAKE_SUPABASE_PORT ?? 54399}`;
const publishable = "sb_publishable_fakefakefakefakefake";

async function localToken(page: import("@playwright/test").Page, email: string) {
  const response = await page.request.post(`${fake}/auth/v1/token?grant_type=password`, {
    headers: { apikey: publishable }, data: { email, password },
  });
  expect(response.ok()).toBe(true);
  const session = await response.json() as { access_token: string; user: { id: string } };
  return { token: session.access_token, id: session.user.id };
}

test("copia personal y solicitud de baja verificadas con dos identidades ficticias", async ({ page, browser }, info) => {
  const email = uniqueEmail();
  await signUpAndOnboard(page, email);
  const a = await localToken(page, email);
  const directHeaders = { apikey: publishable, authorization: `Bearer ${a.token}`, "content-type": "application/json" };
  for (const data of [{}, { p_user: a.id }]) {
    const direct = await page.request.post(`${fake}/rest/v1/rpc/request_account_deletion`, { headers: directHeaders, data });
    expect(direct.ok()).toBe(false);
  }
  const before = await page.request.get(`${fake}/rest/v1/account_deletion_requests?select=id`, { headers: directHeaders });
  expect(await before.json()).toEqual([]);
  const original = await makePdf({ marker: "PRIVACY-5A" });
  const materialId = await uploadAndOpen(page, { name: "original-sintetico.pdf", mimeType: "application/pdf", buffer: original });
  await page.goto("/app/uso");
  await expect(page.getByRole("heading", { name: "Tus datos y privacidad" })).toBeVisible();
  await page.screenshot({ path: info.outputPath("privacidad-escritorio-o-movil.png"), fullPage: true,
    style: "nextjs-portal { display: none; }" });

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Descargar mis datos" }).click();
  const artifact = await download;
  const stream = await artifact.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const exported = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  expect(exported.account.email).toBe(email);
  const personal = exported.workspaces.find((space: { included: boolean }) => space.included);
  expect(personal.materials).toHaveLength(1);
  expect(Buffer.from(personal.original_files[0].data_base64, "base64")).toEqual(original);
  expect(JSON.stringify(exported)).not.toContain("api_key");
  const limited = await page.evaluate(async () => {
    const second = await fetch("/api/account/export", { method: "POST" });
    const third = await fetch("/api/account/export", { method: "POST" });
    return [second.status, third.status];
  });
  expect(limited).toEqual([200, 429]);

  const otherContext = await browser.newContext();
  const other = await otherContext.newPage();
  const otherEmail = uniqueEmail();
  await signUpAndOnboard(other, otherEmail);
  const b = await localToken(other, otherEmail);
  await other.goto("/app/uso");
  const forbiddenFile = await other.request.get(`/api/materials/${materialId}/file?download=1`);
  expect(forbiddenFile.status()).toBe(404);
  const otherDownload = other.waitForEvent("download");
  await other.getByRole("button", { name: "Descargar mis datos" }).click();
  const second = await otherDownload;
  const secondStream = await second.createReadStream();
  let secondJson = "";
  for await (const chunk of secondStream) secondJson += chunk.toString();
  expect(secondJson).not.toContain("PRIVACY-5A");
  expect(secondJson).not.toContain(email);
  await otherContext.close();

  await page.getByLabel("Escribe ELIMINAR MI CUENTA").fill("ELIMINAR MI CUENTA");
  await page.getByLabel("Contraseña actual").fill("incorrecta");
  await page.getByRole("button", { name: "Solicitar eliminación" }).click();
  await expect(page.getByText("No hemos podido verificar tu identidad.")).toBeVisible();
  await page.getByLabel("Contraseña actual").fill(password);
  await page.getByRole("button", { name: "Solicitar eliminación" }).click();
  await expect(page.getByText("Solicitud de eliminación pendiente.")).toBeVisible();
  await expect(page.getByText(/No se ha ejecutado el borrado: tu cuenta y tus documentos siguen disponibles/)).toBeVisible();
  const repeated = await page.evaluate(async ({ pwd, otherId }) => {
    const response = await fetch("/api/account/deletion-request", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirmation: "ELIMINAR MI CUENTA", password: pwd, user_id: otherId }) });
    return { status: response.status, data: await response.json() };
  }, { pwd: password, otherId: b.id });
  expect(repeated.status).toBe(202);
  const ownRequests = await page.request.get(`${fake}/rest/v1/account_deletion_requests?select=id,user_id`, { headers: directHeaders });
  expect(await ownRequests.json()).toEqual([{ id: repeated.data.id, user_id: a.id }]);
  const bRequests = await page.request.get(`${fake}/rest/v1/account_deletion_requests?select=id`, {
    headers: { apikey: publishable, authorization: `Bearer ${b.token}` },
  });
  expect(await bRequests.json()).toEqual([]);
  await page.reload();
  await expect(page.getByText("Solicitud de eliminación pendiente.")).toBeVisible();
  await expect(page.getByText(email, { exact: true }).last()).toBeVisible();
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath("privacidad-solicitud.png"), fullPage: true,
    style: "nextjs-portal { display: none; }" });
  await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "active" });
  await page.setViewportSize({ width: 320, height: 900 });
  await page.addStyleTag({ content: "html { font-size: 200%; }" });
  const overflow = await page.evaluate(() => [...document.querySelectorAll("main *")]
    .filter((el) => el.getBoundingClientRect().right > innerWidth + 1).slice(0, 5).map((el) => el.tagName));
  expect(overflow).toEqual([]);
});

test("el límite de verificación bloquea intentos repetidos sin crear una solicitud", async ({ page }) => {
  const email = uniqueEmail();
  await signUpAndOnboard(page, email);
  const identity = await localToken(page, email);
  const attempts = await page.evaluate(async (correctPassword) => {
    const out = [];
    for (let i = 0; i < 6; i += 1) {
      const response = await fetch("/api/account/deletion-request", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmation: "ELIMINAR MI CUENTA", password: i === 5 ? correctPassword : "incorrecta" }) });
      out.push({ status: response.status, body: JSON.stringify(await response.json()) });
    }
    return out;
  }, password);
  expect(attempts.map((attempt) => attempt.status)).toEqual([403, 403, 403, 403, 403, 429]);
  expect(attempts.every((attempt) => !attempt.body.includes(email) && !attempt.body.includes("invalid_credentials"))).toBe(true);
  const requests = await page.request.get(`${fake}/rest/v1/account_deletion_requests?select=id`, {
    headers: { apikey: publishable, authorization: `Bearer ${identity.token}` },
  });
  expect(await requests.json()).toEqual([]);
  await page.goto("/app/uso");
  await expect(page.getByRole("button", { name: "Solicitar eliminación" })).toBeVisible();
});
