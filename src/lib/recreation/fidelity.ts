import type { Block } from "@/lib/schemas/material-document";
import type { DiagramSpec } from "@/lib/visuals/diagram";
import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";
import type { CompiledRecreation } from "./compile";
import type { RecreationPlan } from "./contract";
import { declaredSchemes, diagramSpecOf } from "./diagrams";
import { chooseScheme, diagramFlow, originalFlowOf, planFlow, type Flow } from "./relations";
import { normalize } from "./verify";
import type { ResolvedVisual } from "./visuals";

/**
 * Fidelity audit (ADR-057, ADR-058): what Claude designed against what the documents received. Deterministic, no model.
 *
 * Every activity keeps its instruction, its steps and every text of its response format. Every picture, scheme and material is checked
 * BY IDENTITY, not by presence: the block an activity is linked to must be the resource the plan assigns to it —
 *   · a request's picture: the very asset (or original, or scheme) that was resolved for that request;
 *   · a scheme: the labels and the source of THAT scheme of the plan (or of the original diagram its facts and words point at);
 *   · a material: its own cards in order, its own pictures card by card, its own columns, under its own activity's heading.
 * A resource swapped for another is a loss like any other: the sheet is then incomplete and is not delivered.
 */

export interface FidelityIssue {
  activity: string;
  message: string;
}

const has = (haystack: string, text: string) => normalize(haystack).includes(normalize(text));
const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((t, i) => normalize(t) === normalize(b[i]!));

/** Two drawings of a new scheme are the same when every node, relation and group is, in the same order (key order does not matter). */
const sameDiagram = (x: DiagramSpec, y: DiagramSpec) =>
  x.layout === y.layout && (x.title ?? "") === (y.title ?? "") && same(x.groups, y.groups) &&
  x.nodes.length === y.nodes.length && x.nodes.every((n, i) => n.id === y.nodes[i]!.id && n.label === y.nodes[i]!.label && (n.group ?? null) === (y.nodes[i]!.group ?? null)) &&
  x.edges.length === y.edges.length && x.edges.every((e, i) => e.from === y.edges[i]!.from && e.to === y.edges[i]!.to && (e.label ?? null) === (y.edges[i]!.label ?? null));

type ImageBlock = Extract<Block, { type: "image" }>;
const isImage = (b: Block | undefined): b is ImageBlock => b?.type === "image";

/** The scheme a block draws, if it is one. */
const flowOf = (b: ImageBlock): { items: readonly string[]; ref: string } | null =>
  b.source.kind === "figure" && b.source.spec.kind === "flow" ? { items: b.source.spec.items, ref: b.source.visual_ref ?? "" } : null;

export function auditFidelity(plan: RecreationPlan, compiled: CompiledRecreation, visuals: readonly ResolvedVisual[], analysis?: MaterialAnalysis): FidelityIssue[] {
  const issues: FidelityIssue[] = [];
  const blocks = compiled.student.pages.flatMap((p) => p.blocks);
  const activities = blocks.filter((b): b is Extract<Block, { type: "activity" }> => b.type === "activity");
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const facts = new Map(plan.facts.map((f) => [f.id, f]));
  const links = compiled.links;

  /** The resource the plan assigns to a key, from the plan alone (independent of how the blocks were assembled). */
  const expectedScheme = (key: string): Flow | null => {
    if (key.startsWith("rd:")) {
      const d = plan.diagrams?.find((x) => x.id === key.slice(3));
      return d ? diagramFlow(d) : null;
    }
    if (key.startsWith("rv:")) {
      const v = plan.visuals.find((x) => x.id === key.slice(3));
      return v ? planFlow(v) : null;
    }
    const original = analysis?.visuals.find((x) => x.id === key.slice(5));
    return original ? originalFlowOf(original) : null;
  };

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

    // ---- Resources, by identity -----------------------------------------------------------------------------------------------
    const linked = new Set(block.resource_block_ids ?? []);
    const used = links?.activities[a.id] ?? [];
    const blockOf = (key: string) => (links ? byId.get(links.printed[key] ?? "") : undefined);

    // Its pictures: the block printed for EACH request that lists it, linked to this activity and showing what was resolved for it.
    for (const v of visuals.filter((x) => x.activity_ids.includes(a.id) && x.source && !x.cards)) {
      const key = `vr:${v.request_id}`;
      const b = blockOf(key);
      if (!b || !isImage(b)) { lose(`la imagen «${v.request_id}» no está en el documento`); continue; }
      if (!linked.has(b.id)) { lose(`la imagen «${v.request_id}» no está ligada a la actividad`); continue; }
      const src = v.source!;
      const ok =
        src.kind === "generated" ? b.source.kind === "generated" && b.source.asset_id === src.asset_id
        : src.kind === "original" ? b.source.kind === "original" && b.source.visual_ref === src.visual_ref
        : src.kind === "figure" ? flowOf(b) !== null && same(flowOf(b)!.items, src.spec.kind === "flow" ? src.spec.items : []) && flowOf(b)!.ref === src.visual_ref
        : b.source.kind === "requested";
      if (!ok) lose(`la imagen ligada a «${v.request_id}» no es la que se le asignó`);
    }

    // Its schemes: those it lists, and the one that corresponds to the relation it depends on.
    const wanted = new Set(declaredSchemes(plan, a));
    const needsRelation = plan.visual_requests.some((r) => r.activity_ids.includes(a.id) && (r.needs_exact.arrows || r.needs_exact.labels));
    if (needsRelation && wanted.size === 0) {
      const choice = chooseScheme(a, plan, analysis);
      if (choice.ok) wanted.add(choice.flow.key);
    }
    for (const key of wanted) {
      const expected = expectedScheme(key);
      const b = blockOf(key);
      if (!expected) { lose(`el esquema «${key}» no existe en el plan`); continue; }
      if (!b || !isImage(b) || !used.includes(key) || !linked.has(b.id)) { lose(`el esquema «${key.slice(key.indexOf(":") + 1)}» no está ligado a la actividad`); continue; }
      if (expected.diagram) {
        // A new scheme: the drawing is exactly its design (nodes, relations with their labels, groups), nothing swapped or reordered.
        const ok = b.source.kind === "figure" && b.source.spec.kind === "diagram" && sameDiagram(b.source.spec, diagramSpecOf(expected.diagram));
        if (!ok) lose(`el esquema ligado no es «${key.slice(3)}»: sus nodos o sus relaciones no coinciden con el diseño`);
        continue;
      }
      const drawn = flowOf(b);
      if (!drawn || !same(drawn.items, expected.items) || drawn.ref !== expected.source_ref) lose(`el esquema ligado no es «${key.slice(key.indexOf(":") + 1)}»: sus rótulos o su origen no coinciden con el plan`);
    }
    // Nothing else of the plan's schemes may be linked in its place (a scheme the activity does not use).
    for (const key of used) {
      if (!key.startsWith("rv:") && !key.startsWith("orig:") && !key.startsWith("rd:")) continue;
      if (!wanted.has(key)) lose(`tiene ligado el esquema «${key.slice(key.indexOf(":") + 1)}», que no le corresponde`);
    }
  });

  // ---- Materials, by identity ----------------------------------------------------------------------------------------------
  const materialBlocks = compiled.materials?.pages.flatMap((p) => p.blocks) ?? [];
  for (const m of plan.materials) {
    const index = plan.activities.findIndex((a) => a.id === m.activity_id);
    const label = String(index + 1);
    const lose = (message: string) => issues.push({ activity: label, message });
    if (!compiled.materials) { lose(`faltan los materiales (${m.kind === "cut_out_cards" ? "tarjetas" : "tablero"})`); continue; }
    const block = materialBlocks.find((b) => b.id === (compiled.links?.materials[m.id] ?? ""));
    if (!isImage(block)) { lose(`el material «${m.id}» no está en el documento de materiales`); continue; }
    // Under the heading of ITS activity.
    const heading = materialBlocks.slice(0, materialBlocks.indexOf(block)).reverse().find((b) => b.type === "heading" && b.level === 2);
    if (!heading || heading.type !== "heading" || !heading.text.endsWith(`actividad ${label}`)) lose(`el material «${m.id}» no está bajo la actividad ${label}`);
    const spec = block.source.kind === "figure" ? block.source.spec : null;
    if (m.kind === "cut_out_cards") {
      if (spec?.kind !== "cut_cards" || !same(spec.items, m.cards)) { lose(`las tarjetas del material «${m.id}» no son las diseñadas`); continue; }
      // Each card's picture is the one resolved for THAT card.
      const resolved = visuals.find((v) => plan.visual_requests.find((r) => r.id === v.request_id)?.for_cards === m.id)?.cards;
      m.cards.forEach((card, k) => {
        const expected = resolved?.find((c) => c.text === card)?.asset?.asset_id ?? null;
        const got = spec.pictures?.[k] ?? null;
        if (got !== expected) lose(`la ilustración de la tarjeta «${card.slice(0, 30)}» no es la que se le asignó`);
      });
    } else if (spec?.kind !== "sort_board" || !same(spec.columns, m.columns)) lose(`las columnas del tablero «${m.id}» no son las diseñadas`);
  }
  return issues;
}
