import { DIMENSIONS, activeSupports, type DimensionKey, type FunctionalProfile } from "@/lib/schemas/functional-profile";
import { DIMENSION_COPY, LEVEL_WORD } from "./copy";

export interface SummaryLine {
  text: string;
  /** Intensity word shown next to the line, when it comes from a support level. */
  level?: "algo" | "bastante" | "mucho";
}

export interface ProfileSummary {
  isEmpty: boolean;
  intro: string;
  lines: SummaryLine[];
}

const LEVEL_ORDER = { high: 0, medium: 1, low: 2 } as const;
const groupOrder = Object.keys(
  Object.fromEntries(Object.values(DIMENSIONS).map((d) => [d.group, true])),
);

function bilingualLine(code: string): string {
  try {
    const name = new Intl.DisplayNames("es", { type: "language" }).of(code);
    return name ? `apoyo bilingüe en ${name}` : "apoyo bilingüe";
  } catch {
    return "apoyo bilingüe";
  }
}

/**
 * Deterministic, human-readable description of a functional profile. No AI is involved:
 * the same profile always yields the same text. Strongest supports come first.
 */
export function summarizeProfile(profile: FunctionalProfile): ProfileSummary {
  const lines: SummaryLine[] = [];

  const supports = activeSupports(profile)
    .map(([key, level]) => ({ key, level }))
    .sort(
      (a, b) =>
        LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] ||
        groupOrder.indexOf(DIMENSIONS[a.key].group) - groupOrder.indexOf(DIMENSIONS[b.key].group) ||
        a.key.localeCompare(b.key),
    );
  for (const { key, level } of supports) {
    lines.push({ text: DIMENSION_COPY[key as DimensionKey].summary, level: LEVEL_WORD[level] });
  }

  const { limits, allowances } = profile;
  if (limits.max_instruction_words) lines.push({ text: `instrucciones de ${limits.max_instruction_words} palabras como máximo` });
  if (limits.max_visible_tasks) lines.push({ text: `como máximo ${limits.max_visible_tasks} tareas visibles a la vez` });
  if (limits.max_task_minutes) lines.push({ text: `tareas de unos ${limits.max_task_minutes} minutos como máximo` });
  if (allowances.calculator) lines.push({ text: "se permite el uso de calculadora" });
  if (allowances.keyboard) lines.push({ text: "se permite responder con teclado" });
  if (allowances.bilingual_support_language) lines.push({ text: bilingualLine(allowances.bilingual_support_language) });

  if (lines.length === 0) {
    return {
      isEmpty: true,
      intro: "Todavía no has indicado ningún apoyo. Las adaptaciones solo cambiarán lo que pidas en cada material.",
      lines,
    };
  }
  return { isEmpty: false, intro: "Adaptaula tendrá en cuenta que este perfil se beneficia de:", lines };
}

/** Short teaser for list rows: the first lines plus how many more there are. */
export function teaser(summary: ProfileSummary, max = 3): { shown: string[]; more: number } {
  return { shown: summary.lines.slice(0, max).map((l) => l.text), more: Math.max(0, summary.lines.length - max) };
}
