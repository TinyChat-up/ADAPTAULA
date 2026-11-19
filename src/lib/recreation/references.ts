import { normalize } from "./verify";

/**
 * Instructions may only point at what the student will really have, activity by activity (ADR-053). A real «Hacer magia» sheet asked
 * to observe a picture that had been rejected, to explain arrows no scheme drew and to cut out cards that were in another document.
 *
 * What an activity mentions is resolved in this order, and only the last two steps happen here:
 *   1. the original's picture (located crop) · 2. an OpenAI illustration · 3. a scheme drawn by code   → `visuals.ts`, `compile.ts`
 *   4. a minimal rewording: ONLY a sentence that merely points («Observa la ilustración.», «Mira el esquema.») is removed; the task
 *      itself, its response and its solution do not change, so what is learnt and its cognitive demand are kept;
 *   5. otherwise the activity is UNRESOLVED and the sheet is incomplete: it is never delivered as final.
 */

export type ResourceKind = "picture" | "scheme" | "arrows" | "cards";

const PATTERNS: Record<ResourceKind, RegExp> = {
  // normalised text (no accents, lower case)
  picture: /\b(ilustracion(es)?|imagen(es)?|dibujo(s)?|foto(s|grafia|grafias)?)\b/,
  // A scheme is satisfied by a drawn scheme or by a picture of THIS activity.
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

/**
 * A sentence that only directs the eye (no question, a pointing verb, short): removing it leaves the task as it was. «Explica qué
 * indican las flechas» or «¿Qué ves en la imagen?» ARE the task: they are never removed.
 */
const POINTING = /^(observa|mira|fijate|ayudate|apoyate|usa|utiliza|consulta)\b/;
const merelyPoints = (sentence: string) => {
  const n = normalize(sentence);
  return !sentence.includes("?") && POINTING.test(n) && n.split(/\s+/).length <= 14;
};

export interface ReferenceResolution {
  prompt: string;
  steps: string[];
  /** Pointing sentences removed (the task is unchanged). */
  removed: number;
  /** The kinds still referenced by the TASK itself: the activity cannot be done as written. */
  unresolved: ResourceKind[];
}

export function resolveReferences(activity: { prompt: string; steps: readonly string[] }, available: Available): ReferenceResolution {
  const unresolved = new Set<ResourceKind>();
  let removed = 0;
  const keep = (s: string) => {
    const missing = missingReferences(s, available);
    if (missing.length === 0) return true;
    if (merelyPoints(s)) {
      removed++;
      return false;
    }
    for (const k of missing) unresolved.add(k);
    return true;
  };
  const prompt = sentences(activity.prompt).filter(keep).join(" ");
  const steps = activity.steps.filter(keep);
  // A prompt reduced to nothing was only a pointer: the activity has no task left.
  if (prompt.length < 12) for (const k of missingReferences(activity.prompt, available)) unresolved.add(k);
  return { prompt, steps, removed, unresolved: [...unresolved] };
}

export const mentions = (text: string, kind: ResourceKind) => PATTERNS[kind].test(normalize(text));
