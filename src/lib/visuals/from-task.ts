import type { AnalysisActivity, AnalysisVisual } from "@/lib/schemas/material-analysis";
import { consistentWithActivities, specFromAnalysis } from "./from-analysis";
import { VISUAL_SPEC_VERSION, VisualSpecSchema, reduce, sameValue, specIssues, type Fraction, type VisualSpec } from "./spec";

/**
 * «Hacer magia», when the original's figure can be neither cropped nor read from its pixels: a NEW figure of the same kind is drawn
 * so that the activity keeps its competence (reading a bar is still reading a bar; marking on a line is still marking on a line).
 * It is presented as a new resource (`provenance: "generated"`), never as the original, and the activity is then about THIS figure.
 *
 * What the figure carries comes only from the material: the analysis's complete description of the visual, the fraction the
 * activity's expected answer gives (a bar that shows 3/8 for «¿qué fracción está coloreada?» whose answer is 3/8), or the fractions
 * the activity names (a line in quarters for «Marca 3/4»). Where they disagree, the answer wins: the figure and the activity's key
 * must say the same. A generated number line labels only its whole numbers (it never prints the fraction to be placed).
 */

export type GeneratedBasis = "description" | "answer" | "task_data";

const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

const FRACTION = /\b(\d{1,3})\/(\d{1,3})\b/g;
const fractionsIn = (text: string): Fraction[] => [...normalize(text).matchAll(FRACTION)].map((m) => ({ n: Number(m[1]), d: Number(m[2]) })).filter((f) => f.d > 0);

/** A single fraction as the whole answer («3/8», «3/8 de la barra»), from an answer the material gives or the analysis inferred. */
function answerFraction(activity: AnalysisActivity): Fraction | null {
  if (activity.expected_answer.basis === "not_inferable" || !activity.expected_answer.value) return null;
  const found = fractionsIn(activity.expected_answer.value);
  return found.length === 1 && found[0]!.n <= found[0]!.d ? found[0]! : null;
}

export type DrawableFamily = "number_line" | "part_whole" | null;

export function drawableFamily(visual: Pick<AnalysisVisual, "kind" | "title" | "description" | "text">, activities: readonly AnalysisActivity[]): DrawableFamily {
  const words = normalize(`${visual.title ?? ""} ${visual.description} ${visual.text ?? ""} ${activities.map((a) => a.instruction).join(" ")}`);
  if (visual.kind === "number_line" || /\brecta (numerica|numerada)\b/.test(words)) return "number_line";
  if (/\b(barra|tira|rectangulo|circulo|pizza|tarta|cuadricula|fraccion (?:coloreada|sombreada|pintada))\b/.test(words)) return "part_whole";
  return null;
}

const verified = (candidate: unknown): VisualSpec | null => {
  const parsed = VisualSpecSchema.safeParse(candidate);
  return parsed.success && specIssues(parsed.data).length === 0 ? parsed.data : null;
};

const shadedValue = (spec: VisualSpec): Fraction | null =>
  spec.kind === "fraction_bar" || spec.kind === "part_whole" ? { n: spec.shaded.length, d: spec.parts } : spec.kind === "grid" ? { n: spec.shaded.length, d: spec.rows * spec.cols } : null;

const lcm = (a: number, b: number): number => {
  const g = (x: number, y: number): number => (y === 0 ? x : g(y, x % y));
  return (a * b) / g(a, b);
};

function partWhole(value: Fraction, circle: boolean): VisualSpec | null {
  // Never fewer parts than the denominator printed in the answer (3/8 is 8 parts, not 4 with a half).
  const parts = value.d;
  const shaded = Array.from({ length: value.n }, (_, i) => i);
  return circle && parts <= 12 ? verified({ spec_version: VISUAL_SPEC_VERSION, kind: "part_whole", shape: "circle", parts, shaded }) : verified({ spec_version: VISUAL_SPEC_VERSION, kind: "fraction_bar", parts, shaded });
}

function numberLine(fractions: readonly Fraction[]): VisualSpec | null {
  if (fractions.length === 0) return null;
  const end = Math.max(1, ...fractions.map((f) => Math.ceil(f.n / f.d)));
  const unit = fractions.map((f) => reduce(f).d).reduce(lcm, 1);
  const divisions = unit * end;
  if (unit > 12 || divisions > 24) return null;
  const labels = Array.from({ length: end + 1 }, (_, k) => ({ tick: k * unit, text: String(k) }));
  return verified({ spec_version: VISUAL_SPEC_VERSION, kind: "number_line", start: { n: 0, d: 1 }, end: { n: end, d: 1 }, divisions, labels });
}

export function generateEquivalentFigure(visual: Pick<AnalysisVisual, "kind" | "title" | "description" | "text">, activities: readonly AnalysisActivity[]): { spec: VisualSpec; basis: GeneratedBasis } | null {
  if (activities.length === 0) return null;
  const family = drawableFamily(visual, activities);
  if (!family) return null;
  const claim = specFromAnalysis(visual);
  const texts = activities.map((a) => (a.context ? `${a.instruction} ${a.context}` : a.instruction));

  if (family === "number_line") {
    if (claim?.kind === "number_line" && consistentWithActivities(claim, texts)) return { spec: claim, basis: "description" };
    const spec = numberLine(texts.flatMap(fractionsIn));
    return spec && consistentWithActivities(spec, texts) ? { spec, basis: "task_data" } : null;
  }

  const answers = activities.map(answerFraction).filter((f): f is Fraction => f !== null);
  // Two activities on one figure that expect different fractions: the figure is not determined.
  if (answers.some((a) => !sameValue(a, answers[0]!))) return null;
  const answer = answers[0] ?? null;
  const claimValue = claim ? shadedValue(claim) : null;
  if (claim && claimValue && (!answer || (sameValue(claimValue, answer) && claimValue.d === answer.d))) return { spec: claim, basis: "description" };
  if (!answer) return null;
  const circle = /\b(circulo|circunferencia|pizza|tarta|rueda)\b/.test(normalize(`${visual.title ?? ""} ${visual.description}`));
  const spec = partWhole(answer, circle);
  return spec ? { spec, basis: "answer" } : null;
}
