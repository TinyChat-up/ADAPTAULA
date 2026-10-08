import { createHash } from "node:crypto";
import path from "node:path";
import { GlobalFonts, createCanvas } from "@napi-rs/canvas";
import { MaterialDocumentSchema, type Block, type MaterialDocument } from "@/lib/schemas/material-document";
import type { Presentation } from "@/lib/schemas/adaptation-context";
import type { PinnedAsset } from "@/lib/render/print/pinned-assets";

/**
 * Phase 8 · visual QA. Five small, deterministic, synthetic sheets that look like what the pipeline delivers (adapted wording,
 * the block types an adaptation adds), written by hand: no model, no private material. They exist to JUDGE the printed product
 * (docs/qa/phase8), not to pin the renderer: nothing in the renderer may know about them.
 */

const trace = { origin: "adapted" as const, source_refs: [] as string[], decision_ids: [] as string[] };
let seq = 0;
const id = () => `blk_qa${String(++seq).padStart(5, "0")}`;
const opts = (texts: string[], prefix = "o") => texts.map((text, i) => ({ id: `${prefix}${i + 1}`, text }));

export const b = {
  h: (text: string, level: 1 | 2 | 3 = 2): Block => ({ id: id(), type: "heading", level, text, trace }),
  p: (text: string): Block => ({ id: id(), type: "paragraph", text, trace }),
  instruction: (text: string, steps?: string[]): Block => ({ id: id(), type: "instruction", text, ...(steps ? { steps } : {}), trace }),
  reading: (paragraphs: string[], title?: string, labels?: string[]): Block => ({ id: id(), type: "reading_text", ...(title ? { title } : {}), paragraphs, literal: true, ...(labels ? { segment_labels: labels } : {}), trace }),
  activity: (label: string, prompt: string, response: Extract<Block, { type: "activity" }>["response"], extra: { steps?: string[]; requirements?: string[] } = {}): Block => ({ id: id(), type: "activity", label, prompt, ...extra, response, trace }),
  help: (variant: "key_idea" | "reminder" | "tip" | "strategy", text: string, title?: string): Block => ({ id: id(), type: "help_box", variant, text, ...(title ? { title } : {}), trace }),
  checklist: (items: string[], title?: string): Block => ({ id: id(), type: "checklist", items, ...(title ? { title } : {}), trace }),
  vocab: (items: Array<{ term: string; definition: string }>, title?: string): Block => ({ id: id(), type: "vocabulary", items, ...(title ? { title } : {}), trace }),
  example: (problem: string, steps: string[], result: string, title?: string): Block => ({ id: id(), type: "worked_example", problem, steps, result, ...(title ? { title } : {}), trace }),
  starters: (items: string[]): Block => ({ id: id(), type: "sentence_starters", items, trace }),
  planner: (slots: Array<{ label: string; lines: number }>, title?: string): Block => ({ id: id(), type: "planner", slots, ...(title ? { title } : {}), trace }),
  table: (headers: string[], rows: string[][], caption?: string, unit?: string): Block => ({ id: id(), type: "table", headers, rows, ...(caption ? { caption } : {}), ...(unit ? { unit } : {}), trace }),
  chart: (title: string, categories: string[], values: number[], yLabel: string): Block => ({ id: id(), type: "chart", title, chart_type: "bar", categories, series: [{ label: null, values }], y_label: yLabel, trace }),
  image: (visual: string, caption: string): Block => ({ id: id(), type: "image", source: { kind: "original", visual_ref: visual }, alt_text: caption, caption, trace }),
  math: (latex: string, spoken: string): Block => ({ id: id(), type: "math", latex, display: "block", spoken_text: spoken, trace }),
};

const PRESENTATION: Presentation = { font_scale: 1, line_spacing: "normal", spacing: "normal", contrast: "normal", decoration: "standard", max_tasks_per_page: null, color_independent: true, text_alternatives_for_visuals: true };
const FIELDS = [
  { type: "student_name" as const, label: "Nombre" },
  { type: "date" as const, label: "Fecha" },
];

export function sheet(meta: { title: string; stage: string; grade: string; subject: string; topic: string }, pages: Block[][], presentation: Partial<Presentation> = {}): MaterialDocument {
  return MaterialDocumentSchema.parse({
    schema_version: 1,
    meta: { ...meta, language: "es" },
    presentation: { ...PRESENTATION, ...presentation },
    admin_fields: FIELDS,
    pages: pages.map((blocks) => ({ blocks })),
    answer_key: [],
  });
}

/**
 * A · Primaria (5.º): every common answer type. Activity 7 asks for two equivalent fractions of 3/5: it is answered in a table of
 * operations (the factor, numerator × factor, denominator × factor, the result), not in a generic grid, after an analogous example.
 */
export const primary = (): MaterialDocument => {
  const ops = b.table(["", "Multiplico por", "Numerador (3 × …)", "Denominador (5 × …)", "Fracción equivalente"], [["Primera", "", "", "", ""], ["Segunda", "", "", "", ""]], "Tabla de operaciones");
  return sheet({ title: "Fracciones equivalentes", stage: "primaria", grade: "5-primaria", subject: "Matemáticas", topic: "Fracciones" }, [
    [
      b.h("Fracciones equivalentes", 1),
      b.instruction("Lee cada pregunta con calma. Si dudas, vuelve al recuadro **Recuerda**."),
      b.help("reminder", "Dos fracciones son **equivalentes** cuando representan la misma parte de un todo. Se obtiene una fracción equivalente multiplicando el numerador y el denominador **por el mismo número**."),
      b.math("\\frac{1}{2} = \\frac{1 \\times 2}{2 \\times 2} = \\frac{2}{4}", "un medio es igual a uno por dos entre dos por dos, que es igual a dos cuartos"),
      b.activity("1", "Escribe una fracción equivalente a **1/3**.", { kind: "lines", lines: 1 }),
      b.activity("2", "¿Qué fracción es equivalente a **2/4**?", { kind: "choice", multiple: false, options: opts(["1/2", "1/4", "3/4"]) }),
      b.activity("3", "Completa con el número que falta.", { kind: "fill_blank", text: "1/2 = {{a}}/6     y     3/4 = 6/{{b}}", word_bank: ["3", "8", "5"] }),
      b.activity("4", "Marca si es verdadero (V) o falso (F).", { kind: "true_false", statements: opts(["3/6 es lo mismo que 1/2.", "1/4 es mayor que 1/2.", "2/8 y 1/4 son equivalentes."]) }),
      b.activity("5", "Une cada fracción con su equivalente.", { kind: "match", left: opts(["1/2", "1/5", "2/3"]), right: opts(["4/6", "2/10", "5/10"], "r") }),
      b.activity("6", "Ana come 2/8 de una pizza y Luis come 1/4. ¿Han comido lo mismo? Explica cómo lo sabes.", { kind: "lines", lines: 3 }),
      { ...b.activity("7", "Encuentra dos fracciones equivalentes a **3/5**. Elige un número, multiplica por él el numerador y el denominador y escribe la fracción que obtienes.", { kind: "table_cells" }), resource_block_ids: [ops.id] } as Block,
      ops,
    ],
  ]);
};

/**
 * B · Primaria with more structure (working-memory support, max 3 tasks per page): the reading comes in parts and each part is
 * followed by its question, so the instruction «lee una parte y responde» can be followed literally. The three terms are named in
 * the text before they are assessed, and the cycle is first organised in a partly structured scheme (in the scientific order:
 * evaporation → water vapour → condensation → clouds → precipitation → back to rivers and sea; the word bank is not in that
 * order, so it does not give the answer away), then drawn. One logical page: the profile's «3 tasks per page» groups the
 * activities evenly (2 · 3 · 2), the browser paginates the rest.
 */
export const primaryStructured = (): MaterialDocument =>
  sheet(
    { title: "El ciclo del agua", stage: "primaria", grade: "4-primaria", subject: "Ciencias de la Naturaleza", topic: "El ciclo del agua" },
    [
      [
        b.h("El ciclo del agua", 1),
        b.instruction("Vamos a trabajar paso a paso.", ["Lee una parte del texto.", "Responde a la pregunta de esa parte.", "Después, pasa a la parte siguiente."]),
        b.reading(["El sol calienta el agua de los mares y los ríos. El agua se convierte en vapor y sube al cielo. Este cambio se llama **evaporación**."], "Un viaje sin fin", ["Parte 1"]),
        b.activity("1", "¿Qué hace el sol con el agua del mar?", { kind: "lines", lines: 2 }),
        b.reading(["Arriba hace frío. El vapor se enfría y forma pequeñas gotas. Así nacen las nubes. Este cambio se llama **condensación**."], undefined, ["Parte 2"]),
        b.activity("2", "¿Cómo se forman las nubes?", { kind: "lines", lines: 2 }),
        b.reading(["Cuando las gotas pesan mucho, caen en forma de lluvia o de nieve. Esto se llama **precipitación**. El agua vuelve a los ríos y al mar, y el viaje empieza otra vez."], undefined, ["Parte 3"]),
        b.activity("3", "¿Qué pasa cuando las gotas de las nubes pesan mucho?", { kind: "lines", lines: 2 }),
        b.help("key_idea", "El agua **cambia de estado**, pero no desaparece: siempre vuelve a empezar el viaje."),
        b.activity("4", "Ordena lo que le pasa al agua. Escribe 1, 2 y 3 en los cuadros.", { kind: "order", items: opts(["Se forman las nubes.", "El agua se evapora.", "Llueve."]) }),
        b.activity("5", "Une cada palabra con lo que significa.", { kind: "match", left: opts(["Evaporación", "Condensación", "Precipitación"]), right: opts(["El agua cae de las nubes.", "El agua se convierte en vapor.", "El vapor forma gotas."], "r") }),
        b.activity("6", "Completa el esquema del ciclo. En cada hueco, escribe el nombre del cambio con una palabra del recuadro.", { kind: "fill_blank", text: "Agua del mar  →  {{a}}  →  vapor de agua  →  {{b}}  →  nubes  →  {{c}}  →  el agua vuelve a los ríos y al mar", word_bank: ["precipitación", "evaporación", "condensación"] }),
        b.activity("7", "Ahora dibuja el ciclo del agua siguiendo tu esquema: el mar, el vapor, las nubes y la lluvia. En cada flecha, escribe el nombre del cambio.", { kind: "box", size: "medium" }),
        b.checklist(["He leído las tres partes.", "He respondido a todas las preguntas.", "Cada flecha de mi dibujo tiene el nombre de su cambio."], "Antes de terminar"),
      ],
    ],
    { font_scale: 1.15, line_spacing: "relaxed", spacing: "wide", decoration: "reduced", max_tasks_per_page: 3 },
  );

/**
 * C · ESO: the general instruction no longer asks for full sentences everywhere (activity 2 is answered with «sí»/«no» and 3 by
 * ticking): only the written answers say so. The table activity comes before its table, and the sentence starters follow the
 * activity they help (the renderer shows them between its prompt and its lines).
 */
export const eso = (): MaterialDocument => {
  const cells = b.table(["Estructura", "Célula animal", "Célula vegetal"], [["Núcleo", "", ""], ["Pared celular", "", ""], ["Cloroplastos", "", ""]], "Tabla 1. Estructuras celulares");
  return sheet({ title: "La célula: unidad de vida", stage: "eso", grade: "1-eso", subject: "Biología y Geología", topic: "La célula" }, [
    [
      b.h("La célula: unidad de vida", 1),
      b.instruction("Lee el texto y consulta el vocabulario antes de responder."),
      b.reading([
        "Todos los seres vivos están formados por células. Algunos organismos, como las bacterias, tienen una sola célula; otros, como las plantas y los animales, tienen millones de ellas.",
        "Las células eucariotas tienen un núcleo que guarda el material genético. Las procariotas no tienen núcleo: su material genético está libre en el citoplasma.",
        "Las células vegetales, además, tienen pared celular y cloroplastos, que les permiten fabricar su propio alimento mediante la fotosíntesis.",
      ]),
      b.vocab(
        [
          { term: "Núcleo", definition: "Parte de la célula que contiene el material genético." },
          { term: "Citoplasma", definition: "Medio interno de la célula, donde están los orgánulos." },
          { term: "Cloroplasto", definition: "Orgánulo de las células vegetales donde se realiza la fotosíntesis." },
        ],
        "Vocabulario",
      ),
      b.h("Comprueba lo que has leído", 2),
      b.activity("1", "¿Qué diferencia principal hay entre una célula eucariota y una procariota?", { kind: "lines", lines: 3 }, { requirements: ["Responde con una frase completa"] }),
      { ...b.activity("2", "Completa la tabla 1: escribe «sí» o «no» en cada casilla.", { kind: "table_cells" }), resource_block_ids: [cells.id] } as Block,
      cells,
      b.activity("3", "¿Qué afirmaciones son correctas? Marca todas las que lo sean.", { kind: "choice", multiple: true, options: opts(["Las bacterias son organismos unicelulares.", "Las células animales tienen cloroplastos.", "El núcleo guarda el material genético.", "Todas las células tienen pared celular."]) }),
      b.activity("4", "Explica por qué las plantas pueden fabricar su propio alimento y los animales no.", { kind: "lines", lines: 5 }, { requirements: ["Responde con frases completas"] }),
      b.starters(["Una célula vegetal se diferencia de una animal en que", "Esto le permite"]),
    ],
  ]);
};

/**
 * D · Bachillerato: the full commentary, one logical page (the browser paginates). Each organiser follows the essay it prepares
 * (the renderer shows it between the prompt with its requirements and the writing lines). Requirements and lengths unchanged.
 */
export const bachillerato = (): MaterialDocument =>
  sheet(
    { title: "Comentario de texto: el contrato social", stage: "bachillerato", grade: "2-bachillerato", subject: "Historia de la Filosofía", topic: "Rousseau" },
    [
      [
        b.h("Comentario de texto: el contrato social", 1),
        b.instruction("Lee el fragmento con atención. Después, realiza las actividades en el orden propuesto. Cita el texto cuando lo necesites."),
        b.reading(
          [
            "«Encontrar una forma de asociación que defienda y proteja con toda la fuerza común la persona y los bienes de cada asociado, y por la cual cada uno, uniéndose a todos, no obedezca sin embargo más que a sí mismo y permanezca tan libre como antes.» Tal es el problema fundamental cuya solución da el contrato social.",
            "Las cláusulas de este contrato están de tal modo determinadas por la naturaleza del acto que la menor modificación las haría vanas y de ningún efecto; de suerte que, aunque quizá nunca hayan sido enunciadas formalmente, son en todas partes las mismas, en todas partes tácitamente admitidas y reconocidas.",
            "Estas cláusulas, bien entendidas, se reducen todas a una sola, a saber: la enajenación total de cada asociado con todos sus derechos a toda la comunidad. Porque, en primer lugar, al darse cada uno por entero, la condición es igual para todos; y siendo la condición igual para todos, nadie tiene interés en hacerla onerosa para los demás.",
          ],
          "J.-J. Rousseau, Del contrato social (1762), libro I, cap. VI",
        ),
        b.h("Actividades", 2),
        b.activity("1", "Identifica la **tesis** del fragmento y formúlala con tus propias palabras.", { kind: "lines", lines: 3 }),
        b.activity("2", "Explica el significado de la expresión «enajenación total» en el contexto del texto.", { kind: "lines", lines: 4 }),
        b.activity("3", "Relaciona el fragmento con la teoría política de Rousseau y compárala con la de Hobbes o Locke.", { kind: "lines", lines: 10 }, { requirements: ["Entre 150 y 200 palabras", "Menciona la voluntad general", "Incluye al menos una comparación argumentada"] }),
        b.planner([{ label: "Idea principal", lines: 2 }, { label: "Conceptos clave", lines: 2 }, { label: "Comparación", lines: 3 }], "Organiza tu respuesta antes de escribir"),
        b.activity("4", "Valora críticamente la vigencia del planteamiento de Rousseau en las democracias actuales.", { kind: "lines", lines: 12 }, { requirements: ["Entre 200 y 250 palabras", "Al menos un ejemplo actual"] }),
        b.checklist(["La tesis está formulada con mis palabras.", "He citado el texto cuando era necesario.", "He respetado la extensión pedida."], "Antes de entregar"),
      ],
    ],
  );

/**
 * E · The original visual (a crop of the source sheet) with its months, axes and units, so «¿en qué mes…?» can be answered. The
 * seasonal chart is computed from the same monthly data. The instruction separates what is observed from what the student must
 * bring: the type of climate needs what was studied, not only the image.
 */
export const CLIMATE = {
  months: ["E", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"],
  rainMm: [110, 95, 80, 70, 45, 20, 8, 12, 40, 85, 105, 120],
  tempC: [6, 8, 11, 13, 17, 22, 26, 25, 21, 15, 10, 7],
};
const seasons = () => {
  const r = CLIMATE.rainMm;
  return [r[11]! + r[0]! + r[1]!, r[2]! + r[3]! + r[4]!, r[5]! + r[6]! + r[7]!, r[8]! + r[9]! + r[10]!];
};
export const visualCrop = (): MaterialDocument =>
  sheet({ title: "El clima de Valdeloma", stage: "eso", grade: "1-eso", subject: "Geografía e Historia", topic: "El clima" }, [
    [
      b.h("El clima de Valdeloma", 1),
      b.instruction("Observa el climograma: los datos de las actividades 01, 02 y 03 están en él. Para la actividad 04 necesitarás también lo que has estudiado sobre los tipos de clima."),
      b.image("vis_1", "Climograma de Valdeloma: precipitaciones (barras, mm) y temperatura media (línea, °C) de cada mes"),
      b.activity("1", "¿En qué mes llueve más? ¿Y en cuál menos?", { kind: "lines", lines: 2 }),
      b.activity("2", "Describe cómo cambia la temperatura a lo largo del año.", { kind: "lines", lines: 3 }),
      b.chart("Precipitaciones por estación (suma de sus tres meses)", ["Invierno", "Primavera", "Verano", "Otoño"], seasons(), "mm"),
      b.activity("3", "Según el gráfico, ¿qué estación es la más seca? Justifica tu respuesta con un dato.", { kind: "lines", lines: 2 }),
      b.activity("4", "Con los datos del climograma y lo que has estudiado, ¿qué tipo de clima tiene Valdeloma?", { kind: "choice", multiple: false, options: opts(["Mediterráneo", "Oceánico", "Continental"]) }),
    ],
  ]);

const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/**
 * The climograph as it would appear in the teacher's original sheet: rain bars (mm, left axis), mean temperature line (°C,
 * right axis), the months under the bars and the units on both axes. Distinct grey values, so it also works photocopied.
 */
export async function climographPng(): Promise<Uint8Array> {
  GlobalFonts.registerFromPath(path.join(process.cwd(), "src/components/material/fonts/Inter-Regular.woff2"), "QA Inter");
  const w = 1000;
  const h = 600;
  const left = 110;
  const right = 110;
  const top = 50;
  const bottom = 90;
  const plotW = w - left - right;
  const plotH = h - top - bottom;
  const maxRain = 140;
  const maxTemp = 35;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.font = "22px 'QA Inter'";
  ctx.fillStyle = "#333";
  ctx.strokeStyle = "#d5d5d5";
  ctx.lineWidth = 1;
  // Horizontal guides and the two scales (rain on the left, temperature on the right).
  for (let i = 0; i <= 7; i++) {
    const y = top + plotH - (i / 7) * plotH;
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(left + plotW, y);
    ctx.stroke();
    ctx.textAlign = "right";
    ctx.fillText(String(i * 20), left - 12, y + 7);
    ctx.textAlign = "left";
    ctx.fillText(String(i * 5), left + plotW + 12, y + 7);
  }
  ctx.textAlign = "center";
  ctx.fillText("mm", left - 45, top - 18);
  ctx.fillText("°C", left + plotW + 45, top - 18);
  const bw = plotW / 12;
  CLIMATE.rainMm.forEach((r, i) => {
    ctx.fillStyle = "#9fb7d0";
    const bh = (r / maxRain) * plotH;
    ctx.fillRect(left + i * bw + 10, top + plotH - bh, bw - 20, bh);
  });
  ctx.strokeStyle = "#7a1f14";
  ctx.lineWidth = 5;
  ctx.beginPath();
  CLIMATE.tempC.forEach((t, i) => {
    const x = left + i * bw + bw / 2;
    const y = top + plotH - (t / maxTemp) * plotH;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.fillStyle = "#7a1f14";
  CLIMATE.tempC.forEach((t, i) => {
    ctx.beginPath();
    ctx.arc(left + i * bw + bw / 2, top + plotH - (t / maxTemp) * plotH, 6, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.strokeStyle = "#222";
  ctx.lineWidth = 2;
  ctx.strokeRect(left, top, plotW, plotH);
  ctx.fillStyle = "#222";
  ctx.font = "24px 'QA Inter'";
  CLIMATE.months.forEach((m, i) => ctx.fillText(m, left + i * bw + bw / 2, top + plotH + 34));
  ctx.font = "20px 'QA Inter'";
  ctx.fillText("Meses (de enero a diciembre)", left + plotW / 2, top + plotH + 72);
  return new Uint8Array(await canvas.encode("png"));
}

export const pinOf = (assetId: string, bytes: Uint8Array): PinnedAsset => ({ assetId, sha256: sha(bytes), mime: "image/png", bytes });

export const FIXTURES = [
  { name: "A-primaria", label: "Primaria", doc: primary },
  { name: "B-primaria-estructurada", label: "Primaria estructurada", doc: primaryStructured },
  { name: "C-eso", label: "ESO", doc: eso },
  { name: "D-bachillerato", label: "Bachillerato", doc: bachillerato },
  { name: "E-visual", label: "Visual (recorte)", doc: visualCrop },
] as const;
