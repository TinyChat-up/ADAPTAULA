import { emptyFunctionalProfile, type FunctionalProfile } from "@/lib/schemas/functional-profile";

/**
 * Fictional profiles A, B and C used by the V2.2 pilots, as data only (dimension levels and one limit). They describe no real
 * learner and carry no diagnosis. A: reading long texts and organising work. B: writing by hand, without reading needs.
 * C: control, nothing assessed (which does not mean that nothing is needed).
 */
const profile = (supports: FunctionalProfile["supports"], extra: Partial<FunctionalProfile> = {}): FunctionalProfile => ({ ...emptyFunctionalProfile(), ...extra, supports });

export const V22_PROFILES = {
  A: profile(
    { reading_chunk_size: "medium", key_idea_highlighting: "low", working_memory_support: "medium", planning_support: "medium", explicit_expectations: "low", vocabulary_complexity: "none", fine_motor_demand: "none", writing_amount: "none" },
    { limits: { max_instruction_words: 15 } },
  ),
  B: profile({ fine_motor_demand: "high", writing_amount: "medium", alternative_response: "low", expressive_language_support: "low", reading_level: "none", text_length: "none", vocabulary_complexity: "none", instruction_chunking: "none" }),
  C: emptyFunctionalProfile(),
} satisfies Record<"A" | "B" | "C", FunctionalProfile>;
