import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fingerprint } from "@/lib/adaptation/fingerprint";
import { buildRenderModel, type RenderModel } from "@/lib/render/model";
import { renderPrintHtml, PRINT_CSP, PrintHtmlError } from "@/lib/render/print/html";
import { assetRef, parseAssetRef, PinnedAssetError, type PinnedAsset } from "@/lib/render/print/pinned-assets";
import { fontFingerprint, loadSheetFonts, SHEET_FONT } from "@/lib/render/print/sheet-assets";
import { MATERIAL_RENDERER_VERSION } from "@/lib/render/version";
import { MaterialDocumentSchema, type MaterialDocument } from "@/lib/schemas/material-document";
import { ANSWER_KEY_SECRET, BLANK_SECRET, geografia, primaria, withBlocks } from "../support/render-fixtures";

/** `renderPrintHtml`: the printable document of a sheet is complete, self-contained and the app's own renderer (no second layout). */

const ONE_PX_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const OTHER_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
const sha = (b: Uint8Array | string) => createHash("sha256").update(b).digest("hex");
const pinOf = (assetId: string, bytes: Uint8Array): PinnedAsset => ({ assetId, sha256: sha(bytes), mime: "image/png", bytes });
const A = pinOf("11111111-2222-4333-8444-555555555555", ONE_PX_PNG);
const B = pinOf("99999999-8888-4777-8666-555555555555", OTHER_PNG);

function withImage(doc: MaterialDocument): MaterialDocument {
  return withBlocks(doc, (b) => [...b, { id: "blk_img00001", type: "image", source: { kind: "original", visual_ref: "vis_7" }, alt_text: "Mapa", caption: "Mapa del original", trace: { origin: "original", source_refs: [], decision_ids: [] } }]);
}
const model = (doc: MaterialDocument, pins: Record<string, PinnedAsset> = {}, mode: "student" | "teacher_preview" = "student"): RenderModel =>
  buildRenderModel(doc, { mode, deferred: [], requiredVisuals: Object.keys(pins), assets: Object.fromEntries(Object.entries(pins).map(([v, p]) => [v, { src: assetRef(p) }])) }).model;
const bodyOf = (html: string) => html.slice(html.indexOf("<body>"));

describe("renderPrintHtml · self-contained document", () => {
  it("uses material_renderer@v3 and the app's own sheet markup, whole", async () => {
    expect(MATERIAL_RENDERER_VERSION).toBe("material_renderer@v3");
    const out = await renderPrintHtml(model(geografia()), []);
    expect(out.rendererVersion).toBe("material_renderer@v3");
    expect(out.html.startsWith('<!doctype html><html lang="es">')).toBe(true);
    expect(bodyOf(out.html)).toMatch(/^<body><div class="ms-root"/);
    expect(out.html).toContain('class="ms-sheet"');
  });

  it("has a CSP that allows only inline styles and data: images and fonts, and no script, link, frame or network URL", async () => {
    const out = await renderPrintHtml(model(withImage(primaria()), { vis_7: A }), [A]);
    expect(out.html).toContain(`<meta http-equiv="Content-Security-Policy" content="${PRINT_CSP}">`);
    expect(PRINT_CSP).toMatch(/default-src 'none'/);
    expect(PRINT_CSP).toMatch(/script-src 'none'/);
    expect(out.html).not.toMatch(/<script|<link|<iframe|<object|<embed|<base|\bon[a-z]+=/i);
    expect(out.html).not.toMatch(/https?:|\/\/[a-z0-9.-]+\.[a-z]{2,}\//i);
    for (const m of out.html.matchAll(/url\(\s*["']?([^"')]*)/g)) expect(m[1]!.startsWith("data:font/woff2;base64,")).toBe(true);
    for (const m of out.html.matchAll(/\bsrc="([^"]*)"/g)) expect(m[1]!.startsWith("data:image/png;base64,")).toBe(true);
    expect(out.html).not.toMatch(/supabase|signed|token=|cookie|\/api\//i);
  });

  it("inlines the real material.css (the same file the app imports) with the pinned font faces", async () => {
    const out = await renderPrintHtml(model(geografia()), []);
    const css = readFileSync("src/components/material/material.css", "utf8");
    expect(out.cssFingerprint).toBe(sha(css));
    expect(out.html).toContain(css.slice(css.indexOf(".ms-root {"), css.indexOf(".ms-root {") + 80));
    expect([...out.html.matchAll(/@font-face \{ font-family: "Adaptaula Inter"; src: url\("data:font\/woff2;base64,/g)]).toHaveLength(3);
    expect(out.fontFamily).toBe("Adaptaula Inter");
    expect(out.fontWeights).toEqual([400, 600, 700]);
  });

  it("the student sheet only: never the teacher view, the answer key, an inferred answer, ids or traces", async () => {
    await expect(renderPrintHtml(model(geografia(), {}, "teacher_preview"), [])).rejects.toThrow(PrintHtmlError);
    const doc = primaria();
    expect(JSON.stringify(doc)).toContain(ANSWER_KEY_SECRET);
    const out = await renderPrintHtml(model(doc), []);
    expect(out.html).not.toContain(ANSWER_KEY_SECRET);
    expect(out.html).not.toContain(BLANK_SECRET);
    expect(bodyOf(out.html)).not.toMatch(/ms-teacher|ms-missing|ms-chrome|data-app|blk_|dec_\d|vis_\d|trace|source_refs|material_renderer|answer_key/);
  });

  it("refuses a model built by another renderer version", async () => {
    await expect(renderPrintHtml({ ...model(geografia()), rendererVersion: "material_renderer@v1" }, [])).rejects.toThrow("renderer_mismatch");
  });

  it("escapes the title and keeps Spanish text as text", async () => {
    const base = geografia();
    const doc = MaterialDocumentSchema.parse({ ...base, meta: { ...base.meta, title: "Año <b>¿qué?</b> «sí» & “no”" } });
    const out = await renderPrintHtml(model(doc), []);
    expect(out.html).toContain("<title>Año &#60;b&#62;¿qué?&#60;/b&#62; «sí» &#38; “no”</title>");
  });
});

describe("renderPrintHtml · pinned visual assets", () => {
  it("the model carries `asset:<id>@<sha256>`; only the HTML carries the verified bytes, as a data URI", async () => {
    const m = model(withImage(geografia()), { vis_7: A });
    expect(JSON.stringify(m)).toContain(`asset:${A.assetId}@${A.sha256}`);
    expect(JSON.stringify(m)).not.toContain("data:");
    const out = await renderPrintHtml(m, [A]);
    expect(out.assets).toEqual([`asset:${A.assetId}@${A.sha256}`]);
    expect(out.html).toContain(`src="data:image/png;base64,${ONE_PX_PNG.toString("base64")}"`);
    expect(out.html).not.toContain("asset:");
  });

  it("uses the pinned instance even when a newer instance of the same visual is also at hand; never substitutes it when missing", async () => {
    const m = model(withImage(geografia()), { vis_7: A });
    const out = await renderPrintHtml(m, [B, A]);
    expect(out.html).toContain(ONE_PX_PNG.toString("base64"));
    expect(out.html).not.toContain(OTHER_PNG.toString("base64"));
    await expect(renderPrintHtml(m, [B])).rejects.toMatchObject({ code: "asset_unpinned" });
    await expect(renderPrintHtml(m, [])).rejects.toBeInstanceOf(PinnedAssetError);
  });

  it("verifies the bytes: wrong checksum → asset_corrupt, not a PNG → asset_unsupported, a URL as source → asset_unpinned", async () => {
    const m = model(withImage(geografia()), { vis_7: A });
    await expect(renderPrintHtml(m, [{ ...A, bytes: OTHER_PNG }])).rejects.toMatchObject({ code: "asset_corrupt" });
    const notPng = Buffer.from("GIF89a....");
    await expect(renderPrintHtml(model(withImage(geografia()), { vis_7: pinOf(A.assetId, notPng) }), [pinOf(A.assetId, notPng)])).rejects.toMatchObject({ code: "asset_unsupported" });
    const routed = buildRenderModel(withImage(geografia()), { mode: "student", deferred: [], assets: { vis_7: { src: "/api/adaptations/x/visuals/vis_7" } } }).model;
    await expect(renderPrintHtml(routed, [A])).rejects.toMatchObject({ code: "asset_unpinned" });
    expect(() => assetRef({ assetId: "not-a-uuid", sha256: A.sha256 })).toThrow(PinnedAssetError);
    expect(parseAssetRef(`asset:${A.assetId}@${A.sha256}`)).toEqual({ assetId: A.assetId, sha256: A.sha256 });
    expect(parseAssetRef(`asset:${A.assetId}@${A.sha256}x`)).toBeNull();
  });

  it("the model fingerprint is deterministic and follows the pin, not the bytes' transport", async () => {
    const a = await renderPrintHtml(model(withImage(geografia()), { vis_7: A }), [A]);
    const again = await renderPrintHtml(model(withImage(geografia()), { vis_7: A }), [A, B]);
    const b = await renderPrintHtml(model(withImage(geografia()), { vis_7: B }), [B]);
    expect(again.renderModelFingerprint).toBe(a.renderModelFingerprint);
    expect(again.html).toBe(a.html);
    expect(b.renderModelFingerprint).not.toBe(a.renderModelFingerprint);
  });
});

describe("sheet font: Inter, local, pinned", () => {
  it("three official static WOFF2 faces with their OFL licence; bytes match the pinned checksums", () => {
    const faces = loadSheetFonts();
    expect(faces.map((f) => [f.file, f.weight])).toEqual([["Inter-Regular.woff2", 400], ["Inter-SemiBold.woff2", 600], ["Inter-Bold.woff2", 700]]);
    for (const f of faces) {
      expect(sha(f.bytes)).toBe(f.sha256);
      expect(f.bytes.subarray(0, 4).toString("latin1")).toBe("wOF2");
    }
    expect(readFileSync("src/components/material/fonts/LICENSE.txt", "utf8")).toMatch(/SIL Open Font License, Version 1\.1/);
    expect(readdirSync("src/components/material/fonts").sort()).toEqual(["Inter-Bold.woff2", "Inter-Regular.woff2", "Inter-SemiBold.woff2", "LICENSE.txt", "README.md"]);
  });

  it("font_fingerprint is deterministic from family, version and the bytes of every face", () => {
    expect(fontFingerprint()).toBe(fingerprint(SHEET_FONT));
    expect(fontFingerprint()).toMatch(/^[a-f0-9]{64}$/);
    expect(fingerprint({ ...SHEET_FONT, faces: SHEET_FONT.faces.map((f, i) => (i === 0 ? { ...f, sha256: "0".repeat(64) } : f)) })).not.toBe(fontFingerprint());
  });
});

describe("material.css (renderer v3): the sheet is self-sufficient and printable", () => {
  const css = readFileSync("src/components/material/material.css", "utf8");
  const print = css.slice(css.indexOf("@media print"));

  it("one font family for screen and print, from local files; no system monospace for formulas", () => {
    expect([...css.matchAll(/src: url\("\.\/fonts\/(Inter-[A-Za-z]+\.woff2)"\)/g)].map((m) => m[1])).toEqual(["Inter-Regular.woff2", "Inter-SemiBold.woff2", "Inter-Bold.woff2"]);
    expect(css).toMatch(/\.ms-root \{ font-family: "Adaptaula Inter"/);
    expect(css).not.toMatch(/ui-monospace|Menlo|var\(--font-sans/);
    expect(css).not.toMatch(/@import|https?:/);
  });

  it("its own zero-specificity reset (the app's Tailwind preflight never reaches the PDF) and explicit list numbers", () => {
    expect(css).toContain(":where(.ms-root, .ms-root *, .ms-root ::before, .ms-root ::after) { box-sizing: border-box; margin: 0; padding: 0; border: 0 solid; }");
    // Step numbers are generated content (they print and read as text); numbered lists keep their decimal markers.
    expect(css).toMatch(/\.ms-steps > li::before \{ content: counter\(ms-step\) "\.";/);
    expect(css).toMatch(/ol\.ms-list \{ list-style: decimal; \}/);
  });

  it("A4, page breaks kept, physical page numbers in the page margin, visuals never taller than a page", () => {
    expect(print).toMatch(/@page \{ size: A4; margin: 18mm; @bottom-right \{ content: counter\(page\) " \/ " counter\(pages\)/);
    expect(print).toMatch(/\.ms-sheet \{[^}]*break-after: page/);
    expect(css).toMatch(/\.ms-table thead \{ display: table-header-group; \}/);
    expect(css).toMatch(/\.ms-figure img \{[^}]*max-height: calc\(\(var\(--ms-page-h\) - 2 \* var\(--ms-margin\)\) \* \.6\)/);
    expect(print).toMatch(/\.ms-footer \{ display: none; \}/);
  });
});

describe("print module boundaries", () => {
  const dir = "src/lib/render/print";
  const files = readdirSync(dir).map((f) => path.join(dir, f));
  it("server-only, no session, database, storage, AI or network client; Chromium only in the engine", () => {
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      expect(text, f).toMatch(/^import "server-only";/);
      expect(text, f).not.toMatch(/@\/lib\/(supabase|auth|ai|adaptation\/orchestration|materials)|next\/headers|cookies\(|fetch\(|process\.env\.(?!NODE_ENV)/);
      if (!f.endsWith("engine.ts")) expect(text, f).not.toMatch(/playwright|sparticuz/);
    }
    expect(readFileSync(`${dir}/validation.ts`, "utf8")).not.toMatch(/pdfjs|napi-rs/);
  });
});
