import { protectedFor } from "@/lib/adaptation/facts";
import { normalizeAnalysis } from "@/lib/analysis/normalize";
import type { DraftDecision } from "@/lib/schemas/adaptation-plan";
import { DraftGeneratedSegmentsV2Schema, type DraftGeneratedSegmentsV2 } from "@/lib/schemas/generated-segments-v2";
import { MaterialAnalysisDraftSchema, type MaterialAnalysis } from "@/lib/schemas/material-analysis";

/**
 * «La célula en acción» (Biología, 1.º de ESO): la ficha de prueba del equipo en la que un ejemplo resuelto entregó la respuesta del
 * apartado a). Mismas pistas (en su tabla), misma respuesta deducida (dada por el material), mismo ejemplo; sin datos del alumnado.
 */
export const CELL_EXAMPLE_LEAK = "Pista: «Contiene la información que dirige la actividad de la célula». ¿Qué estructura es?";

export function cellPilotAnalysis(): MaterialAnalysis {
  const draft = MaterialAnalysisDraftSchema.parse({
    identification: { title: "La célula en acción", language: "es", stage: "eso", grade: "1-eso", subject: "Biología y Geología", topic: "La célula", confidence: { stage: 0.95, grade: 0.9, subject: 0.95, topic: 0.9 } },
    intent: { purpose: "Identificar estructuras celulares a partir de su función.", objectives: [{ id: "o1", text: "Identificar estructuras celulares a partir de su función" }], knowledge: ["Estructuras de la célula"], prerequisites: [], difficulty: "medium" },
    sections: [{ id: "s1", title: "Estructuras de la célula", page_start: 1, page_end: 1 }],
    texts: [{ id: "t1", kind: "reading_text", page: 1, text: "Todas las células tienen una membrana plasmática y citoplasma. En las células animales y vegetales, el núcleo contiene el ADN. Las mitocondrias intervienen en la obtención de energía a partir de nutrientes.", section: "s1" }],
    visuals: [{ id: "v1", kind: "table", page: 1, role: "required", title: "Pistas", description: "Tabla de pistas y estructuras.", section: "s1", table: { headers: ["Pista", "Estructura"], rows: [["a) Contiene el ADN.", ""], ["b) Regula el paso de sustancias entre la célula y el exterior.", ""], ["c) Es el medio interno donde se encuentran los orgánulos.", ""], ["d) Participa en la obtención de energía a partir de nutrientes.", ""]] } }],
    admin: [],
    activities: [
      { id: "a1", label: "1", page: 1, type: "short_answer", instruction: "Escribe la estructura celular que corresponde a cada pista.", resources: ["v1", "t1"], objectives: ["o1"], section: "s1", response: "write_text", answer_area: "table_cells", answer: { basis: "inferred", value: "a) Núcleo; b) Membrana plasmática; c) Citoplasma; d) Mitocondria" }, difficulty: "medium", confidence: 0.93 },
    ],
    protected: [{ type: "concept", importance: "essential", value: "Identificar la estructura celular a partir de su función", activities: ["a1"], resources: [] }],
    uncertainties: [],
    quality: { confidence: 0.94, readability: "good" },
  });
  return normalizeAnalysis(draft, { pageCount: 1 }).analysis;
}

/** One executable decision: a worked example for act_1 (the working-memory need, the one the test profile has). */
export const cellDecisions = (a: MaterialAnalysis = cellPilotAnalysis()): DraftDecision[] => [
  { target: "act_1", action: "add_support", strategies: ["worked_example", "working_memory_support"], dimensions: ["working_memory_support"], intensity: "moderate", preserves: protectedFor(a, "act_1").map((p) => p.id), supports: [{ kind: "worked_example", uses_task_data: false }], flags: [] },
];

const draftWith = (problem: string, result: string): DraftGeneratedSegmentsV2 =>
  DraftGeneratedSegmentsV2Schema.parse({
    segments: [{ decision_id: "dec_1", target: "act_1", supports: [{ kind: "worked_example", problem, steps: ["Lee la pista y localiza la función que describe."], result }] }],
    skipped: [],
    blocked: [],
    change_summary: ["Un ejemplo resuelto"],
  });

/** What the generator wrote the first time (the answer of item a) as the example) and what a safe example looks like. */
export const cellLeaking = () => draftWith(CELL_EXAMPLE_LEAK, "Núcleo.");
export const cellSafe = () => draftWith("Pista: «Bombea la sangre por todo el cuerpo». ¿Qué órgano corresponde?", "El corazón.");
