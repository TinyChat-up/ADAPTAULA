import type { CONFLICT_KEYS } from "@/lib/schemas/adaptation-context";
import type { ReviewFlag } from "@/lib/schemas/adaptation-plan";
import type { AdaptationType } from "@/lib/schemas/adaptation-type";
import { emptyFunctionalProfile, type FunctionalProfile } from "@/lib/schemas/functional-profile";
import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";
import type { ReviewCheck } from "@/lib/schemas/pedagogical-review";
import { argumentationAnalysis, fractionsAnalysis, geographyAnalysis } from "./fixtures";

/**
 * Functional profiles (dimensions only, as the product stores them) and the scenarios of the offline adaptation eval.
 * Names describe needs, never diagnoses. Expectations are about preserving what is taught and meeting the need, not about
 * how the sheet looks.
 */

const profile = (supports: FunctionalProfile["supports"], extra: Partial<FunctionalProfile> = {}): FunctionalProfile => ({ ...emptyFunctionalProfile(), ...extra, supports });

export const PROFILES = {
  reading: profile({ decoding_support: "high", reading_chunk_size: "high", text_length: "medium", sentence_length: "medium", line_spacing: "high", font_size: "medium", vocabulary_support: "medium", reduced_copying: "medium", instruction_chunking: "medium" }),
  executive: profile(
    { instruction_chunking: "high", number_of_visible_tasks: "high", checklist_support: "high", planning_support: "medium", working_memory_support: "medium", visual_distraction_reduction: "medium" },
    { limits: { max_visible_tasks: 3 } },
  ),
  language: profile({ receptive_language_support: "high", vocabulary_support: "high", syntax_complexity: "medium", sentence_length: "medium", expressive_language_support: "medium" }),
  visualLoad: profile({ visual_density: "high", unnecessary_decoration: "high", visual_distraction_reduction: "medium", visual_support: "medium" }),
  writingReduction: profile({ writing_amount: "high", fine_motor_demand: "high", alternative_response: "medium" }, { allowances: { keyboard: true } }),
  readingVsSource: profile({ text_length: "high", reading_level: "medium", writing_amount: "high" }),
  extension: profile({ extension_tasks: "high", conceptual_depth: "high", open_ended_tasks: "medium" }),
} satisfies Record<string, FunctionalProfile>;

export interface AdaptationScenario {
  id: string;
  title: string;
  analysis: () => MaterialAnalysis;
  profile: FunctionalProfile;
  adaptationType: AdaptationType;
  expect: {
    conflicts?: Array<(typeof CONFLICT_KEYS)[number]>;
    /** Flags the plan validator must raise (as block or review) for the mock plan. */
    planFlags?: ReviewFlag[];
    /** Checks that must not FAIL in the mock pipeline's review. */
    mustNotFail: ReviewCheck[];
  };
}

const CORE: ReviewCheck[] = ["objectives_preserved", "protected_elements_preserved", "answers_not_leaked", "required_data_preserved", "instructions_complete", "constraints_preserved", "response_format_appropriate", "traceability_complete", "no_infantilization"];

export const SCENARIOS: AdaptationScenario[] = [
  { id: "primaria-fracciones-lectura", title: "Primaria · fracciones · lectura", analysis: fractionsAnalysis, profile: PROFILES.reading, adaptationType: "accessibility", expect: { mustNotFail: CORE } },
  { id: "primaria-fracciones-carga-visual", title: "Primaria · fracciones · carga visual", analysis: fractionsAnalysis, profile: PROFILES.visualLoad, adaptationType: "accessibility", expect: { conflicts: ["added_visuals_vs_visual_load"], mustNotFail: CORE } },
  { id: "eso-geografia-ejecutivas", title: "ESO · geografía · funciones ejecutivas", analysis: geographyAnalysis, profile: PROFILES.executive, adaptationType: "methodological", expect: { conflicts: ["segmentation_vs_integrated_product"], mustNotFail: CORE } },
  { id: "eso-geografia-lenguaje", title: "ESO · geografía · lenguaje", analysis: geographyAnalysis, profile: PROFILES.language, adaptationType: "linguistic", expect: { mustNotFail: CORE } },
  { id: "eso-geografia-escritura", title: "ESO · geografía · reducción de escritura", analysis: geographyAnalysis, profile: PROFILES.writingReduction, adaptationType: "accessibility", expect: { conflicts: ["writing_reduction_vs_evaluated_writing"], mustNotFail: CORE } },
  { id: "bach-argumentacion-lectura", title: "Bachillerato · argumentación · lectura", analysis: argumentationAnalysis, profile: PROFILES.reading, adaptationType: "accessibility", expect: { conflicts: ["reading_load_vs_literal_text"], mustNotFail: CORE } },
  { id: "bach-argumentacion-conflicto", title: "Bachillerato · conflicto apoyo/objetivo", analysis: argumentationAnalysis, profile: PROFILES.readingVsSource, adaptationType: "accessibility", expect: { conflicts: ["reading_load_vs_literal_text", "writing_reduction_vs_evaluated_writing"], mustNotFail: CORE } },
  { id: "bach-argumentacion-ampliacion", title: "Bachillerato · ampliación y reto", analysis: argumentationAnalysis, profile: PROFILES.extension, adaptationType: "enrichment", expect: { mustNotFail: CORE } },
];
