import { z } from "zod";

export const TEACHING_STAGES = ["primaria", "eso", "bachillerato"] as const;
export const STAGE_CHOICES = ["primaria", "eso", "bachillerato", "varias"] as const;
export const START_CHOICES = ["adaptar", "perfil", "explorar"] as const;

export const OnboardingSchema = z.object({
  stage: z.enum(STAGE_CHOICES),
  start: z.enum(START_CHOICES),
});

export type OnboardingInput = z.infer<typeof OnboardingSchema>;

export function stagesFor(choice: OnboardingInput["stage"]): string[] {
  return choice === "varias" ? [...TEACHING_STAGES] : [choice];
}

export const START_DESTINATION: Record<OnboardingInput["start"], string> = {
  adaptar: "/app/adaptar",
  perfil: "/app/alumnos/nuevo",
  explorar: "/app",
};
