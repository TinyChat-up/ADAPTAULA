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

// AdaptationType se mantiene por compatibilidad con la API, pero ya no determina el perfil NEE.
// El perfil NEE llega directamente desde el formulario como campo independiente.
export type AdaptationType = "pictogramas" | "simplificar" | "autonomia";

export type SupportDegree = "leve" | "medio" | "alto";

// Mapeo del nuevo formulario al sistema interno.
// CORRECCIÓN CRÍTICA: el perfil NEE llega directamente como parámetro `learningProfile`.
// Ya no se deriva de adaptationType — ese mapeo causaba que TEL, DI y Retraso recibieran
// reglas de dislexia o TEA en lugar de sus propias reglas clínicas.
export function buildConfigFromForm(params: {
  subject: Subject;
  learningProfile: LearningProfile;   // ← perfil directo desde el formulario
  supportDegree: SupportDegree;
  studentInterests: string[];
}): AdaptationConfig {
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
    learningProfile:  params.learningProfile,
    adaptationLevel:  levelFromDegree[params.supportDegree],
    supportLevel:     supportFromDegree[params.supportDegree],
    studentInterests: params.studentInterests,
  };
}

// ─── Reglas específicas por asignatura ───────────────────────────────────────

export const SUBJECT_RULES: Record<Subject, string> = {

  lengua: `
ASIGNATURA: LENGUA CASTELLANA
Base normativa: UNE 153101:2018 EX · niveles MCER Instituto Cervantes

TEXTOS DE COMPRENSIÓN LECTORA:
- Dividir en fragmentos de máximo 3-4 líneas con subtítulo propio.
- Preguntas SIEMPRE en el mismo orden en que aparecen las respuestas en el texto.
- Tres niveles de Barrett escalados por perfil:
  · Literal (todas las preguntas): ¿Qué dice el texto? Localizar la respuesta directa.
  · Inferencial (solo en perfiles con mayor capacidad): ¿Qué quiere decir? ¿Por qué?
  · Crítico (opcional en DI y TEL grave): ¿Qué opinas? ¿Estás de acuerdo?
- Tipos de pregunta por perfil:
  · DI / TEL: V-F con pictograma + opción múltiple 3 respuestas + unir con flechas.
  · Dislexia / TDAH: opción múltiple 4 respuestas + completar huecos con banco de palabras.
  · TEA: preguntas cerradas y literales; evitar abiertas sobre sentimientos sin estructura.

PREGUNTAS Y ACTIVIDADES:
- Nunca preguntas compuestas ("Explica X y di por qué Y" → dos preguntas separadas).
- V-F siempre con justificación: "Si es FALSO, copia la frase correcta del texto".
- Banco de palabras visible antes de los huecos, nunca después.
- Comprensión en tres fases cuando apoyo sea medio/alto:
  1. PRE: vocabulario clave + activación (¿Qué sabes de este tema?)
  2. DURANTE: fragmento + pregunta inmediata intercalada
  3. POST: preguntas en orden textual + esquema para completar

ORTOGRAFÍA Y GRAMÁTICA:
- En dislexia/disgrafía: NO penalizar ortografía si no se evalúa explícitamente.
- Textos narrativos → organizador: Personajes / Lugar / Tiempo / Principio-Nudo-Desenlace.
- Textos expositivos → esquema: IDEA PRINCIPAL → ideas secundarias → ejemplos.
- Textos descriptivos → tabla de Atributos.
- Gramática: priorizar uso funcional (¿para qué sirve?) sobre nomenclatura (¿cómo se llama?).
`.trim(),

  matematicas: `
ASIGNATURA: MATEMÁTICAS — REGLAS CRÍTICAS

PRINCIPIO FUNDAMENTAL — NUNCA NEGOCIABLE:
Adaptar el ACCESO, nunca el CONTENIDO matemático.
NUNCA cambiar números, operaciones, nivel de dificultad ni datos del enunciado.

ESTRUCTURA OBLIGATORIA POR TIPO:

1. ECUACIONES Y OPERACIONES PURAS (sin contexto narrativo):
   - Cada ecuación en su propio bloque: <div class="aa-equation-block">2x + 5 = 17</div>
   - Espacio de desarrollo: <div class="aa-calc-box"></div>
   - Línea de resultado: <div class="aa-solution-line"><div class="aa-solution-blank"></div></div>
   - OBLIGATORIO: ejemplo resuelto paso a paso antes de cada tipo nuevo de operación.
   - NUNCA pictogramas en ecuaciones abstractas (x², 2x+5=17, fracciones, etc.).
   - Máximo 8-10 ecuaciones por bloque visual, luego separador.

2. PROBLEMAS CON CONTEXTO (enunciados con situación real):
   Estructura OBLIGATORIA para cada problema:
   <div class="aa-block aa-activity">
     <p class="aa-instruction">[enunciado simplificado — solo texto, datos conservados]</p>
     <div class="aa-example">
       📌 DATOS: [extraer los datos del enunciado en viñetas]
       ✏️ OPERACIÓN: [espacio para la operación]
       ✅ RESULTADO: [espacio para escribir la respuesta con unidad]
     </div>
   </div>
   - Simplificar SOLO el texto narrativo, NUNCA los números ni datos.
   - Orden cronológico estricto de los hechos del problema.
   - Resaltar en negrita las palabras-clave matemáticas: "en total", "quedan", "el doble",
     "la mitad", "repartir", "cada", "diferencia", "más que", "menos que".
   - La pregunta siempre al final, en su propia línea, empezando por "¿Cuántos/Cuánto...?"
   - Pictogramas SOLO si perfil es TEA o DI Y el objeto existe en ARASAAC (manzana, euro, pelota).
   - Si perfil es dislexia o TDAH: estructura visual clara SIN pictogramas.

3. ESQUEMA PÓLYA SIMPLIFICADO (barra lateral o recuadro de apoyo):
   ENTIENDO → PLANIFICO → RESUELVO → COMPRUEBO
   En DI: añadir pictograma por paso.

NUNCA:
- Cambiar los números del enunciado original.
- Simplificar x² a x ni operaciones de un grado a otro.
- Añadir pictogramas en ecuaciones abstractas.
- Mezclar ecuaciones de distintos tipos en el mismo bloque.
- Omitir el ejemplo resuelto antes de cada tipo nuevo.
`.trim(),

  naturales: `
ASIGNATURA: CIENCIAS NATURALES / CONOCIMIENTO DEL MEDIO

PLANTILLA FIJA PARA CADA CONCEPTO (órgano, sistema, fenómeno, instrumento):
┌─────────────────────────────────────────────┐
│ ¿QUÉ es?        → definición ≤ 12 palabras  │
│ ¿PARA QUÉ sirve? → función en 1 oración     │
│ ¿CÓMO funciona?  → proceso en viñetas 1-2-3 │
└─────────────────────────────────────────────┘

RELACIONES CAUSALES:
- Siempre como "CAUSA → EFECTO" con flecha visible.
- Una causa, un efecto por flecha.
- Patrón: "Si [causa], entonces [efecto]" — nunca en prosa continua.
- Ciclos (agua, estaciones, nutrientes): diagrama circular con 4-6 fases, nunca texto corrido.

VOCABULARIO CIENTÍFICO:
- Mantener SIEMPRE la terminología correcta (fotosíntesis, evaporación, ecosistema...).
- Glosario ilustrado obligatorio: palabra + imagen + definición ≤ 12 palabras.
- Máximo 5 términos nuevos por unidad en Primaria, 8 en Secundaria.
- Usar cognados como ancla cuando existan (fotosíntesis = photosynthesis).
- Etiquetado de imágenes antes que texto corrido en anatomía, botánica y aparatos.

TRANSFORMACIÓN DE TEXTO EXPOSITIVO:
- Máximo 3 frases por párrafo + 1 pregunta guiada inmediata.
- "Cloze científico": completar huecos con banco de palabras específico de la unidad.
- Sustituir "se produce / se genera / tiene lugar" por verbos activos: "ocurre", "pasa", "hace".
- Protocolos experimentales: MATERIALES (con imágenes) / PASOS (verbo + objeto, ≤8 palabras) /
  OBSERVO (tabla de registro) / CONCLUYO (frase con hueco).

ORGANIZADORES GRÁFICOS POR TIPO DE CONTENIDO:
- Clasificaciones → árbol o mapa de llaves.
- Procesos → diagrama de flujo con flechas.
- Ciclos → circular con pictogramas en cada fase.
- Partes del cuerpo/planta → imagen etiquetada.
- Comparaciones → tabla de doble entrada.
`.trim(),

  ingles: `
ASIGNATURA: INGLÉS COMO LENGUA EXTRANJERA

PRINCIPIO FUNDAMENTAL: input comprensible (Krashen i+1).
El input debe ser ligeramente superior al nivel actual; comprensible con apoyo contextual.

REGLA 80/20: 80% contenido en inglés, 20% español como andamiaje.
Instrucciones en español si apoyo es alto. Explicaciones gramaticales en español.
Traducción de vocabulario abstracto en español. Contenido principal siempre en inglés.

VOCABULARIO:
- Glosario bilingüe obligatorio: English · imagen · español · pronunciación guiada.
- Pronunciación simplificada al español como puente: "house → /jáus/", "water → /uóter/".
  NO usar IPA — los alumnos con NEE no lo manejan.
- Triple presentación: imagen + palabra escrita + equivalente en español.
- Priorizar cognados: hospital/hospital, doctor/doctor, animal/animal.
- High Frequency Words (listas Dolch/Oxford 3000): reconocimiento global antes de phonics
  complejo, especialmente en dislexia.

GRAMÁTICA — qué conservar y qué simplificar:
- MANTENER: Present Simple, Past Simple regular, to be, have got, there is/are,
  can/can't, imperativo, futuro con will y going to.
- SIMPLIFICAR O RETRASAR: Present Perfect con expresiones complejas, Past Continuous,
  Passive Voice, Condicionales 2º/3º, Reported Speech, phrasal verbs idiomáticos.
- Para TEA/TEL: usar chunks fijos ("Hello, my name is ___", "Can I have ___, please?").

READING COMPREHENSION:
- Pre-teach 5-8 palabras clave antes del texto (nunca después).
- Longitud de textos: 60 palabras en 3º-4º Primaria, 100-150 en 5º-6º, 150-250 en ESO.
- Preguntas en mismo orden textual, V-F o opción múltiple de 3 opciones.
- Nunca preguntas de inferencia compleja para DI o TEL.

EVALUACIÓN:
- Mayor peso a comprensión oral y expresión oral en dislexia.
- NO penalizar spelling salvo que se evalúe específicamente.
- Permitir diccionario bilingüe en actividades de producción escrita.
`.trim(),

  otra: `
ASIGNATURA: GENERAL
- Adaptar el contenido manteniendo los objetivos curriculares esenciales.
- Aplicar las reglas de perfil y nivel de apoyo seleccionados.
- Organizar el contenido en bloques temáticos con subtítulos claros.
- Usar esquemas y tablas en lugar de párrafos densos cuando sea posible.
`.trim(),

};

// ─── Intereses del alumno ─────────────────────────────────────────────────────

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

// ─── Reglas por etapa educativa ──────────────────────────────────────────────

const EDUCATIONAL_LEVEL_RULES: Record<"primaria" | "secundaria", string> = {
  primaria: `
ETAPA: PRIMARIA (6-12 años)
- Formato muy visual: imágenes, pictogramas, colores informativos.
- Tipografía grande (mínimo 15-16px), interlineado 1.5, espaciado generoso.
- Checklist con pictogramas, supervisión docente frecuente.
- Actividades manipulativas cuando sea posible (señalar, rodear, unir).
- Mensajes de refuerzo positivo al final de cada bloque completado.
`.trim(),

  secundaria: `
ETAPA: SECUNDARIA / ESO (12-16 años)
REGLA FUNDAMENTAL: NO infantilizar. El alumno tiene entre 12 y 16 años.

CONTENIDO:
- Mantener el rigor curricular de ESO. No simplificar el CONTENIDO, solo el ACCESO.
- Vocabulario: conservar términos propios del nivel ESO, explicar los que sean barrera.
- Nivel léxico: el más alto posible dentro de las restricciones del perfil NEE.
- NO usar ejemplos de dibujos animados, juguetes ni contextos infantiles.
- Usar contextos próximos a adolescentes: tecnología, deportes, redes, vida cotidiana.

FORMATO:
- Predominio textual pero estructurado: infografías, tablas, mapas conceptuales.
- Tipografía 12-13px (no la letra grande de Primaria).
- Máximo 2 colores informativos, sin decoraciones llamativas.

AUTONOMÍA:
- Checklist textual (sin pictogramas de animales ni emojis infantiles).
- Metacognición explícita: "¿Qué he aprendido? ¿Qué me ha costado?".
- Autoevaluación guiada al final.

MATEMÁTICAS ESO — REGLA ESPECIAL:
- NUNCA simplificar ecuaciones de 2º grado a 1º grado.
- NUNCA eliminar sistemas de ecuaciones ni reducir su complejidad.
- Solo adaptar el enunciado textual que rodea las operaciones.

TEACHERNOTES para secundaria: incluir siempre nota sobre qué apoyos son ACI
no significativa (formato/metodología) y cuáles requerirían dictamen orientación.
`.trim(),
};

// ─── Resolución de conflictos multi-perfil ───────────────────────────────────
// Cuando un alumno tiene varios perfiles NEE con reglas que pueden contradecirse.

function buildMultiProfileConflictRules(profiles: LearningProfile[]): string {
  if (profiles.length <= 1) return "";

  const profileSet = new Set(profiles);
  const rules: string[] = [];

  rules.push(`RESOLUCIÓN DE CONFLICTOS MULTI-PERFIL (${profiles.join(" + ")})`);
  rules.push("Cuando hay reglas contradictorias, aplica en este orden de prioridad:");
  rules.push("di > tea > tel > tdah > dislexia > retraso");
  rules.push("");

  if (profileSet.has("tea") && (profileSet.has("dislexia") || profileSet.has("tdah"))) {
    rules.push("TEA + DISLEXIA/TDAH:");
    rules.push("- TIPOGRAFÍA: aplicar reglas de dislexia (fondo crema, sin justificado).");
    rules.push("- ESTRUCTURA: mantener predictibilidad TEACCH (recuadros, numeración, anticipación).");
    rules.push("- PICTOGRAMAS: máximo 1 por instrucción clave. NO saturar el documento.");
    rules.push("- LENGUAJE: literal (TEA) + frases cortas chunked (dislexia/TDAH).");
    rules.push("- CONTRAINDICADO: pictograma sobre cada palabra del enunciado.");
    rules.push("");
  }

  if (profileSet.has("tea") && profileSet.has("di")) {
    rules.push("TEA + DI:");
    rules.push("- Canal principal: pictograma + texto breve (fila picto encima, texto debajo).");
    rules.push("- Lenguaje DI (frases 5-8 palabras) con estructura TEACCH (una acción por paso).");
    rules.push("- Anticipación explícita obligatoria al inicio.");
    rules.push("- Una actividad por bloque visual, máximo.");
    rules.push("");
  }

  if (profileSet.has("tdah") && profileSet.has("di")) {
    rules.push("TDAH + DI:");
    rules.push("- Producir MÁS ejercicios BREVES en lugar de menos ejercicios largos.");
    rules.push("- Casilla de completado al final de CADA ejercicio (TDAH) + ejemplo resuelto (DI).");
    rules.push("- Redundancia visual (DI) pero en bloques pequeños autónomos (TDAH).");
    rules.push("");
  }

  if (profileSet.has("tel") && profileSet.has("di")) {
    rules.push("TEL + DI:");
    rules.push("- Vocabulario cotidiano A1 (DI) con apoyo fonológico (TEL).");
    rules.push("- Frases 5-7 palabras máximo, orden SVO estricto.");
    rules.push("- Pictograma en verbos de instrucción Y en sustantivos concretos clave.");
    rules.push("");
  }

  rules.push("PRINCIPIO GENERAL: ante cualquier conflicto, aplicar la opción más restrictiva.");
  rules.push("Documentar en teacherNotes qué regla de qué perfil ha prevalecido y por qué.");

  return rules.join("\n");
}

// ─── Función principal: genera el bloque de reglas para el prompt ─────────────

export function buildDynamicAdaptationRules(
  config: AdaptationConfig,
  educationalLevel: "primaria" | "secundaria" = "primaria",
  additionalProfiles: LearningProfile[] = [],
): string {
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

  // Perfiles secundarios para resolución de conflictos
  const allProfiles = [config.learningProfile, ...additionalProfiles.filter(p => p !== config.learningProfile)];
  const conflictRules = buildMultiProfileConflictRules(allProfiles);

  return [
    base,
    PROFILE_RULES[config.learningProfile],
    // Perfiles secundarios (si los hay)
    ...additionalProfiles
      .filter(p => p !== config.learningProfile)
      .map(p => `\n--- PERFIL SECUNDARIO: ${p.toUpperCase()} ---\n${PROFILE_RULES[p]}`),
    conflictRules,
    LEVEL_RULES[config.adaptationLevel],
    SUPPORT_RULES[config.supportLevel],
    EDUCATIONAL_LEVEL_RULES[educationalLevel],
    decisionOrder,
  ]
    .filter(Boolean)
    .join("\n\n");
}
