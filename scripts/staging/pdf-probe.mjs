/** Read-only PDF probe for an already delivered SYNTHETIC adaptation in an explicitly authorized staging deployment. */
import { chromium } from "playwright-core";
import { PDFDocument } from "pdf-lib";
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";

export async function inspectPdf(bytes, expectedPages, markers) {
  if (bytes.length > 20 * 1024 * 1024 || Buffer.from(bytes.subarray(0, 5)).toString("latin1") !== "%PDF-") throw new Error("pdf_invalid");
  const parsed = await PDFDocument.load(bytes);
  if (parsed.isEncrypted || parsed.getPageCount() !== expectedPages) throw new Error("pdf_pages_or_encryption");
  const task = getDocument({ data: new Uint8Array(bytes), disableFontFace: true, verbosity: 0 });
  const document = await task.promise;
  let imageOps = 0;
  const text = [];
  try {
    for (let number = 1; number <= document.numPages; number += 1) {
      const page = await document.getPage(number);
      const { width, height } = page.getViewport({ scale: 1 });
      if (Math.abs(width - 595.28) > 2 || Math.abs(height - 841.89) > 2) throw new Error("pdf_not_a4");
      const content = await page.getTextContent();
      text.push(content.items.filter((item) => "str" in item).map((item) => item.str).join(" "));
      const operators = await page.getOperatorList();
      imageOps += operators.fnArray.filter((op) => op === OPS.paintImageXObject || op === OPS.paintInlineImageXObject).length;
    }
  } finally { await task.destroy(); }
  const normalized = text.join(" ").replace(/\s+/g, " ").trim();
  if (markers.some((marker) => !normalized.includes(marker))) throw new Error("pdf_missing_synthetic_marker");
  return { pages: document.numPages, bytes: bytes.length, imageOps };
}

function config() {
  const required = ["STAGING_BASE_URL", "STAGING_ALLOWED_HOST", "STAGING_TEST_EMAIL_A", "STAGING_TEST_PASSWORD_A",
    "STAGING_TEST_EMAIL_B", "STAGING_TEST_PASSWORD_B", "STAGING_ADAPTATION_ID", "STAGING_EXPECT_PAGES", "STAGING_EXPECT_TEXT"];
  if (!process.argv.includes("--authorized-staging") || required.some((name) => !process.env[name])) throw new Error("staging_not_authorized_or_unconfigured");
  const base = new URL(process.env.STAGING_BASE_URL);
  if (base.protocol !== "https:" || base.hostname !== process.env.STAGING_ALLOWED_HOST || base.pathname !== "/" || base.search || base.hash) throw new Error("staging_origin_invalid");
  if (!/^\d+$/.test(process.env.STAGING_EXPECT_PAGES) || Number(process.env.STAGING_EXPECT_PAGES) < 1) throw new Error("expected_pages_invalid");
  if (!/^[0-9a-f-]{36}$/i.test(process.env.STAGING_ADAPTATION_ID)) throw new Error("adaptation_id_invalid");
  const markers = process.env.STAGING_EXPECT_TEXT.split("|").map((value) => value.trim()).filter(Boolean);
  if (!markers.length) throw new Error("markers_missing");
  return { base, markers, pages: Number(process.env.STAGING_EXPECT_PAGES) };
}

async function signIn(browser, base, email, password) {
  const context = await browser.newContext({ baseURL: base.href, locale: "es-ES" });
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Contraseña").fill(password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.waitForURL((url) => url.pathname.startsWith("/app"), { timeout: 30_000 });
  return context;
}

async function run() {
  const { base, markers, pages } = config();
  const browser = await chromium.launch({ executablePath: process.env.STAGING_BROWSER_PATH || undefined, headless: true });
  try {
    const path = `/api/adaptations/${process.env.STAGING_ADAPTATION_ID}/pdf`;
    const anonymous = await browser.newContext({ baseURL: base.href });
    try {
      const denied = await anonymous.request.get(path, { maxRedirects: 0 });
      if (denied.status() !== 401) throw new Error("anonymous_pdf_not_denied");
    } finally { await anonymous.close(); }
    const owner = await signIn(browser, base, process.env.STAGING_TEST_EMAIL_A, process.env.STAGING_TEST_PASSWORD_A);
    try {
      const started = performance.now();
      const response = await owner.request.get(path, { timeout: 65_000, maxRedirects: 0 });
      const durationMs = Math.round(performance.now() - started);
      if (response.status() !== 200 || !response.headers()["content-type"]?.startsWith("application/pdf")) throw new Error(`pdf_http_${response.status()}`);
      if (!response.headers()["cache-control"]?.includes("no-store") || !response.headers()["content-disposition"]?.startsWith("attachment;")) throw new Error("pdf_headers_invalid");
      const result = await inspectPdf(new Uint8Array(await response.body()), pages, markers);
      const other = await signIn(browser, base, process.env.STAGING_TEST_EMAIL_B, process.env.STAGING_TEST_PASSWORD_B);
      try {
        const forbidden = await other.request.get(path, { maxRedirects: 0 });
        if (forbidden.status() !== 404) throw new Error("other_user_pdf_not_denied");
      } finally { await other.close(); }
      console.log(JSON.stringify({ result: "PASS", ...result, durationMs, requestId: response.headers()["x-request-id"] ?? null }));
    } finally { await owner.close(); }
  } finally { await browser.close(); }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  run().catch((error) => {
    // No URL, credentials, IDs, PDF content or provider error messages in logs.
    console.error(`staging_pdf_probe: ${error instanceof Error && /^[a-z0-9_]+$/.test(error.message) ? error.message : "failed"}`);
    process.exitCode = 1;
  });
}
