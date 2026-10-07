import "server-only";
import { createHash } from "node:crypto";
import { buildRenderModel, type RenderModel } from "@/lib/render/model";
import { assetRef, type PinnedAsset } from "@/lib/render/print/pinned-assets";
import { MaterialDocumentSchema, type Block } from "@/lib/schemas/material-document";

/**
 * VALIDATION_ONLY (rama phase5/pdf-vercel-validation, nunca main): fichas sintéticas embebidas para probar el motor PDF de la
 * Fase 5.2A en una Vercel Function real. Ningún dato de usuario, ninguna URL, ningún fichero externo.
 */

export const SPANISH = "Ñandú y año, árbol, café, país, canción, útil, pingüino. ¿Qué? ¡Sí! 1.º · … «comillas» – —";

// 600×400 PNG: black frame, pure red core (generated with @napi-rs/canvas, embedded as is).
const RED_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAlgAAAGQCAYAAAByNR6YAAAABHNCSVQICAgIfAhkiAAAAAFzUkdCAK7OHOkAAAc4SURBVHic7duxCcAwDABBOWT/lZMJnOrBEO5KuVH5CLxm5hkAADLX6QUAAP5GYAEAxAQWAEBMYAEAxAQWAEDs3j34WggA8G1t5i5YAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAAAxgQUAEBNYAACxNTPP6SUAAP7EBQsAICawAABiAgsAICawAABiAgsAIPYCRcwGHzK9g7MAAAAASUVORK5CYII=", "base64");
const VISUAL: PinnedAsset = { assetId: "0b6f9a3e-1c2d-4e5f-8a9b-0c1d2e3f4a5b", sha256: createHash("sha256").update(RED_PNG).digest("hex"), mime: "image/png", bytes: new Uint8Array(RED_PNG) };

const trace = { origin: "adapted" as const, source_refs: [] as string[], decision_ids: [] as string[] };
let seq = 0;
const id = () => `blk_vp${String(++seq).padStart(5, "0")}`;
const heading = (text: string): Block => ({ id: id(), type: "heading", level: 1, text, trace });
const paragraph = (text: string): Block => ({ id: id(), type: "paragraph", text, trace });
const lines = (label: string, n: number): Block => ({ id: id(), type: "activity", label, prompt: "Responde con tus palabras.", response: { kind: "lines", lines: n }, trace });
const table = (rows: number): Block => ({ id: id(), type: "table", caption: "Tabla de datos", headers: ["Cabecera 1", "Cabecera 2", "Cabecera 3"], rows: Array.from({ length: rows }, (_, r) => [1, 2, 3].map((c) => `Fila ${r + 1} · dato ${c}`)), trace });
const chart = (): Block => ({ id: id(), type: "chart", title: "Población por año", chart_type: "bar", categories: ["2019", "2020", "2021", "2022"], series: [{ label: null, values: [10, 20, 15, 30] }], y_label: "Habitantes", trace });
const image = (): Block => ({ id: id(), type: "image", source: { kind: "original", visual_ref: "vis_1" }, alt_text: "Figura del original", caption: "Figura del original", trace });

function model(pages: Block[][], pins: Record<string, PinnedAsset> = {}): RenderModel {
  const doc = MaterialDocumentSchema.parse({
    schema_version: 1,
    meta: { title: "Ficha sintética de validación", language: "es", stage: "eso", grade: "1-eso", subject: "Geografía", topic: null },
    presentation: { font_scale: 1, line_spacing: "normal", spacing: "normal", contrast: "normal", decoration: "standard", max_tasks_per_page: null, color_independent: true, text_alternatives_for_visuals: true },
    admin_fields: [{ type: "student_name", label: "Nombre" }, { type: "date", label: "Fecha" }],
    pages: pages.map((blocks) => ({ blocks })),
    answer_key: [],
  });
  const { model: m, validation } = buildRenderModel(doc, { mode: "student", deferred: [], requiredVisuals: Object.keys(pins), assets: Object.fromEntries(Object.entries(pins).map(([v, p]) => [v, { src: assetRef(p) }])) });
  if (validation.status === "not_renderable") throw new Error("fixture_not_renderable");
  return m;
}

export interface Fixture {
  model: () => RenderModel;
  pins: PinnedAsset[];
  pages: number;
  texts: string[];
  images: number;
}

export const FIXTURES = {
  basic: { model: () => model([[heading("Ficha básica"), paragraph("Lee el texto y responde."), lines("1", 3)]]), pins: [], pages: 1, texts: ["Ficha básica", "Responde con tus palabras."], images: 0 },
  spanish: { model: () => model([[heading("¿Ñandú? ¡Sí! «Pingüino»"), paragraph(SPANISH), paragraph(`**${SPANISH}**`), paragraph(`_${SPANISH}_`)]]), pins: [], pages: 1, texts: [SPANISH, "¿Ñandú? ¡Sí! «Pingüino»"], images: 0 },
  table: { model: () => model([[heading("Tabla"), table(40)]]), pins: [], pages: 2, texts: ["Cabecera 1", "Fila 1 · dato 1", "Fila 40 · dato 3"], images: 0 },
  chart: { model: () => model([[heading("Gráfico"), chart()]]), pins: [], pages: 1, texts: ["Población por año", "2019", "2022", "Habitantes"], images: 0 },
  visual: { model: () => model([[heading("Observa la figura"), image(), lines("1", 3)]], { vis_1: VISUAL }), pins: [VISUAL], pages: 1, texts: ["Figura del original"], images: 1 },
  multipage: { model: () => model([[heading("Página uno")], [heading("Página dos")], [heading("Página tres")]]), pins: [], pages: 3, texts: ["Página uno", "Página dos", "Página tres"], images: 0 },
  "ten-pages": { model: () => model(Array.from({ length: 10 }, (_, i) => [heading(`Página ${i + 1}`), paragraph(SPANISH), table(4), lines(String(i + 1), 6)])), pins: [], pages: 10, texts: ["Página 1", "Página 10"], images: 0 },
} satisfies Record<string, Fixture>;

/** Fixed HTML with references to an unresolvable host (RFC 2606 .invalid): the engine must refuse it without any request. */
export const NETWORK_PROBE_HTML = '<!doctype html><html><head><link rel="stylesheet" href="https://adaptaula-probe.invalid/a.css"></head><body><img src="https://adaptaula-probe.invalid/i.png"><p>red</p></body></html>';
