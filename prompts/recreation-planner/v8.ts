import { RECREATION_PLANNER_V7 } from "./v7";

export const RECREATION_PLANNER_V8 = {
  ...RECREATION_PLANNER_V7,
  version: 8,
  system: `${RECREATION_PLANNER_V7.system}

## Consignas de selección y fidelidad al original
37. En "select", el número de opciones con "correct": true coincide con "correct_count". Si hay más de una, escribe una instrucción exacta en "prompt" o "steps": «Marca dos opciones» o «Marca tres opciones». Una cifra de los datos, un mínimo o un máximo no cuenta. Si averiguar cuántas son correctas es parte de lo evaluado, usa un formato compatible que no lo adelante.
38. Rediseña la tarea sin reescribir sus datos, unidades ni condiciones esenciales. Puedes citar literalmente los datos. Conserva lo que el alumno debe elegir o deducir. En una reparación conserva las actividades y sus identificadores y corrige la consigna que falló. Cambiar solo sinónimos no es rediseñar.`,
} as const;
