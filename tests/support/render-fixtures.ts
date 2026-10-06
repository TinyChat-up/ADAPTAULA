import { buildDocument, sequentialIds } from "@/lib/adaptation/document";
import { MaterialDocumentSchema, type Block, type MaterialDocument } from "@/lib/schemas/material-document";
import { argumentationAnalysis, fractionsAnalysis, geographyAnalysis } from "../../evals/adaptation/fixtures";
import { EXECUTIVE_EXPERIMENT_PROFILE } from "../../evals/adaptation/planner-lib";
import { contextFor, planOf } from "../unit/adaptation-helpers";
import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";

/**
 * Synthetic documents for the renderer (no private material). They start from the REAL document builder over the synthetic
 * analyses (so ids, order and answer areas are the pipeline's own) and add the blocks only an adapted sheet carries.
 */
export const ANSWER_KEY_SECRET = "RESPUESTA_CLAVE_SECRETA";
export const BLANK_SECRET = "HUECO_SECRETO";

const t = (over: Partial<Block["trace"]> = {}) => ({ origin: "support" as const, source_refs: [] as string[], decision_ids: ["dec_1"], ...over });
let n = 0;
const id = () => `blk_x${String(++n).padStart(5, "0")}`;

function literal(analysis: MaterialAnalysis): MaterialDocument {
  const context = contextFor(analysis, EXECUTIVE_EXPERIMENT_PROFILE);
  return buildDocument({ analysis, plan: planOf(analysis, context, []), context, generated: null, newBlockId: sequentialIds("f") });
}

export function withBlocks(doc: MaterialDocument, edit: (blocks: Block[]) => Block[], page = 0): MaterialDocument {
  return MaterialDocumentSchema.parse({ ...doc, pages: doc.pages.map((p, i) => (i === page ? { blocks: edit(p.blocks) } : p)) });
}
export const withPresentation = (doc: MaterialDocument, over: Partial<MaterialDocument["presentation"]>): MaterialDocument => MaterialDocumentSchema.parse({ ...doc, presentation: { ...doc.presentation, ...over } });

export const primaria = (): MaterialDocument => {
  const base = literal(fractionsAnalysis());
  const extra: Block[] = [
    { id: id(), type: "chart", title: "Fracciones sobre la recta", chart_type: "bar", categories: ["1/4", "2/4", "3/4"], series: [{ label: null, values: [1, 2, 3] }], trace: t({ origin: "original" }) },
    { id: id(), type: "activity", label: "6", prompt: "Elige la fracción equivalente a 1/2.", response: { kind: "choice", multiple: false, options: [{ id: "o1", text: "2/4" }, { id: "o2", text: "1/3" }, { id: "o3", text: "3/5" }] }, trace: t({ origin: "adapted" }) },
    { id: id(), type: "activity", label: "7", prompt: "Completa.", response: { kind: "fill_blank", text: "1/2 = {{a}}/4 y 3/4 = 6/{{b}}", word_bank: ["2", "8"] }, trace: t({ origin: "adapted" }) },
    { id: id(), type: "activity", label: "8", prompt: "Marca verdadero o falso.", response: { kind: "true_false", statements: [{ id: "s1", text: "1/2 es mayor que 1/4." }, { id: "s2", text: "2/4 y 1/2 son distintas." }] }, trace: t({ origin: "adapted" }) },
    { id: id(), type: "activity", label: "9", prompt: "Une cada fracción con su dibujo.", response: { kind: "match", left: [{ id: "l1", text: "1/2" }, { id: "l2", text: "1/4" }], right: [{ id: "r1", text: "Un cuarto del círculo" }, { id: "r2", text: "La mitad del círculo" }] }, trace: t({ origin: "adapted" }) },
    { id: id(), type: "activity", label: "10", prompt: "Ordena de menor a mayor.", response: { kind: "order", items: [{ id: "i1", text: "3/4" }, { id: "i2", text: "1/4" }, { id: "i3", text: "1/2" }] }, trace: t({ origin: "adapted" }) },
    { id: id(), type: "math", latex: "\\frac{1}{2}=\\frac{2}{4}", display: "block", spoken_text: "un medio es igual a dos cuartos", trace: t({ origin: "original" }) },
  ];
  const doc = withBlocks(base, (b) => [...b, ...extra], 1);
  const last = doc.pages[1]!.blocks;
  return MaterialDocumentSchema.parse({ ...doc, answer_key: [{ block_id: last.find((b) => b.type === "activity")!.id, basis: "source", value: ANSWER_KEY_SECRET }, { block_id: extra[2]!.id, basis: "new_item", blanks: [{ key: "a", answer: BLANK_SECRET }] }] });
};

export const geografia = (): MaterialDocument => {
  const base = literal(geographyAnalysis());
  return withBlocks(base, (b) => [...b, { id: id(), type: "chart", title: "Dos series", chart_type: "line", categories: ["2019", "2020", "2021"], series: [{ label: null, values: [3, 5, 4] }, { label: null, values: [2, 2, 6] }], y_label: "Millones", trace: t({ origin: "original" }) }], 0);
};

export const bachillerato = (): MaterialDocument => {
  const base = literal(argumentationAnalysis());
  const last = base.pages.length - 1;
  const doc = withBlocks(
    base,
    (blocks) => {
      const out = [...blocks];
      const writing = out.map((b, i) => [b, i] as const).filter(([b]) => b.type === "activity").at(-1)![1];
      out.splice(
        writing + 1,
        0,
        { id: id(), type: "planner", title: "Planifica tu texto", slots: [{ label: "Tesis", lines: 2 }, { label: "Argumento 1", lines: 3 }, { label: "Argumento 2", lines: 3 }, { label: "Conclusión", lines: 2 }], trace: t() },
        { id: id(), type: "checklist", title: "Antes de entregar", items: ["Tengo una tesis clara", "He dado al menos dos argumentos", "He escrito una conclusión", "Está entre 150 y 180 palabras"], trace: t() },
        { id: id(), type: "help_box", variant: "reminder", text: "Organiza el texto en **párrafos**.", trace: t() },
      );
      return out;
    },
    last,
  );
  const target = doc.pages[last]!.blocks.find((b) => b.type === "activity" && b.label === "5");
  return target && target.type === "activity"
    ? withBlocks(doc, (blocks) => blocks.map((b) => (b.id === target.id && b.type === "activity" ? { ...b, requirements: ["Entre 150 y 180 palabras", "Con tesis, argumentos y conclusión"] } : b)), last)
    : doc;
};

/** Overflow stress: a very long word, a wide table, a long checklist, a full planner, a huge answer area. */
export const stress = (): MaterialDocument => {
  const doc = literal(argumentationAnalysis());
  const long = "Supercalifragilisticoespialidosoanticonstitucionalisimamente".repeat(2);
  return withBlocks(
    doc,
    (b) => [
      ...b,
      { id: id(), type: "paragraph", text: `Texto con una palabra larguísima: ${long} y una dirección ${"https://ejemplo.org/".concat("a".repeat(80))}.`, trace: t({ origin: "original" }) },
      { id: id(), type: "table", caption: "Tabla ancha", headers: Array.from({ length: 10 }, (_, i) => `Columna ${i + 1}`), rows: [Array.from({ length: 10 }, (_, i) => `Valor largo ${i + 1} ${"x".repeat(14)}`), Array.from({ length: 10 }, (_, i) => String(i * 1000))], trace: t({ origin: "original" }) },
      { id: id(), type: "checklist", items: Array.from({ length: 12 }, (_, i) => `Elemento ${i + 1} de una lista bastante larga que debe fluir sin recortarse`), trace: t() },
      { id: id(), type: "planner", slots: Array.from({ length: 8 }, (_, i) => ({ label: `Apartado ${i + 1}`, lines: 12 })), trace: t() },
      { id: id(), type: "activity", label: "Z", prompt: "Respuesta muy extensa.", response: { kind: "lines", lines: 40 }, trace: t({ origin: "adapted" }) },
    ],
    0,
  );
};
