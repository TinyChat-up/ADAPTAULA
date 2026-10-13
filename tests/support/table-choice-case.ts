import { PDFDocument, StandardFonts } from "pdf-lib";
import { buildDocument, sequentialIds } from "@/lib/adaptation/document";
import { normalizePlan } from "@/lib/adaptation/plan";
import { normalizeAnalysis } from "@/lib/analysis/normalize";
import { MaterialAnalysisDraftSchema } from "@/lib/schemas/material-analysis";
import { buildAdaptationContext } from "@/lib/adaptation/context";
import { EXECUTIVE_EXPERIMENT_PROFILE } from "../../evals/adaptation/planner-lib";

export const TABLE_DATA = { headers: ["Animal", "Alimentación", "Hábitat"], rows: [["Conejo", "Plantas", "Pradera"], ["León", "Carne", "Sabana"], ["Gorrión", "Semillas", "Bosque"]], unit: null };
export const TABLE_PROMPT = "Según la tabla, ¿qué alimentación corresponde a «Conejo»? Elige una opción.";
export const TABLE_CHOICE_DRAFT = { feasible: true, prompt: TABLE_PROMPT, steps: [] as string[], lines: 0, figure: null, choice: { kind: "choice" as const, multiple: false, options: [{ id: "option_a", text: "A) Carne" }, { id: "option_b", text: "B) Plantas" }, { id: "option_c", text: "C) Semillas" }] }, table: TABLE_DATA };
export const TABLE_RUN = { purpose: "visual_rewrite" as const, attempt: 1, alias: "STANDARD" as const, provider: "mock" as const, model: "default", effort: "low" as const, promptKey: "visual_substitute", promptVersion: 4, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, cacheCreationInputTokens: 0, estimatedCostUsd: 0, latencyMs: 0, status: "success" as const, errorCode: null };

export function tableChoiceCase(asImage = false) {
  const analysis = normalizeAnalysis(MaterialAnalysisDraftSchema.parse({
    identification: { title: "Animales y alimentación", language: "es", stage: "primaria", grade: "4-primaria", subject: "Ciencias", topic: "Lectura de tablas", confidence: { stage: 1, grade: 1, subject: 1, topic: 1 } },
    intent: { purpose: "Consultar una tabla", objectives: [{ id: "o1", text: "Leer un dato de una tabla relacionando fila y columna" }], knowledge: ["Tablas"], prerequisites: ["Filas y columnas"], difficulty: "low" },
    sections: [], texts: [], admin: [], uncertainties: [], protected: [],
    visuals: [{ id: "v1", kind: "table", page: 1, role: "required", description: "Tabla de animales, alimentación y hábitat", table: { headers: TABLE_DATA.headers, rows: TABLE_DATA.rows } }],
    activities: [{ id: "a1", label: "1", page: 1, type: "multiple_choice", instruction: TABLE_PROMPT, context: "A) Carne\nB) Plantas\nC) Semillas", resources: ["v1"], objectives: ["o1"], response: "select_option", answer_area: "none", answer: { basis: "source", value: "B" }, difficulty: "low", confidence: 1 }],
    quality: { confidence: 1, readability: "good" },
  }), { pageCount: 1 }).analysis;
  const context = buildAdaptationContext({ profile: EXECUTIVE_EXPERIMENT_PROFILE, education: { stage: "primaria", grade: "4-primaria", subject: "Ciencias" }, analysis, adaptationType: "accessibility", policy: 2 }).context;
  const plan = normalizePlan({ decisions: [], summary: [] }, analysis, context);
  const document = buildDocument({ analysis, context, plan, generated: null, newBlockId: sequentialIds("t") });
  if (asImage) for (const page of document.pages) page.blocks = page.blocks.map((b) => b.type === "table" ? { id: b.id, type: "image", source: { kind: "original", visual_ref: "vis_1" }, alt_text: "Tabla original", trace: b.trace } : b);
  return { analysis, context, plan, document };
}

/** A vector grid with a text layer, no image object to crop. */
export async function tableChoicePdf(table = TABLE_DATA, omit = false): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  if (!omit) {
    const rows = [table.headers, ...table.rows];
    rows.forEach((row, r) => row.forEach((cell, c) => page.drawText(cell, { x: 65 + c * 155, y: 715 - r * 30, size: 11, font })));
    for (let r = 0; r <= rows.length; r++) page.drawLine({ start: { x: 60, y: 735 - r * 30 }, end: { x: 525, y: 735 - r * 30 }, thickness: 1 });
    for (let c = 0; c <= 3; c++) page.drawLine({ start: { x: 60 + c * 155, y: 735 }, end: { x: 60 + c * 155, y: 735 - rows.length * 30 }, thickness: 1 });
  }
  page.drawText("Consulta la tabla y elige una opción.", { x: 60, y: 570, size: 11, font });
  return pdf.save();
}
