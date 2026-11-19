import { normalize } from "./verify";

/**
 * Instructions may only point at what the student will really have (ADR-053). A real «Hacer magia» sheet asked to observe a picture
 * that had been rejected, to explain arrows no scheme drew and to cut out cards that were in another document. The planner writes the
 * wording; the server decides what is actually there, and removes the sentence of a prompt or a step that points at something missing
 * (never rewriting it). An activity left with no instruction is reported: the sheet is then incomplete, never silently delivered.
 */

export type ResourceKind = "picture" | "scheme" | "arrows" | "cards";

const PATTERNS: Record<ResourceKind, RegExp> = {
  // normalised text (no accents, lower case)
  picture: /\b(ilustracion(es)?|imagen(es)?|dibujo(s)?|foto(s|grafia|grafias)?)\b/,
  // A scheme is satisfied by a drawn scheme or by any picture of the sheet.
  scheme: /\b(esquema|diagrama)\b/,
  arrows: /\bflechas?\b/,
  cards: /\b(recorta\w*|recortable\w*|tarjetas?|tablero|pega\w*)\b/,
};

export type Available = Readonly<Record<ResourceKind, boolean>>;

const sentences = (text: string) => text.split(/(?<=[.!?:])\s+/).map((s) => s.trim()).filter(Boolean);

/** What a text points at that is not available. */
export function missingReferences(text: string, available: Available): ResourceKind[] {
  const n = normalize(text);
  return (Object.keys(PATTERNS) as ResourceKind[]).filter((k) => !available[k] && PATTERNS[k].test(n));
}

const points = (sentence: string, available: Available) => missingReferences(sentence, available).length > 0;

/** The prompt and steps of an activity without the sentences that point at something unavailable; `empty` when nothing is left to do. */
export function stripUnresolved(activity: { prompt: string; steps: readonly string[] }, available: Available): { prompt: string; steps: string[]; removed: number; empty: boolean } {
  const prompt = sentences(activity.prompt).filter((s) => !points(s, available)).join(" ");
  const steps = activity.steps.filter((s) => !points(s, available));
  const removed = (sentences(activity.prompt).length - sentences(prompt).length) + (activity.steps.length - steps.length);
  return { prompt, steps, removed, empty: prompt.length < 12 };
}
