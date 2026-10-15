import type { z } from "zod";
import { CaseSchema, type Case } from "./cases";

/**
 * Synthetic sheets written for these tests (own material, no user sheet, no student data). They cover the six families the
 * phase asks for: reading comprehension, numeration and calculation, fractions, natural sciences, labelled diagrams and
 * geometry. Every reference is a provisional synthetic proposal: none has been reviewed by a teacher.
 * Leak patterns are regex sources over `normalizeText` output (lowercase, no accents, canonical numbers).
 */

type CaseInput = z.input<typeof CaseSchema>;
const PROVISIONAL = { status: "sintetica_provisional", note: "Ficha sintética propia para pruebas automáticas; sin revisión docente." } as const;

const fracciones: CaseInput = {
  original: {
    id: "fx_fracciones_pizza",
    activities: [
      { id: "act_1", number: "1", instruction: "Una pizza está dividida en 4 partes iguales. Lucas come 3 partes. ¿Qué fracción de la pizza come Lucas?", operations: ["identificar", "representar"] },
      { id: "act_2", number: "2", instruction: "Sombrea 2 de las 8 partes de la barra M y 1 de las 4 partes de la barra N. ¿Representan la misma parte del total? Explica por qué.", operations: ["representar", "comparar", "justificar"] },
      { id: "act_3", number: "3", instruction: "Marta dice que 3/4 de la barra P es más que 2/4 de la barra P. ¿Tiene razón? Justifica tu respuesta.", operations: ["comparar", "justificar"] },
    ],
    figures: [
      { id: "fig_pizza", activityIds: ["act_1"], kind: "circulo_partido", facts: { partes: 4, sombreadas: 3 } },
      { id: "fig_barra_m", activityIds: ["act_2"], kind: "barra", facts: { partes: 8, sombreadas: 0 } },
      { id: "fig_barra_n", activityIds: ["act_2"], kind: "barra", facts: { partes: 4, sombreadas: 0 } },
    ],
  },
  reference: {
    id: "fx_fracciones_pizza", sourceSha256: null, split: "development", subject: "Matemáticas", grade: "3.º Primaria", activityType: "fracciones",
    objective: "Interpretar y comparar fracciones de una misma unidad y justificar la equivalencia.",
    activities: [
      { id: "act_1", number: "1", instruction: "Una pizza está dividida en 4 partes iguales. Lucas come 3 partes. ¿Qué fracción de la pizza come Lucas?", required: true, operations: ["identificar", "representar"], operationCues: ["fraccion"], data: { numbers: ["4", "3"], relations: [["partes iguales"]] } },
      { id: "act_2", number: "2", instruction: "Sombrea 2 de las 8 partes de la barra M y 1 de las 4 partes de la barra N. ¿Representan la misma parte del total? Explica por qué.", required: true, operations: ["representar", "comparar", "justificar"], operationCues: ["explica", "por que"], data: { numbers: ["2", "8", "1", "4"], relations: [["2 de las 8"], ["1 de las 4"]], names: ["M", "N"] } },
      { id: "act_3", number: "3", instruction: "Marta dice que 3/4 de la barra P es más que 2/4 de la barra P. ¿Tiene razón? Justifica tu respuesta.", required: true, operations: ["comparar", "justificar"], operationCues: ["justifica"], data: { numbers: ["3/4", "2/4"], relations: [["mas que"]] } },
    ],
    figures: [
      { id: "fig_pizza", activityIds: ["act_1"], kind: "circulo_partido", facts: { partes: 4, sombreadas: 3 } },
      { id: "fig_barra_m", activityIds: ["act_2"], kind: "barra", facts: { partes: 8, sombreadas: 0 }, unresolved: ["sombreadas"] },
      { id: "fig_barra_n", activityIds: ["act_2"], kind: "barra", facts: { partes: 4, sombreadas: 0 }, unresolved: ["sombreadas"] },
    ],
    answers: [
      { activityId: "act_1", value: "3/4", leakPatterns: ["come 3/4", "3/4 de la pizza", "tres cuartos"] },
      { activityId: "act_2", value: "Sí, las dos representan un cuarto del total", leakPatterns: ["un cuarto", "1/4", "2/8", "las dos (son|representan) (un cuarto|la misma)"] },
      { activityId: "act_3", value: "Sí, 3 partes de 4 son más que 2 partes de 4", leakPatterns: ["(si|marta) tiene razon", "3/4 (es|son) mayor", "3/4 ?> ?2/4"] },
    ],
    barriers: [
      { id: "bar_consigna_doble", description: "La actividad 2 encadena dos acciones y una pregunta en una sola frase." },
      { id: "bar_visual", description: "Las partes de las barras son pequeñas y el borde es fino." },
    ],
    admissibleAdaptations: ["Separar la consigna doble en pasos", "Barras más grandes con bordes reforzados", "Recordatorio general de numerador y denominador"],
    unacceptableChanges: ["Cambiar particiones o sombreados", "Indicar qué fracción hay que sombrear", "Sugerir que dos fracciones son iguales si tienen el mismo número de partes"],
    referenceAdaptation: null,
    validation: PROVISIONAL,
  },
  plans: [
    {
      id: "a_pasos", description: "Consigna en pasos y barras reforzadas.",
      activities: {
        act_2: {
          instruction: "Sombrea 2 de las 8 partes de la barra M. Después, sombrea 1 de las 4 partes de la barra N. ¿Representan la misma parte del total? Explica por qué.",
          supports: [{ kind: "formato_visual", text: "Barras más grandes y con el borde reforzado; las divisiones no cambian.", addresses: ["bar_visual"] }, { kind: "segmentacion", text: "Haz un paso cada vez y marca el paso cuando lo termines.", addresses: ["bar_consigna_doble"] }],
        },
      },
    },
    {
      id: "b_recordatorio", description: "Además, recordatorio general y espacio de respuesta.",
      activities: {
        act_1: { supports: [{ kind: "recordatorio_general", text: "Recuerda: el número de abajo dice en cuántas partes iguales está el entero; el de arriba, cuántas partes se toman.", addresses: ["bar_consigna_doble"] }] },
        act_2: {
          instruction: "Sombrea 2 de las 8 partes de la barra M. Después, sombrea 1 de las 4 partes de la barra N. ¿Representan la misma parte del total? Explica por qué.",
          supports: [{ kind: "formato_visual", text: "Barras más grandes y con el borde reforzado.", addresses: ["bar_visual"] }],
        },
        act_3: { supports: [{ kind: "espacio_respuesta", text: "Sí / No. Porque ________________________", addresses: ["bar_consigna_doble"] }] },
      },
    },
  ],
  mutationBase: "a_pasos",
  mutations: [
    { id: "fraccion_3_4_a_2_4", errorType: "cambio_dato", description: "3/4 pasa a 2/4 en la actividad 3.", verifiable: true, expect: { criterion: "A_conservacion_datos", check: "numeros" }, ops: [{ op: "replace", activity: "act_3", target: "instruction", find: "3/4", replace: "2/4" }] },
    { id: "particion_cambiada", errorType: "cambio_dato", description: "La barra N pasa de 4 a 6 partes.", verifiable: true, expect: { criterion: "A_conservacion_datos", check: "figura" }, ops: [{ op: "set_figure_fact", figure: "fig_barra_n", key: "partes", value: 6 }] },
    { id: "pista_revela", errorType: "respuesta_revelada", description: "Una pista dice la fracción.", verifiable: true, expect: { criterion: "C_seguridad_respuestas", check: "respuesta_revelada" }, ops: [{ op: "add_support", activity: "act_1", kind: "pista", text: "Pista: Lucas come 3/4 de la pizza.", addresses: ["bar_consigna_doble"] }] },
    { id: "barra_sombreada", errorType: "figura_resuelta", description: "La barra M llega ya sombreada.", verifiable: true, expect: { criterion: "C_seguridad_respuestas", check: "figura_resuelta" }, ops: [{ op: "set_figure_fact", figure: "fig_barra_m", key: "sombreadas", value: 2 }] },
    { id: "sin_justificar", errorType: "sobresimplificacion", description: "La actividad 3 ya no pide justificar.", verifiable: true, expect: { criterion: "E_fidelidad_pedagogica", check: "operacion_cognitiva" }, ops: [{ op: "set_text", activity: "act_3", target: "instruction", value: "¿Es 3/4 de la barra P más que 2/4 de la barra P? Rodea sí o no." }] },
    { id: "omite_act_2", errorType: "actividad_omitida", description: "Desaparece la actividad 2.", verifiable: true, expect: { criterion: "B_integridad_actividad", check: "actividad_omitida" }, ops: [{ op: "drop_activity", activity: "act_2" }] },
    { id: "mezcla_1_2", errorType: "consignas_mezcladas", description: "Las actividades 1 y 2 se funden.", verifiable: true, expect: { criterion: "B_integridad_actividad", check: "consignas_mezcladas" }, ops: [{ op: "merge_activities", activities: ["act_1", "act_2"], instruction: "Mira la pizza y las barras M y N, sombrea 2 de las 8 partes y 1 de las 4 partes y di qué fracción come Lucas de las 4 partes iguales y si son la misma parte (3 partes)." }] },
    { id: "criterio_partes", errorType: "objetivo_cambiado", description: "Un apoyo enseña un criterio falso de equivalencia (mismo número de partes).", verifiable: false, expect: null, ops: [{ op: "add_support", activity: "act_2", kind: "recordatorio_general", text: "Recuerda: dos fracciones son iguales si tienen el mismo número de partes sombreadas.", addresses: ["bar_consigna_doble"] }] },
  ],
};

const calculo: CaseInput = {
  original: {
    id: "fx_problemas_autobus",
    activities: [
      { id: "act_1", number: "1", instruction: "Resuelve el problema. Escribe las operaciones y la solución.", content: "Un autobús lleva 52 pasajeros. En la primera parada bajan 17 y suben 9. ¿Cuántos pasajeros hay ahora en el autobús?", operations: ["calcular_varios_pasos", "seleccionar_datos"] },
      { id: "act_2", number: "2", instruction: "Resuelve el problema. Escribe las operaciones y la solución.", content: "Una carrera mide 2 km 300 m. Ana ha recorrido 1 km 850 m. ¿Cuántos metros le faltan para llegar a la meta?", operations: ["convertir_unidades", "calcular_varios_pasos"] },
    ],
  },
  reference: {
    id: "fx_problemas_autobus", sourceSha256: null, split: "development", subject: "Matemáticas", grade: "4.º Primaria", activityType: "numeracion_calculo",
    objective: "Resolver problemas de dos pasos conservando cantidades, relaciones y unidades.",
    activities: [
      { id: "act_1", number: "1", instruction: "Resuelve el problema. Escribe las operaciones y la solución. Un autobús lleva 52 pasajeros. En la primera parada bajan 17 y suben 9. ¿Cuántos pasajeros hay ahora en el autobús?", required: true, operations: ["calcular_varios_pasos", "seleccionar_datos"], operationCues: ["operaciones"], data: { numbers: ["52", "17", "9"], relations: [["bajan"], ["suben"]] } },
      { id: "act_2", number: "2", instruction: "Resuelve el problema. Escribe las operaciones y la solución. Una carrera mide 2 km 300 m. Ana ha recorrido 1 km 850 m. ¿Cuántos metros le faltan para llegar a la meta?", required: true, operations: ["convertir_unidades", "calcular_varios_pasos"], operationCues: ["operaciones"], data: { numbers: ["2", "300", "1", "850"], units: ["km", "metros"], relations: [["le faltan", "falta"]] } },
    ],
    answers: [
      { activityId: "act_1", value: "44 pasajeros", leakPatterns: [] },
      { activityId: "act_2", value: "450 m", leakPatterns: [] },
    ],
    admissibleNumbers: ["1000"],
    barriers: [
      { id: "bar_datos", description: "Varios datos dentro de un texto continuo." },
      { id: "bar_unidades", description: "Hay que pasar de kilómetros a metros." },
    ],
    admissibleAdaptations: ["Tabla vacía de datos y unidades", "Recordatorio general 1 km = 1000 m", "Más espacio para operar"],
    unacceptableChanges: ["Cambiar o redondear cantidades", "Confundir km y m", "Cambiar «bajan» por otra relación", "Dar la primera operación hecha"],
    referenceAdaptation: null,
    validation: PROVISIONAL,
  },
  plans: [
    {
      id: "a_tabla", description: "Tabla vacía de datos y recordatorio de unidades.",
      activities: {
        act_1: { supports: [{ kind: "organizador_vacio", text: "Tabla vacía: Dato | Cantidad | ¿Sube o baja?", addresses: ["bar_datos"] }] },
        act_2: { supports: [{ kind: "recordatorio_general", text: "Recuerda: 1 km = 1000 m.", addresses: ["bar_unidades"] }, { kind: "organizador_vacio", text: "Tabla vacía: Dato | km | m", addresses: ["bar_datos"] }] },
      },
    },
    {
      id: "b_lineas", description: "Cada dato en su línea, sin cambiar el texto.",
      activities: {
        act_1: { content: "Un autobús lleva 52 pasajeros.\nEn la primera parada bajan 17 y suben 9.\n¿Cuántos pasajeros hay ahora en el autobús?", supports: [{ kind: "espacio_respuesta", text: "Operaciones: ________  Solución: ________", addresses: ["bar_datos"] }] },
        act_2: { content: "Una carrera mide 2 km 300 m.\nAna ha recorrido 1 km 850 m.\n¿Cuántos metros le faltan para llegar a la meta?", supports: [{ kind: "recordatorio_general", text: "Recuerda: 1 km = 1000 m.", addresses: ["bar_unidades"] }] },
      },
    },
  ],
  mutationBase: "a_tabla",
  mutations: [
    { id: "cambia_cantidad", errorType: "cambio_dato", description: "17 pasa a 15.", verifiable: true, expect: { criterion: "A_conservacion_datos", check: "numeros" }, ops: [{ op: "replace", activity: "act_1", target: "content", find: "bajan 17", replace: "bajan 15" }] },
    { id: "cambia_unidad", errorType: "unidad_cambiada", description: "Pregunta en kilómetros en lugar de metros.", verifiable: true, expect: { criterion: "A_conservacion_datos", check: "unidades" }, ops: [{ op: "replace", activity: "act_2", target: "content", find: "Cuántos metros", replace: "Cuántos kilómetros" }] },
    { id: "cambia_relacion", errorType: "relacion_cambiada", description: "«bajan» se convierte en «suben».", verifiable: true, expect: { criterion: "A_conservacion_datos", check: "relaciones" }, ops: [{ op: "replace", activity: "act_1", target: "content", find: "bajan 17 y suben 9", replace: "suben 17 y suben 9" }] },
    { id: "operacion_dada", errorType: "operacion_dada", description: "Un apoyo plantea la primera operación.", verifiable: true, expect: { criterion: "C_seguridad_respuestas", check: "operacion_dada" }, ops: [{ op: "add_support", activity: "act_1", kind: "pista", text: "Primero calcula 52 − 17.", addresses: ["bar_datos"] }] },
    { id: "paso_intermedio", errorType: "sobresimplificacion", description: "El enunciado trae el resultado intermedio.", verifiable: true, expect: { criterion: "A_conservacion_datos", check: "cantidades_nuevas" }, ops: [{ op: "replace", activity: "act_1", target: "content", find: "bajan 17 y suben 9", replace: "bajan 17 (quedan 35) y suben 9" }] },
    { id: "revela_resultado", errorType: "respuesta_revelada", description: "Un apoyo da el resultado para «comprobar».", verifiable: true, expect: { criterion: "C_seguridad_respuestas", check: "respuesta_revelada" }, ops: [{ op: "add_support", activity: "act_2", kind: "pista", text: "Comprueba que te salen 450 m.", addresses: ["bar_unidades"] }] },
    { id: "omite_act_2", errorType: "actividad_omitida", description: "Desaparece el problema 2.", verifiable: true, expect: { criterion: "B_integridad_actividad", check: "actividad_omitida" }, ops: [{ op: "drop_activity", activity: "act_2" }] },
    { id: "ejemplo_calcado", errorType: "sobresimplificacion", description: "Un «ejemplo» con la misma estructura y datos guía el problema paso a paso.", verifiable: false, expect: null, ops: [{ op: "add_support", activity: "act_1", kind: "ejemplo_distinto", text: "Ejemplo: en un tren van 52 viajeros, bajan 17 y suben 9. Primero se quitan los que bajan y después se suman los que suben.", addresses: ["bar_datos"] }] },
  ],
};

const FARO = `El faro de la isla llevaba tres noches apagado. Nadia, la nieta del farero, notó que los barcos de pesca volvían tarde y con miedo.

Una mañana subió la escalera de caracol. Arriba encontró la lámpara intacta, pero el cristal estaba cubierto de sal y de polvo. Por eso la luz apenas se veía desde el mar.

Nadia no estaba segura de poder arreglarlo sola. Primero limpió el cristal con un paño húmedo. Después pidió ayuda a su abuelo para revisar el interruptor, que estaba suelto.

Aquella noche el faro volvió a brillar. Los pescadores llegaron antes y saludaron con la sirena.`;

const lectura: CaseInput = {
  original: {
    id: "fx_lectura_faro",
    sourceTexts: [{ id: "txt_faro", text: FARO }],
    activities: [
      { id: "act_1", number: "1", instruction: "¿Por qué la luz del faro apenas se veía desde el mar?", operations: ["localizar_informacion"] },
      { id: "act_2", number: "2", instruction: "Ordena los hechos del 1 al 4 según ocurren en el texto.", content: "__ Nadia limpia el cristal.\n__ El faro vuelve a brillar.\n__ Nadia sube la escalera.\n__ Nadia pide ayuda a su abuelo.", operations: ["ordenar"] },
      { id: "act_3", number: "3", instruction: "¿Cómo crees que se sentía Nadia al subir la escalera? Escribe dos pistas del texto que lo muestren.", operations: ["inferir", "justificar"] },
      { id: "act_4", number: "4", instruction: "¿Qué significa «apenas» en la frase «la luz apenas se veía»?", operations: ["interpretar_expresion"] },
    ],
  },
  reference: {
    id: "fx_lectura_faro", sourceSha256: null, split: "development", subject: "Lengua", grade: "3.º Primaria", activityType: "comprension_lectora",
    objective: "Comprender un relato: localizar causas, ordenar hechos, inferir sentimientos con pistas del texto e interpretar una expresión.",
    sourceTexts: [{ id: "txt_faro", keyFacts: ["tres noches apagado", "volvian tarde", "cubierto de sal", "apenas se veia", "no estaba segura", "limpio el cristal", "pidio ayuda a su abuelo", "interruptor", "volvio a brillar"], wordCount: 101 }],
    activities: [
      { id: "act_1", number: "1", instruction: "¿Por qué la luz del faro apenas se veía desde el mar?", required: true, operations: ["localizar_informacion"], operationCues: ["por que"], data: { relations: [["luz"]] } },
      { id: "act_2", number: "2", instruction: "Ordena los hechos del 1 al 4 según ocurren en el texto.", required: true, operations: ["ordenar"], operationCues: ["ordena"], data: { numbers: ["1", "4"], sequence: ["limpia el cristal", "vuelve a brillar", "sube la escalera", "pide ayuda"] } },
      { id: "act_3", number: "3", instruction: "¿Cómo crees que se sentía Nadia al subir la escalera? Escribe dos pistas del texto que lo muestren.", required: true, operations: ["inferir", "justificar"], operationCues: ["crees", "pistas"], data: { numbers: ["2"] } },
      { id: "act_4", number: "4", instruction: "¿Qué significa «apenas» en la frase «la luz apenas se veía»?", required: true, operations: ["interpretar_expresion"], operationCues: ["significa"], data: { relations: [["apenas"]] } },
    ],
    answers: [
      { activityId: "act_1", value: "Porque el cristal estaba cubierto de sal y de polvo", leakPatterns: ["porque el cristal", "cristal (estaba )?(sucio|cubierto)"] },
      { activityId: "act_2", value: "2, 4, 1, 3", leakPatterns: ["1\\W+nadia sube"] },
      { activityId: "act_3", value: "Insegura o preocupada: no estaba segura de poder arreglarlo sola; pidió ayuda", leakPatterns: ["se sentia (nerviosa|insegura|preocupada)"] },
      { activityId: "act_4", value: "casi no", leakPatterns: ["apenas\\W+(significa |quiere decir )?casi no"] },
    ],
    barriers: [
      { id: "bar_texto_continuo", description: "Texto continuo sin separación visual de párrafos." },
      { id: "bar_vocabulario", description: "Palabras poco frecuentes: farero, escalera de caracol, interruptor." },
      { id: "bar_consigna_doble", description: "La pregunta 3 pide dos cosas." },
    ],
    admissibleAdaptations: ["Párrafos separados y marcados", "Glosario neutro de palabras que no se preguntan", "Organizador vacío para la pregunta 3"],
    unacceptableChanges: ["Recortar causas o la inseguridad de Nadia", "Cambiar el orden de los hechos", "Convertir la inferencia en copiar una frase", "Definir en el glosario la palabra que se pregunta"],
    referenceAdaptation: null,
    validation: PROVISIONAL,
  },
  plans: [
    {
      id: "a_parrafos", description: "Párrafos separados, glosario neutro y organizador vacío.", segmentTexts: ["txt_faro"],
      activities: {
        act_1: { supports: [{ kind: "glosario", text: "farero: persona que cuida el faro. Interruptor: pieza para encender y apagar la luz.", addresses: ["bar_vocabulario"] }] },
        act_3: { instruction: "¿Cómo crees que se sentía Nadia al subir la escalera? Después, escribe dos pistas del texto que lo muestren.", supports: [{ kind: "organizador_vacio", text: "Cómo se sentía: ______ / Pista 1: ______ / Pista 2: ______", addresses: ["bar_consigna_doble"] }] },
      },
    },
    {
      id: "b_lectura", description: "Lectura en voz alta y párrafos separados.", segmentTexts: ["txt_faro"],
      activities: {
        act_1: { supports: [{ kind: "lectura_en_voz_alta", text: "Puedes escuchar el texto antes de responder.", addresses: ["bar_texto_continuo"] }] },
        act_3: { supports: [{ kind: "espacio_respuesta", text: "Me parece que se sentía ______ porque ______", addresses: ["bar_consigna_doble"] }] },
      },
    },
  ],
  mutationBase: "a_parrafos",
  mutations: [
    { id: "recorta_inseguridad", errorType: "texto_recortado", description: "Se elimina la frase de la inseguridad de Nadia.", verifiable: true, expect: { criterion: "A_conservacion_datos", check: "texto_fuente" }, ops: [{ op: "replace_source", textId: "txt_faro", find: "Nadia no estaba segura de poder arreglarlo sola. ", replace: "" }] },
    { id: "inferir_a_copiar", errorType: "objetivo_cambiado", description: "La inferencia se convierte en copiar una frase.", verifiable: true, expect: { criterion: "E_fidelidad_pedagogica", check: "operacion_cognitiva" }, ops: [{ op: "set_text", activity: "act_3", target: "instruction", value: "Copia la frase del texto en la que Nadia sube la escalera." }] },
    { id: "orden_resuelto", errorType: "orden_cambiado", description: "Los hechos aparecen ya ordenados.", verifiable: true, expect: { criterion: "A_conservacion_datos", check: "secuencia" }, ops: [{ op: "set_text", activity: "act_2", target: "content", value: "__ Nadia sube la escalera.\n__ Nadia limpia el cristal.\n__ Nadia pide ayuda a su abuelo.\n__ El faro vuelve a brillar." }] },
    { id: "glosario_revela", errorType: "respuesta_revelada", description: "El glosario define la palabra preguntada.", verifiable: true, expect: { criterion: "C_seguridad_respuestas", check: "respuesta_revelada" }, ops: [{ op: "add_support", activity: "act_4", kind: "glosario", text: "apenas: casi no.", addresses: ["bar_vocabulario"] }] },
    { id: "omite_act_4", errorType: "actividad_omitida", description: "Desaparece la pregunta 4.", verifiable: true, expect: { criterion: "B_integridad_actividad", check: "actividad_omitida" }, ops: [{ op: "drop_activity", activity: "act_4" }] },
    { id: "duplica_act_1", errorType: "actividad_duplicada", description: "La pregunta 1 aparece dos veces.", verifiable: true, expect: { criterion: "B_integridad_actividad", check: "actividad_duplicada" }, ops: [{ op: "duplicate_activity", activity: "act_1" }] },
    { id: "inferencia_en_texto", errorType: "respuesta_revelada", description: "El texto adaptado dice ya cómo se sentía Nadia.", verifiable: false, expect: null, ops: [{ op: "replace_source", textId: "txt_faro", find: "Una mañana subió", replace: "Muy nerviosa, una mañana subió" }] },
    { id: "pregunta_cambiada_misma_marca", errorType: "objetivo_cambiado", description: "Otra pregunta con las mismas palabras clave («por qué», «luz»).", verifiable: false, expect: null, ops: [{ op: "set_text", activity: "act_1", target: "instruction", value: "¿Por qué la luz del faro era importante para los pescadores?" }] },
  ],
};

const ciencias: CaseInput = {
  original: {
    id: "fx_ciencias_estados",
    activities: [
      { id: "act_1", number: "1", instruction: "Clasifica estos ejemplos según el estado de la materia: sólido, líquido o gas.", content: "hielo · zumo · vapor de la olla · piedra · aceite · aire del globo", operations: ["clasificar"] },
      { id: "act_2", number: "2", instruction: "Explica qué le pasa al agua de un charco en un día de mucho calor y por qué.", operations: ["relacionar_funcion", "justificar"] },
    ],
  },
  reference: {
    id: "fx_ciencias_estados", sourceSha256: null, split: "development", subject: "Ciencias Naturales", grade: "4.º Primaria", activityType: "ciencias",
    objective: "Clasificar materiales por su estado y explicar un cambio de estado por el calor.",
    activities: [
      { id: "act_1", number: "1", instruction: "Clasifica estos ejemplos según el estado de la materia: sólido, líquido o gas.", required: true, operations: ["clasificar"], operationCues: ["clasifica"], data: { relations: [["solido"], ["liquido"], ["gas"]], options: ["hielo", "zumo", "vapor de la olla", "piedra", "aceite", "aire del globo"] } },
      { id: "act_2", number: "2", instruction: "Explica qué le pasa al agua de un charco en un día de mucho calor y por qué.", required: true, operations: ["relacionar_funcion", "justificar"], operationCues: ["explica", "por que"], data: { relations: [["calor"], ["charco"]] } },
    ],
    answers: [
      { activityId: "act_1", value: "Sólido: hielo, piedra. Líquido: zumo, aceite. Gas: vapor de la olla, aire del globo.", leakPatterns: ["solido\\W*:?\\W*hielo", "hielo\\W*(:|=|-|→|es)\\W*solido", "liquido\\W*:?\\W*zumo", "gas\\W*:?\\W*(vapor|aire)"] },
      { activityId: "act_2", value: "Se evapora: el calor convierte el agua líquida en vapor.", leakPatterns: ["evapora", "se convierte en vapor"] },
    ],
    barriers: [
      { id: "bar_lista", description: "Los ejemplos van seguidos en una sola línea." },
      { id: "bar_vocabulario", description: "Palabras poco habituales: charco, olla." },
    ],
    admissibleAdaptations: ["Un ejemplo por línea", "Tabla vacía con tres columnas", "Glosario neutro de palabras no preguntadas"],
    unacceptableChanges: ["Quitar ejemplos", "Rellenar la tabla", "Definir evaporación en un apoyo", "Convertir la explicación en elegir una opción"],
    referenceAdaptation: null,
    validation: PROVISIONAL,
  },
  plans: [
    {
      id: "a_tabla", description: "Un ejemplo por línea y tabla vacía.",
      activities: {
        act_1: { content: "hielo\nzumo\nvapor de la olla\npiedra\naceite\naire del globo", supports: [{ kind: "organizador_vacio", text: "Tabla vacía con tres columnas: Sólido | Líquido | Gas", addresses: ["bar_lista"] }] },
        act_2: { supports: [{ kind: "glosario", text: "charco: agua acumulada en el suelo después de llover.", addresses: ["bar_vocabulario"] }] },
      },
    },
    {
      id: "b_minima", description: "Solo un ejemplo por línea.",
      activities: { act_1: { content: "hielo\nzumo\nvapor de la olla\npiedra\naceite\naire del globo", supports: [{ kind: "formato_visual", text: "Cada ejemplo en su línea, con espacio a la derecha.", addresses: ["bar_lista"] }] } },
    },
  ],
  mutationBase: "a_tabla",
  mutations: [
    { id: "quita_ejemplo", errorType: "cambio_dato", description: "Desaparece «aceite».", verifiable: true, expect: { criterion: "A_conservacion_datos", check: "opciones" }, ops: [{ op: "replace", activity: "act_1", target: "content", find: "aceite\n", replace: "" }] },
    { id: "tabla_rellena", errorType: "respuesta_revelada", description: "La tabla llega rellena.", verifiable: true, expect: { criterion: "C_seguridad_respuestas", check: "respuesta_revelada" }, ops: [{ op: "add_support", activity: "act_1", kind: "organizador_vacio", text: "Sólido: hielo, piedra | Líquido: zumo, aceite | Gas: vapor de la olla, aire del globo", addresses: ["bar_lista"] }] },
    { id: "glosario_evaporar", errorType: "respuesta_revelada", description: "El glosario define evaporarse.", verifiable: true, expect: { criterion: "C_seguridad_respuestas", check: "respuesta_revelada" }, ops: [{ op: "add_support", activity: "act_2", kind: "glosario", text: "evaporarse: pasar de líquido a gas con el calor.", addresses: ["bar_vocabulario"] }] },
    { id: "explicar_a_elegir", errorType: "sobresimplificacion", description: "La explicación se convierte en elegir.", verifiable: true, expect: { criterion: "E_fidelidad_pedagogica", check: "operacion_cognitiva" }, ops: [{ op: "set_text", activity: "act_2", target: "instruction", value: "¿Qué le pasa al agua de un charco con mucho calor? Rodea: desaparece / se congela." }] },
    { id: "mezcla_1_2", errorType: "consignas_mezcladas", description: "Las dos actividades se funden.", verifiable: true, expect: { criterion: "B_integridad_actividad", check: "consignas_mezcladas" }, ops: [{ op: "merge_activities", activities: ["act_1", "act_2"], instruction: "Clasifica los ejemplos en sólido, líquido o gas y explica qué pasa con el agua de un charco con calor y por qué." }] },
  ],
};

const esquema: CaseInput = {
  original: {
    id: "fx_esquema_volcan",
    activities: [
      { id: "act_1", number: "1", instruction: "Escribe el nombre de cada parte del volcán señalada con las letras A, B, C y D.", operations: ["identificar"] },
      { id: "act_2", number: "2", instruction: "¿Por qué sale lava por el cráter? Usa las partes B y C en tu explicación.", operations: ["relacionar_funcion", "justificar"] },
    ],
    figures: [{ id: "fig_volcan", activityIds: ["act_1", "act_2"], kind: "esquema_etiquetado", facts: { A_apunta_a: "crater", B_apunta_a: "chimenea", C_apunta_a: "camara_magmatica", D_apunta_a: "colada_de_lava", A_texto: "", B_texto: "", C_texto: "", D_texto: "" } }],
  },
  reference: {
    id: "fx_esquema_volcan", sourceSha256: null, split: "development", subject: "Ciencias Naturales", grade: "5.º Primaria", activityType: "esquema_etiquetado",
    objective: "Identificar las partes de un volcán en un esquema y relacionarlas con la salida de la lava.",
    activities: [
      { id: "act_1", number: "1", instruction: "Escribe el nombre de cada parte del volcán señalada con las letras A, B, C y D.", required: true, operations: ["identificar"], operationCues: ["nombre"] },
      { id: "act_2", number: "2", instruction: "¿Por qué sale lava por el cráter? Usa las partes B y C en tu explicación.", required: true, operations: ["relacionar_funcion", "justificar"], operationCues: ["por que", "explicacion"], data: { names: ["B", "C"] } },
    ],
    figures: [{ id: "fig_volcan", activityIds: ["act_1", "act_2"], kind: "esquema_etiquetado", facts: { A_apunta_a: "crater", B_apunta_a: "chimenea", C_apunta_a: "camara_magmatica", D_apunta_a: "colada_de_lava", A_texto: "", B_texto: "", C_texto: "", D_texto: "" }, unresolved: ["A_texto", "B_texto", "C_texto", "D_texto"] }],
    answers: [
      { activityId: "act_1", value: "A cráter, B chimenea, C cámara magmática, D colada de lava", leakPatterns: ["\\ba\\W*(:|=|-|→)\\W*crater", "\\bb\\W*(:|=|-|→)\\W*chimenea", "\\bc\\W*(:|=|-|→)\\W*camara"] },
      { activityId: "act_2", value: "El magma sube desde la cámara magmática (C) por la chimenea (B) y sale por el cráter", leakPatterns: ["magma sube", "sube por la chimenea"] },
    ],
    barriers: [
      { id: "bar_visual", description: "Letras pequeñas y flechas finas en el esquema." },
      { id: "bar_respuesta", description: "No hay espacio claro para escribir cada nombre." },
    ],
    admissibleAdaptations: ["Letras más grandes y flechas más gruesas sin moverlas", "Líneas de respuesta junto a cada letra"],
    unacceptableChanges: ["Mover flechas o cambiar la parte señalada", "Escribir los nombres en el esquema", "Sustituir el esquema por otra imagen"],
    referenceAdaptation: null,
    validation: PROVISIONAL,
  },
  plans: [
    {
      id: "a_visual", description: "Esquema más legible y líneas de respuesta.",
      activities: {
        act_1: { supports: [{ kind: "formato_visual", text: "Letras más grandes y flechas más gruesas; ninguna flecha cambia de sitio.", addresses: ["bar_visual"] }, { kind: "espacio_respuesta", text: "A ________  B ________  C ________  D ________", addresses: ["bar_respuesta"] }] },
      },
    },
    { id: "b_minima", description: "Solo líneas de respuesta.", activities: { act_1: { supports: [{ kind: "espacio_respuesta", text: "A ________  B ________  C ________  D ________", addresses: ["bar_respuesta"] }] } } },
  ],
  mutationBase: "a_visual",
  mutations: [
    { id: "etiquetas_b_c", errorType: "etiquetas_confundidas", description: "Las flechas B y C se intercambian.", verifiable: true, expect: { criterion: "A_conservacion_datos", check: "figura" }, ops: [{ op: "swap_figure_facts", figure: "fig_volcan", keys: ["B_apunta_a", "C_apunta_a"] }] },
    { id: "etiqueta_rotulada", errorType: "figura_resuelta", description: "El esquema trae escrito «cráter».", verifiable: true, expect: { criterion: "C_seguridad_respuestas", check: "figura_resuelta" }, ops: [{ op: "set_figure_fact", figure: "fig_volcan", key: "A_texto", value: "cráter" }] },
    { id: "figura_sustituida", errorType: "figura_sustituida", description: "El esquema se cambia por una fotografía.", verifiable: true, expect: { criterion: "A_conservacion_datos", check: "figura" }, ops: [{ op: "set_figure_kind", figure: "fig_volcan", kind: "fotografia" }] },
    { id: "figura_reasignada", errorType: "figura_reasignada", description: "El esquema queda solo en la actividad 2.", verifiable: true, expect: { criterion: "B_integridad_actividad", check: "figura_en_otra_actividad" }, ops: [{ op: "set_figure_activities", figure: "fig_volcan", activityIds: ["act_2"] }] },
    { id: "pista_nombres", errorType: "respuesta_revelada", description: "Un apoyo empareja letras y nombres.", verifiable: true, expect: { criterion: "C_seguridad_respuestas", check: "respuesta_revelada" }, ops: [{ op: "add_support", activity: "act_1", kind: "pista", text: "Pista: A = cráter.", addresses: ["bar_respuesta"] }] },
    { id: "banco_palabras", errorType: "sobresimplificacion", description: "Un banco de palabras convierte recordar en reconocer.", verifiable: false, expect: null, ops: [{ op: "add_support", activity: "act_1", kind: "glosario", text: "Palabras: cráter, chimenea, cámara magmática, colada de lava.", addresses: ["bar_respuesta"] }] },
  ],
};

const geometria: CaseInput = {
  original: {
    id: "fx_geometria_rectangulo_l",
    activities: [
      { id: "act_1", number: "1", instruction: "Calcula el perímetro del rectángulo R. Escribe la operación.", content: "El rectángulo R mide 9 cm de largo y 4 cm de ancho.", operations: ["calcular_varios_pasos"] },
      { id: "act_2", number: "2", instruction: "Calcula el área del rectángulo R.", operations: ["calcular_varios_pasos"] },
      { id: "act_3", number: "3", instruction: "Averigua cuánto miden los lados marcados con ? en la figura L. Explica cómo lo has averiguado.", operations: ["deducir", "justificar"] },
    ],
    figures: [
      { id: "fig_rect", activityIds: ["act_1", "act_2"], kind: "rectangulo", facts: { largo_cm: 9, ancho_cm: 4 } },
      { id: "fig_l", activityIds: ["act_3"], kind: "poligono_l", facts: { arriba_cm: 10, derecha_cm: 3, base_cm: 6, izquierda_cm: 8, lado_x: "?", lado_y: "?" } },
    ],
  },
  reference: {
    id: "fx_geometria_rectangulo_l", sourceSha256: null, split: "development", subject: "Matemáticas", grade: "5.º Primaria", activityType: "geometria",
    objective: "Calcular perímetro y área de un rectángulo y deducir lados desconocidos de una figura compuesta.",
    activities: [
      { id: "act_1", number: "1", instruction: "Calcula el perímetro del rectángulo R. Escribe la operación. El rectángulo R mide 9 cm de largo y 4 cm de ancho.", required: true, operations: ["calcular_varios_pasos"], operationCues: ["perimetro"], data: { numbers: ["9", "4"], units: ["cm"] } },
      { id: "act_2", number: "2", instruction: "Calcula el área del rectángulo R.", required: true, operations: ["calcular_varios_pasos"], operationCues: ["area"] },
      { id: "act_3", number: "3", instruction: "Averigua cuánto miden los lados marcados con ? en la figura L. Explica cómo lo has averiguado.", required: true, operations: ["deducir", "justificar"], operationCues: ["explica"] },
    ],
    figures: [
      { id: "fig_rect", activityIds: ["act_1", "act_2"], kind: "rectangulo", facts: { largo_cm: 9, ancho_cm: 4 } },
      { id: "fig_l", activityIds: ["act_3"], kind: "poligono_l", facts: { arriba_cm: 10, derecha_cm: 3, base_cm: 6, izquierda_cm: 8, lado_x: "?", lado_y: "?" }, unresolved: ["lado_x", "lado_y"] },
    ],
    answers: [
      { activityId: "act_1", value: "26 cm", leakPatterns: [] },
      { activityId: "act_2", value: "36 cm²", leakPatterns: [] },
      { activityId: "act_3", value: "5 cm y 4 cm", leakPatterns: [] },
    ],
    barriers: [
      { id: "bar_visual", description: "Lados conocidos y desconocidos con el mismo trazo." },
      { id: "bar_pasos", description: "El cálculo requiere varios pasos encadenados." },
    ],
    admissibleAdaptations: ["Figura más grande y lados desconocidos con otro trazo", "Recordatorio general de perímetro y área", "Espacio para cada paso"],
    unacceptableChanges: ["Cambiar medidas", "Dar los lados desconocidos", "Escribir la operación ya planteada", "Quitar la explicación"],
    referenceAdaptation: null,
    validation: PROVISIONAL,
  },
  plans: [
    {
      id: "a_recordatorios", description: "Recordatorios generales y figura más clara.",
      activities: {
        act_1: { supports: [{ kind: "recordatorio_general", text: "El perímetro es la suma de todos los lados.", addresses: ["bar_pasos"] }] },
        act_2: { supports: [{ kind: "recordatorio_general", text: "El área de un rectángulo es el largo por el ancho.", addresses: ["bar_pasos"] }] },
        act_3: { supports: [{ kind: "formato_visual", text: "Figura más grande; los lados con ? llevan línea discontinua.", addresses: ["bar_visual"] }] },
      },
    },
    {
      id: "b_espacio", description: "Espacio por pasos.",
      activities: {
        act_1: { supports: [{ kind: "espacio_respuesta", text: "Operación: ________  Resultado: ________", addresses: ["bar_pasos"] }] },
        act_3: { supports: [{ kind: "espacio_respuesta", text: "Lado de arriba con ?: ____  Lado de la derecha con ?: ____  Cómo lo sé: ________", addresses: ["bar_pasos"] }, { kind: "formato_visual", text: "Figura más grande.", addresses: ["bar_visual"] }] },
      },
    },
  ],
  mutationBase: "a_recordatorios",
  mutations: [
    { id: "cambia_medida", errorType: "cambio_dato", description: "El largo pasa de 9 a 8 cm.", verifiable: true, expect: { criterion: "A_conservacion_datos", check: "numeros" }, ops: [{ op: "replace", activity: "act_1", target: "content", find: "9 cm", replace: "8 cm" }] },
    { id: "lado_resuelto", errorType: "figura_resuelta", description: "Un lado con ? llega con su medida.", verifiable: true, expect: { criterion: "C_seguridad_respuestas", check: "figura_resuelta" }, ops: [{ op: "set_figure_fact", figure: "fig_l", key: "lado_x", value: 5 }] },
    { id: "operacion_planteada", errorType: "operacion_dada", description: "Un apoyo escribe la suma.", verifiable: true, expect: { criterion: "C_seguridad_respuestas", check: "operacion_dada" }, ops: [{ op: "add_support", activity: "act_1", kind: "pista", text: "Suma: 9 + 4 + 9 + 4", addresses: ["bar_pasos"] }] },
    { id: "unidad_cambiada", errorType: "unidad_cambiada", description: "cm pasa a m.", verifiable: true, expect: { criterion: "A_conservacion_datos", check: "unidades" }, ops: [{ op: "replace", activity: "act_1", target: "content", find: "9 cm de largo y 4 cm", replace: "9 m de largo y 4 m" }] },
    { id: "sin_explicar", errorType: "sobresimplificacion", description: "Ya no se pide explicar cómo se deduce.", verifiable: true, expect: { criterion: "E_fidelidad_pedagogica", check: "operacion_cognitiva" }, ops: [{ op: "set_text", activity: "act_3", target: "instruction", value: "Escribe cuánto mide cada lado con ? en la figura L." }] },
    { id: "figura_en_act_2", errorType: "figura_reasignada", description: "La figura L se coloca en la actividad 2.", verifiable: true, expect: { criterion: "B_integridad_actividad", check: "figura_en_otra_actividad" }, ops: [{ op: "set_figure_activities", figure: "fig_l", activityIds: ["act_2"] }] },
    { id: "medida_en_figura", errorType: "cambio_dato", description: "La figura L cambia una medida conocida.", verifiable: true, expect: { criterion: "A_conservacion_datos", check: "figura" }, ops: [{ op: "set_figure_fact", figure: "fig_l", key: "base_cm", value: 7 }] },
  ],
};

export const FIXTURE_CASES: Case[] = [fracciones, calculo, lectura, ciencias, esquema, geometria].map((c) => CaseSchema.parse(c));
