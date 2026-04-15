// ============================================================
// ESPECIFICACIÓN PEDAGÓGICA COMPLETA — AdaptAula v2
// Etapa: Primaria baja (1º-3º, 6-9 años)
// Base normativa: UNE 153101:2018 EX (Lectura Fácil)
//                 Inclusion Europe "Information for All"
//                 BDA Style Guide 2023 (Dislexia)
//                 Guía TEL — Hospital Sant Joan de Déu
//                 Fundación CADAH (TDAH)
//                 ARASAAC / metodología TEACCH (TEA)
// ============================================================

export type LearningProfile =
  | "tea"       // Trastorno del Espectro Autista
  | "tel"       // Trastorno Específico del Lenguaje
  | "dislexia"  // Dislexia / Dificultad lectora
  | "di"        // Discapacidad intelectual leve o moderada
  | "tdah"      // TDAH
  | "retraso";  // Retraso madurativo general

export type AdaptationLevel =
  | "ligero"    // Mejora visual y claridad, estructura casi igual
  | "guiado"    // Simplificación real, pasos, apoyos visuales
  | "funcional";// Reorganización completa, reducción de cantidad

export type SupportLevel =
  | "bajo"      // Pocos apoyos añadidos
  | "medio"     // Apoyo visual y estructural moderado
  | "alto";     // Máxima mediación, máximo andamiaje

export interface AdaptationConfig {
  learningProfile: LearningProfile;
  adaptationLevel: AdaptationLevel;
  supportLevel: SupportLevel;
  selectedStyleId?: string | null;
  studentInterests?: string[];
}


// ─── Compatibilidad con el formulario anterior ────────────────────────────────
export function buildAdaptationConfigFromSimpleControls(params: {
  need: string;
  adaptationType: string;
  level: string;
  selectedStyleId?: string | null;
  studentInterests?: string[];
}): AdaptationConfig {
  const profileMap: Record<string, LearningProfile> = {
    "TEA con apoyo visual": "tea",
    "Apoyo visual": "tea",
    "TEL": "tel",
    "Dificultad lectora": "dislexia",
    "Discapacidad intelectual": "di",
    "Menos carga, más claridad": "di",
    "Iniciación a lectoescritura": "retraso",
    "Escritura guiada": "retraso",
    "Simplificación lectora": "dislexia",
    "Trabajo autónomo": "tdah",
  };
  const levelMap: Record<string, AdaptationLevel> = {
    "alto": "funcional",
    "medio": "guiado",
    "bajo": "ligero",
  };
  const supportMap: Record<string, SupportLevel> = {
    "alto": "alto",
    "medio": "medio",
    "bajo": "bajo",
  };
  return {
    learningProfile: profileMap[params.need] ?? "di",
    adaptationLevel: levelMap[params.level] ?? "guiado",
    supportLevel: supportMap[params.level] ?? "medio",
    selectedStyleId: params.selectedStyleId ?? null,
    studentInterests: params.studentInterests ?? [],
  };
}

// ─── Métricas de escritura según perfil y apoyo ───────────────────────────────
// Valores basados en recomendaciones de la BDA Style Guide 2023
// y guías de intervención logopédica para Primaria baja
export function getWritingMetrics(config: AdaptationConfig): {
  lineHeight: string;
  boxMinHeight: string;
  fontSize: string;
  lineSpacing: string;
} {
  const needsExtraSpace =
    config.learningProfile === "tea" ||
    config.learningProfile === "di" ||
    config.learningProfile === "retraso";

  if (config.supportLevel === "alto" || needsExtraSpace) {
    return {
      lineHeight: "52px",
      boxMinHeight: "120px",
      fontSize: config.learningProfile === "di" ? "19px" : "17px",
      lineSpacing: "52px",
    };
  }
  if (config.supportLevel === "medio") {
    return {
      lineHeight: "44px",
      boxMinHeight: "96px",
      fontSize: config.learningProfile === "dislexia" ? "19px" : "16px",
      lineSpacing: "44px",
    };
  }
  return {
    lineHeight: "36px",
    boxMinHeight: "72px",
    fontSize: config.learningProfile === "dislexia" ? "19px" : "15px",
    lineSpacing: "36px",
  };
}

export function getMaxActivitiesPerPage(supportLevel: SupportLevel): number {
  if (supportLevel === "alto") return 1;
  if (supportLevel === "medio") return 2;
  return 3;
}

export function getResponseBoxSize(config: AdaptationConfig): "small" | "medium" | "large" {
  if (config.supportLevel === "alto") return "large";
  if (config.supportLevel === "medio") return "medium";
  return "small";
}

export function getPictogramDensity(config: AdaptationConfig): "low" | "medium" | "high" {
  if (
    config.supportLevel === "alto" ||
    config.learningProfile === "tea" ||
    config.learningProfile === "di"
  ) return "high";
  if (config.supportLevel === "medio") return "medium";
  return "low";
}

// ─── Reglas pedagógicas por perfil ───────────────────────────────────────────
// Basadas en: UNE 153101:2018 EX, guías clínicas españolas, TEACCH, BDA, CADAH

const PROFILE_RULES: Record<LearningProfile, string> = {

  tea: `
PERFIL TEA — Trastorno del Espectro Autista (TEACCH + UNE 153101)
Necesidad central: predictibilidad, literalidad total, ausencia de ambigüedad.

LENGUAJE (máxima prioridad):
- Frases de máximo 8 palabras. Una sola idea por frase.
- Una instrucción por paso. Nunca dobles consignas ("Lee y responde" → dos pasos separados).
- Lenguaje 100% literal y directo.
- PROHIBIDO: metáforas, ironías, refranes, expresiones figuradas, preguntas retóricas, deícticos sin referente explícito ("esto", "aquello" → repetir siempre el sustantivo).
- Si hay palabra nueva: explicar inmediatamente con una frase corta y concreta.
- Mismo vocabulario para el mismo concepto en todo el documento (sin sinónimos).

ESTRUCTURA:
- Orden fijo siempre: instrucción → ejemplo → espacio de respuesta.
- Instrucciones en imperativo directo: "Escribe", "Rodea", "Une".
- Pasos numerados visibles en toda actividad con más de una acción.
- Sin cambios de formato entre actividades (previsibilidad máxima).
- Preguntas cerradas o semicerradas siempre que sea posible.

APOYOS VISUALES:
- Pictograma obligatorio en verbos de instrucción (lee, escribe, rodea, une, completa).
- Pictograma en sustantivos concretos del texto (flor, árbol, libro).
- Fondo neutro (#FAFAF5). Sin patrones ni decoración innecesaria.
- Borde de color visible en cada bloque para delimitar claramente.
`.trim(),

  tel: `
PERFIL TEL — Trastorno Específico del Lenguaje (Guía TEL Galicia / AELFA)
Necesidad central: reducir complejidad morfosintáctica y longitud de procesamiento.

LENGUAJE:
- Frases de máximo 8 palabras (1er ciclo) o 10 palabras (2º ciclo).
- Solo oraciones simples (Sujeto + Verbo + Complemento).
- Coordinadas simples con "y" o "pero" únicamente.
- PROHIBIDO: subordinadas de relativo, causales, condicionales complejas.
- Conectores permitidos: "y", "pero", "también", "luego", "después", "porque".
- Conectores prohibidos: "sin embargo", "no obstante", "aunque", "a pesar de".
- Preferir palabras de 2-3 sílabas. Evitar palabras de más de 4 sílabas si hay alternativa.
- Si hay término nuevo: definir inmediatamente con formato "palabra = explicación simple".
- Usar sustantivos explícitos, nunca pronombres ambiguos.

ESTRUCTURA:
- No exigir producción escrita larga como primera respuesta.
- Antes de preguntas abiertas: incluir actividades de apoyo (completar, elegir).
- Dividir actividades largas en sub-pasos numerados con espacio de respuesta propio.

APOYOS VISUALES:
- Pictogramas en palabras clave del texto y verbos de instrucción.
- Ejemplo resuelto antes de cada actividad de producción escrita.
- Interlineado mínimo 1.9 (la letra suele ser más grande por esfuerzo motor).
`.trim(),

  dislexia: `
PERFIL DISLEXIA — Dificultad lectora (BDA Style Guide 2023 + UNE 153101)
Necesidad central: reducir el esfuerzo de decodificación visual y fonológica.

LENGUAJE:
- Frases de máximo 12-14 palabras.
- Máximo 3 frases por párrafo, con espacio generoso entre ellos.
- Evitar palabras con combinaciones difíciles (br, dr, tr, pl) cuando haya alternativa más simple.
- PROHIBIDO: subrayado (confunde con texto base), cursiva (las letras "corren juntas"), MAYÚSCULAS CONTINUAS (impide el reconocimiento de forma de palabras).
- Usar negrita para énfasis: es la única forma aceptable de destacar.
- Mismo vocabulario para el mismo concepto (sin sinónimos que aumenten carga fonológica).

TIPOGRAFÍA Y ESPACIADO (el CSS ya lo aplica automáticamente):
- Fuente: OpenDyslexic o Arial (sans-serif con caracteres bien diferenciados).
- Tamaño mínimo: 19px.
- Interlineado: mínimo 1.9 (150% reduce el "saltar de línea").
- Espaciado entre letras: 0.05em (reduce el efecto crowding).
- Espaciado entre palabras: 0.16em.
- Máximo 65 caracteres por línea (rastreo visual más corto).
- Alineación izquierda SIEMPRE. El justificado produce "efecto río".
- Fondo crema (#FFF8E7): el blanco puro resulta deslumbrante.

ESTRUCTURA:
- Texto dividido en fragmentos pequeños con espacio entre ellos.
- Preguntas después de cada fragmento, no todas al final.
- Actividades de comprensión con apoyo: subrayar, rodear, unir con flechas.
`.trim(),

  di: `
PERFIL DI — Discapacidad Intelectual leve/moderada (UNE 153101 Nivel I-II + Método Troncoso)
Necesidad central: máxima concreción, vocabulario controlado, andamiaje intenso.

DI LEVE (CI 55-70) — Nivel II IFLA:
- Frases de 8-12 palabras máximo. Solo vocabulario A1-A2 (palabras del entorno cotidiano).
- Un pictograma cada 2-3 frases como apoyo a la comprensión.
- Estructura cronológica estricta (antes → durante → después).
- Solo contenido concreto-funcional. Acompañar todo concepto abstracto con imagen.
- Jerarquía máxima: 3 niveles de título.
- Ejemplo resuelto obligatorio antes de cada tipo de actividad nuevo.

DI MODERADA (CI 35-55) — Nivel I IFLA (pictograma como canal principal):
- Frases de 3-6 palabras. Vocabulario de 100-300 palabras básicas.
- 1 pictograma por frase o palabra clave. El pictograma es el canal principal.
- Layout: pictograma centrado arriba + texto corto debajo (inversión respecto a DI leve).
- Solo concreto-observable. Las emociones solo con pictogramas de caras.
- Máximo 2-3 frases por bloque.
- Mediador humano siempre presente (incluir nota para el mediador en teacher_notes).

INSTRUCCIONES (ambos niveles):
- Una sola acción por instrucción. Nunca dos verbos.
- Formato preferido: completar, rodear, unir, señalar.
- Evitar preguntas abiertas sin inicio de respuesta dado.
- Una actividad por página si el apoyo es alto.
`.trim(),

  tdah: `
PERFIL TDAH — Déficit de Atención e Hiperactividad (Fundación CADAH)
Necesidad central: fragmentar, estructurar, motivar, reducir esfuerzo atencional.

LENGUAJE:
- Frases cortas y directas. Instrucciones muy claras y visibles.
- Resaltar en negrita solo las palabras o instrucciones más importantes (máx. 2-3 por actividad).
- Evitar textos de lectura largos sin interrupción visual.

ESTRUCTURA — CHUNKING (crítico):
- Bloques de 3-5 frases máximo antes de cambio de tarea.
- Máximo 50-100 palabras por bloque antes de pausa o cambio.
- Cada actividad debe parecer autónoma y terminable en 5-10 minutos.
- Alternar tipos de actividad (no todas iguales seguidas).
- Poner recordatorio de instrucción al inicio de cada actividad.
- Si hay múltiples actividades: indicar el total al principio ("Son 4 actividades").

ENGAGEMENT Y MOTIVACIÓN:
- Checkpoint de completado al final de cada actividad ("He terminado ✓").
- 1 color de borde por sección/tema para orientación visual rápida.
- Codificación visual por colores: cada sección tiene su color identificador.

APOYOS VISUALES:
- Separación muy clara entre actividades (espacio en blanco generoso).
- Numeración muy visible. El alumno necesita saber dónde está en todo momento.
- Instrucciones en recuadro destacado, no mezcladas con el contenido.
- Márgenes amplios. Interlineado mínimo 1.5.
`.trim(),

  retraso: `
PERFIL RETRASO MADURATIVO — Desfase evolutivo temporal (1-2 cursos)
Necesidad central: adaptar al nivel de desarrollo real, no al cronológico. Carácter TEMPORAL.

LENGUAJE:
- Frases de 6-10 palabras. Vocabulario de alta frecuencia con introducción gradual de palabras nuevas.
- Estructuras gramaticales de 1-2 cursos por debajo del grupo.
- Instrucciones directas y breves.
- Explicar términos que el grupo ya domina pero este alumno puede no conocer.

ESTRUCTURA:
- Mantener los objetivos curriculares del grupo. Reducir la exigencia de producción, no el contenido.
- Actividades de formato accesible: completar, rodear, unir, ordenar.
- Ejemplos resueltos. Guiar el inicio de las respuestas abiertas.
- Espacios de escritura generosos (escritura en proceso de afianzamiento).
- Estructura muy predecible entre actividades.

CARÁCTER TEMPORAL — IMPORTANTE:
- Los apoyos son temporales y deben retirarse progresivamente (andamiaje decreciente).
- Reevaluar cada trimestre.
- Incluir en teacher_notes una nota sobre la evolución esperada y cuándo reducir apoyos.

APOYOS VISUALES:
- Pictogramas en instrucciones y palabras clave. Ir retirando progresivamente.
- Subtítulos y separaciones visuales para orientarse en el documento.
`.trim(),

};

// ─── Reglas por nivel de adaptación ──────────────────────────────────────────

const LEVEL_RULES: Record<AdaptationLevel, string> = {
  ligero: `
NIVEL LIGERO
- Mantener casi toda la estructura y contenido original.
- Mejorar solo: claridad visual, separación entre bloques, legibilidad del texto.
- Simplificar frases solo si son claramente complejas para el perfil.
- No eliminar ni reordenar actividades. No cambiar el tipo de actividad.
`.trim(),

  guiado: `
NIVEL GUIADO
- Simplificar el lenguaje del texto y de las instrucciones.
- Dividir actividades complejas en pasos numerados.
- Añadir apoyo visual moderado (pictogramas en palabras clave, ejemplos).
- Se puede reordenar ligeramente para mejorar la secuencia.
- Se pueden añadir sub-preguntas si una pregunta original es muy amplia.
`.trim(),

  funcional: `
NIVEL FUNCIONAL
- Priorizar autonomía y comprensión real sobre fidelidad al original.
- Reducir cantidad de actividades si es necesario (mantener las más esenciales).
- Reorganizar el contenido en el orden más accesible para el perfil.
- Transformar el tipo de actividad si el original no es accesible.
- El objetivo curricular esencial debe mantenerse siempre.
`.trim(),
};

// ─── Reglas por grado de apoyo ────────────────────────────────────────────────

const SUPPORT_RULES: Record<SupportLevel, string> = {
  bajo: `
APOYO BAJO
- El alumno trabaja con relativa autonomía. No sobreandamiar.
- Mejorar claridad sin añadir demasiados elementos nuevos.
- Espacios de respuesta normales.
`.trim(),

  medio: `
APOYO MEDIO
- Añadir ejemplos resueltos antes de actividades nuevas.
- Segmentar instrucciones en pasos si tienen más de una acción.
- Espacios de respuesta generosos con líneas de guía visibles.
- Pictogramas en palabras clave del texto y verbos de instrucción.
`.trim(),

  alto: `
APOYO ALTO
- Máxima mediación: cada actividad tiene instrucción + ejemplo + espacio guiado.
- Inicios de frase dados para respuestas abiertas (ej: "Abril tiene... días").
- Respuestas de elección siempre que sea posible (rodear, marcar, unir).
- Espacios de escritura muy generosos. Una actividad por bloque visual.
- Pictogramas en todas las instrucciones y palabras clave posibles.
- Casilla de completado al final de cada actividad.
`.trim(),
};

// ─── Nuevos tipos para el formulario simplificado ────────────────────────────

export type Subject = "lengua" | "matematicas" | "naturales" | "ingles" | "otra";

export type AdaptationType = "pictogramas" | "simplificar" | "autonomia";

export type SupportDegree = "leve" | "medio" | "alto";

// Mapeo del nuevo formulario al sistema interno
export function buildConfigFromForm(params: {
  subject: Subject;
  adaptationType: AdaptationType;
  supportDegree: SupportDegree;
  studentInterests: string[];
}): AdaptationConfig {
  const profileFromType: Record<AdaptationType, AdaptationConfig["learningProfile"]> = {
    pictogramas: "tea",
    simplificar: "dislexia",
    autonomia:   "tdah",
  };
  const levelFromDegree: Record<SupportDegree, AdaptationConfig["adaptationLevel"]> = {
    leve:  "ligero",
    medio: "guiado",
    alto:  "funcional",
  };
  const supportFromDegree: Record<SupportDegree, AdaptationConfig["supportLevel"]> = {
    leve:  "bajo",
    medio: "medio",
    alto:  "alto",
  };
  return {
    learningProfile: profileFromType[params.adaptationType],
    adaptationLevel: levelFromDegree[params.supportDegree],
    supportLevel:    supportFromDegree[params.supportDegree],
    studentInterests: params.studentInterests,
  };
}

// ─── Reglas específicas por asignatura ───────────────────────────────────────

export const SUBJECT_RULES: Record<Subject, string> = {

  lengua: `
ASIGNATURA: LENGUA
- Adaptar textos de comprensión lectora manteniendo el hilo narrativo.
- Simplificar vocabulario sin perder el significado esencial.
- En escritura: dar modelos o inicios de frase si el apoyo es medio/alto.
- En gramática: usar ejemplos concretos con objetos del entorno del alumno.
- En dictados o copias: reducir la longitud, mantener las palabras clave.
`.trim(),

  matematicas: `
ASIGNATURA: MATEMÁTICAS — REGLAS CRÍTICAS DE ADAPTACIÓN

PRINCIPIO FUNDAMENTAL:
Adaptar el ACCESO, nunca el CONTENIDO matemático.
Nunca cambiar números, operaciones ni nivel de dificultad.

ESTRUCTURA OBLIGATORIA POR TIPO DE CONTENIDO:

1. ECUACIONES Y OPERACIONES PURAS (sin contexto de problema):
   - Cada ecuación: <div class="aa-equation-block">2x + 5 = 17</div>
   - Espacio de desarrollo: <div class="aa-calc-box"></div>
   - Línea de solución: <div class="aa-solution-line"><div class="aa-solution-blank"></div></div>
   - Incluir ejemplo resuelto paso a paso antes de cada bloque nuevo
   - NUNCA añadir pictogramas en ecuaciones abstractas (x², 2x+5=17, etc.)
   - Máximo 10 ecuaciones por bloque visual, luego separador

2. PROBLEMAS CON CONTEXTO (enunciados con objetos reales):
   Estructura OBLIGATORIA para cada problema:
   <div class="aa-block aa-activity">
     <p class="aa-instruction">[enunciado adaptado]</p>
     <div class="aa-example">
       DATOS: [espacio]
       OPERACIÓN: [espacio]
       RESULTADO: [espacio]
     </div>
   </div>
   - Pictogramas SOLO si el perfil es TEA o DI Y el objeto existe en ARASAAC
   - Si perfil es dislexia o TDAH: estructura visual clara SIN pictogramas

3. RECORDATORIOS Y FÓRMULAS:
   - Presentar en caja destacada aa-example
   - Fórmula en línea propia, bien espaciada
   - Nunca en párrafo corrido

NUNCA:
- Cambiar los números del enunciado original
- Simplificar x² a x ni operaciones de segundo grado a primero
- Añadir pictogramas en ecuaciones abstractas (solo en objetos reales de problemas)
- Mezclar ecuaciones de distintos tipos en el mismo bloque visual
`.trim(),

  naturales: `
ASIGNATURA: CONOCIMIENTO DEL MEDIO / NATURALES
- Organizar el contenido en bloques temáticos con subtítulos claros.
- Usar esquemas sencillos en lugar de párrafos densos cuando sea posible.
- Los conceptos científicos se explican con ejemplos del entorno del alumno.
- Pictogramas especialmente útiles: animales, plantas, partes del cuerpo, fenómenos naturales.
- En actividades de clasificación: usar tablas o listas visuales.
- Mantener la terminología científica básica pero explicarla siempre.
`.trim(),

  ingles: `
ASIGNATURA: INGLÉS
- Mantener el inglés en el contenido. No traducir al español el texto a adaptar.
- Simplificar las instrucciones de actividades (pueden estar en español si apoyo es alto).
- Reducir la longitud de textos en inglés manteniendo el vocabulario objetivo.
- Vocabulario: palabra en inglés + pictograma si está disponible.
- En gramática: dar el modelo de la estructura claramente antes de los ejercicios.
- Espacios de escritura generosos (el alumno escribe en inglés, necesita más espacio).
`.trim(),

  otra: `
ASIGNATURA: GENERAL
- Adaptar el contenido manteniendo los objetivos curriculares esenciales.
- Aplicar las reglas de perfil y nivel de apoyo seleccionados.
`.trim(),

};

// ─── Intereses del alumno ─────────────────────────────────────────────────────

export const POPULAR_INTERESTS = [
  "Pokémon", "Minecraft", "Fútbol", "Dinosaurios", "Princesas",
  "Superhéroes", "Animales", "Coches", "Música", "Espacio",
  "Unicornios", "Artes marciales",
];

export function buildInterestsBlock(interests: string[]): string {
  if (!interests || interests.length === 0) return "";
  return `
INTERESES DEL ALUMNO — USA SOLO EN EJEMPLOS Y CONTEXTOS (nunca en el contenido principal)
Intereses: ${interests.join(", ")}.

CÓMO USARLOS (reglas estrictas):
✓ Sustituir personajes genéricos por personajes de su interés en los EJEMPLOS.
  "Si tienes 3 manzanas..." → "Si Pikachu tiene 3 pociones..."
✓ Usar objetos de su interés como elementos de conteo o comparación.
✓ Contextualizar una actividad en su mundo si encaja naturalmente.

NUNCA:
✗ Cambiar el objetivo de aprendizaje por introducir el interés.
✗ Convertir todo el documento en una temática del interés.
✗ Forzar el interés donde no encaje naturalmente.
`.trim();
}

// ─── Función principal: genera el bloque de reglas para el prompt ─────────────

export function buildDynamicAdaptationRules(config: AdaptationConfig): string {
  const base = `
PRINCIPIOS BASE UNE 153101:2018 EX (siempre obligatorios)
- Una idea por frase. Cada frase empieza en línea nueva cuando sea posible.
- Orden natural: sujeto + verbo + predicado.
- Evitar: voz pasiva, gerundios de instrucción, subjuntivo, doble negación.
- Evitar: metáforas, ironía, refranes, puntos suspensivos, punto y coma.
- Misma palabra para el mismo concepto en todo el documento (sin sinónimos).
- Adaptar el ACCESO al contenido, no vaciarlo. El alumno trabaja los mismos objetivos.
- No infantilizar el lenguaje ni el diseño.
- No sobredecorar. Cada elemento visual tiene una función pedagógica.
- El documento debe parecer una ficha escolar profesional, no un cuento.
`.trim();

  const decisionOrder = `
ORDEN DE DECISIÓN ANTE CADA ACTIVIDAD DIFÍCIL
Aplica en este orden hasta que la actividad sea accesible:
1. Simplificar el lenguaje de la instrucción
2. Añadir un pictograma o apoyo visual
3. Dividir en pasos numerados
4. Añadir un ejemplo resuelto
5. Reducir la cantidad (no el objetivo)
6. Dar inicio de respuesta o respuesta guiada
7. Transformar el formato (último recurso)
`.trim();

  return [
    base,
    PROFILE_RULES[config.learningProfile],
    LEVEL_RULES[config.adaptationLevel],
    SUPPORT_RULES[config.supportLevel],
    decisionOrder,
  ]
    .filter(Boolean)
    .join("\n\n");
}
