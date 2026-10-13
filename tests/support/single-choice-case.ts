import { buildDocument, sequentialIds } from "@/lib/adaptation/document";
import { normalizePlan } from "@/lib/adaptation/plan";
import { normalizeAnalysis } from "@/lib/analysis/normalize";
import { MaterialAnalysisDraftSchema } from "@/lib/schemas/material-analysis";
import { fractionsCaseContext } from "./fractions-case";
import { PDFDocument, StandardFonts } from "pdf-lib";

export async function singleChoicePdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  ["1. Observa la barra. ¿Qué fracción de la barra está coloreada?", "Elige una opción.", "A) 1/4", "B) 3/8", "C) 1/2"].forEach((text, i) => page.drawText(text, { x: 60, y: 740 - i * 28, size: 11, font }));
  return pdf.save();
}

/** A lost bar with a source key expressed as a letter, not a fraction: the existing figure generator cannot infer its spec. */
export function singleChoiceCase() {
  const analysis = normalizeAnalysis(MaterialAnalysisDraftSchema.parse({
    identification: { title: "Elige una fracción", language: "es", stage: "primaria", grade: "4-primaria", subject: "Matemáticas", topic: "Fracciones", confidence: { stage: 1, grade: 1, subject: 1, topic: 1 } },
    intent: { purpose: "Leer fracciones en una barra", objectives: [{ id: "o1", text: "Reconocer la fracción representada en una barra" }], knowledge: ["Fracción como parte de un todo"], prerequisites: ["Partes iguales"], difficulty: "low" },
    sections: [], texts: [], admin: [], uncertainties: [], protected: [],
    visuals: [{ id: "v1", kind: "geometric_figure", page: 1, role: "required", description: "Barra con ocho celdas iguales, tres de ellas pintadas." }],
    activities: [{ id: "a1", label: "1", page: 1, type: "multiple_choice", instruction: "Observa la barra. ¿Qué fracción de la barra está coloreada? Elige una opción.", context: "A) 1/4\nB) 3/8\nC) 1/2", resources: ["v1"], objectives: ["o1"], response: "select_option", answer_area: "none", answer: { basis: "source", value: "B" }, difficulty: "low", confidence: 1 }],
    quality: { confidence: 1, readability: "good" },
  }), { pageCount: 1 }).analysis;
  const context = fractionsCaseContext(analysis);
  const plan = normalizePlan({ decisions: [], summary: [] }, analysis, context);
  const document = buildDocument({ analysis, context, plan, generated: null, newBlockId: sequentialIds("s") });
  return { analysis, context, plan, document };
}

export const SINGLE_CHOICE_DRAFT = {
  feasible: true,
  prompt: "Observa la barra. ¿Qué fracción de la barra está coloreada? Elige una opción.",
  steps: [], lines: 0,
  figure: { kind: "fraction_bar" as const, parts: 8, shaded: 3, rows: null, cols: null, line_end: null, divisions: null },
  choice: { kind: "choice" as const, multiple: false, options: [{ id: "option_a", text: "A) 1/4" }, { id: "option_b", text: "B) 3/8" }, { id: "option_c", text: "C) 1/2" }] },
};
