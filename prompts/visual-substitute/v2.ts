import type { AnalysisActivity } from "@/lib/schemas/material-analysis";
import { substitutionFeedback, type SubstitutionRejectionCode } from "@/lib/adaptation/substitution-feedback";
import { VISUAL_SUBSTITUTE_V1 } from "./v1";

/** v1 remains frozen; v2 makes the response contract and the server's bounded correction explicit. No new output schema. */
export const VISUAL_SUBSTITUTE_V2 = {
  ...VISUAL_SUBSTITUTE_V1,
  version: 2,
  system: `${VISUAL_SUBSTITUTE_V1.system}

Contrato de evaluación y corrección:
- Conserva también las condiciones: extensión, mínimos, máximos, justificaciones y demás restricciones de la consigna. No añadas operaciones evaluadas nuevas ni omitas las existentes.
- El servidor solo sabe representar una respuesta escrita o una marca/dibujo sobre la figura. No conviertas elegir opciones, relacionar, ordenar o rellenar huecos en líneas de escritura; si no puedes conservar el formato, responde feasible=false.
- En un segundo intento recibes códigos de validación del servidor: corrige exclusivamente esos problemas, manteniendo el objetivo y las condiciones originales. Un código no permite rebajar una condición ni revelar la respuesta.
- shared_figure_conflict indica que otras actividades ya necesitan la figura compartida; si no puedes dar una propuesta compatible, responde feasible=false.
- Nunca reproduzcas estos códigos en la consigna del alumno. Si la corrección no es posible, responde feasible=false.`,
  buildUserText(input: { stage: string | null; activity: string; objective: string | null; visual: string; responseFormat: AnalysisActivity["response_format"]; rejectionCodes?: readonly SubstitutionRejectionCode[] }): string {
    const json = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
    return `<untrusted_material>\n${json({ etapa: input.stage, consigna_original: input.activity, objetivo: input.objective, imagen_que_no_esta_disponible: input.visual, formato_respuesta_original: input.responseFormat })}\n</untrusted_material>\n<validation_feedback>\n${json(substitutionFeedback(input.rejectionCodes ?? []))}\n</validation_feedback>`;
  },
} as const;
