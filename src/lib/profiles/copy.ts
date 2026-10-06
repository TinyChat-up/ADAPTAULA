import type { DimensionKey } from "@/lib/schemas/functional-profile";

export interface DimensionCopy {
  /** Wording of the control the teacher sees. */
  control: string;
  /** Phrase used in the "Así se aplicará" summary ("este perfil se beneficia de: …"). */
  summary: string;
  hint?: string;
}

/** Plain-language copy for every dimension. `Record<DimensionKey, …>` makes a missing entry a compile error. */
export const DIMENSION_COPY: Record<DimensionKey, DimensionCopy> = {
  // Lectura
  decoding_support: { control: "Apoyar la decodificación al leer", summary: "apoyo para decodificar al leer", hint: "Palabras difíciles divididas o destacadas." },
  reading_level: { control: "Ajustar el nivel de lectura", summary: "textos con un nivel de lectura más accesible" },
  text_length: { control: "Acortar los textos", summary: "textos más cortos" },
  sentence_length: { control: "Usar frases más cortas", summary: "frases cortas" },
  vocabulary_complexity: { control: "Simplificar el vocabulario", summary: "vocabulario más sencillo" },
  line_spacing: { control: "Más espacio entre líneas", summary: "más interlineado" },
  font_size: { control: "Letra más grande", summary: "letra más grande" },
  emphasis_support: { control: "Resaltar lo esencial", summary: "lo esencial resaltado" },
  reading_chunk_size: { control: "Dividir los textos en partes", summary: "textos divididos en partes" },
  // Comprensión
  literal_language: { control: "Usar un lenguaje literal", summary: "lenguaje literal, sin dobles sentidos" },
  inferential_demand: { control: "Ayudar con las inferencias", summary: "apoyo para inferir lo que no está dicho" },
  background_knowledge_support: { control: "Activar conocimientos previos", summary: "activación de conocimientos previos" },
  key_idea_highlighting: { control: "Destacar las ideas clave", summary: "ideas clave destacadas" },
  recap_frequency: { control: "Incluir resúmenes y repasos", summary: "resúmenes y repasos frecuentes" },
  // Lenguaje
  receptive_language_support: { control: "Apoyar la comprensión del lenguaje", summary: "apoyo para comprender el lenguaje escrito y oral" },
  expressive_language_support: { control: "Apoyar la expresión", summary: "apoyo para expresarse", hint: "Frases de arranque, bancos de palabras…" },
  vocabulary_support: { control: "Explicar el vocabulario nuevo", summary: "vocabulario nuevo explicado" },
  syntax_complexity: { control: "Simplificar la construcción de las frases", summary: "estructuras de frase más sencillas" },
  figurative_language_support: { control: "Explicar el lenguaje figurado", summary: "explicación de metáforas y expresiones" },
  // Atención y organización
  instruction_chunking: { control: "Dividir instrucciones largas en pasos", summary: "instrucciones breves y divididas en pasos" },
  visual_distraction_reduction: { control: "Reducir distracciones visuales", summary: "menos distracciones visuales" },
  number_of_visible_tasks: { control: "Mostrar menos tareas a la vez", summary: "menos tareas visibles a la vez" },
  task_duration: { control: "Acortar la duración de las tareas", summary: "tareas más breves" },
  checklist_support: { control: "Añadir listas de comprobación", summary: "listas para comprobar lo hecho" },
  planning_support: { control: "Ayudar a planificar", summary: "apoyo para planificar el trabajo" },
  working_memory_support: { control: "Aliviar la memoria de trabajo", summary: "menos información que retener a la vez" },
  transition_support: { control: "Facilitar los cambios de tarea", summary: "apoyo en los cambios de tarea" },
  // Matemáticas
  number_sense_support: { control: "Apoyar el sentido numérico", summary: "apoyo en el sentido numérico" },
  worked_examples: { control: "Dar ejemplos resueltos", summary: "ejemplos resueltos antes de tareas nuevas" },
  operation_steps: { control: "Mostrar los pasos de las operaciones", summary: "pasos de las operaciones a la vista" },
  visual_math_support: { control: "Usar representaciones visuales", summary: "representaciones visuales en matemáticas" },
  reduced_copying: { control: "Reducir la copia de enunciados", summary: "menos copia de enunciados" },
  scaffolding_level: { control: "Ofrecer andamiaje", summary: "ayudas graduadas que se retiran poco a poco" },
  // Comunicación y predictibilidad
  explicit_expectations: { control: "Explicar qué se espera", summary: "expectativas explícitas" },
  predictable_structure: { control: "Mantener una estructura predecible", summary: "misma estructura en todas las tareas" },
  transition_signals: { control: "Señalar los cambios de actividad", summary: "avisos de cambio de actividad" },
  ambiguity_reduction: { control: "Evitar ambigüedades", summary: "enunciados sin ambigüedad" },
  visual_schedule: { control: "Mostrar la secuencia de la tarea", summary: "secuencia visual de la tarea" },
  choice_support: { control: "Ayudar a elegir entre opciones", summary: "apoyo para elegir entre opciones" },
  // Sensorial
  visual_density: { control: "Reducir la densidad visual", summary: "menos elementos por página" },
  contrast: { control: "Ajustar el contraste", summary: "contraste ajustado" },
  unnecessary_decoration: { control: "Quitar decoración innecesaria", summary: "sin decoración innecesaria" },
  sensory_triggers: { control: "Evitar estímulos que molestan", summary: "sin estímulos que molesten" },
  color_dependency: { control: "No depender del color", summary: "información que no depende del color" },
  // Visión
  large_print: { control: "Ampliar la letra", summary: "letra ampliada" },
  high_contrast: { control: "Alto contraste", summary: "alto contraste" },
  alt_text: { control: "Describir las imágenes con texto", summary: "imágenes descritas con texto" },
  image_dependency: { control: "No depender de imágenes", summary: "tareas que no dependen de imágenes" },
  spacing: { control: "Más espacio entre elementos", summary: "más espacio entre elementos" },
  screen_reader_compatibility: { control: "Compatible con lector de pantalla", summary: "documento compatible con lector de pantalla" },
  // Audición
  written_instructions: { control: "Dar las instrucciones por escrito", summary: "instrucciones por escrito" },
  visual_support: { control: "Añadir apoyos visuales", summary: "apoyos visuales" },
  transcript_support: { control: "Incluir transcripciones", summary: "transcripciones del material audiovisual" },
  audio_dependency_reduction: { control: "No depender del audio", summary: "tareas que no dependen del audio" },
  // Motricidad
  writing_amount: { control: "Reducir la escritura", summary: "menos escritura" },
  alternative_response: { control: "Permitir otras formas de responder", summary: "otras formas de responder" },
  selection_based_response: { control: "Responder eligiendo", summary: "respuestas por selección" },
  fine_motor_demand: { control: "Reducir la exigencia de motricidad fina", summary: "menor exigencia de motricidad fina" },
  // Regulación
  predictable_feedback: { control: "Dar feedback predecible", summary: "retroalimentación predecible" },
  choice: { control: "Dar la posibilidad de elegir", summary: "posibilidad de elegir" },
  anxiety_reduction: { control: "Reducir la presión ante la tarea", summary: "menos presión ante la tarea" },
  error_tolerance: { control: "Normalizar el error", summary: "tolerancia al error" },
  neutral_language: { control: "Usar un lenguaje neutro", summary: "lenguaje neutro y no amenazante" },
  // Ampliación y reto
  extension_tasks: { control: "Añadir tareas de ampliación", summary: "tareas de ampliación" },
  conceptual_depth: { control: "Aumentar la profundidad conceptual", summary: "mayor profundidad conceptual" },
  reduced_repetition: { control: "Reducir la práctica repetitiva", summary: "menos práctica repetitiva" },
  open_ended_tasks: { control: "Incluir preguntas abiertas", summary: "preguntas abiertas" },
  real_world_connections: { control: "Conectar con el mundo real", summary: "conexiones con el mundo real" },
  autonomous_inquiry: { control: "Proponer investigación autónoma", summary: "investigación autónoma" },
};

export const LEVEL_OPTIONS = [
  { value: "none", label: "Sin adaptación" },
  { value: "low", label: "Algo" },
  { value: "medium", label: "Bastante" },
  { value: "high", label: "Mucho" },
] as const;

export const LEVEL_WORD = { low: "algo", medium: "bastante", high: "mucho" } as const;
