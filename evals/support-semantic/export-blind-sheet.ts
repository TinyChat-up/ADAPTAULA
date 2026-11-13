import { mkdirSync, writeFileSync } from "node:fs";
import { studentText } from "@/lib/adaptation/document-text";
import { DIMENSIONS } from "@/lib/schemas/functional-profile";
import type { Block } from "@/lib/schemas/material-document";
import { CORPUS, SHEETS, type CorpusEntry } from "./corpus";
import { sheetOf } from "./lib";

/**
 * The BLIND evaluation sheet of the 27 supports (offline, free): `pnpm exec tsx evals/support-semantic/export-blind-sheet.ts`.
 * It shows, for each support, only what a reviewer needs to judge it (the activity, what it evaluates, the need the support serves and the
 * support itself) and NEVER the team's provisional label, its rationale, the expected judgment or whether the support is a real one or a
 * variant. The items are shuffled with a fixed seed and renamed (B01…), so neither their order nor their name reveals a class. The key that
 * maps each item to the corpus lives apart (`clave-hoja-ciega.json`) and holds no label.
 */
const dir = "docs/qa/etapa-2-3-semantica";
const keyPath = "evals/support-semantic/clave-hoja-ciega.json";

const TYPE_ES: Record<string, string> = { short_answer: "respuesta corta", classification: "clasificación", problem_solving: "resolución de un problema" };
const KIND_ES: Record<string, string> = { glossary: "glosario", worked_example: "ejemplo resuelto", key_idea: "idea clave", reminder: "recordatorio", guiding_questions: "preguntas guía", checklist: "lista de comprobación", sentence_starters: "comienzos de frase" };
const need = (key: string) => (DIMENSIONS as unknown as Record<string, { label: string }>)[key]?.label ?? key;

/** A seeded shuffle (mulberry32): the same sheet every time, in an order unrelated to the corpus. */
function shuffled<T>(items: readonly T[], seed: number): T[] {
  let a = seed >>> 0;
  const random = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

const quote = (text: string) => text.trim().split("\n").map((l) => `> ${l}`).join("\n");
const tableMd = (t: { headers: readonly string[]; rows: ReadonlyArray<readonly string[]> }) => [`| ${t.headers.join(" | ")} |`, `|${t.headers.map(() => "---").join("|")}|`, ...t.rows.map((r) => `| ${r.map((c) => c || " ").join(" | ")} |`)].join("\n");

const order = shuffled(CORPUS, 20261113);
const items = order.map((entry, i) => ({ item: `B${String(i + 1).padStart(2, "0")}`, entry }));

function itemMd({ item, entry }: { item: string; entry: CorpusEntry }): string {
  const sheet = SHEETS[entry.sheet];
  const text = studentText(sheetOf(entry).document.pages[0]!.blocks[0] as Block);
  const tbl = "table" in sheet ? sheet.table : undefined;
  const parts = [
    `### ${item}`,
    "",
    `**Actividad** (${TYPE_ES[sheet.type] ?? sheet.type}): ${sheet.instruction}`,
    ...("context" in sheet && sheet.context ? ["", `Datos de la actividad: ${sheet.context}`] : []),
    ...(tbl ? ["", tableMd(tbl)] : []),
    ...("reading" in sheet && sheet.reading ? ["", "Texto de lectura de la ficha:", quote(sheet.reading)] : []),
    "",
    `**Lo que evalúa la actividad:** ${sheet.competence}.`,
    ...("answer" in sheet && sheet.answer ? [`**Respuesta de referencia del análisis** (deducida; puede no ser exacta): ${sheet.answer}`] : ["**Respuesta de referencia:** no disponible; juzga por la competencia que evalúa."]),
    "",
    `**Necesidad funcional que atiende el apoyo:** ${need(entry.need.dimension)} (${entry.need.note}).`,
    `**Apoyo generado** (${KIND_ES[entry.kind] ?? entry.kind}):`,
    quote(text),
    "",
  ];
  return parts.join("\n");
}

const md = [
  "# Hoja de evaluación ciega · apoyos de la revisión semántica (etapa 2.3)",
  "",
  "Hoja para etiquetar **27 apoyos** generados por Adaptaula. **No contiene ninguna etiqueta previa** del equipo ni de ninguna IA: júzgalos tú, con criterio pedagógico y de PT. Los apoyos son de fichas de prueba del equipo; no hay datos de alumnado.",
  "",
  "## Qué se pregunta por cada apoyo",
  "",
  "1. **Etiqueta** (una de las seis de abajo).",
  "2. **¿Aceptarías que se retirara o se regenerara automáticamente?** `si` / `no` / `depende`.",
  "3. **¿Falta contexto para decidir?** `si` / `no`. Si falta, di cuál.",
  "4. **Confianza**: 1 (dudo) · 2 (razonable) · 3 (seguro).",
  "5. Un comentario breve si quieres (opcional).",
  "",
  "## Las seis etiquetas",
  "",
  "- `legitimate_access`: da acceso a la tarea (vocabulario secundario, preguntas de observación, un recordatorio de cómo trabajar) sin hacer lo que la actividad evalúa.",
  "- `criterion_card`: recuerda el criterio que el alumno debe **aplicar** a elementos concretos, y el alumno sigue aplicándolo él.",
  "- `method_example`: ejemplo resuelto con otros datos u otro ámbito que enseña un procedimiento sin resolver ningún ítem de la actividad.",
  "- `over_hint`: facilita la respuesta más de lo que el acceso requiere, sin llegar a hacerla (por ejemplo, permite deducir un ítem).",
  "- `performs_competence`: hace directamente lo que la actividad evalúa (enuncia lo que había que explicar, resuelve o asigna un ítem, da el resultado).",
  "- `ambiguous`: lectura razonable en dos sentidos; necesita criterio de otra persona.",
  "",
  "## Cómo registrar quién etiqueta (importante)",
  "",
  "Cada fila de respuestas lleva `label_source`:",
  "",
  "- `human`: tu criterio, sin asistente.",
  "- `human_ai_assisted`: lo has razonado con ayuda de un asistente de IA (p. ej. ChatGPT). **Es UN revisor, no dos.**",
  "- Si otro especialista etiqueta aparte y por su cuenta, usa su propio `reviewer` y `human`: solo así cuenta como segundo revisor independiente.",
  "- Una etiqueta que sugiera una IA y que nadie haya hecho suya **no es una etiqueta**: no la pongas.",
  "",
  "Las respuestas van en `hoja-ciega-respuestas.csv` (una fila por apoyo y por revisor; puedes duplicar las filas para un segundo revisor).",
  "",
  "---",
  "",
  ...items.map(itemMd),
].join("\n");

const header = ["item", "reviewer", "label_source", "label", "accept_removal", "needs_more_context", "confidence", "comment"];
const csv = [header.join(","), ...items.map(({ item }) => `${item},,,,,,,`)].join("\n");

mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}/hoja-ciega.md`, `${md}\n`);
writeFileSync(`${dir}/hoja-ciega-respuestas.csv`, `${csv}\n`);
writeFileSync(keyPath, `${JSON.stringify(items.map(({ item, entry }) => ({ item, id: entry.id })), null, 2)}\n`);
console.log(`Hoja ciega: ${items.length} apoyos → ${dir}/hoja-ciega.md, hoja-ciega-respuestas.csv y ${keyPath}`);
