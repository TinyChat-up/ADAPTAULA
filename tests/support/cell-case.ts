import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { buildAdaptationContext } from "@/lib/adaptation/context";
import { buildDocument, sequentialIds } from "@/lib/adaptation/document";
import { protectedFor } from "@/lib/adaptation/facts";
import { normalizePlan } from "@/lib/adaptation/plan";
import { normalizeAnalysis } from "@/lib/analysis/normalize";
import type { AdaptationContext } from "@/lib/schemas/adaptation-context";
import type { AdaptationPlan, DraftDecision } from "@/lib/schemas/adaptation-plan";
import type { GeneratedSegments } from "@/lib/schemas/ai-contracts";
import { MaterialAnalysisDraftSchema, type MaterialAnalysis } from "@/lib/schemas/material-analysis";
import type { MaterialDocument } from "@/lib/schemas/material-document";
import { EXECUTIVE_EXPERIMENT_PROFILE } from "../../evals/adaptation/planner-lib";

/**
 * «La célula animal» (Biología y Geología, 1.º de ESO): a synthetic one-page sheet whose first activity needs a SCHEME that no
 * structured figure can redraw (case B of the «Hacer magia» validation):
 *   1 · observe the scheme of an animal cell and write the names of the parts marked 1, 2 and 3 (the scheme is essential);
 *   2 · explain the function of the nucleus;
 *   3 · write one difference between an animal and a plant cell.
 * No private material. The scheme is drawn as vectors (membrane, cytoplasm dots, nucleus, numbered markers) or left out.
 */
const A4 = { w: 595.28, h: 841.89 } as const;
const top = (y: number) => A4.h - y;
const text = (page: PDFPage, font: PDFFont, s: string, x: number, y: number, size = 11) => page.drawText(s, { x, y: top(y), size, font, color: rgb(0, 0, 0) });

export const CELL_ACTIVITY_1 = "Observa el esquema de la célula animal. Escribe el nombre de las partes señaladas con los números 1, 2 y 3.";

export async function cellPdf(options: { withoutScheme?: boolean } = {}): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([A4.w, A4.h]);
  text(page, bold, "La célula animal", 60, 60, 16);
  text(page, font, "Nombre: ____________________   Fecha: __________", 60, 92, 10);
  text(page, bold, "1.", 60, 132);
  text(page, font, "Observa el esquema de la célula animal. Escribe el nombre de las partes", 76, 132);
  text(page, font, "señaladas con los números 1, 2 y 3.", 76, 146);
  if (!options.withoutScheme) {
    const cx = 250;
    const cy = 250;
    page.drawEllipse({ x: cx, y: top(cy), xScale: 120, yScale: 80, borderColor: rgb(0, 0, 0), borderWidth: 1.4 });
    page.drawEllipse({ x: cx + 15, y: top(cy + 5), xScale: 32, yScale: 26, color: rgb(0.75, 0.75, 0.75), borderColor: rgb(0, 0, 0), borderWidth: 1.2 });
    for (const [dx, dy] of [[-60, -30], [-70, 25], [70, -35], [60, 40]] as const) page.drawCircle({ x: cx + dx, y: top(cy + dy), size: 2, color: rgb(0.3, 0.3, 0.3) });
    const marker = (n: string, x: number, y: number, tx: number, ty: number) => {
      page.drawLine({ start: { x, y: top(y) }, end: { x: tx, y: top(ty) }, thickness: 0.8 });
      text(page, bold, n, x + 4, y + 4, 11);
    };
    marker("1", 400, 200, 362, 225);
    marker("2", 400, 300, 320, 285);
    marker("3", 120, 330, 255, 262);
  }
  for (const y of [360, 382, 404]) page.drawLine({ start: { x: 76, y: top(y) }, end: { x: 520, y: top(y) }, thickness: 0.6, color: rgb(0.45, 0.45, 0.45) });
  text(page, bold, "2.", 60, 440);
  text(page, font, "¿Qué función tiene el núcleo? Explícalo con tus palabras.", 76, 440);
  for (const y of [468, 490, 512]) page.drawLine({ start: { x: 76, y: top(y) }, end: { x: 520, y: top(y) }, thickness: 0.6, color: rgb(0.45, 0.45, 0.45) });
  text(page, bold, "3.", 60, 548);
  text(page, font, "Escribe una diferencia entre la célula animal y la célula vegetal.", 76, 548);
  for (const y of [576, 598]) page.drawLine({ start: { x: 76, y: top(y) }, end: { x: 520, y: top(y) }, thickness: 0.6, color: rgb(0.45, 0.45, 0.45) });
  return pdf.save({ useObjectStreams: false });
}

/** The analysis a careful analyzer writes for that sheet (normalised by the real normalizer). */
export function cellCaseAnalysis(): MaterialAnalysis {
  const draft = MaterialAnalysisDraftSchema.parse({
    identification: { title: "La célula animal", language: "es", stage: "eso", grade: "1-eso", subject: "Biología y Geología", topic: "La célula", confidence: { stage: 0.95, grade: 0.9, subject: 0.98, topic: 0.9 } },
    intent: {
      purpose: "Identificar las partes de la célula animal y relacionarlas con su función.",
      objectives: [
        { id: "o1", text: "Identificar las partes de la célula animal en un esquema" },
        { id: "o2", text: "Relacionar las partes de la célula con su función" },
      ],
      knowledge: ["Membrana plasmática, citoplasma y núcleo"],
      prerequisites: ["Concepto de ser vivo"],
      difficulty: "medium",
    },
    sections: [],
    texts: [],
    visuals: [{ id: "v1", kind: "diagram", page: 1, role: "required", description: "Esquema de una célula animal con tres partes señaladas con los números 1, 2 y 3." }],
    admin: [
      { type: "student_name", label: "Nombre", page: 1 },
      { type: "date", label: "Fecha", page: 1 },
    ],
    activities: [
      { id: "a1", label: "1", page: 1, type: "short_answer", instruction: CELL_ACTIVITY_1, resources: ["v1"], objectives: ["o1"], response: "write_text", answer_area: "lines", answer_lines: 3, answer: { basis: "inferred", value: "1: membrana plasmática; 2: citoplasma; 3: núcleo" }, difficulty: "low", confidence: 0.93 },
      { id: "a2", label: "2", page: 1, type: "open_question", instruction: "¿Qué función tiene el núcleo? Explícalo con tus palabras.", objectives: ["o2"], response: "write_text", answer_area: "lines", answer_lines: 3, difficulty: "medium", confidence: 0.9 },
      { id: "a3", label: "3", page: 1, type: "open_question", instruction: "Escribe una diferencia entre la célula animal y la célula vegetal.", objectives: ["o2"], response: "write_text", answer_area: "lines", answer_lines: 2, difficulty: "medium", confidence: 0.9 },
    ],
    protected: [{ type: "necessary_visual", importance: "essential", value: "Esquema de la célula animal con partes numeradas", activities: ["a1"], resources: ["v1"] }],
    uncertainties: [],
    quality: { confidence: 0.92, readability: "good" },
  });
  return normalizeAnalysis(draft, { pageCount: 1 }).analysis;
}

export function cellCaseContext(analysis: MaterialAnalysis = cellCaseAnalysis()): AdaptationContext {
  return buildAdaptationContext({ profile: EXECUTIVE_EXPERIMENT_PROFILE, education: { stage: "eso", grade: "1-eso", subject: "biologia-geologia" }, analysis, adaptationType: "accessibility", policy: 2 }).context;
}

const decision = (analysis: MaterialAnalysis, over: Partial<DraftDecision> & Pick<DraftDecision, "target" | "action">): DraftDecision => ({
  strategies: [],
  dimensions: [],
  intensity: "light",
  preserves: protectedFor(analysis, over.target).map((p) => p.id),
  supports: [],
  flags: [],
  ...over,
});

/** One planning help for activity 2; activity 1 and its scheme stay as they are. */
export function cellCasePlan(analysis: MaterialAnalysis, context: AdaptationContext): AdaptationPlan {
  const dims = context.needs.map((n) => n.dimension);
  const dim = (want: string) => (dims.includes(want as never) ? [want] : dims.slice(0, 1)) as DraftDecision["dimensions"];
  return normalizePlan({ decisions: [decision(analysis, { target: "act_2", action: "add_support", strategies: ["planning_support"], dimensions: dim("planning_support"), supports: [{ kind: "checklist", uses_task_data: false }] })], summary: [] }, analysis, context);
}

export function cellCaseGeneration(plan: AdaptationPlan): GeneratedSegments {
  const id = plan.decisions.find((x) => x.target === "act_2")!.id;
  return {
    segments: [{ target: "act_2", decision_ids: [id], new_item_answers: [], blocks: [{ id: "s1", type: "checklist", items: ["Piensa en qué contiene el núcleo.", "Escribe para qué sirve con una frase completa."], trace: { origin: "support", source_refs: ["act_2"], decision_ids: [id] } }] }],
    change_summary: ["Lista de comprobación para la actividad 2"],
  };
}

export function cellCaseDocument(): { analysis: MaterialAnalysis; context: AdaptationContext; plan: AdaptationPlan; document: MaterialDocument } {
  const analysis = cellCaseAnalysis();
  const context = cellCaseContext(analysis);
  const plan = cellCasePlan(analysis, context);
  const document = buildDocument({ analysis, plan, context, generated: cellCaseGeneration(plan), newBlockId: sequentialIds("c") });
  return { analysis, context, plan, document };
}

/** The brief a careful image_brief model writes for activity 1: numbered markers, no names (the student writes them). */
export const CELL_BRIEF = {
  feasible: true,
  kind: "scientific_diagram" as const,
  concept: "Célula animal vista al microscopio óptico, en sección",
  pedagogical_purpose: "Identificar la membrana plasmática, el citoplasma y el núcleo de una célula animal",
  required_elements: [
    { name: "membrana plasmática", marker: 1, label: null },
    { name: "citoplasma", marker: 2, label: null },
    { name: "núcleo", marker: 3, label: null },
  ],
  prohibited_elements: ["pared celular", "cloroplastos", "vacuola central grande", "texto con los nombres de las partes"],
  composition: "Una sola célula centrada, ovalada, ocupando dos tercios de la imagen, con el núcleo algo desplazado del centro",
  detail_level: "simple" as const,
  conceptual_constraints: ["el núcleo es claramente mayor que cualquier otro orgánulo", "la membrana rodea toda la célula"],
  alt_text: "Esquema de una célula animal con tres partes señaladas con los números 1, 2 y 3.",
};

/** A review that approves exactly that brief. */
export const CELL_REVIEW_APPROVED = {
  elements: [
    { name: "membrana plasmática", present: true, marker_ok: true, label_ok: null },
    { name: "citoplasma", present: true, marker_ok: true, label_ok: null },
    { name: "núcleo", present: true, marker_ok: true, label_ok: null },
  ],
  prohibited_found: [],
  conceptual_errors: [],
  extra_text: false,
  illegible_text: false,
  answer_revealed: false,
  age_appropriate: true,
  printable: true,
  matches_activity: true,
  verdict: "approved" as const,
};
