import { RECREATION_PLANNER_V2 } from "./v2";
import { RECREATION_PLANNER_V6 } from "./v6";
import { RecreationPlanV7Schema, type RecreationPlan } from "@/lib/recreation/contract";
import type { RecreationInput } from "@/lib/recreation/input";
import type { PlanIssue } from "@/lib/recreation/verify";
import type { ContentPart } from "@/lib/ai/types";

/**
 * recreation_planner v7 (ADR-059): Claude may design NEW exact schemes («diagrams»: nodes, relations, their evidence and the
 * activities that use each one), not only redraw a picture of the original. Adaptaula draws them with code. v6's rules plus the
 * new resource; v1–v6 stay unchanged for the adaptations frozen with them (their output schema has no `diagrams`).
 */
const EXTRA = `

## Esquemas nuevos que diseñas tú (v7)
32. El original dice qué se aprende, no qué recursos puedes usar. Además de "visuals" (redibujar un esquema que YA existe en una imagen del original, con sus rótulos), puedes diseñar esquemas NUEVOS en "diagrams", aunque el original no tenga ningún dibujo parecido: una cadena alimentaria o de causas, un ciclo, una jerarquía (oración → sujeto y predicado; polígonos → tipos), dos situaciones comparadas en columnas, fracciones equivalentes en cadena…
33. Cada esquema nuevo declara: "layout" ("chain" una cadena de flechas; "cycle" una cadena que vuelve al inicio; "hierarchy" un árbol con una raíz, máximo tres niveles; "groups" columnas comparadas, sin flechas), "title", "purpose", "activity_ids" (las actividades que lo usan: SIEMPRE las que lo nombran), "nodes" (id "n_N", "label" corto, "fact_id" del hecho que lo respalda, "group_id" solo en "groups"), "relations" (from, to, "label" corto o null, "fact_id" del hecho que enuncia esa relación) y "groups" (id "g_N", "label"; vacío si no es "groups").
34. La evidencia es obligatoria y se comprueba: el rótulo de cada nodo aparece en la cita de su hecho y los DOS extremos de cada relación aparecen en la cita del hecho de esa relación. No inventes relaciones: si el original no la dice, no la dibujes. Añade a "facts" (tipo "statement" o el que corresponda) las citas que necesites.
35. Un esquema nunca da la respuesta: si la actividad pregunta qué relación hay entre dos elementos, deja "label" a null en esas flechas; si clasifica, no dibujes los elementos ya repartidos en sus grupos. El sistema lo comprueba.
36. Si una actividad nombra un esquema, flechas o una cadena, ese esquema debe existir en "visuals" o en "diagrams" con esa actividad en su lista. Nunca lo dejes implícito.`;

export const RECREATION_PLANNER_V7 = {
  key: "recreation_planner",
  version: 7,
  system: `${RECREATION_PLANNER_V6.system}${EXTRA}`,
  buildUserParts(input: RecreationInput, repairOf?: readonly PlanIssue[], previousPlan?: RecreationPlan): ContentPart[] {
    return RECREATION_PLANNER_V2.buildUserParts(input, repairOf, previousPlan);
  },
  output: { name: "recreation_plan", schema: RecreationPlanV7Schema, delivery: "prompted" as const },
} as const;
