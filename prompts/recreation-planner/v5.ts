import { RECREATION_PLANNER_V1 } from "./v1";
import { RECREATION_PLANNER_V2 } from "./v2";
import { RECREATION_PLANNER_V4 } from "./v4";
import type { RecreationPlan } from "@/lib/recreation/contract";
import type { RecreationInput } from "@/lib/recreation/input";
import type { PlanIssue } from "@/lib/recreation/verify";
import type { ContentPart } from "@/lib/ai/types";

/**
 * recreation_planner v5 (ADR-054): Claude designs NEW visual supports for this student and these activities; the original's
 * pictures are never reused (the original says WHAT is learnt, not how it looks). OpenAI draws what Claude specifies; Adaptaula's
 * renderer draws everything exact (arrows, numbers, labels, tables) from verified data. Same contract and output; repair as v2.
 * v1–v4 stay unchanged for the adaptations frozen with them.
 */
const EXTRA = `

## Apoyos visuales nuevos (v5)
21. No reutilizas las imágenes del original: el original indica qué se aprende, no cómo se ve la ficha. Diseñas ilustraciones NUEVAS pensadas para este alumno y estas actividades. "original_ref" solo identifica el diagrama del original cuyos datos exactos (rótulos, relaciones) se dibujarán con código; nunca significa «copia este dibujo».
22. Para cada actividad decide si una imagen nueva facilita el aprendizaje según las necesidades del perfil. Si la pides, la petición indica: objetivo pedagógico concreto ("purpose"), actividades que la usan, conceptos que ayuda a comprender, elementos que deben verse ("must_show"), elementos que deben evitarse ("prohibited": respuestas, pistas, detalles que confundan), accesibilidad (contraste, tamaño de las partes, nada solo por color) y el estilo común de "visual_style". Nada decorativo.
23. Una misma imagen puede servir a varias actividades: inclúyelas todas en su "activity_ids" en lugar de pedir otra igual. No pidas dos veces la misma escena.
24. Si una actividad compara situaciones (antes/después, dos ecosistemas, con y sin sequía), pide una escena por situación con el mismo estilo y encuadre. Si clasifica elementos visualmente, pide tarjetas ilustradas con "for_cards". Si predice, la escena muestra la situación de partida sin la consecuencia.
25. Lo exacto no se pide a un generador de imágenes: flechas, números, rótulos, tablas y cadenas alimentarias van en "visuals" (los dibuja el sistema con los rótulos citados del original).
26. Una actividad que pide observar una imagen depende de ella: marca esa petición "essential": true. Si la imagen no se pudiera crear, la ficha no se entrega; no escribas la actividad de modo que funcione «sin mirar».`;

export const RECREATION_PLANNER_V5 = {
  key: "recreation_planner",
  version: 5,
  system: `${RECREATION_PLANNER_V4.system}${EXTRA}`,
  buildUserParts(input: RecreationInput, repairOf?: readonly PlanIssue[], previousPlan?: RecreationPlan): ContentPart[] {
    return RECREATION_PLANNER_V2.buildUserParts(input, repairOf, previousPlan);
  },
  output: RECREATION_PLANNER_V1.output,
} as const;
