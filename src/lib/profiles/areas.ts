import { DIMENSIONS, type DimensionGroup, type DimensionKey } from "@/lib/schemas/functional-profile";

export interface ProfileArea {
  id: string;
  label: string;
  description: string;
  /** Schema groups shown under this area; every group belongs to exactly one area. */
  groups: readonly DimensionGroup[];
}

/** Teacher-facing taxonomy. It is deliberately decoupled from the schema's `DIMENSION_GROUPS`. */
export const PROFILE_AREAS = [
  { id: "reading", label: "Lectura", description: "Decodificar, leer con fluidez y manejar textos largos.", groups: ["reading"] },
  { id: "comprehension", label: "Comprensión", description: "Entender ideas, inferir y recordar lo leído.", groups: ["comprehension"] },
  { id: "language", label: "Lenguaje", description: "Vocabulario, construcción de frases y expresión.", groups: ["language"] },
  {
    id: "attention",
    label: "Atención y organización",
    description: "Instrucciones, planificación y gestión de la tarea.",
    groups: ["attention_executive"],
  },
  { id: "math", label: "Matemáticas", description: "Sentido numérico, pasos y representación.", groups: ["math"] },
  {
    id: "communication",
    label: "Comunicación y predictibilidad",
    description: "Expectativas claras y estructura predecible.",
    groups: ["communication"],
  },
  { id: "visual", label: "Acceso visual", description: "Tamaño, contraste y carga de estímulos.", groups: ["vision", "sensory"] },
  { id: "hearing", label: "Acceso auditivo", description: "Información que no dependa del audio.", groups: ["hearing"] },
  { id: "motor", label: "Motricidad y respuesta", description: "Cómo se escribe y cómo se responde.", groups: ["motor"] },
  { id: "emotional", label: "Regulación", description: "Tono, feedback y presión ante la tarea.", groups: ["emotional"] },
  { id: "enrichment", label: "Ampliación y reto", description: "Más profundidad, no más ejercicios.", groups: ["enrichment"] },
] as const satisfies readonly ProfileArea[];

export type ProfileAreaId = (typeof PROFILE_AREAS)[number]["id"];

export type KnownProfileArea = (typeof PROFILE_AREAS)[number];

export function dimensionsOfArea(area: ProfileArea): DimensionKey[] {
  const groups: readonly DimensionGroup[] = area.groups;
  return (Object.keys(DIMENSIONS) as DimensionKey[]).filter((key) => groups.includes(DIMENSIONS[key].group));
}

export function areaOfDimension(key: DimensionKey): KnownProfileArea {
  const area = PROFILE_AREAS.find((a) => (a.groups as readonly DimensionGroup[]).includes(DIMENSIONS[key].group));
  if (!area) throw new Error(`Dimensión sin área: ${key}`);
  return area;
}
