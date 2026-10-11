import { z } from "zod";

/**
 * VisualSpec v1: a simple mathematical figure as DATA, drawn by our own deterministic SVG renderer (never a diffusion model,
 * never HTML or SVG written by a model). It is produced on the server from what the original material really shows (pixels and
 * printed labels of a located figure, or the printed text of an activity) and verified before it is stored.
 *
 * Answers cannot be expressed: no kind has a field for a mark, a point, a sign or a solution. A number line carries only its
 * interval, its equal divisions and the labels printed in the original; a comparison carries only the two numbers of each item,
 * and the renderer always draws an EMPTY box between them. A new kind or field is a new `spec_version`.
 */

export const VISUAL_SPEC_VERSION = 1 as const;
export const VISUAL_SPEC_KINDS = ["fraction_bar", "number_line", "part_whole", "comparison"] as const;
export type VisualSpecKind = (typeof VISUAL_SPEC_KINDS)[number];

const Count = (min: number, max: number) => z.number().int().min(min).max(max);
export const FractionSchema = z.object({ n: Count(0, 999), d: Count(1, 999) });
export type Fraction = z.infer<typeof FractionSchema>;

/** A label as printed in the original: an integer or a fraction (`0`, `1`, `3/4`). Nothing else is ever drawn as a label. */
export const LABEL_PATTERN = /^[0-9]{1,3}(\/[0-9]{1,3})?$/;
const LabelText = z.string().regex(LABEL_PATTERN);
const PartIndexes = z.array(Count(0, 23)).max(24);

const base = { spec_version: z.literal(VISUAL_SPEC_VERSION) };

export const FractionBarSpecSchema = z.object({ ...base, kind: z.literal("fraction_bar"), parts: Count(2, 24), shaded: PartIndexes });
export const NumberLineSpecSchema = z.object({
  ...base,
  kind: z.literal("number_line"),
  start: FractionSchema,
  end: FractionSchema,
  /** Equal intervals between the first and the last tick (ticks = divisions + 1). */
  divisions: Count(1, 24),
  labels: z.array(z.object({ tick: Count(0, 24), text: LabelText })).max(25),
});
export const PartWholeSpecSchema = z.object({ ...base, kind: z.literal("part_whole"), shape: z.enum(["circle", "rectangle"]), parts: Count(2, 12), shaded: PartIndexes });
export const ComparisonSpecSchema = z.object({ ...base, kind: z.literal("comparison"), items: z.array(z.object({ left: FractionSchema, right: FractionSchema })).min(1).max(8) });

export const VisualSpecSchema = z
  .discriminatedUnion("kind", [FractionBarSpecSchema, NumberLineSpecSchema, PartWholeSpecSchema, ComparisonSpecSchema])
  .superRefine((spec, ctx) => {
    for (const message of specIssues(spec)) ctx.addIssue({ code: "custom", message });
  });
export type VisualSpec = z.infer<typeof VisualSpecSchema>;
export type FractionBarSpec = z.infer<typeof FractionBarSpecSchema>;
export type NumberLineSpec = z.infer<typeof NumberLineSpecSchema>;
export type PartWholeSpec = z.infer<typeof PartWholeSpecSchema>;
export type ComparisonSpec = z.infer<typeof ComparisonSpecSchema>;

const gcd = (a: number, b: number): number => (b === 0 ? Math.abs(a) : gcd(b, a % b));
export const sameValue = (a: Fraction, b: Fraction) => a.n * b.d === b.n * a.d;
export const less = (a: Fraction, b: Fraction) => a.n * b.d < b.n * a.d;
export const reduce = (f: Fraction): Fraction => {
  const g = gcd(f.n, f.d) || 1;
  return { n: f.n / g, d: f.d / g };
};
export function parseLabel(text: string): Fraction | null {
  if (!LABEL_PATTERN.test(text)) return null;
  const [n, d] = text.split("/");
  return { n: Number(n), d: d === undefined ? 1 : Number(d) };
}
export const fractionText = (f: Fraction) => (f.d === 1 ? String(f.n) : `${f.n}/${f.d}`);

/** The exact value of tick `i` of a number line (rational arithmetic: no rounding decides a label). */
export function tickValue(spec: Pick<NumberLineSpec, "start" | "end" | "divisions">, i: number): Fraction {
  const { start: s, end: e, divisions: k } = spec;
  // s + i·(e − s)/k = (s.n·e.d·k + i·(e.n·s.d − s.n·e.d)) / (s.d·e.d·k)
  return reduce({ n: s.n * e.d * k + i * (e.n * s.d - s.n * e.d), d: s.d * e.d * k });
}

/** The rules a spec must meet to be drawn at all (also applied by the schema). Empty = verified. */
export function specIssues(spec: { kind: string } & Record<string, unknown>): string[] {
  const issues: string[] = [];
  const s = spec as VisualSpec;
  if (s.kind === "fraction_bar" || s.kind === "part_whole") {
    if (new Set(s.shaded).size !== s.shaded.length) issues.push("partes sombreadas repetidas");
    if (s.shaded.some((i) => i >= s.parts)) issues.push("una parte sombreada no existe");
  }
  if (s.kind === "number_line") {
    if (!less(s.start, s.end)) issues.push("el intervalo de la recta no es creciente");
    const ticks = new Set<number>();
    for (const label of s.labels) {
      if (label.tick > s.divisions) issues.push("una etiqueta no corresponde a ninguna marca");
      if (ticks.has(label.tick)) issues.push("dos etiquetas en la misma marca");
      ticks.add(label.tick);
      const value = parseLabel(label.text);
      // A label is printed where its value is: a misplaced one would teach something false.
      if (!value || !sameValue(value, tickValue(s, label.tick))) issues.push("una etiqueta no coincide con el valor de su marca");
    }
  }
  return issues;
}

/** Plain-language description for assistive technology. States what is drawn, never what the student must find. */
export function describeSpec(spec: VisualSpec): string {
  switch (spec.kind) {
    case "fraction_bar":
      return `Barra dividida en ${spec.parts} partes iguales; ${spec.shaded.length} ${spec.shaded.length === 1 ? "parte sombreada" : "partes sombreadas"}.`;
    case "part_whole":
      return `${spec.shape === "circle" ? "Círculo" : "Rectángulo"} dividido en ${spec.parts} partes iguales; ${spec.shaded.length} ${spec.shaded.length === 1 ? "parte sombreada" : "partes sombreadas"}.`;
    case "number_line": {
      const labels = spec.labels.length > 0 ? `; marcas rotuladas: ${spec.labels.map((l) => l.text).join(", ")}` : "";
      return `Recta numérica de ${fractionText(spec.start)} a ${fractionText(spec.end)} dividida en ${spec.divisions} partes iguales${labels}.`;
    }
    case "comparison":
      return spec.items.map((i) => `${fractionText(i.left)}, casilla vacía, ${fractionText(i.right)}`).join(". ") + ".";
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Geometry: pure, in millimetres. The SVG renderer draws exactly this; tests measure it.
// ---------------------------------------------------------------------------------------------------------------------

export const BAR = { width: 120, height: 14 } as const;
export interface BarGeometry {
  width: number;
  height: number;
  parts: Array<{ x: number; w: number; shaded: boolean }>;
}
export function barGeometry(spec: Pick<FractionBarSpec, "parts" | "shaded">, width: number = BAR.width): BarGeometry {
  const w = width / spec.parts;
  const shaded = new Set(spec.shaded);
  return { width, height: BAR.height, parts: Array.from({ length: spec.parts }, (_, i) => ({ x: i * w, w, shaded: shaded.has(i) })) };
}

export const LINE = { width: 150, pad: 8, tick: 3.2 } as const;
export interface NumberLineGeometry {
  width: number;
  axis: { x1: number; x2: number };
  ticks: Array<{ x: number; value: Fraction; label: Fraction | null }>;
}
export function numberLineGeometry(spec: NumberLineSpec, width: number = LINE.width): NumberLineGeometry {
  const x0 = LINE.pad;
  const step = (width - 2 * LINE.pad) / spec.divisions;
  const labels = new Map(spec.labels.map((l) => [l.tick, parseLabel(l.text)]));
  return {
    width,
    axis: { x1: 0, x2: width },
    ticks: Array.from({ length: spec.divisions + 1 }, (_, i) => ({ x: x0 + i * step, value: tickValue(spec, i), label: labels.get(i) ?? null })),
  };
}

export const COMPARISON = { box: 9, fractionWidth: 12, gap: 4, itemGap: 16 } as const;
export function comparisonGeometry(spec: ComparisonSpec): { width: number; items: Array<{ left: number; box: number; right: number }> } {
  const itemWidth = 2 * COMPARISON.fractionWidth + 2 * COMPARISON.gap + COMPARISON.box;
  const items = spec.items.map((_, i) => {
    const x = i * (itemWidth + COMPARISON.itemGap);
    return { left: x, box: x + COMPARISON.fractionWidth + COMPARISON.gap, right: x + COMPARISON.fractionWidth + 2 * COMPARISON.gap + COMPARISON.box };
  });
  return { width: spec.items.length * itemWidth + (spec.items.length - 1) * COMPARISON.itemGap, items };
}
