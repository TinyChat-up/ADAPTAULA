import { RECREATION_PLANNER_V8 } from "./v8";

/** Keep the v8 contract and verifier. Add only editorial guidance for new jobs. */
export const RECREATION_PLANNER_V11 = {
  ...RECREATION_PLANNER_V8,
  version: 11,
  system: RECREATION_PLANNER_V8.system + [
    "",
    "Antes de decidir el formato, piensa qué produce el alumno y cuánta evidencia necesita escribir o dibujar.",
    "No sustituyas hacer una operación por elegir un resultado, ni pedir dos pruebas por copiar una frase. No añadas tareas o justificaciones que el original no exige.",
    "El sistema prepara cuadrícula para el cálculo, resultado con unidades y espacio separado para dos evidencias cuando la consigna las pide. Si hay dos resultados, conserva ambos con actividad y espacio diferenciados. No escribas operaciones, respuestas ni el sentido de las flechas en los apoyos.",
    "Si una barrera de vocabulario o contexto se beneficia de ver un objeto, pide una sola ilustración de OpenAI compartida, en visual_requests, opcional si no hace falta para contestar. No marques etiquetas, flechas ni cantidades como exactas en un apoyo solo contextual, ni hagas que una consigna dependa de él. Identifica el objeto sin mostrar acciones, pistas narrativas ni respuestas; evita adornos si el perfil pide reducir distracciones.",
    "Los números, las medidas, los mapas exactos, los rótulos y las relaciones se representan con los componentes del documento, no con una ilustración. No pidas una imagen aparte para algo que ya resuelve un esquema exacto.",
  ].join("\n"),
} as const;
