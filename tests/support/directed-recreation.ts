import { createHash } from "node:crypto";
import { analyzeMaterialFile } from "@/lib/ai/pipeline/analyze";
import { getMaterialAnalyzer } from "@/lib/ai/prompts";
import { MockProvider } from "@/lib/ai/providers/mock";
import type { StructuredRequest } from "@/lib/ai/types";
import type { DirectorInput } from "@/lib/recreation/director";
import type { FunctionalProfile } from "@/lib/schemas/functional-profile";
import { emptyFunctionalProfile, FunctionalProfileSchema } from "@/lib/schemas/functional-profile";
import { emptyPedagogicalProfile } from "@/lib/schemas/pedagogical-profile";
import type { DirectorActivityProposal } from "@/lib/schemas/pedagogical-direction";
import { directPedagogy } from "@/lib/recreation/director";
import type { DirectedPlan } from "@/lib/recreation/directed-plan";
import { pedagogicalOriginalDraft, pedagogicalOriginalPdf } from "./pedagogical-original";

export const PRIVATE_STATEMENT = "Registro libre exclusivo del equipo docente";
const scope = { version: 1, type: "methodological" } as const;

export function completeOriginal() {
  const draft = pedagogicalOriginalDraft();
  draft.activities.pop();
  draft.uncertainties = [];
  return draft;
}

export function shortOriginal() {
  const draft = completeOriginal();
  const reading = draft.activities[1]!;
  const condition = "Menciona el nombre del lugar.";
  const target = "Identifica el lugar al que volvió la exploradora.";
  reading.instruction = `${target} ${condition} Puedes decirlo o escribirlo.`;
  reading.answer_lines = 3;
  const quote = (quote: string) => ({ source_ref: "a2", quote });
  draft.intent.objectives[1]!.text = "Identificar el lugar al que volvió la exploradora";
  reading.comprehension = {
    ...reading.comprehension,
    objectives: [{ objective_ref: "o2", basis: "interpreted", evidence: quote(target) }],
    operations: [{ kind: "identify", evidence: quote(target) }],
    student_decisions: [],
    essential_resources: [{ resource_ref: "story", evidence: quote("al que volvió la exploradora") }],
    conditions: [{ kind: "required_terms", evidence: quote(condition) }],
    evaluation: [{ kind: "accuracy", evidence: quote(condition) }],
    response_format_role: { kind: "access", evidence: quote("Puedes decirlo o escribirlo") },
  };
  return draft;
}

export async function directorFixture(options: {
  draft?: ReturnType<typeof completeOriginal>;
  supports?: FunctionalProfile["supports"];
  authorization?: DirectorInput["authorization"];
  oral?: boolean;
  originalFile?: Uint8Array;
} = {}) {
  const draft = options.draft ?? completeOriginal();
  const original = options.originalFile ?? await pedagogicalOriginalPdf(draft);
  const profile = FunctionalProfileSchema.parse({ ...emptyFunctionalProfile(), schema_version: 3,
    supports: options.supports ?? { decoding_support: "high", planning_support: "high", visual_support: "high" },
    pedagogy: { ...emptyPedagogicalProfile(), response_preferences: options.oral ? ["oral"] : [], areas: [{
      subject: "lengua", reference_grade: null, knows: [], needs: [PRIVATE_STATEMENT],
      abilities: [{ statement: "Inferir una causa y fundamentarla con evidencia textual", autonomy: "independent" }],
    }] },
  });
  const analyzed = await analyzeMaterialFile({
    analyzer: getMaterialAnalyzer(4), file: { kind: "pdf", data: original }, pageCount: 2, teacherContext: {},
    provider: new MockProvider({ fixtures: { material_analysis_v4: () => draft } }),
    selection: { alias: "STANDARD", provider: "mock", model: "directed-analysis-fixture", effort: "medium" },
    maxRepairAttempts: 0, maxOutputTokens: 10_000,
  });
  const input: DirectorInput = { originalSha256: createHash("sha256").update(original).digest("hex"), profile, verifiedSubject: "lengua",
    analysis: analyzed.analysis, education: { stage: "eso", grade: "1-eso" },
    authorization: options.authorization ?? scope,
  };
  return { input, original };
}

export function candidateFor(input: DirectorInput, originalId: string, replacement = false): DirectorActivityProposal {
  const directed = directPedagogy(input);
  if (!directed.ok) throw new Error(directed.code);
  const row = directed.direction.activities.find(({ activity_id }) => activity_id === originalId)!;
  return { activity_id: originalId, decision: replacement ? "substitute" : "keep", retains: row.retains,
    changes: replacement ? [{ kind: "replacement", need: "decoding_support", executor: "short_answer" }] : [],
  };
}

export function readPlannerRequest(request: StructuredRequest) {
  const content = request.messages[0]!.content[0]!;
  if (content.type !== "text") throw new Error("El piloto espera un mensaje de texto");
  return {
    text: content.text,
    direction: JSON.parse(/<direction>\n([^\n]+)\n<\/direction>/u.exec(content.text)![1]!) as {
      request_fingerprint: string;
      activities: Array<{ activity_id: string; changes: Array<{ kind: DirectedPlan["links"][number]["changes"][number] }>; retains: string[] }>;
    },
  };
}

export function echoPlan(request: StructuredRequest): DirectedPlan {
  const { direction } = readPlannerRequest(request);
  return { version: 1, request_fingerprint: direction.request_fingerprint, replacement: null,
    links: direction.activities.map(({ activity_id, changes, retains }) => ({
      original_id: activity_id, result_id: changes.some(({ kind }) => kind === "replacement") ? "ra_1" : activity_id,
      changes: changes.map(({ kind }) => kind), retains,
    })),
  };
}

export function replacementPlan(request: StructuredRequest): DirectedPlan {
  const plan = echoPlan(request);
  plan.replacement = {
    contract: "recreation_plan@v1", scope: { type: "methodological" }, title: "Lectura", reading: null,
    objectives: [{ objective_id: "obj_2", level: "kept", operations: ["identify"] }],
    facts: [], strategies: [{ id: "st_1", method: "segmented_reading", needs: ["decoding_support"], rationale: "Facilita localizar lo que se pide." }],
    activities: [{ id: "ra_1", objective_ids: ["obj_2"], operations: ["identify"], strategy_ids: ["st_1"], visual_ids: [],
      prompt: "Tu compañero busca a la exploradora después de la lluvia. ¿A qué sitio del relato tiene que ir? Menciona el nombre del lugar.",
      steps: [], executor: { kind: "short_answer", lines: 3, starters: [], criteria: ["Menciona el nombre del lugar."] } }],
    visual_requests: [], visuals: [], materials: [], visual_style: "Sobrio",
    explanation: { adapted: ["Pregunta breve", "Lectura íntegra"], why: [{ text: "Facilita el acceso a la consigna.", needs: ["decoding_support"] }],
      how_to_use: ["Consulta el relato.", "Lee la consigna.", "Responde en el espacio."] },
    guide: { per_activity: [{ activity_id: "ra_1", observe: "Comprobar la identificación." }] },
  };
  return plan;
}
