import { createHash } from "node:crypto";
import { createCanvas } from "@napi-rs/canvas";
import { degrees, PDFDocument, rgb } from "pdf-lib";
import { cropPng, renderPage } from "@/lib/materials/visuals/raster";
import { buildRenderModel, type RenderModel } from "@/lib/render/model";
import { assetRef, type PinnedAsset } from "@/lib/render/print/pinned-assets";
import { MaterialDocumentSchema, type Block, type MaterialDocument } from "@/lib/schemas/material-document";
import { ANSWER_KEY_SECRET, geografia } from "../support/render-fixtures";

/**
 * Synthetic sheets for the real PDF smoke (no private material, no model). Each one goes through the whole chain:
 * `MaterialDocument` → `buildRenderModel` → `renderPrintHtml` → Chromium → PDF.
 */

export const SPANISH = "Ñandú y año, árbol, café, país, canción, útil, pingüino. ¿Qué? ¡Sí! 1.º · … «comillas» – — “dobles”";
export const TEACHER_ONLY = ["Falta una imagen", "Imagen prevista", "material_renderer", "Vista docente", "Información para la docente"];
export { ANSWER_KEY_SECRET };

const trace = { origin: "adapted" as const, source_refs: [] as string[], decision_ids: [] as string[] };
let seq = 0;
const id = () => `blk_pdf${String(++seq).padStart(5, "0")}`;

export const heading = (text: string, level: 1 | 2 | 3 = 1): Block => ({ id: id(), type: "heading", level, text, trace });
export const paragraph = (text: string): Block => ({ id: id(), type: "paragraph", text, trace });
export const instruction = (text: string, steps?: string[]): Block => ({ id: id(), type: "instruction", text, ...(steps ? { steps } : {}), trace });
export const lines = (label: string, prompt: string, n: number): Block => ({ id: id(), type: "activity", label, prompt, response: { kind: "lines", lines: n }, trace });
export const table = (caption: string, rows: number, columns = 3): Block => ({
  id: id(),
  type: "table",
  caption,
  headers: Array.from({ length: columns }, (_, c) => `Cabecera ${c + 1}`),
  rows: Array.from({ length: rows }, (_, r) => Array.from({ length: columns }, (_, c) => `Fila ${r + 1} · dato ${c + 1}`)),
  trace,
});
export const chart = (series: Array<{ label: string | null; values: number[] }>, chart_type: "bar" | "line" = "bar"): Block => ({ id: id(), type: "chart", title: "Población por año", chart_type, categories: ["2019", "2020", "2021", "2022"], series, y_label: "Habitantes", trace });
export const image = (visual: string, caption: string): Block => ({ id: id(), type: "image", source: { kind: "original", visual_ref: visual }, alt_text: caption, caption, trace });
export const checklist = (n: number): Block => ({ id: id(), type: "checklist", title: "Antes de entregar", items: Array.from({ length: n }, (_, i) => `Comprobación número ${i + 1} de la lista`), trace });
export const steps = (n: number) => Array.from({ length: n }, (_, i) => `Paso ${i + 1}: lee con atención y subraya los datos.`);

export function document(pages: Block[][], title = "Ficha de prueba PDF"): MaterialDocument {
  const base = geografia();
  return MaterialDocumentSchema.parse({ ...base, meta: { ...base.meta, title }, pages: pages.map((blocks) => ({ blocks })), answer_key: [] });
}

/** A choice activity whose correct option is only in the answer key: the PDF must never contain it. */
export function withSecretKey(doc: MaterialDocument): MaterialDocument {
  const choice: Block = { id: id(), type: "activity", label: "K", prompt: "Elige una opción.", response: { kind: "choice", multiple: false, options: [{ id: "o1", text: "Primera" }, { id: "o2", text: "Segunda" }] }, trace };
  return MaterialDocumentSchema.parse({ ...doc, pages: doc.pages.map((p, i) => (i === 0 ? { blocks: [...p.blocks, choice] } : p)), answer_key: [{ block_id: choice.id, basis: "source", value: ANSWER_KEY_SECRET, correct_option_ids: ["o1"] }] });
}

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

/** A visual with a pure red core and a black frame: easy to find, whole or cut, in the rasterised PDF. */
export async function redVisual(width: number, height: number): Promise<Uint8Array> {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#ff0000";
  ctx.fillRect(6, 6, width - 12, height - 12);
  return new Uint8Array(await canvas.encode("png"));
}

/** A real crop produced by the visual pipeline's rasteriser from a rotated page with a shifted CropBox. */
export async function rotatedCropVisual(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([600, 400]);
  page.setCropBox(50, 20, 500, 360);
  page.drawRectangle({ x: 150, y: 120, width: 200, height: 120, color: rgb(1, 0, 0), borderColor: rgb(0, 0, 0), borderWidth: 4 });
  page.drawText("Mapa", { x: 160, y: 250, size: 18 });
  page.setRotation(degrees(90));
  const bytes = await pdf.save();
  const rendered = await renderPage(bytes, "application/pdf", 1, { dpi: 200, maxPx: 4096 });
  const { png } = await cropPng(rendered, { left: Math.round(rendered.width * 0.15), top: Math.round(rendered.height * 0.15), width: Math.round(rendered.width * 0.7), height: Math.round(rendered.height * 0.7) });
  return new Uint8Array(png);
}

export function pin(assetId: string, bytes: Uint8Array): PinnedAsset {
  return { assetId, sha256: sha(bytes), mime: "image/png", bytes };
}

export function studentModel(doc: MaterialDocument, pins: Record<string, PinnedAsset> = {}, requiredVisuals: string[] = []): RenderModel {
  const { model, validation } = buildRenderModel(doc, {
    mode: "student",
    deferred: [],
    requiredVisuals,
    assets: Object.fromEntries(Object.entries(pins).map(([visual, p]) => [visual, { src: assetRef(p) }])),
  });
  if (validation.status === "not_renderable") throw new Error(`fixture no renderizable: ${validation.issues.map((i) => i.code).join(", ")}`);
  return model;
}
