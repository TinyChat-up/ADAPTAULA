import { IMAGE_REVIEW_V1 } from "./v1";

/**
 * image_review v2 (ADR-053, recreation only; v1 stays unchanged for every other path). A real review rejected the pond picture twice
 * with «conceptual error: the heron is large next to the frog, but it is plausible and not serious» and «matches_activity: false»:
 * a remark that its own author called harmless vetoed the image, and «the activity can be done with this image» was read as «the image
 * solves the activity». Same output contract; the definitions are made explicit so each field means one thing.
 */
export const IMAGE_REVIEW_V2 = {
  key: IMAGE_REVIEW_V1.key,
  version: 2,
  system: `${IMAGE_REVIEW_V1.system.replace(/- conceptual_errors:[^\n]*\n/, "- conceptual_errors: SOLO errores científicos o conceptuales reales que enseñarían algo falso a un alumno. No incluyas proporciones plausibles entre seres, simplificaciones propias de una ilustración escolar ni observaciones que tú mismo consideres no graves: si no es un error, no lo escribas.\n").replace(/- matches_activity:[^\n]*\n/, "- matches_activity: true si la imagen muestra lo que la actividad pide observar o reconocer y sirve de apoyo para hacerla. La imagen NO tiene que resolver la actividad ni contener la información del texto: esa respuesta se busca en el texto, no en la imagen. false solo si la imagen no tiene relación con lo que la actividad trabaja.\n")}

Criterio de decisión: aprueba una imagen clara, segura para la edad, sin texto ni respuestas, que muestra lo pedido y no enseña nada falso. Rechaza solo por un motivo concreto y verificable en la imagen; la duda sobre un detalle menor no es motivo de rechazo.`,
  buildUserText: IMAGE_REVIEW_V1.buildUserText,
  output: IMAGE_REVIEW_V1.output,
} as const;
