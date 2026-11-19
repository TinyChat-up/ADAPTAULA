import { RECREATION_PLANNER_V1 } from "./v1";
import { RECREATION_PLANNER_V2 } from "./v2";
import { RECREATION_PLANNER_V3 } from "./v3";
import type { RecreationPlan } from "@/lib/recreation/contract";
import type { RecreationInput } from "@/lib/recreation/input";
import type { PlanIssue } from "@/lib/recreation/verify";
import type { ContentPart } from "@/lib/ai/types";

/**
 * recreation_planner v4 (ADR-053): v3's rules plus the resources an instruction may mention (a picture, a scheme with arrows, cards, a board only if declared); the teacher's orientation («approach»: auto, playful, structured), when a game
 * or a manipulative earns its place, and the exactness the server checks (quotes, ids, groups, cards) so a valid design is not lost
 * to a slip. Same contract and output; repair as v2 (the rejected plan + the verifier's issues). v1, v2 and v3 stay unchanged.
 */
const EXTRA = `${RECREATION_PLANNER_V3.system.slice(RECREATION_PLANNER_V1.system.length)}

## Recursos que se mencionan
19. Un enunciado o un paso solo habla de una imagen, un esquema, unas flechas, unas tarjetas o un tablero si ese recurso existe: la imagen en "visual_requests" (marca "essential": true si la actividad no se puede hacer sin ella), el esquema con flechas en "visuals" con los rótulos del original, y las tarjetas o el tablero en "materials". Si pides explicar flechas, declara ese esquema; no lo supongas.
20. Las flechas, números y rótulos nunca van en una ilustración: van en un esquema de "visuals".`;
export const RECREATION_PLANNER_V4 = {
  key: "recreation_planner",
  version: 4,
  system: `${RECREATION_PLANNER_V1.system}${EXTRA}`,
  buildUserParts(input: RecreationInput, repairOf?: readonly PlanIssue[], previousPlan?: RecreationPlan): ContentPart[] {
    return RECREATION_PLANNER_V2.buildUserParts(input, repairOf, previousPlan);
  },
  output: RECREATION_PLANNER_V1.output,
} as const;
