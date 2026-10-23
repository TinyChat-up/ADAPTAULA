import type { IMAGE_BRIEF_V1 } from "@prompts/image-brief/v1";
import type { IMAGE_REVIEW_V1 } from "@prompts/image-review/v1";
import type { z } from "zod";
import { leakedSignature, normalizeText } from "@/lib/adaptation/text";

/**
 * New educational illustrations (docs/VISUAL_RESOURCES.md § Ilustraciones generadas): the deterministic gates around the two
 * model answers. A brief is accepted only if it can serve the activity as written without giving its answer; an image only if a
 * review confirms every required element, marker and label, and finds nothing prohibited, invented, wrong or revealing.
 * Exact representations (values, scales, measures, positions) never come this way: they are VisualSpecs.
 */

export type BriefDraft = z.infer<typeof IMAGE_BRIEF_V1.output.schema>;
export type ReviewDraft = z.infer<typeof IMAGE_REVIEW_V1.output.schema>;

export interface IllustrationElement {
  name: string;
  marker: number | null;
  label: string | null;
}

export interface IllustrationBrief {
  kind: NonNullable<BriefDraft["kind"]>;
  concept: string;
  pedagogical_purpose: string;
  required_elements: IllustrationElement[];
  prohibited_elements: string[];
  composition: string;
  detail_level: NonNullable<BriefDraft["detail_level"]>;
  conceptual_constraints: string[];
  alt_text: string;
}

export interface BriefContext {
  /** The activity as the student reads it (instruction + context). */
  activity: string;
  /** The analysis's expected answer, when there is one: no label may give it. */
  expectedAnswer: string | null;
  signatures: readonly string[];
  /** The sheet attends the reduction of visual distractions or density: never more than «simple» detail. */
  lowDetail: boolean;
}

const MARKUP = /[<>{}[\]`]/;
/** A measure, scale or value the picture would have to get exactly right: not for an image model. */
const EXACT_DATA = /\b\d+(?:[.,]\d+)?\s?(?:mm|cm|dm|m|km|g|kg|mg|l|ml|cl|s|min|h|%|°|º|grados|metros|kilos|litros|euros|€)\b/;
/** The activity points at numbered parts of the picture («señaladas con los números», «numeradas»). */
const EXACT_REPRESENTATION = /\b\d+\s*[/⁄]\s*\d+\b|\d\s*[+−×÷=]\s*\d|\b(recta numerica|fracciones? equivalentes?|escala|eje de coordenadas|tabla de valores)\b|\b(exactamente|cantidad de|grupo de)\s+(?:\d+|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\b/;
const NUMBERED = /\b(senalad[ao]s? con (?:los )?numeros?|numerad[ao]s|marcad[ao]s? con (?:los )?numeros?|indicad[ao]s? con (?:los )?numeros?|con los numeros)\b/;

/** The numbers an activity says are on the picture, when it says so: those markers must be there, and only those. */
export function markerNumbersIn(activity: string): number[] {
  const norm = normalizeText(activity);
  if (!NUMBERED.test(norm)) return [];
  return [...new Set([...norm.matchAll(/(?<![\d/])\b([1-9])\b(?![\d/])/g)].map((m) => Number(m[1])))].sort((a, b) => a - b);
}

const labelsForCheck = (elements: IllustrationElement[]) => elements.flatMap(e => e.label ? [e.label] : []);

const words = (s: string) => normalizeText(s).split(/[^a-z0-9ñ]+/).filter((w) => w.length > 2);

export function validateBrief(draft: BriefDraft | null, ctx: BriefContext): { ok: true; brief: IllustrationBrief } | { ok: false; violations: string[] } {
  if (!draft || !draft.feasible) return { ok: false, violations: ["not_feasible"] };
  const { kind, concept, pedagogical_purpose, composition, detail_level, alt_text } = draft;
  if (!kind || !concept?.trim() || !pedagogical_purpose?.trim() || !composition?.trim() || !detail_level || !alt_text?.trim()) return { ok: false, violations: ["incomplete"] };
  const elements = (draft.required_elements ?? []).map((e) => ({ name: e.name.trim(), marker: e.marker, label: e.label?.trim() || null }));
  const violations: string[] = [];
  if (elements.some(e => e.marker === null && /\b(?:[2-9]|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s+\p{L}+/u.test(normalizeText(e.name)))) violations.push("exact_data");
  if (elements.length === 0 || elements.some((e) => !e.name)) violations.push("no_required_elements");
  const names = elements.map((e) => normalizeText(e.name));
  if (new Set(names).size !== names.length) violations.push("duplicate_elements");
  const texts = [concept, pedagogical_purpose, composition, alt_text, ...elements.flatMap((e) => [e.name, e.label ?? ""]), ...(draft.prohibited_elements ?? []), ...(draft.conceptual_constraints ?? [])];
  if (texts.some((t) => MARKUP.test(t))) violations.push("markup");
  if ([concept, composition, alt_text, ...labelsForCheck(elements), ...(draft.conceptual_constraints ?? []), ...elements.map((e) => e.name)].some((t) => EXACT_DATA.test(normalizeText(t)) || EXACT_REPRESENTATION.test(normalizeText(t)))) violations.push("exact_data");

  // Numbered parts: exactly the numbers the activity names, consecutive, each on one element, never with its name written.
  const markers = elements.filter((e) => e.marker !== null).map((e) => e.marker!);
  if (new Set(markers).size !== markers.length) violations.push("duplicate_markers");
  const sorted = [...markers].sort((a, b) => a - b);
  if (sorted.some((m, i) => m !== i + 1)) violations.push("markers_not_consecutive");
  const named = markerNumbersIn(ctx.activity);
  if (named.length > 0 && JSON.stringify(named) !== JSON.stringify(sorted)) violations.push("markers_do_not_match_activity");
  if (elements.some((e) => e.marker !== null && e.label)) violations.push("marker_with_name");

  // Labels: few, short, and never what the student has to find.
  const labels = elements.filter((e) => e.label).map((e) => e.label!);
  if (labels.some(l => /[0-9]/.test(l))) violations.push("exact_data");
  if (ctx.expectedAnswer && labels.some(l => normalizeText(l) === normalizeText(ctx.expectedAnswer!))) violations.push("label_gives_answer");
  if (labels.length > 8) violations.push("too_many_labels");
  const answerWords = new Set(ctx.expectedAnswer ? words(ctx.expectedAnswer) : []);
  if (labels.some((l) => words(l).length > 0 && words(l).every((w) => answerWords.has(w)))) violations.push("label_gives_answer");
  if (leakedSignature([...labels, alt_text].join("\n"), ctx.signatures)) violations.push("answer_leaked");

  if (violations.length > 0) return { ok: false, violations };
  return {
    ok: true,
    brief: {
      kind,
      concept: concept.trim(),
      pedagogical_purpose: pedagogical_purpose.trim(),
      required_elements: elements,
      prohibited_elements: (draft.prohibited_elements ?? []).map((p) => p.trim()).filter(Boolean),
      composition: composition.trim(),
      // The profile decides how much detail is too much, not the model.
      detail_level: ctx.lowDetail && detail_level === "moderate" ? "simple" : detail_level,
      conceptual_constraints: (draft.conceptual_constraints ?? []).map((c) => c.trim()).filter(Boolean),
      alt_text: alt_text.trim(),
    },
  };
}

/** The review is a model claim to check, not a guarantee of semantic correctness: every required element, marker and label confirmed, and nothing else wrong. */
export function acceptReview(review: ReviewDraft | null, brief: IllustrationBrief): { ok: true } | { ok: false; issues: string[] } {
  if (!review) return { ok: false, issues: ["no_review"] };
  const issues: string[] = [];
  const used = new Set<number>();
  for (const e of brief.required_elements) {
    const at = review.elements.findIndex((r, i) => !used.has(i) && normalizeText(r.name) === normalizeText(e.name));
    if (at >= 0) used.add(at);
    const seen = at >= 0 ? review.elements[at] : undefined;
    if (!seen || !seen.present) issues.push(`missing:${e.name}`);
    else {
      if (e.marker !== null && seen.marker_ok !== true) issues.push(`marker:${e.marker}:${e.name}`);
      if (e.label && seen.label_ok !== true) issues.push(`label:${e.label}`);
    }
  }
  for (const p of review.prohibited_found) issues.push(`prohibited:${p}`);
  for (const c of review.conceptual_errors) issues.push(`concept:${c}`);
  if (review.extra_text) issues.push("extra_text");
  if (review.illegible_text) issues.push("illegible_text");
  if (review.answer_revealed) issues.push("answer_revealed");
  if (!review.age_appropriate) issues.push("age");
  if (!review.printable) issues.push("printable");
  if (!review.matches_activity) issues.push("activity_mismatch");
  if (review.verdict !== "approved") issues.push("rejected");
  return issues.length === 0 ? { ok: true } : { ok: false, issues };
}

/** What a second attempt is told to fix (issue codes in words; nothing about the learner). */
export function correctionsFrom(issues: readonly string[]): string[] {
  const out = issues.map((i) => {
    const [code, ...rest] = i.split(":");
    const value = rest.join(":");
    switch (code) {
      case "missing":
        return `debe verse con claridad «${value}»`;
      case "marker": {
        const [n, ...name] = rest;
        return `el marcador ${n} debe tocar exactamente «${name.join(":")}»`;
      }
      case "label":
        return `la etiqueta «${value}» debe estar escrita exactamente así y unida a su elemento`;
      case "prohibited":
        return `elimina «${value}»`;
      case "concept":
        return `corrige este error: ${value}`;
      case "extra_text":
        return "no escribas ningún texto, número ni letra aparte de los indicados";
      case "illegible_text":
        return "los textos indicados deben ser legibles y sin faltas";
      case "answer_revealed":
        return "la imagen no puede mostrar la respuesta";
      case "age":
        return "ajusta el estilo a la edad indicada, sin infantilizar";
      case "printable":
        return "simplifica y aumenta el contraste para que se entienda impresa en blanco y negro";
      case "activity_mismatch":
        return "la actividad debe poder hacerse con la imagen tal como está escrita";
      default:
        return null;
    }
  });
  return [...new Set(out.filter((x): x is string => x !== null))].slice(0, 8);
}
