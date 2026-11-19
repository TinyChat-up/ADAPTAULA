import { RECREATION_PLANNER_V1 } from "./v1";
import { RECREATION_PLANNER_V2 } from "./v2";
import { RECREATION_PLANNER_V5 } from "./v5";
import type { RecreationPlan } from "@/lib/recreation/contract";
import type { RecreationInput } from "@/lib/recreation/input";
import type { PlanIssue } from "@/lib/recreation/verify";
import type { ContentPart } from "@/lib/ai/types";

/**
 * recreation_planner v6 (ADR-056): Claude is the pedagogical designer and orchestrator; the system's tools adapt to its design. v5's
 * rules plus: the tools and what they do, that a tool's limit is the system's problem (not a reason to design less), and a way to ask
 * for resources outside the catalog. v1–v5 stay unchanged for the adaptations frozen with them.
 */
const EXTRA = `

## Eres el diseñador; el sistema pone las herramientas (v6)
27. Diseña la adaptación que mejor sirva a este alumno, con libertad metodológica: juegos de clasificación, observación, organizadores, secuencias visuales, lecturas por partes, manipulativos, comparaciones, retos contextualizados, respuestas guiadas, razonamiento y transferencia. Conserva siempre los objetivos, las operaciones cognitivas y la exigencia (alcance metodológico).
28. Describe cada recurso como lo imaginas y de forma natural: puedes escribir «tres ranas», «una escena con una charca llena y otra seca» o «una cadena con flechas». El sistema decide qué herramienta lo fabrica y adapta el encargo a ella; no te autolimites por lo que pueda o no dibujar un generador de imágenes.
29. Herramientas que existen: (a) ilustraciones nuevas de OpenAI (escenas, animales, objetos, conceptos, una por tarjeta; sin texto, números, flechas ni cantidades exactas dentro de la imagen); (b) el renderizador, para todo lo exacto: flechas, relaciones, rótulos, cifras y diagramas (en "visuals", con rótulos citados del original); (c) tarjetas recortables y tableros de clasificación en "materials"; (d) una ilustración y un esquema exacto pueden acompañar a la misma actividad (híbrido: ilustración en "visual_requests" y esquema en "visuals", ambos con esa actividad).
30. Si una actividad depende de una cantidad EXACTA de elementos dibujados (contar ranas, por ejemplo), márcalo en "needs_exact.numbers": hoy no existe esa herramienta. Mejor diseña la tarea con tarjetas (una por elemento) o con la cantidad escrita en el enunciado.
31. Si imaginas un recurso que no encaja en ninguna herramienta, descríbelo en "custom_resources" (título, función, actividades, descripción, "essential"). No lo supondrás hecho: si es imprescindible se te pedirá resolverlo con las herramientas que existen; si no, queda registrado como demanda.`;

export const RECREATION_PLANNER_V6 = {
  key: "recreation_planner",
  version: 6,
  system: `${RECREATION_PLANNER_V5.system}${EXTRA}`,
  buildUserParts(input: RecreationInput, repairOf?: readonly PlanIssue[], previousPlan?: RecreationPlan): ContentPart[] {
    return RECREATION_PLANNER_V2.buildUserParts(input, repairOf, previousPlan);
  },
  output: RECREATION_PLANNER_V1.output,
} as const;
