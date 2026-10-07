import "server-only";
import { createHash } from "node:crypto";
import { createElement } from "react";
// `react-dom/static` and not `react-dom/server`: Next 16 refuses the latter in server bundles (route handlers, `after()`), and
// `prerenderToNodeStream` is React's API for complete static HTML. Spike: docs/ADAPTATION.md § PDF.
import { prerenderToNodeStream } from "react-dom/static";
import { MaterialSheet } from "@/components/material/sheet";
import { fingerprint } from "@/lib/adaptation/fingerprint";
import type { RenderModel } from "@/lib/render/model";
import { MATERIAL_RENDERER_VERSION } from "@/lib/render/version";
import { modelAssetRefs, PinnedAssetError, assetRef, verifyPinnedAsset, type PinnedAsset } from "./pinned-assets";
import { cssFingerprint, fontFingerprint, loadSheetFonts, readSheetCss, SHEET_FONT } from "./sheet-assets";

/**
 * The printable document of one `RenderModel`, complete and self-contained: the same `MaterialSheet` the app shows, the real
 * `material.css`, the sheet font and the pinned visuals inlined as data URIs, and a CSP that allows nothing else. No script, no
 * link, no URL, no cookie: what Chromium prints cannot depend on the network, a session or the time it runs.
 */

export const PRINT_CSP = "default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; script-src 'none'; base-uri 'none'; form-action 'none'";

export class PrintHtmlError extends Error {
  constructor(readonly code: "not_student_mode" | "renderer_mismatch" | "css_unresolved") {
    super(code);
  }
}

export interface PrintHtml {
  html: string;
  rendererVersion: string;
  /** Identity of the model as exported: pins as references, never bytes. */
  renderModelFingerprint: string;
  cssFingerprint: string;
  fontFingerprint: string;
  fontFamily: string;
  fontWeights: number[];
  /** The pins the sheet uses (`asset:<id>@<sha256>`), sorted. */
  assets: string[];
  htmlSha256: string;
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const dataUri = (mime: string, bytes: Uint8Array) => `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
const LANG = /^[a-z]{2,3}(?:-[A-Z]{2})?$/;

async function staticMarkup(model: RenderModel): Promise<string> {
  const { prelude } = await prerenderToNodeStream(createElement(MaterialSheet, { model }));
  let out = "";
  for await (const chunk of prelude) out += typeof chunk === "string" ? chunk : Buffer.from(chunk as Uint8Array).toString("utf8");
  return out;
}

/** `material.css` with its font URLs replaced by the pinned bytes; any other URL left would be a request, so it is an error. */
function inlineCss(): { css: string; source: string } {
  const source = readSheetCss();
  let css = source;
  for (const face of loadSheetFonts()) {
    const url = `url("./fonts/${face.file}")`;
    if (!css.includes(url)) throw new PrintHtmlError("css_unresolved");
    css = css.split(url).join(`url("${dataUri("font/woff2", face.bytes)}")`);
  }
  if (/url\(\s*(?!["']?data:)/i.test(css) || /@import/i.test(css)) throw new PrintHtmlError("css_unresolved");
  return { css, source };
}

export async function renderPrintHtml(model: RenderModel, pinnedAssets: readonly PinnedAsset[]): Promise<PrintHtml> {
  if (model.mode !== "student") throw new PrintHtmlError("not_student_mode");
  if (model.rendererVersion !== MATERIAL_RENDERER_VERSION) throw new PrintHtmlError("renderer_mismatch");

  const refs = modelAssetRefs(model);
  const byRef = new Map<string, PinnedAsset>();
  for (const asset of pinnedAssets) {
    verifyPinnedAsset(asset);
    byRef.set(assetRef(asset), asset);
  }
  for (const ref of refs) if (!byRef.has(ref)) throw new PinnedAssetError("asset_unpinned");

  const printable: RenderModel = {
    ...model,
    pages: model.pages.map((page) => ({
      ...page,
      nodes: page.nodes.map((node) => (node.kind === "image" && node.state === "available" && node.src ? { ...node, src: dataUri("image/png", byRef.get(node.src)!.bytes) } : node)),
    })),
  };

  const { css, source } = inlineCss();
  const body = await staticMarkup(printable);
  const lang = LANG.test(model.language) ? model.language : "es";
  const html = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${PRINT_CSP}"><meta name="referrer" content="no-referrer"><title>${escapeHtml(model.title)}</title><style>${css}</style></head><body>${body}</body></html>`;

  return {
    html,
    rendererVersion: model.rendererVersion,
    renderModelFingerprint: fingerprint(model),
    cssFingerprint: cssFingerprint(source),
    fontFingerprint: fontFingerprint(),
    fontFamily: SHEET_FONT.family,
    fontWeights: SHEET_FONT.faces.map((f) => f.weight),
    assets: refs,
    htmlSha256: createHash("sha256").update(html).digest("hex"),
  };
}
