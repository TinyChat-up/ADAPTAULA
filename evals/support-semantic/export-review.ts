import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { studentText } from "@/lib/adaptation/document-text";
import { DIMENSIONS } from "@/lib/schemas/functional-profile";
import type { Block } from "@/lib/schemas/material-document";
import { CORPUS, SHEETS } from "./corpus";
import { sheetOf } from "./lib";

/**
 * Writes the corpus for the person who will label it (docs/qa/etapa-2-3-semantica/corpus-revision.md and .json). Offline, free:
 * `pnpm exec tsx evals/support-semantic/export-review.ts`. The labels it shows are PROVISIONAL (AI-assisted); the column «Etiqueta definitiva»
 * is empty on purpose: it is the one the measurement uses once filled.
 */
const dir = "docs/qa/etapa-2-3-semantica";
const label = (key: string) => (DIMENSIONS as unknown as Record<string, { label: string }>)[key]?.label ?? key;
const cell = (text: string) => text.trim().replace(/\|/g, "\\|").replace(/\n+/g, " · ");

const rows = CORPUS.map((e) => {
  const sheet = SHEETS[e.sheet];
  const { document } = sheetOf(e);
  const text = studentText(document.pages[0]!.blocks[0] as Block);
  return { e, sheet, text };
});

const md = [
  "# Corpus de apoyos para la revisión semántica (etapa 2.3)",
  "",
  "**Las etiquetas de esta tabla son PROVISIONALES**: las ha propuesto el equipo con ayuda de IA y no son verdad de referencia. Cada fila espera",
  "la etiqueta definitiva de una persona con criterio pedagógico y de PT (columna «Etiqueta definitiva»). La medición usa esa etiqueta y, mientras",
  "no exista, avisa de que mide contra etiquetas provisionales. Las fichas son las de prueba del equipo; no hay datos de alumnado.",
  "",
  "Etiquetas posibles: `legitimate_access` (apoyo legítimo de acceso) · `criterion_card` (tarjeta de criterio legítima) · `method_example` (ejemplo",
  "metodológico adecuado) · `over_hint` (pista que facilita excesivamente) · `performs_competence` (realiza directamente la competencia evaluada) · `ambiguous`.",
  "",
  "| Id | Ficha · actividad | Competencia evaluada | Apoyo (tipo) | Texto del apoyo | Necesidad funcional | Etiqueta provisional · motivo | Etiqueta definitiva |",
  "|---|---|---|---|---|---|---|---|",
  ...rows.map(({ e, sheet, text }) => `| ${e.id} | ${cell(`${e.sheet}: ${sheet.instruction}`)} | ${cell(sheet.competence)} | ${e.kind} | ${cell(text)} | ${cell(`${label(e.need.dimension)} — ${e.need.note}`)} | \`${e.provisional.label}\` · ${cell(e.provisional.rationale)} |  |`),
  "",
].join("\n");

mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}/corpus-revision.md`, md);
const json = rows.map(({ e, sheet, text }) => ({ id: e.id, sheet: e.sheet, activity: sheet.instruction, evaluated_competence: sheet.competence, support_kind: e.kind, support_text: text, functional_need: e.need, provisional: e.provisional, review: e.review }));
mkdirSync(dirname(`${dir}/corpus-revision.json`), { recursive: true });
writeFileSync(`${dir}/corpus-revision.json`, `${JSON.stringify(json, null, 2)}\n`);
console.log(`Corpus: ${CORPUS.length} apoyos → ${dir}/corpus-revision.md y .json`);
