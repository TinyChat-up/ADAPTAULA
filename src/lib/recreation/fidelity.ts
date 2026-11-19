import type { Block } from "@/lib/schemas/material-document";
import type { CompiledRecreation } from "./compile";
import type { RecreationPlan } from "./contract";
import { normalize } from "./verify";
import type { ResolvedVisual } from "./visuals";

/**
 * Fidelity audit (ADR-057): what Claude designed against what the documents received. Deterministic, no model: every activity keeps
 * its instruction, its steps and every text of its response format; every picture, scheme and material the plan ties to an activity is
 * in the document and linked to that activity. A loss is named («actividad 2: falta «Algas» en la respuesta»): the sheet is then
 * incomplete and is not delivered, instead of reaching the PDF with less than was designed.
 */

export interface FidelityIssue {
  activity: string;
  message: string;
}

const has = (haystack: string, text: string) => normalize(haystack).includes(normalize(text));

export function auditFidelity(plan: RecreationPlan, compiled: CompiledRecreation, visuals: readonly ResolvedVisual[]): FidelityIssue[] {
  const issues: FidelityIssue[] = [];
  const blocks = compiled.student.pages.flatMap((p) => p.blocks);
  const activities = blocks.filter((b): b is Extract<Block, { type: "activity" }> => b.type === "activity");
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const facts = new Map(plan.facts.map((f) => [f.id, f]));
  plan.activities.forEach((a, i) => {
    const label = String(i + 1);
    const block = activities[i];
    const lose = (message: string) => issues.push({ activity: label, message });
    if (!block) return lose("la actividad no está en el documento");
    if (block.prompt !== a.prompt) lose("el enunciado no es el diseñado");
    for (const step of a.steps) if (!(block.steps ?? []).includes(step)) lose(`falta el paso «${step.slice(0, 30)}»`);
    // Every text of the response format the student must see.
    const response = JSON.stringify(block.response);
    const e = a.executor;
    const texts: string[] =
      e.kind === "classify" ? [...e.categories.map((c) => c.label), ...e.item_fact_ids.map((id) => { const f = facts.get(id); return f?.kind === "membership" ? f.item : ""; })]
      : e.kind === "select" ? e.options.map((o) => o.text)
      : e.kind === "true_false" ? e.statements.map((st) => st.text)
      : e.kind === "sequence" ? e.event_fact_ids.map((id) => { const f = facts.get(id); return f?.kind === "event" ? f.label : ""; })
      : [];
    for (const t of texts.filter(Boolean)) if (!has(response, t)) lose(`falta «${t.slice(0, 30)}» en la respuesta`);
    if (e.kind === "short_answer") {
      if (block.response.kind !== "lines" || block.response.lines < e.lines) lose("faltan líneas de respuesta");
      const starters = blocks.slice(blocks.indexOf(block) + 1).find((b) => b.type === "sentence_starters");
      for (const st of e.starters) if (!starters || starters.type !== "sentence_starters" || !starters.items.includes(st)) lose(`falta el inicio de frase «${st.slice(0, 30)}»`);
    }
    // Every picture and scheme tied to the activity is printed and linked to it.
    const linked = new Set(block.resource_block_ids ?? []);
    for (const v of visuals.filter((x) => x.activity_ids.includes(a.id) && x.source && x.source.kind !== "missing" && !x.cards)) {
      if (![...linked].some((id) => byId.get(id)?.type === "image")) lose(`la imagen «${v.request_id}» no está ligada a la actividad`);
    }
    for (const id of a.visual_ids) if (![...linked].some((l) => byId.get(l)?.type === "image")) lose(`el esquema «${id}» no está en la actividad`);
  });
  // Materials: every card and every column is in the materials document.
  const materialsText = compiled.materials ? JSON.stringify(compiled.materials.pages) : "";
  for (const m of plan.materials) {
    const items = m.kind === "cut_out_cards" ? m.cards : m.columns;
    const label = String(plan.activities.findIndex((a) => a.id === m.activity_id) + 1);
    if (!compiled.materials) issues.push({ activity: label, message: `faltan los materiales (${m.kind === "cut_out_cards" ? "tarjetas" : "tablero"})` });
    else for (const t of items) if (!has(materialsText, t)) issues.push({ activity: label, message: `falta «${t.slice(0, 30)}» en los materiales` });
  }
  return issues;
}
