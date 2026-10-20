import { expect, test, type Page } from "@playwright/test";
import { makePdf, signUpAndOnboard, uniqueEmail } from "./helpers";

const fake = "http://127.0.0.1:54399";
const service = { apikey: "sb_secret_fakefakefakefakefake", authorization: "Bearer sb_secret_fakefakefakefakefake" };
const cron = { authorization: "Bearer e2e-cron-secret-0123456789" };

async function pendingUpload(page: Page, name: string) {
  const origin = new URL(page.url()).origin;
  expect(new URL(origin).hostname).toBe("localhost");
  const bytes = await makePdf({ marker: name });
  const init = await page.request.post("/api/uploads", { headers: { origin }, data: { name: `${name}.pdf`, size: bytes.length, mime: "application/pdf" } });
  expect(init.status()).toBe(200);
  const data = await init.json() as { materialId: string; path: string; token: string };
  const uploaded = await page.request.put(`${fake}/storage/v1/object/upload/sign/source-materials/${data.path}?token=${encodeURIComponent(data.token)}`, {
    headers: { "content-type": "application/pdf" }, data: bytes,
  });
  expect(uploaded.ok()).toBe(true);
  return { ...data, bytes, origin };
}

test("dos crons solo limpian la subida caducada, conservan el original válido y dejan trazabilidad", async ({ page }) => {
  await signUpAndOnboard(page, uniqueEmail(), /Explorar/);
  const expired = await pendingUpload(page, "Caducada sintética");
  const valid = await pendingUpload(page, "Válida sintética");
  const expiredUpdate = await page.request.patch(`${fake}/rest/v1/materials?id=eq.${expired.materialId}`, {
    headers: service, data: { upload_expires_at: "2020-01-01T00:00:00Z" },
  });
  expect(expiredUpdate.ok()).toBe(true);
  const finish = await page.request.post(`/api/uploads/${expired.materialId}/complete`, { headers: { origin: expired.origin } });
  expect(finish.status()).toBe(410);
  expect((await finish.json()).error.message).toContain("Esta subida ha caducado");
  const runs = await Promise.all([page.request.get("/api/cron/materials", { headers: cron }), page.request.get("/api/cron/materials", { headers: cron })]);
  for (const run of runs) expect(run.status()).toBe(200);
  const counts = await Promise.all(runs.map((r) => r.json() as Promise<{ removed: number }>));
  expect(counts.reduce((n, r) => n + r.removed, 0)).toBe(1);
  const original = await page.request.get(`${fake}/storage/v1/object/source-materials/${valid.path}`, { headers: service });
  expect(original.status()).toBe(200);
  expect(await original.body()).toEqual(valid.bytes);
  expect((await page.request.get(`${fake}/storage/v1/object/source-materials/${expired.path}`, { headers: service })).status()).toBe(404);
  const persisted = await page.request.get(`${fake}/rest/v1/material_upload_cleanups?material_id=eq.${expired.materialId}`, { headers: service });
  const rows = await persisted.json();
  expect(rows).toHaveLength(1);
  expect(rows[0].files).toContainEqual({ bucket: "source-materials", path: expired.path });
  expect(rows[0].row_deleted_at).toBeTruthy();
  expect((await (await page.request.get("/api/cron/materials", { headers: cron })).json()).removed).toBe(0);
  expect((await page.request.post(`/api/uploads/${expired.materialId}/complete`, { headers: { origin: expired.origin } })).status()).toBe(404);
});
