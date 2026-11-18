import type { FunctionalProfile } from "@/lib/schemas/functional-profile";
import type { RecreationPlan } from "@/lib/recreation/contract";

/**
 * Pilot of the recreation engine on «Un estanque en equilibrio» (tests/support/pond-case.ts, 5.º de Primaria, Ciencias).
 *
 * WHAT THIS IS: a plan written BY HAND in the exact contract a model will produce (recreation_plan@v1), standing in for the model
 * so that the pilot runs without paid calls. It is not evidence that a model writes plans like this one; it is evidence that the
 * contract can express real new activities and that the server checks, solves and prints them. Every quote below is checked word for
 * word against the analysis; no solution of a closed activity is written here except the claims the verifier marks «anchored».
 *
 * Profile of the pilot: reading and writing difficulties, functional needs only (no name, tag or free text). Seven activities for the five
 * objectives (every operation of the original kept), cards and a sorting board for the classification, one context illustration, and
 * the teacher's explanation written in the same plan.
 */
export const POND_PILOT_PROFILE: FunctionalProfile = {
  schema_version: 2,
  supports: {
    decoding_support: "medium",
    reading_chunk_size: "medium",
    text_length: "low",
    font_size: "low",
    line_spacing: "low",
    instruction_chunking: "medium",
    writing_amount: "high",
    selection_based_response: "medium",
    expressive_language_support: "medium",
  },
  limits: {},
  allowances: {},
};

export const POND_RECREATION_PLAN: RecreationPlan = {
  contract: "recreation_plan@v1",
  scope: { type: "methodological" },
  title: "Un estanque en equilibrio",
  objectives: [
    { objective_id: "obj_1", level: "kept", operations: ["identify", "locate_evidence"] },
    { objective_id: "obj_2", level: "kept", operations: ["classify"] },
    { objective_id: "obj_3", level: "kept", operations: ["interpret_relation", "predict", "justify"] },
    { objective_id: "obj_4", level: "kept", operations: ["calculate"] },
    { objective_id: "obj_5", level: "kept", operations: ["locate_evidence", "evaluate_claim", "justify", "propose"] },
  ],
  reading: { source_ref: "ctt_1", part_titles: ["Parte 1. Quién vive en el estanque", "Parte 2. Qué cambió de mayo a junio", "Parte 3. Qué quieren averiguar"] },
  facts: [
    { id: "f_1", kind: "membership", source_ref: "ctt_3", quote: "Algas", item: "Algas", category_id: "cat_1" },
    { id: "f_2", kind: "membership", source_ref: "ctt_3", quote: "Agua", item: "Agua", category_id: "cat_2" },
    { id: "f_3", kind: "membership", source_ref: "ctt_3", quote: "Larvas de insectos", item: "Larvas de insectos", category_id: "cat_1" },
    { id: "f_4", kind: "membership", source_ref: "ctt_3", quote: "Luz solar", item: "Luz solar", category_id: "cat_2" },
    { id: "f_5", kind: "membership", source_ref: "ctt_3", quote: "Garzas", item: "Garzas", category_id: "cat_1" },
    { id: "f_6", kind: "membership", source_ref: "ctt_3", quote: "Temperatura", item: "Temperatura", category_id: "cat_2" },
    { id: "f_12", kind: "statement", source_ref: "ctt_1", quote: "Algunas larvas se alimentan de algas" },
    { id: "f_13", kind: "quantity", source_ref: "ctt_1", quote: "era de 30 centímetros", value: 30, unit: "cm", label: "Profundidad en mayo" },
    { id: "f_14", kind: "quantity", source_ref: "ctt_1", quote: "bajó a 18 centímetros", value: 18, unit: "cm", label: "Profundidad en junio" },
  ],
  strategies: [
    { id: "st_1", method: "segmented_reading", needs: ["reading_chunk_size", "decoding_support"], rationale: "El texto original se lee por partes con título: se localiza la información sin releerlo todo." },
    { id: "st_2", method: "selection_response", needs: ["writing_amount", "selection_based_response"], rationale: "Se responde marcando o colocando tarjetas donde lo evaluado no es la escritura." },
    { id: "st_3", method: "manipulative_sorting", needs: ["selection_based_response"], rationale: "Tarjetas y tablero para clasificar moviendo piezas antes de anotar la letra." },
    { id: "st_4", method: "sentence_frames", needs: ["expressive_language_support", "writing_amount"], rationale: "Inicios de frase neutros para empezar a explicar sin dar la conclusión." },
    { id: "st_5", method: "guided_sequence", needs: ["instruction_chunking"], rationale: "Pasos cortos de trabajo (dónde mirar, qué entregar), nunca cómo se resuelve." },
    { id: "st_6", method: "visual_organizer", needs: ["decoding_support"], rationale: "El esquema del original redibujado con sus rótulos: menos texto para seguir la relación." },
  ],
  activities: [
    {
      id: "ra_1",
      objective_ids: ["obj_2"],
      operations: ["classify"],
      strategy_ids: ["st_3", "st_2"],
      prompt: "¿Cada componente del estanque es un ser vivo o un elemento no vivo? Coloca las tarjetas en el tablero y después escribe la letra en cada casilla.",
      steps: [],
      visual_ids: [],
      executor: { kind: "classify", categories: [{ id: "cat_1", label: "Ser vivo" }, { id: "cat_2", label: "Elemento no vivo" }], item_fact_ids: ["f_1", "f_2", "f_3", "f_4", "f_5", "f_6"] },
    },
    {
      id: "ra_2",
      objective_ids: ["obj_1"],
      operations: ["identify", "locate_evidence"],
      strategy_ids: ["st_1", "st_4"],
      prompt: "Lee la parte 2. Escribe dos cambios del estanque entre mayo y junio. Para cada uno, copia las palabras del texto que lo demuestran.",
      steps: [],
      visual_ids: [],
      executor: { kind: "short_answer", lines: 4, starters: ["Un cambio es", "En el texto pone"], criteria: ["Escribe dos cambios de la parte 2 (el nivel del agua bajó; algunas plantas quedaron fuera; hubo menos refugio; se vieron menos larvas).", "Para cada uno copia o señala el fragmento que lo dice; no se valora la ortografía de la copia."] },
    },
    {
      id: "ra_3",
      objective_ids: ["obj_3"],
      operations: ["interpret_relation"],
      strategy_ids: ["st_6", "st_2"],
      prompt: "Mira el esquema. ¿Qué indica la flecha que va de las algas a las larvas de insectos? Marca una respuesta.",
      steps: [],
      visual_ids: ["rv_1"],
      executor: {
        kind: "select",
        correct_count: 1,
        options: [
          { text: "Que las algas son más grandes que las larvas.", correct: false, evidence_fact_id: null },
          { text: "Que las larvas de insectos se alimentan de algas.", correct: true, evidence_fact_id: "f_12" },
          { text: "Que las algas se alimentan de larvas.", correct: false, evidence_fact_id: null },
          { text: "Que las larvas viven encima de las algas.", correct: false, evidence_fact_id: null },
        ],
      },
    },
    {
      id: "ra_4",
      objective_ids: ["obj_3"],
      operations: ["predict", "justify"],
      strategy_ids: ["st_4"],
      prompt: "Imagina que casi desaparecen las larvas de insectos. ¿Qué les pasaría a las ranas? Explica tu idea con el esquema.",
      steps: [],
      visual_ids: [],
      executor: { kind: "short_answer", lines: 3, starters: ["Creo que las ranas", "porque en el esquema"], criteria: ["Predice una consecuencia para las ranas (tendrían menos alimento, podrían disminuir).", "La justifica con la relación alimentaria del esquema."] },
    },
    {
      id: "ra_5",
      objective_ids: ["obj_4"],
      operations: ["calculate"],
      strategy_ids: ["st_5"],
      prompt: "Busca en la parte 2 cuánto medía el agua en mayo y en junio. Calcula cuántos centímetros bajó.",
      steps: ["Escribe la operación.", "Escribe el resultado y su unidad."],
      visual_ids: [],
      executor: { kind: "compute", operation: "difference", minuend_fact_id: "f_13", subtrahend_fact_id: "f_14" },
    },
    {
      id: "ra_6",
      objective_ids: ["obj_5"],
      operations: ["evaluate_claim", "justify", "locate_evidence"],
      strategy_ids: ["st_4"],
      prompt: "Lee esta idea: «Si baja el agua, todos los seres vivos del estanque se ven afectados exactamente igual». ¿Estás de acuerdo? Explica con una prueba del texto.",
      steps: [],
      visual_ids: [],
      executor: { kind: "short_answer", lines: 3, starters: ["Estoy / No estoy de acuerdo porque", "El texto dice que"], criteria: ["Toma postura y la apoya en el texto.", "Prueba de la parte 2: no todos los seres vivos se afectan de la misma manera."] },
    },
    {
      id: "ra_7",
      objective_ids: ["obj_5"],
      operations: ["propose", "justify"],
      strategy_ids: ["st_4"],
      prompt: "Piensa una medida para cuidar el estanque. Di a qué ser vivo y a qué elemento no vivo ayudaría.",
      steps: [],
      visual_ids: [],
      executor: { kind: "short_answer", lines: 3, starters: ["Yo propongo", "Ayudaría a"], criteria: ["Propone una medida viable para un estanque.", "Nombra un ser vivo y un elemento no vivo y explica cómo les ayuda."] },
    },
  ],
  visuals: [{ id: "rv_1", kind: "flow", title: "Esquema del estanque", items: ["Algas", "Larvas de insectos", "Ranas", "Garzas"], source_ref: "vis_2" }],
  visual_style: "Ilustración naturalista de trazo limpio y contornos marcados, colores suaves de naturaleza (verdes, azules y ocres), sin ningún texto; comprensible en blanco y negro.",
  visual_requests: [
    {
      id: "vr_1",
      activity_ids: ["ra_1"],
      objective_ids: ["obj_2"],
      function: "context",
      purpose: "Reconocer los componentes que nombra la parte 1 del texto (algas, plantas acuáticas, larvas, ranas, garzas, agua y luz) antes de clasificarlos, con menos dependencia de la lectura.",
      concepts: ["estanque", "seres vivos y elementos del medio"],
      must_show: ["agua del estanque", "algas", "plantas acuáticas en la orilla", "una rana", "una garza", "el sol"],
      prohibited: ["un animal comiendo a otro", "grupos o separaciones que sugieran qué es ser vivo y qué no", "nivel del agua bajando o plantas secas"],
      needs_exact: { labels: false, arrows: false, numbers: false },
      style: "simple_illustration",
      detail: "simple",
      alt_text: "Dibujo de un estanque con agua, algas, plantas acuáticas en la orilla, una rana, una garza y el sol.",
      accessibility: "Líneas de contorno marcadas y buen contraste en blanco y negro; ningún elemento se reconoce solo por su color.",
      original_ref: null,
      essential: false,
      for_cards: null,
    },
    {
      id: "vr_2",
      activity_ids: ["ra_1"],
      objective_ids: ["obj_2"],
      function: "observation",
      purpose: "Que cada tarjeta muestre lo que nombra, para clasificar observando y no solo leyendo la palabra.",
      concepts: ["componentes del estanque"],
      must_show: ["el elemento, solo, centrado, sobre fondo claro", "mismo encuadre y escala que las demás tarjetas"],
      prohibited: ["cualquier marco, color de fondo o símbolo que distinga unas tarjetas de otras", "escenas con varios elementos", "rasgos infantiles o caricaturescos"],
      needs_exact: { labels: false, arrows: false, numbers: false },
      style: "simple_illustration",
      detail: "simple",
      alt_text: "Ilustración del elemento que nombra la tarjeta.",
      accessibility: "Silueta clara y contraste suficiente para reconocerlo impreso en blanco y negro.",
      original_ref: null,
      essential: false,
      for_cards: "rm_1",
    },
  ],
  materials: [
    { id: "rm_1", kind: "cut_out_cards", activity_id: "ra_1", purpose: "Clasificar moviendo piezas antes de escribir.", instructions: "Recorta las tarjetas por la línea de puntos.", cards: ["Algas", "Agua", "Larvas de insectos", "Luz solar", "Garzas", "Temperatura"] },
    { id: "rm_2", kind: "sorting_board", activity_id: "ra_1", purpose: "Un lugar para cada grupo donde colocar las tarjetas.", instructions: "Coloca cada tarjeta en su columna. Puedes cambiarla de sitio hasta estar seguro.", columns: ["Ser vivo", "Elemento no vivo"] },
  ],
  explanation: {
    adapted: [
      "Se trabajan los mismos cinco objetivos que en la ficha original: los cambios del estanque, los seres vivos y los elementos no vivos, la cadena alimentaria, el cálculo de cuánto bajó el agua y la valoración de una idea con una propuesta para cuidarlo.",
      "Hay siete actividades nuevas: clasificar con tarjetas y un tablero, escribir dos cambios con su prueba, interpretar una flecha del esquema, predecir qué les pasaría a las ranas, calcular escribiendo la operación, valorar una idea y proponer una medida.",
      "El texto original se mantiene igual, dividido en tres partes con título, y se añade una ilustración del estanque para reconocer sus componentes antes de empezar.",
    ],
    why: [
      { text: "El texto se lee por partes y cada actividad dice en qué parte buscar: así se encuentra la información sin releerlo entero.", needs: ["reading_chunk_size", "decoding_support"] },
      { text: "Donde lo que se aprende no es escribir, se responde colocando tarjetas o marcando; donde hay que explicar, la respuesta es breve y empieza con un inicio de frase.", needs: ["writing_amount", "selection_based_response", "expressive_language_support"] },
      { text: "Las consignas son cortas y van en pasos cuando hay más de una cosa que hacer.", needs: ["instruction_chunking"] },
    ],
    how_to_use: [
      "Antes de la clase, imprima la ficha y la hoja de materiales; recorte las tarjetas o deje que el alumno lo haga.",
      "Empiece por la ilustración: pídale que señale lo que reconoce del estanque antes de leer.",
      "Lean juntos el título de cada parte; el alumno lee una parte cada vez, cuando la actividad lo pide.",
      "En la actividad 1, deje que coloque las tarjetas en el tablero y que después escriba las letras en la ficha.",
      "En las respuestas escritas, recuérdele los inicios de frase y acepte una respuesta oral si escribir le bloquea.",
    ],
  },
  guide: {
    per_activity: [
      { activity_id: "ra_1", observe: "Si duda con agua, luz o temperatura, pregunte si nacen, crecen o se reproducen; no le diga el grupo." },
      { activity_id: "ra_2", observe: "Que busque en la parte 2 antes de escribir; valore la localización, no la ortografía de la copia." },
      { activity_id: "ra_3", observe: "Lea el esquema con él si lo necesita; la interpretación de la flecha es suya." },
      { activity_id: "ra_4", observe: "Admita la respuesta oral si escribir le bloquea; anote la idea, no la forma." },
      { activity_id: "ra_5", observe: "Compruebe que escribe la operación además del resultado." },
      { activity_id: "ra_6", observe: "Cualquier postura vale si la defiende con una prueba del texto." },
      { activity_id: "ra_7", observe: "Que nombre un ser vivo y un elemento no vivo." },
    ],
  },
};
