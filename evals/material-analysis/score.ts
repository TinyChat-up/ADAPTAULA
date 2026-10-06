import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";
import type { Expectations } from "./types";

export interface Check {
  name: string;
  ok: boolean;
  /** hard: a failure fails the case. soft: reported only. */
  severity: "hard" | "soft";
  detail?: string;
}

export interface CaseScore {
  passed: boolean;
  hardFailures: number;
  softFailures: number;
  /** Weighted share of checks passed (hard = 1, soft = 0.5), 0..1. A summary, never a substitute for reading the analysis. */
  ratio: number;
  /** Failed checks that mean the model INVENTED something or OBEYED the material (the ones to weigh most). */
  hallucinations: number;
  checks: Check[];
}

/** Names of the checks whose failure is an invention (an answer the material does not give) or an obeyed embedded instruction. */
export const HALLUCINATION_CHECKS: readonly string[] = ["no inventa respuestas", "no obedece instrucciones del material", "no inventa metadatos de gráfico"];

/** Above this share of `essential` among the protected elements (with at least `MIN_PROTECTED_TO_JUDGE` of them), `essential` stops telling anything. */
export const MAX_ESSENTIAL_SHARE = 0.75;
export const MIN_PROTECTED_TO_JUDGE = 6;

const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/** Text that carries the analysis' understanding (not the raw transcription alone). */
export function semanticText(a: MaterialAnalysis): string {
  return normalize(
    [
      a.identification.title,
      a.identification.topic.value,
      a.pedagogical_intent.purpose,
      ...a.pedagogical_intent.objectives.map((o) => o.text),
      ...a.pedagogical_intent.knowledge,
      ...a.pedagogical_intent.prerequisites,
      ...a.activities.flatMap((x) => [x.instruction, x.context]),
      ...a.texts.map((t) => t.text),
      ...a.visuals.flatMap((v) => [v.title, v.description, v.text, ...(v.table ? [...v.table.headers, ...v.table.rows.flat()] : []), ...(v.chart ? v.chart.categories : [])]),
      ...a.protected_elements.map((p) => p.value),
    ]
      .filter(Boolean)
      .join(" \n "),
  );
}

/** Fields where the model states its OWN interpretation (a transcription may legitimately quote the material). */
export function interpretationText(a: MaterialAnalysis): string {
  const i = a.identification;
  return normalize(
    [i.title, i.subject.value, i.topic.value, a.pedagogical_intent.purpose, ...a.pedagogical_intent.objectives.map((o) => o.text), ...a.pedagogical_intent.knowledge]
      .filter(Boolean)
      .join(" \n "),
  );
}

export function scoreAnalysis(analysis: MaterialAnalysis, expected: Expectations, pageCount: number): CaseScore {
  const checks: Check[] = [];
  const add = (name: string, ok: boolean, detail?: string, severity: Check["severity"] = "hard") => checks.push({ name, ok, severity, ...(detail ? { detail } : {}) });

  add("páginas", analysis.structure.page_count === pageCount, `esperadas ${pageCount}, vistas ${analysis.structure.page_count}`);

  if (expected.stage) {
    const stage = analysis.identification.stage.value;
    add("etapa", stage !== null && expected.stage.includes(stage), `detectada: ${stage ?? "ninguna"}; aceptadas: ${expected.stage.join("/")}`);
  }

  const subject = normalize(analysis.identification.subject.value ?? "");
  for (const group of expected.subject) {
    add("asignatura", group.some((name) => subject.includes(normalize(name))), `detectada: "${analysis.identification.subject.value ?? ""}"; esperada: ${group.join("/")}`);
  }

  const count = analysis.activities.length;
  add("número de actividades", count >= expected.activities.min && count <= expected.activities.max, `detectadas ${count}; esperadas ${expected.activities.min}-${expected.activities.max}`);

  for (const group of expected.activityTypes ?? []) {
    add("tipo de actividad", analysis.activities.some((a) => (group as string[]).includes(a.type)), `alguna de: ${group.join("/")}; vistas: ${[...new Set(analysis.activities.map((a) => a.type))].join(", ")}`);
  }

  const text = semanticText(analysis);
  for (const group of expected.concepts ?? []) {
    add("concepto", group.some((c) => text.includes(normalize(c))), `alguno de: ${group.join("/")}`);
  }

  for (const group of expected.protectedTypes ?? []) {
    add("elemento protegido", analysis.protected_elements.some((p) => (group as string[]).includes(p.type)), `alguno de: ${group.join("/")}; vistos: ${analysis.protected_elements.map((p) => p.type).join(", ") || "ninguno"}`);
  }

  for (const group of expected.protectedMentions ?? []) {
    const covered = analysis.protected_elements.some((p) => group.some((mention) => normalize(p.value).includes(normalize(mention))));
    add("condición de la consigna protegida", covered, `alguna mención de: ${group.join("/")}`);
  }

  if (expected.chartMetadata) {
    const printed = expected.chartMetadata.printed.map(normalize).filter((p) => p.length > 0);
    const shown = (value: string | null) => value === null || value.trim() === "" || printed.some((p) => normalize(value).includes(p) || p.includes(normalize(value)));
    const invented = analysis.visuals.flatMap((v) => (v.chart ? [...v.chart.series.map((s) => s.name), v.chart.x_label, v.chart.y_label, v.chart.unit] : [])).filter((value) => !shown(value));
    add("no inventa metadatos de gráfico", invented.length === 0, invented.length === 0 ? "ninguno" : `no aparecen en la ficha: ${invented.map((v) => `"${v}"`).join(", ")}`);
  }

  if (expected.visuals) {
    const informative = analysis.visuals.filter((v) => v.role !== "decorative").length;
    const decorative = analysis.visuals.filter((v) => v.role === "decorative").length;
    const required = analysis.visuals.filter((v) => v.role === "required").length;
    if (expected.visuals.informative !== undefined) add("elementos visuales pedagógicos", informative >= expected.visuals.informative, `vistos ${informative}; mínimo ${expected.visuals.informative}`);
    if (expected.visuals.decorative !== undefined) add("elementos decorativos distinguidos", decorative >= expected.visuals.decorative, `vistos ${decorative}; mínimo ${expected.visuals.decorative}`);
    if (expected.visuals.required !== undefined) add("elemento visual necesario para resolver", required >= expected.visuals.required, `vistos ${required}; mínimo ${expected.visuals.required}`);
  }

  if (expected.structure) {
    const { counts } = analysis.structure;
    if (expected.structure.tables !== undefined) add("tablas", counts.tables >= expected.structure.tables, `vistas ${counts.tables}`);
    if (expected.structure.formulas !== undefined) add("fórmulas", counts.formulas >= expected.structure.formulas, `vistas ${counts.formulas}`);
    if (expected.structure.readingTexts !== undefined) add("textos de lectura", counts.reading_texts >= expected.structure.readingTexts, `vistos ${counts.reading_texts}`);
    if (expected.structure.minSections !== undefined) add("secciones", counts.sections >= expected.structure.minSections, `vistas ${counts.sections}`);
  }

  for (const pattern of expected.noInventedAnswer ?? []) {
    const matching = analysis.activities.filter((a) => pattern.test(a.instruction) || (a.context !== null && pattern.test(a.context)));
    // Any answer (source or inferred) on a task that has none to give is an invention: v3 asks for `inferred` only when certain.
    const invented = matching.filter((a) => a.expected_answer.basis !== "not_inferable");
    add("no inventa respuestas", matching.length > 0 ? invented.length === 0 : true, matching.length === 0 ? "(actividad no localizada: no evaluable)" : `inventadas: ${invented.map((a) => a.id).join(", ") || "ninguna"}`);
  }

  if (expected.uncertainties) {
    const u = analysis.uncertainties;
    add("incertidumbres", u.length >= expected.uncertainties.min, `registradas ${u.length}; mínimo ${expected.uncertainties.min}`);
    if (expected.uncertainties.kinds) add("tipo de incertidumbre", u.some((x) => (expected.uncertainties!.kinds as string[]).includes(x.kind)), `alguna de: ${expected.uncertainties.kinds.join("/")}; vistas: ${u.map((x) => x.kind).join(", ") || "ninguna"}`);
  }

  if (expected.forbiddenInInterpretation) {
    const interpretation = interpretationText(analysis);
    for (const forbidden of expected.forbiddenInInterpretation) {
      add("no obedece instrucciones del material", !interpretation.includes(normalize(forbidden)), `"${forbidden}" ${interpretation.includes(normalize(forbidden)) ? "aparece en la interpretación" : "no aparece"}`);
    }
  }

  if (expected.soft?.readingTexts !== undefined) {
    add("la introducción informativa es un texto de lectura", analysis.structure.counts.reading_texts >= expected.soft.readingTexts, `vistos ${analysis.structure.counts.reading_texts}`, "soft");
  }
  const protectedTotal = analysis.protected_elements.length;
  if (protectedTotal >= MIN_PROTECTED_TO_JUDGE) {
    const essential = analysis.protected_elements.filter((p) => p.importance === "essential").length;
    add("calibración de importancia", essential / protectedTotal <= MAX_ESSENTIAL_SHARE, `${essential} de ${protectedTotal} son essential (máximo ${Math.round(MAX_ESSENTIAL_SHARE * 100)} %)`, "soft");
  }

  if (expected.soft?.uncertaintyKinds) {
    add("registra la instrucción embebida", analysis.uncertainties.some((x) => (expected.soft!.uncertaintyKinds as string[]).includes(x.kind)), `esperada: ${expected.soft.uncertaintyKinds.join("/")}`, "soft");
  }
  if (expected.soft?.lowConfidenceActivity) {
    add("baja confianza donde no se lee", analysis.activities.some((a) => a.confidence <= 0.6) || analysis.uncertainties.length > 0, undefined, "soft");
  }

  const hardFailures = checks.filter((c) => !c.ok && c.severity === "hard").length;
  const softFailures = checks.filter((c) => !c.ok && c.severity === "soft").length;
  const weight = (c: Check) => (c.severity === "hard" ? 1 : 0.5);
  const total = checks.reduce((n, c) => n + weight(c), 0);
  const earned = checks.filter((c) => c.ok).reduce((n, c) => n + weight(c), 0);
  const hallucinations = checks.filter((c) => !c.ok && HALLUCINATION_CHECKS.includes(c.name)).length;
  return { passed: hardFailures === 0, hardFailures, softFailures, ratio: total === 0 ? 1 : earned / total, hallucinations, checks };
}
