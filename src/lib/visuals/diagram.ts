import { z } from "zod";

/**
 * A NEW exact scheme designed for a material (ADR-059): labelled nodes and the relations between them, drawn by our own renderer
 * from data. It is not tied to a picture of the original: any subject can use it (a food chain, the parts of a sentence, equivalent
 * fractions, the stages of a process, two situations compared). Four layouts, each with a structure the server checks before drawing:
 *
 *   chain      every node once, joined by one path of arrows (a → b → c)
 *   cycle      a chain whose last node returns to the first
 *   hierarchy  one root; every other node hangs from exactly one parent (a tree, at most three levels)
 *   groups     two to four titled columns; every node in one of them; no arrows (a comparison, not a classification to solve)
 *
 * What a relation MEANS, which nodes go together and why, is the planner's (anchored to quoted facts: `recreation/diagrams.ts`).
 * This module only says whether a drawing is well formed. It cannot express a blank or a mark: a diagram never asks anything.
 */

export const DIAGRAM_LAYOUTS = ["chain", "cycle", "hierarchy", "groups"] as const;
export type DiagramLayout = (typeof DIAGRAM_LAYOUTS)[number];

const Label = (max: number) => z.string().trim().min(1).max(max).refine((t) => !/[<>{}\[\]`]/.test(t), { message: "texto sin marcas" });
const NodeId = z.string().regex(/^n_[0-9]{1,3}$/);

export const DiagramSpecSchema = z.object({
  spec_version: z.literal(1),
  kind: z.literal("diagram"),
  layout: z.enum(DIAGRAM_LAYOUTS),
  title: Label(60).optional(),
  nodes: z.array(z.object({ id: NodeId, label: Label(40), group: z.number().int().min(0).max(3).optional() })).min(2).max(8),
  edges: z.array(z.object({ from: NodeId, to: NodeId, label: Label(30).optional() })).max(10),
  groups: z.array(Label(30)).max(4),
});
export type DiagramSpec = z.infer<typeof DiagramSpecSchema>;

export interface DiagramShape {
  layout: DiagramLayout;
  nodes: ReadonlyArray<{ id: string; group?: number | null | undefined }>;
  edges: ReadonlyArray<{ from: string; to: string }>;
  groups: readonly unknown[];
}

/** The order of a chain or cycle (by its arrows), or null when the arrows do not make one single path through every node. */
export function pathOf(d: DiagramShape): string[] | null {
  const ids = d.nodes.map((n) => n.id);
  const open = d.layout === "chain";
  if (d.edges.length !== (open ? ids.length - 1 : ids.length)) return null;
  const next = new Map<string, string>();
  const incoming = new Map<string, number>();
  for (const e of d.edges) {
    if (next.has(e.from)) return null;
    next.set(e.from, e.to);
    incoming.set(e.to, (incoming.get(e.to) ?? 0) + 1);
  }
  if ([...incoming.values()].some((n) => n > 1)) return null;
  const start = open ? ids.find((id) => !incoming.has(id)) : ids[0];
  if (!start) return null;
  const order: string[] = [];
  for (let at: string | undefined = start; at !== undefined && order.length <= ids.length; at = next.get(at)) {
    if (order.includes(at)) break;
    order.push(at);
  }
  if (order.length !== ids.length) return null;
  if (!open && next.get(order[order.length - 1]!) !== start) return null;
  return order;
}

/** The levels of a hierarchy (root first), or null when it is not one tree of at most three levels. */
export function levelsOf(d: DiagramShape): string[][] | null {
  const ids = d.nodes.map((n) => n.id);
  if (d.edges.length !== ids.length - 1) return null;
  const parent = new Map<string, string>();
  for (const e of d.edges) {
    if (parent.has(e.to)) return null;
    parent.set(e.to, e.from);
  }
  const roots = ids.filter((id) => !parent.has(id));
  if (roots.length !== 1) return null;
  const levels: string[][] = [roots];
  const seen = new Set(roots);
  while (seen.size < ids.length && levels.length < 4) {
    const children = ids.filter((id) => !seen.has(id) && levels[levels.length - 1]!.includes(parent.get(id) ?? ""));
    if (children.length === 0) return null;
    children.forEach((c) => seen.add(c));
    levels.push(children);
  }
  return seen.size === ids.length && levels.length <= 3 ? levels : null;
}

/** Why a diagram cannot be drawn as declared (empty: well formed). Plain Spanish, no content of the material. */
export function diagramIssues(d: DiagramShape): string[] {
  const issues: string[] = [];
  const ids = d.nodes.map((n) => n.id);
  if (new Set(ids).size !== ids.length) issues.push("nodos repetidos");
  for (const e of d.edges) {
    if (!ids.includes(e.from) || !ids.includes(e.to)) issues.push("una relación une un nodo que no existe");
    if (e.from === e.to) issues.push("una relación une un nodo consigo mismo");
  }
  if (issues.length > 0) return issues;
  if (d.layout === "groups") {
    if (d.edges.length > 0) issues.push("un esquema de grupos no lleva flechas");
    if (d.groups.length < 2) issues.push("un esquema de grupos necesita al menos dos grupos");
    if (d.nodes.some((n) => n.group == null || n.group >= d.groups.length)) issues.push("cada elemento debe estar en uno de los grupos");
    else if (d.groups.some((_, g) => !d.nodes.some((n) => n.group === g))) issues.push("un grupo está vacío");
    return issues;
  }
  if (d.nodes.some((n) => n.group != null)) issues.push("solo un esquema de grupos reparte sus elementos en grupos");
  if (d.layout === "hierarchy") {
    if (!levelsOf(d)) issues.push("las relaciones no forman un árbol con una sola raíz (como máximo tres niveles)");
  } else if (!pathOf(d)) issues.push(d.layout === "chain" ? "las flechas no forman una sola cadena que pase por todos los elementos" : "las flechas no forman un solo ciclo que pase por todos los elementos");
  return issues;
}

/** Plain-language description for assistive technology: what is drawn, in the order it is read. */
export function describeDiagram(d: DiagramSpec): string {
  const label = new Map(d.nodes.map((n) => [n.id, n.label]));
  const edge = (from: string, to: string) => d.edges.find((e) => e.from === from && e.to === to)?.label;
  const title = d.title ? `${d.title}. ` : "";
  if (d.layout === "groups") return `${title}${d.groups.map((g, i) => `${g}: ${d.nodes.filter((n) => n.group === i).map((n) => n.label).join(", ")}`).join(". ")}.`;
  if (d.layout === "hierarchy") {
    return `${title}${d.edges.map((e) => `${label.get(e.from)} → ${label.get(e.to)}${e.label ? ` (${e.label})` : ""}`).join("; ")}.`;
  }
  const order = pathOf(d) ?? d.nodes.map((n) => n.id);
  const steps = order.map((id, i) => {
    const to = order[i + 1] ?? (d.layout === "cycle" ? order[0] : undefined);
    const how = to ? edge(id, to) : undefined;
    return `${label.get(id)}${to ? ` →${how ? ` (${how})` : ""}` : ""}`;
  });
  return `${title}${steps.join(" ")}${d.layout === "cycle" ? ` y vuelve a ${label.get(order[0]!)}` : ""}.`;
}
