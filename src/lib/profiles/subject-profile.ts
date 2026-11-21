import "server-only";
import type { FunctionalProfile } from "@/lib/schemas/functional-profile";
import type { ObservedAbility, PedagogicalProfile } from "@/lib/schemas/pedagogical-profile";

/** Internal, not a provider payload. Learning statements are private and untrusted even after validation. */
export interface SubjectProfile {
  version: 1;
  learning: {
    subject: string;
    reference_grade: string | null;
    abilities: ObservedAbility[];
    needs: string[];
  } | null;
  strengths: NonNullable<FunctionalProfile["observations"]>["strengths"];
  barriers: NonNullable<FunctionalProfile["observations"]>["barriers"];
  supports: FunctionalProfile["supports"];
  response_preferences: PedagogicalProfile["response_preferences"];
  short_responses_with_support: true | null;
}

export function profileForSubject(profile: FunctionalProfile, verifiedSubject: string | null): SubjectProfile {
  const area = verifiedSubject ? profile.pedagogy?.areas.find((item) => item.subject === verifiedSubject) : undefined;
  return {
    version: 1,
    learning: area ? {
      subject: area.subject,
      reference_grade: area.reference_grade,
      abilities: [
        ...area.knows.map((statement): ObservedAbility => ({ statement, autonomy: "unassessed" })),
        ...(area.abilities ?? []).map((ability) => ({ ...ability })),
      ],
      needs: [...area.needs],
    } : null,
    strengths: [...(profile.observations?.strengths ?? [])],
    barriers: [...(profile.observations?.barriers ?? [])],
    supports: { ...profile.supports },
    response_preferences: [...(profile.pedagogy?.response_preferences ?? [])],
    short_responses_with_support: profile.pedagogy?.short_responses_with_support ?? null,
  };
}
