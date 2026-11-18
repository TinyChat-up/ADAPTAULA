import { RECREATION_PLANNER_V1 } from "./v1";
import { RECREATION_PLANNER_V2 } from "./v2";
import type { RecreationPlan } from "@/lib/recreation/contract";
import type { RecreationInput } from "@/lib/recreation/input";
import type { PlanIssue } from "@/lib/recreation/verify";
import type { ContentPart } from "@/lib/ai/types";

/**
 * recreation_planner v3 (ADR-053): v1's rules plus the teacher's orientation («approach»: auto, playful, structured), when a game
 * or a manipulative earns its place, and the exactness the server checks (quotes, ids, groups, cards) so a valid design is not lost
 * to a slip. Same contract and output; repair as v2 (the rejected plan + the verifier's issues). v1 and v2 stay unchanged.
 */
const EXTRA = `

## Enfoque y gamificación
11. "approach" de <recreation_context> es la orientación del docente. "auto": decides tú. "playful": prioriza retos, misiones, juegos de clasificación, tarjetas o tableros SOLO donde ayuden a aprender lo que pide el objetivo. "structured": prioriza claridad, pasos explícitos, organizadores y modelos de respuesta. Nunca contradice las necesidades del perfil ni baja la exigencia: si no encaja con una actividad, ignóralo en esa actividad.
12. Sin gamificación ni materiales por defecto: un reto, una tarjeta o un tablero existe porque cumple una función pedagógica (manipular, clasificar, ordenar, comparar, autorregularse). Si no hacen falta, "materials" va vacío. Nada decorativo.
13. Las ilustraciones se integran en las actividades: cada "visual_requests" sirve a una actividad concreta (observar, reconocer, comparar). Para tarjetas recortables de una clasificación puedes pedir una ilustración por tarjeta con "for_cards".

## Exactitud (el servidor lo comprueba)
14. Cada "quote" es un fragmento copiado carácter a carácter de su "source_ref" (sin resumir ni cambiar palabras). Usa fragmentos cortos.
15. Usa solo identificadores que existan: objetivos y fuentes del material, y los ids que tú mismo declaras (st_, rv_, ra_, f_, rm_, vr_). Cada actividad que use un dato lo cita por su id.
16. Un tablero ("sorting_board") lleva como columnas exactamente las etiquetas de los grupos de su actividad de clasificar; las tarjetas de esa actividad son exactamente los "item" de sus datos.
17. La explicación y la guía del docente no dan ninguna respuesta: no digas a qué grupo va un elemento, el orden, la opción correcta ni el resultado.
18. Prefiere menos actividades bien construidas a muchas: cada objetivo y operación del original trabajado al menos una vez.`;

export const RECREATION_PLANNER_V3 = {
  key: "recreation_planner",
  version: 3,
  system: `${RECREATION_PLANNER_V1.system}${EXTRA}`,
  buildUserParts(input: RecreationInput, repairOf?: readonly PlanIssue[], previousPlan?: RecreationPlan): ContentPart[] {
    return RECREATION_PLANNER_V2.buildUserParts(input, repairOf, previousPlan);
  },
  output: RECREATION_PLANNER_V1.output,
} as const;
