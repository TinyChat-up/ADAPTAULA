import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { mockAnalysisDraftV3 } from "@/lib/ai/providers/mock-analysis-v3";
import type { MaterialAnalysisV4Draft } from "@/lib/schemas/activity-comprehension";

type Exercise = MaterialAnalysisV4Draft["activities"][number];
type Understanding = Exercise["comprehension"];

const q = (source_ref: string, quote: string | null) => ({ source_ref, quote });
const item = <K extends string>(kind: K, source: string, quote: string) => ({ kind, evidence: q(source, quote) });

const exercise = (id: string, type: Exercise["type"], instruction: string, fields: Partial<Understanding>, extra?: Partial<Exercise>): Exercise => ({
  id, label: id.slice(1), type, instruction, page: 1, resources: [], objectives: [`o${id.slice(1)}`],
  response: "write_text", answer_area: "lines", difficulty: "medium", confidence: 0.9,
  ...extra,
  comprehension: {
    objectives: [], operations: [], student_decisions: [], information: [], essential_resources: [],
    response_format_role: null, evaluation: [], conditions: [], uncertainties: [], ...fields,
  },
});

export function pedagogicalOriginalDraft(): MaterialAnalysisV4Draft {
  const math = "Decide qué operaciones necesitas y en qué orden. Justifica el procedimiento.";
  const quantities = "Hay 150 plazas. Se han reservado 75 por la mañana y 32 por la tarde. ¿Cuántas quedan?";
  const reading = "Explica por qué la exploradora volvió al refugio. Justifica tu idea con una frase del texto.";
  const story = "El cielo oscureció y empezaron a caer gotas. La exploradora recogió su mapa y corrió hacia el refugio.";
  const writing = "Escribe un texto para convencer a tu clase. Defiende tu postura con dos argumentos.";
  const classification = "Clasifica los materiales. Decide un criterio propio y explica la regla que utilizas.";
  const chart = "Usa el gráfico. Compara marzo y abril y explica qué tendencia ves.";
  const objectives = [
    { id: "o1", text: "Planificar operaciones y justificar el procedimiento" },
    { id: "o2", text: "Inferir una causa y fundamentarla con evidencia textual" },
    { id: "o3", text: "Escribir un texto argumentativo" },
    { id: "o4", text: "Clasificar aplicando un criterio propio" },
    { id: "o5", text: "Interpretar datos de un gráfico" },
  ];
  const inferred = (n: number, quote: string) => ({ objective_ref: `o${n}`, basis: "interpreted" as const, evidence: q(`a${n}`, quote) });
  return {
    identification: { ...mockAnalysisDraftV3().identification, title: "Actividades de aula", subject: "", topic: "" },
    intent: { difficulty: "medium", purpose: "Resolver tareas de razonamiento, lectura y escritura.", objectives, knowledge: [], prerequisites: [] },
    admin: [], sections: [],
    texts: [{ id: "story", kind: "reading_text", page: 1, text: story }],
    visuals: [{
      id: "chart", kind: "chart", page: 2, role: "required", title: "Visitas a la biblioteca", description: "Gráfico de barras.",
      chart: { type: "bar", categories: ["Marzo", "Abril"], series: [{ name: "", values: [12, 20] }], unit: "visitas" },
    }],
    activities: [
      exercise("a1", "problem_solving", math, {
        objectives: [inferred(1, math)],
        operations: [item("choose_procedure", "a1", "Decide qué operaciones necesitas"), item("justify", "a1", "Justifica el procedimiento")],
        student_decisions: [item("choose_procedure", "a1", "Decide qué operaciones necesitas"), item("order_steps", "a1", "qué operaciones necesitas y en qué orden")],
        information: [q("a1", "Hay 150 plazas"), q("a1", "75 por la mañana y 32 por la tarde")],
        evaluation: [item("reasoning", "a1", "Justifica el procedimiento")],
        conditions: [item("required_data", "a1", "Hay 150 plazas")],
      }, { context: quantities }),
      exercise("a2", "reading_comprehension", reading, {
        objectives: [inferred(2, "Explica por qué la exploradora volvió al refugio")],
        operations: [item("infer", "a2", "Explica por qué la exploradora volvió al refugio"), item("locate_evidence", "a2", "con una frase del texto")],
        student_decisions: [item("infer_conclusion", "a2", "Explica por qué la exploradora volvió al refugio"), item("select_evidence", "a2", "con una frase del texto")],
        information: [q("story", story)],
        essential_resources: [{ resource_ref: "story", evidence: q("a2", "con una frase del texto") }],
        evaluation: [item("reading_comprehension", "a2", "Justifica tu idea con una frase del texto")],
      }, { resources: ["story"] }),
      exercise("a3", "writing", writing, {
        objectives: [inferred(3, writing)],
        operations: [item("compose", "a3", "Escribe un texto para convencer a tu clase"), item("justify", "a3", "Defiende tu postura con dos argumentos")],
        student_decisions: [item("formulate_argument", "a3", "Defiende tu postura con dos argumentos")],
        response_format_role: item("assessed", "a3", "Escribe un texto para convencer a tu clase"),
        evaluation: [item("written_production", "a3", "Escribe un texto"), item("argumentation", "a3", "Defiende tu postura con dos argumentos")],
        conditions: [item("reasoning", "a3", "con dos argumentos")],
      }),
      exercise("a4", "classification", classification, {
        objectives: [inferred(4, classification)],
        operations: [item("classify", "a4", "Clasifica los materiales"), item("justify", "a4", "explica la regla que utilizas")],
        student_decisions: [item("choose_criterion", "a4", "Decide un criterio propio")],
        information: [q("a4", "papel, madera, metal y vidrio")],
        evaluation: [item("reasoning", "a4", "explica la regla que utilizas")],
      }, { context: "Materiales: papel, madera, metal y vidrio." }),
      exercise("a5", "graph_interpretation", chart, {
        objectives: [inferred(5, chart)],
        operations: [item("interpret_visual", "a5", "Usa el gráfico"), item("compare", "a5", "Compara marzo y abril")],
        student_decisions: [item("interpret_relation", "a5", "explica qué tendencia ves")],
        information: [q("chart", null)],
        essential_resources: [{ resource_ref: "chart", evidence: q("a5", "Usa el gráfico") }],
        evaluation: [item("interpretation", "a5", "explica qué tendencia ves")],
      }, { page: 2, resources: ["chart"] }),
      exercise("a6", "other", "Explica lo que muestra.", {
        uncertainties: [{ field: "essential_resources", reason: "ambiguous" }, { field: "operations", reason: "ambiguous" }],
      }, { page: 2, objectives: [] }),
    ],
    protected: [],
    uncertainties: [{ kind: "ambiguous", targets: ["a6"], note: "La consigna no identifica el elemento al que se refiere.", confidence: 0.8 }],
    quality: { confidence: 0.9, readability: "good" },
  };
}

export async function pedagogicalOriginalPdf(draft: MaterialAnalysisV4Draft): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const first = pdf.addPage();
  const second = pdf.addPage();
  const drawLines = (page: typeof first, lines: string[], top: number) => lines.forEach((line, i) => {
    page.drawText(line, { x: 35, y: top - i * 25, size: 10, font });
  });
  drawLines(first, draft.activities.filter((a) => a.page === 1).flatMap((a) => [a.instruction, a.context ?? ""]), 780);
  drawLines(first, draft.texts.map((text) => text.text), 485);
  drawLines(second, [...draft.activities.filter((a) => a.page === 2).map((a) => a.instruction), "Visitas a la biblioteca"], 780);
  for (const [index, value] of [12, 20].entries()) {
    const x = 53 + index * 82;
    second.drawRectangle({ x, y: 455, width: 40, height: 9 * value, color: rgb(0.15, 0.34, 0.56) });
    second.drawText(String(value), { x, y: 460 + 9 * value, size: 10, font });
    second.drawText(index === 0 ? "Marzo" : "Abril", { x, y: 435, size: 10, font });
  }
  return pdf.save();
}
