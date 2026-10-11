import { PDFDocument, StandardFonts, concatTransformationMatrix, degrees, popGraphicsState, pushGraphicsState, rgb, type PDFFont, type PDFPage } from "pdf-lib";
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
 * «Fracciones en situaciones cotidianas» (Matemáticas, 4.º de Primaria): a synthetic one-page sheet with the same mathematical
 * properties as the real case of Phase 8.2B.1, without its words or layout (no private material):
 *   1 · a bar divided into 8 equal parts, 3 shaded; the student writes the fraction;
 *   2 · compare 2/3 with 3/5 and 4/8 with 1/2 writing >, < or = in boxes;
 *   3 · a problem with 3/4 and 1/4 of a litre of water, with a printed worked example;
 *   4 · a number line from 0 to 1 with ticks at quarters; the student marks 3/4;
 *   5 · explain why 1/2 and 4/8 are equivalent.
 * Everything is drawn as VECTORS (no image object), as in most teacher-made PDFs.
 */
export const A4 = { w: 595.28, h: 841.89 } as const;
const top = (y: number) => A4.h - y;

/** Where the figures are, in PDF points from the top-left of the page (the ground truth the locator is measured against). */
export const TRUTH = {
  bar: { x: 80, y: 150, w: 320, h: 28, parts: 8, shaded: 3 },
  numberLine: { x: 80, y: 470, w: 400, ticks: 5, tickHalf: 7, labelY: 492 },
  comparisonBoxes: [
    { x: 118, y: 258, size: 18 },
    { x: 278, y: 258, size: 18 },
  ],
} as const;
export const normalizedTruth = (r: { x: number; y: number; w: number; h: number }) => ({ x: r.x / A4.w, y: r.y / A4.h, w: r.w / A4.w, h: r.h / A4.h });
export const BAR_BOUNDS = normalizedTruth(TRUTH.bar);
export const LINE_BOUNDS = normalizedTruth({ x: TRUTH.numberLine.x, y: TRUTH.numberLine.y - TRUTH.numberLine.tickHalf, w: TRUTH.numberLine.w, h: TRUTH.numberLine.labelY - TRUTH.numberLine.y + TRUTH.numberLine.tickHalf + 6 });

const text = (page: PDFPage, font: PDFFont, s: string, x: number, y: number, size = 11) => page.drawText(s, { x, y: top(y), size, font, color: rgb(0, 0, 0) });

export interface FractionsPdfOptions {
  /**
   * 90: the sheet as a sideways scan is stored — a LANDSCAPE MediaBox whose content is drawn turned, shown upright by /Rotate 90.
   * The page AS SHOWN is the same portrait sheet; its PDF user space is not.
   */
  rotate?: 90;
  /** An X drawn on the line at 3/4 (a reconstruction must refuse it: it could be the answer). */
  markOnLine?: boolean;
  /** The bar with one part wider than the others (not «equal parts»: no reconstruction). */
  unequalBar?: boolean;
  /** No number line on the page (the essential visual of activity 4 cannot be found). */
  withoutNumberLine?: boolean;
}

export async function fractionsPdf(options: FractionsPdfOptions = {}): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage(options.rotate === 90 ? [A4.h, A4.w] : [A4.w, A4.h]);
  // Portrait drawing (X, Y) → landscape user space (A4.h − Y, X): upright once /Rotate 90 is applied.
  if (options.rotate === 90) page.pushOperators(pushGraphicsState(), concatTransformationMatrix(0, 1, -1, 0, A4.h, 0));
  text(page, bold, "Fracciones en situaciones cotidianas", 60, 60, 16);
  text(page, font, "Nombre: ____________________   Fecha: __________", 60, 92, 10);

  text(page, bold, "1.", 60, 132);
  text(page, font, "Observa la barra. ¿Qué fracción de la barra está coloreada? Escríbela.", 76, 132);
  const { bar } = TRUTH;
  // Unequal variant: the first part is 1.6 times wider (same total width).
  const widths = Array.from({ length: bar.parts }, (_, i) => (options.unequalBar ? (i === 0 ? 1.6 : (bar.parts - 1.6) / (bar.parts - 1)) : 1) * (bar.w / bar.parts));
  for (let i = 0, x = bar.x; i < bar.parts; x += widths[i]!, i++) {
    page.drawRectangle({ x, y: top(bar.y + bar.h), width: widths[i]!, height: bar.h, color: i < bar.shaded ? rgb(0.62, 0.62, 0.62) : rgb(1, 1, 1), borderColor: rgb(0, 0, 0), borderWidth: 1.2 });
  }
  text(page, font, "Fracción: __________", 80, 206);

  text(page, bold, "2.", 60, 240);
  text(page, font, "Compara las fracciones. Escribe >, < o = en cada casilla.", 76, 240);
  const [b1, b2] = TRUTH.comparisonBoxes;
  text(page, font, "2/3", 90, 271, 12);
  page.drawRectangle({ x: b1.x, y: top(b1.y + b1.size), width: b1.size, height: b1.size, borderColor: rgb(0, 0, 0), borderWidth: 1 });
  text(page, font, "3/5", 144, 271, 12);
  text(page, font, "4/8", 250, 271, 12);
  page.drawRectangle({ x: b2.x, y: top(b2.y + b2.size), width: b2.size, height: b2.size, borderColor: rgb(0, 0, 0), borderWidth: 1 });
  text(page, font, "1/2", 304, 271, 12);

  text(page, bold, "3.", 60, 312);
  text(page, font, "Ana bebe 3/4 de litro de agua por la mañana y 1/4 de litro por la tarde.", 76, 312);
  text(page, font, "¿Cuántos litros de agua bebe en total?", 76, 326);
  text(page, font, "Ejemplo: 1/5 + 2/5 = 3/5. Se suman los numeradores y se mantiene el denominador.", 76, 346, 10);
  for (const y of [376, 398]) page.drawLine({ start: { x: 76, y: top(y) }, end: { x: 520, y: top(y) }, thickness: 0.6, color: rgb(0.45, 0.45, 0.45) });

  const figure4Y = TRUTH.numberLine.y;
  text(page, bold, "4.", 60, 432);
  text(page, font, "Marca 3/4 en la recta numérica.", 76, 432);
  const line = TRUTH.numberLine;
  if (!options.withoutNumberLine) {
    page.drawLine({ start: { x: line.x, y: top(figure4Y) }, end: { x: line.x + line.w, y: top(figure4Y) }, thickness: 1.2 });
    const labels = ["0", "1/4", "1/2", "3/4", "1"];
    for (let i = 0; i < line.ticks; i++) {
      const x = line.x + (i * line.w) / (line.ticks - 1);
      page.drawLine({ start: { x, y: top(figure4Y - line.tickHalf) }, end: { x, y: top(figure4Y + line.tickHalf) }, thickness: 1.2 });
      const label = labels[i]!;
      text(page, font, label, x - font.widthOfTextAtSize(label, 10) / 2, line.labelY, 10);
    }
    if (options.markOnLine) {
      const x = line.x + (3 * line.w) / 4;
      page.drawLine({ start: { x: x - 5, y: top(figure4Y - 5) }, end: { x: x + 5, y: top(figure4Y + 5) }, thickness: 1.4 });
      page.drawLine({ start: { x: x - 5, y: top(figure4Y + 5) }, end: { x: x + 5, y: top(figure4Y - 5) }, thickness: 1.4 });
    }
  }

  text(page, bold, "5.", 60, 540);
  text(page, font, "Explica por qué 1/2 y 4/8 son fracciones equivalentes.", 76, 540);
  for (const y of [570, 592, 614]) page.drawLine({ start: { x: 76, y: top(y) }, end: { x: 520, y: top(y) }, thickness: 0.6, color: rgb(0.45, 0.45, 0.45) });
  if (options.rotate === 90) {
    page.pushOperators(popGraphicsState());
    page.setRotation(degrees(90));
  }
  return pdf.save({ useObjectStreams: false });
}

/** The analysis a careful analyzer writes for that sheet (normalised by the real normalizer). */
export function fractionsCaseAnalysis(): MaterialAnalysis {
  const draft = MaterialAnalysisDraftSchema.parse({
    identification: { title: "Fracciones en situaciones cotidianas", language: "es", stage: "primaria", grade: "4-primaria", subject: "Matemáticas", topic: "Fracciones", confidence: { stage: 0.95, grade: 0.9, subject: 0.98, topic: 0.9 } },
    intent: {
      purpose: "Representar, comparar y sumar fracciones en situaciones cotidianas.",
      objectives: [
        { id: "o1", text: "Reconocer la fracción representada en una barra" },
        { id: "o2", text: "Comparar fracciones" },
        { id: "o3", text: "Sumar fracciones de igual denominador" },
        { id: "o4", text: "Situar fracciones en la recta numérica" },
        { id: "o5", text: "Justificar la equivalencia de fracciones" },
      ],
      knowledge: ["Fracción como parte de un todo", "Comparación de fracciones", "Recta numérica"],
      prerequisites: ["Partes iguales de una unidad"],
      difficulty: "medium",
    },
    sections: [],
    texts: [{ id: "c1", kind: "example", page: 1, text: "Ejemplo: 1/5 + 2/5 = 3/5. Se suman los numeradores y se mantiene el denominador." }],
    visuals: [
      { id: "v1", kind: "geometric_figure", page: 1, role: "required", description: "Barra dividida en 8 partes iguales con 3 partes coloreadas." },
      { id: "v2", kind: "number_line", page: 1, role: "required", description: "Recta numérica de 0 a 1 con marcas en 0, 1/4, 1/2, 3/4 y 1." },
    ],
    admin: [
      { type: "student_name", label: "Nombre", page: 1 },
      { type: "date", label: "Fecha", page: 1 },
    ],
    activities: [
      { id: "a1", label: "1", page: 1, type: "short_answer", instruction: "Observa la barra. ¿Qué fracción de la barra está coloreada? Escríbela.", resources: ["v1"], objectives: ["o1"], response: "write_number", answer_area: "line", answer: { basis: "inferred", value: "3/8" }, difficulty: "low", confidence: 0.95 },
      { id: "a2", label: "2", page: 1, type: "short_answer", instruction: "Compara las fracciones. Escribe >, < o = en cada casilla.", context: "2/3 ☐ 3/5     4/8 ☐ 1/2", objectives: ["o2"], response: "write_text", answer_area: "box", answer: { basis: "inferred", value: "2/3 > 3/5; 4/8 = 1/2" }, difficulty: "medium", confidence: 0.9 },
      { id: "a3", label: "3", page: 1, type: "problem_solving", instruction: "Ana bebe 3/4 de litro de agua por la mañana y 1/4 de litro por la tarde. ¿Cuántos litros de agua bebe en total?", resources: ["c1"], objectives: ["o3"], response: "calculate", answer_area: "lines", answer_lines: 2, answer: { basis: "inferred", value: "1 litro" }, difficulty: "medium", confidence: 0.93 },
      { id: "a4", label: "4", page: 1, type: "drawing", instruction: "Marca 3/4 en la recta numérica.", resources: ["v2"], objectives: ["o4"], response: "mark", answer_area: "none", difficulty: "low", confidence: 0.94 },
      { id: "a5", label: "5", page: 1, type: "open_question", instruction: "Explica por qué 1/2 y 4/8 son fracciones equivalentes.", objectives: ["o5"], response: "write_text", answer_area: "lines", answer_lines: 3, difficulty: "medium", confidence: 0.9 },
    ],
    protected: [
      { type: "necessary_visual", importance: "essential", value: "Barra dividida en 8 partes iguales con 3 coloreadas", activities: ["a1"], resources: ["v1"] },
      { type: "required_data", importance: "essential", value: "Pares 2/3 y 3/5; 4/8 y 1/2", activities: ["a2"], resources: [] },
      { type: "required_data", importance: "essential", value: "3/4 de litro y 1/4 de litro", activities: ["a3"], resources: [] },
      { type: "necessary_visual", importance: "essential", value: "Recta numérica de 0 a 1 en cuartos", activities: ["a4"], resources: ["v2"] },
      { type: "concept", importance: "essential", value: "Fracciones equivalentes", activities: ["a5"], resources: [] },
    ],
    uncertainties: [],
    quality: { confidence: 0.94, readability: "good" },
  });
  return normalizeAnalysis(draft, { pageCount: 1 }).analysis;
}

export function fractionsCaseContext(analysis: MaterialAnalysis = fractionsCaseAnalysis()): AdaptationContext {
  return buildAdaptationContext({ profile: EXECUTIVE_EXPERIMENT_PROFILE, education: { stage: "primaria", grade: "4-primaria", subject: "matematicas" }, analysis, adaptationType: "accessibility", policy: 2 }).context;
}

const d = (analysis: MaterialAnalysis, over: Partial<DraftDecision> & Pick<DraftDecision, "target" | "action">): DraftDecision => ({
  strategies: [],
  dimensions: [],
  intensity: "light",
  preserves: protectedFor(analysis, over.target).map((p) => p.id),
  supports: [],
  flags: [],
  ...over,
});

/** A light «Hacer magia» plan: one help per activity, nothing removed, nothing rewritten (the five activities stay literal). */
export function fractionsCasePlan(analysis: MaterialAnalysis, context: AdaptationContext): AdaptationPlan {
  const dims = context.needs.map((n) => n.dimension);
  const dim = (want: string) => (dims.includes(want as never) ? [want] : dims.slice(0, 1)) as DraftDecision["dimensions"];
  return normalizePlan(
    {
      decisions: [
        d(analysis, { target: "act_1", action: "add_support", strategies: ["planning_support"], dimensions: dim("planning_support"), supports: [{ kind: "checklist", uses_task_data: false }] }),
        d(analysis, { target: "act_2", action: "add_support", strategies: ["working_memory_support"], dimensions: dim("working_memory_support"), supports: [{ kind: "reminder", uses_task_data: false }] }),
        d(analysis, { target: "act_3", action: "add_support", strategies: ["worked_example"], dimensions: dim("working_memory_support"), supports: [{ kind: "worked_example", uses_task_data: false }] }),
        d(analysis, { target: "act_5", action: "add_support", strategies: ["planning_support"], dimensions: dim("planning_support"), supports: [{ kind: "planner", uses_task_data: false }] }),
      ],
      summary: [],
    },
    analysis,
    context,
  );
}

const support = (target: string, decisionId: string) => ({ origin: "support" as const, source_refs: [target], decision_ids: [decisionId] });

/** What the generator wrote for those decisions (supports only; analogous data, never the task's own). */
export function fractionsCaseGeneration(plan: AdaptationPlan): GeneratedSegments {
  const idOf = (target: string) => plan.decisions.find((x) => x.target === target)!.id;
  return {
    segments: [
      { target: "act_1", decision_ids: [idOf("act_1")], new_item_answers: [], blocks: [{ id: "s1", type: "checklist", items: ["Cuento todas las partes de la barra.", "Cuento las partes coloreadas."], trace: support("act_1", idOf("act_1")) }] },
      { target: "act_2", decision_ids: [idOf("act_2")], new_item_answers: [], blocks: [{ id: "s2", type: "help_box", variant: "reminder", text: "Si dos fracciones tienen el mismo denominador, es mayor la que tiene mayor numerador.", trace: support("act_2", idOf("act_2")) }] },
      { target: "act_3", decision_ids: [idOf("act_3")], new_item_answers: [], blocks: [{ id: "s3", type: "worked_example", problem: "Luis come 2/6 de una pizza y su hermana 3/6. ¿Cuánta pizza comen?", steps: ["Los denominadores son iguales.", "Sumo los numeradores: 2 + 3 = 5."], result: "Comen 5/6 de la pizza.", trace: support("act_3", idOf("act_3")) }] },
      { target: "act_5", decision_ids: [idOf("act_5")], new_item_answers: [], blocks: [{ id: "s5", type: "planner", slots: [{ label: "Lo que observo", lines: 1 }, { label: "Por qué ocurre", lines: 2 }], trace: support("act_5", idOf("act_5")) }] },
    ],
    change_summary: ["Apoyos de planificación y ejemplos análogos"],
  };
}

/** The assembled sheet, as the real document builder makes it. */
export function fractionsCaseDocument(): { analysis: MaterialAnalysis; context: AdaptationContext; plan: AdaptationPlan; document: MaterialDocument } {
  const analysis = fractionsCaseAnalysis();
  const context = fractionsCaseContext(analysis);
  const plan = fractionsCasePlan(analysis, context);
  const document = buildDocument({ analysis, plan, context, generated: fractionsCaseGeneration(plan), newBlockId: sequentialIds("c") });
  return { analysis, context, plan, document };
}
