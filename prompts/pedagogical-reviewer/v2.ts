import { ReviewerFindingsV2Schema } from "@/lib/schemas/reviewer-findings";
import type { PedagogicalReviewContext } from "@/lib/adaptation/review-context";
import type { ContentPart } from "@/lib/ai/types";
import { PEDAGOGICAL_REVIEWER_V1 } from "./v1";

/**
 * pedagogical_reviewer v2 → ReviewerFindings v2 (etapa 2.3). The same reviewer as v1 for everything v1 judged, plus ONE judgment per
 * support the adaptation added: does it give ACCESS to the task or does it do what the activity evaluates? v1 stays published and
 * unchanged; this version appends the judgment of the supports to its instructions. The server decides what each judgment may change
 * (src/lib/adaptation/support-semantic.ts): the reviewer only observes.
 */

const SUPPORTS = `

## Juicio de los apoyos (versión 2)
Además de los hallazgos anteriores, juzgas CADA apoyo que la adaptación añadió. En "review_context" encuentras:
- "supports": cada apoyo a juzgar, con su "block_id" (su texto está en "document.blocks"), las actividades a las que pertenece ("activity_ids"; vacío si es de toda la ficha), su tipo ("kind") y las necesidades funcionales que atiende ("serves"): ese es el motivo por el que existe.
- "activities": para cada actividad, qué pide ("asks": "explain" explicar o interpretar, "apply" aplicar un procedimiento o un criterio) y qué EVALÚA ("evaluates": los elementos protegidos "prt_N" —su texto está en "protected"— y los objetivos).
- "signals": pistas del sistema sobre algunos apoyos ("codes": avisos mecánicos; "cleared": el sistema lo vio como tarjeta de criterio legítima). Orientan, no deciden: un aviso puede ser una coincidencia y la ausencia de aviso no hace legítimo a un apoyo.

Devuelves "support_judgments": un elemento por cada "block_id" de "review_scope.support_blocks" (o [] si no hay ninguno), con:
- "class": "performs" (el apoyo hace lo que la actividad evalúa), "hints" (facilita la respuesta más de lo que el acceso requiere, sin hacerla), "legitimate" (da acceso, enseña un procedimiento o recuerda un criterio para APLICAR: el alumno sigue haciendo el trabajo evaluado) o "unsure" (no puedes decidirlo; es una respuesta honesta, no "legitimate").
- "how" (si "class" no es "legitimate"): "states_concept" (enuncia el concepto que la actividad pide explicar), "performs_operation" (realiza la operación evaluada), "resolves_item" (resuelve un ítem de la actividad), "assigns_item" (asigna un ítem a su categoría), "gives_result" (da el resultado de lo evaluado), "analogy_of_item" (una analogía o comparación que permite deducir un ítem) u "other".
- "protected_id" (obligatorio si "class" es "performs"): el "prt_N" de lo evaluado que el apoyo sustituye, de la misma actividad. Sin poder señalarlo, no uses "performs".
- "reason": una frase de hasta 120 caracteres con el porqué. Omítela si es "legitimate". Nunca escribas la respuesta ni un texto de reemplazo.

Criterios, en este orden:
1. Facilitar el acceso no es dar la respuesta. Una necesidad funcional alta justifica más apoyo de acceso (vocabulario secundario, recordar un método, preguntas de observación, un ejemplo de otro ámbito); nunca justifica que el apoyo haga lo que la actividad evalúa.
2. Un ejemplo resuelto con otros datos u otro ámbito que muestra un PROCEDIMIENTO es "legitimate", aunque comparta el tipo de problema. Es "performs" ("resolves_item" o "performs_operation") si resuelve un ítem de la actividad o hace prácticamente la misma operación con casi los mismos números o elementos.
3. Una tarjeta que recuerda un criterio para APLICARLO a ítems concretos (qué es un número primo, qué distingue a un ser vivo) es "legitimate" mientras el alumno siga aplicándolo. Deja de serlo solo si asigna ítems concretos ("assigns_item") o da el resultado ("gives_result").
4. Definir lo que una actividad de EXPLICAR o INTERPRETAR pide explicar (por ejemplo, qué significan las flechas de un esquema) es "performs" con "states_concept": el alumno copiaría la definición. Definir el criterio de una actividad de APLICAR no lo es.
5. Una analogía o comparación solo temática es "legitimate". Si permitiría deducir un ítem concreto, "hints" con "analogy_of_item". Nunca es "performs" por ser una analogía.
6. No toda coincidencia conceptual es un error: que un apoyo hable del mismo tema que la actividad no lo hace malo. Sin una razón concreta, no marques problema.
7. Ante la duda entre "performs" y "hints", "hints"; entre "hints" y "legitimate" sin una razón concreta, "legitimate" o "unsure".
No uses "requires_human_review" para estos juicios. Los demás hallazgos se emiten en "findings" como antes.`;

export const PEDAGOGICAL_REVIEWER_V2 = {
  key: "pedagogical_reviewer",
  version: 2,
  schemaVersion: 2,

  system: PEDAGOGICAL_REVIEWER_V1.system + SUPPORTS,

  buildUserParts(input: { reviewContext: PedagogicalReviewContext }): ContentPart[] {
    // `<` and `>` are escaped inside the JSON so that the document text cannot close a block.
    const json = JSON.stringify(input.reviewContext).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
    return [{ type: "text", text: `<review_context>\n${json}\n</review_context>\n\nRevisa esta ficha adaptada siguiendo tus instrucciones. Devuelve únicamente el JSON con tus hallazgos y tus juicios de los apoyos.` }];
  },

  output: { name: "pedagogical_review_findings", schema: ReviewerFindingsV2Schema, delivery: "prompted" as const },
} as const;
