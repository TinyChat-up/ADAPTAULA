/**
 * Offline reviewer eval (no provider, no cost): the reviewer's findings are SCRIPTED per case and pushed through the real
 * server-side merge on the documents of the three materials, to check the SYSTEM around the reviewer: what a finding can and
 * cannot change. It says nothing about the quality of a real model's judgment. Historical documents are never touched: every
 * case builds a fresh mock document.
 *
 *   pnpm eval:adaptation:reviewer:mock
 */
import { sequentialIds } from "@/lib/adaptation/document";
import { createMockGenerator, createMockPlanner } from "@/lib/adaptation/mock";
import { runAdaptation } from "@/lib/adaptation/pipeline";
import { checkOf, deterministicChecks } from "@/lib/adaptation/review";
import { buildReviewScoped } from "@/lib/adaptation/reviewer";
import type { ReviewInput } from "@/lib/adaptation/review-checks";
import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";
import { allBlocks } from "@/lib/schemas/material-document";
import type { AiReviewDraft, CheckStatus, PedagogicalReview } from "@/lib/schemas/pedagogical-review";
import { argumentationAnalysis, fractionsAnalysis, geographyAnalysis } from "./fixtures";
import { EXECUTIVE_EXPERIMENT_PROFILE } from "./planner-lib";
import { primariaScenario } from "./reviewer-fixtures";

type Check = AiReviewDraft["checks"][number];
interface Subject {
  name: string;
  input: ReviewInput;
  ids: string[];
  deferred: boolean;
}

async function subjectOf(name: string, analysis: MaterialAnalysis): Promise<Subject> {
  const result = await runAdaptation(
    { profile: EXECUTIVE_EXPERIMENT_PROFILE, education: { stage: null, grade: null, subject: null }, analysis, adaptationType: "accessibility", policy: 2 },
    { planner: createMockPlanner(analysis, 2), plannerVersion: 2, generator: createMockGenerator(2), generatorVersion: 2, reviewer: null, newBlockId: sequentialIds() },
  );
  return { name, input: { analysis, plan: result.plan, context: result.context, document: result.document, validation: result.reviewed.effectiveValidation }, ids: result.reviewed.raw.decisions.map((d) => d.id), deferred: result.execution.deferred.length > 0 };
}

const f = (check: Check["check"], status: CheckStatus & Check["status"], targets: string[], detail: string): Check => ({ check, status, targets, detail });

interface Case {
  name: string;
  /** Scripted findings for this subject. */
  script: (s: { semantic: string[]; blocks: string[]; activity: string }) => Check[];
  expect: (review: PedagogicalReview, s: { semantic: string[] }) => string | null;
}

const clean = (s: { semantic: string[]; blocks: string[] }): Check[] => [
  ...(s.semantic.length > 0 ? [f("answers_not_leaked", "PASS", s.semantic, "Sin fuga")] : []),
  f("age_appropriate", "PASS", [], "Tono adecuado"),
  f("no_infantilization", "PASS", [], "Sobrio"),
  f("functional_supports_applied", "PASS", s.blocks.slice(0, 1), "Apoyo útil"),
];
const swap = (base: Check[], extra: Check): Check[] => [...base.filter((c) => !(c.check === extra.check)), extra];
const need = (cond: boolean, message: string) => (cond ? null : message);

const CASES: Case[] = [
  { name: "limpio", script: clean, expect: (r) => need(r.verdict !== "blocked" && r.verdict !== "needs_revision", `verdict ${r.verdict}`) },
  { name: "fuga literal", script: (s) => swap(clean(s), f("answers_not_leaked", "FAIL", [s.semantic[0] ?? s.activity], "Muestra la respuesta")), expect: (r) => need(checkOf(r, "answers_not_leaked").status === "FAIL" && r.verdict === "blocked", "no bloquea") },
  { name: "fuga semántica", script: (s) => swap(clean(s), f("answers_not_leaked", "FAIL", [s.semantic[0] ?? s.activity], "La parafrasea")), expect: (r) => need(r.verdict === "blocked", "no bloquea") },
  { name: "pista indirecta", script: (s) => [...clean(s), f("answers_not_leaked", "WARN", s.blocks.slice(0, 1).length ? s.blocks.slice(0, 1) : [s.activity], "Orienta casi hacia el resultado")], expect: (r) => need(checkOf(r, "answers_not_leaked").status !== "PASS", "una pista queda en PASS") },
  { name: "sobre-apoyo", script: (s) => [...clean(s), f("functional_supports_applied", "WARN", s.blocks.slice(0, 1), "Añade más carga de la que quita")], expect: (r) => need(checkOf(r, "functional_supports_applied").status !== "PASS", "sobre-apoyo en PASS") },
  { name: "sub-apoyo", script: (s) => [...clean(s), f("functional_supports_applied", "WARN", [], "Necesidad activa sin apoyo suficiente")], expect: (r) => need(checkOf(r, "functional_supports_applied").status !== "PASS", "sub-apoyo en PASS") },
  { name: "infantilización", script: (s) => [...clean(s), f("no_infantilization", "FAIL", [], "Tono pueril")], expect: (r) => need(checkOf(r, "no_infantilization").status === "FAIL" && r.verdict === "needs_revision", "no se corrige a needs_revision") },
  { name: "redundancia semántica", script: (s) => [...clean(s), f("functional_supports_applied", "WARN", s.blocks.slice(0, 1), "Repite el requisito de la consigna")], expect: (r) => need(checkOf(r, "functional_supports_applied").status === "WARN", "redundancia no es WARN") },
  { name: "sin respuesta del reviewer", script: () => [], expect: (r) => need(checkOf(r, "age_appropriate").status === "WARN" && r.verdict !== "approved", "ausencia tratada como PASS") },
  { name: "target inexistente", script: (s) => [f("answers_not_leaked", "PASS", ["act_99", ...s.semantic], "x"), ...clean(s).slice(1)], expect: (r, s) => need(s.semantic.length === 0 || checkOf(r, "answers_not_leaked").status === "WARN", "un target inexistente cerró la pregunta") },
  { name: "decisión diferida", script: clean, expect: (r) => need(checkOf(r, "traceability_complete").status === "WARN", "la trazabilidad diferida dejó de ser WARN") },
];

async function main() {
  const subjects: Subject[] = [
    await subjectOf("Primaria", fractionsAnalysis()),
    await subjectOf("Geografía", geographyAnalysis()),
    await subjectOf("Bachillerato", argumentationAnalysis()),
  ];
  const primaria = primariaScenario();
  subjects.push({ name: "Primaria (cadena real en miniatura)", input: primaria.input, ids: primaria.ids, deferred: true });

  let failures = 0;
  for (const subject of subjects) {
    const base = deterministicChecks(subject.input);
    const semantic = base.find((c) => c.check === "answers_not_leaked" && c.needs_semantic_review)?.targets ?? [];
    const blocks = allBlocks(subject.input.document).filter((b) => b.trace.origin !== "original" && b.trace.origin !== "structure").map((b) => b.id);
    const activity = subject.input.analysis.activities[0]!.id;
    console.log(`${subject.name} · semántica abierta: ${semantic.join(", ") || "ninguna"} · bloques añadidos: ${blocks.length} · decisión diferida: ${subject.deferred ? "sí" : "no"}`);
    for (const c of CASES) {
      if (c.name === "decisión diferida" && !subject.deferred) {
        console.log(`  – ${c.name}: no aplica (sin decisión diferida)`);
        continue;
      }
      const out = buildReviewScoped(subject.input, { checks: c.script({ semantic, blocks, activity }) }, subject.ids);
      const problem = c.expect(out.review, { semantic });
      if (problem) failures += 1;
      console.log(`  ${problem ? "✗" : "✓"} ${c.name} → ${out.review.verdict}${out.pending.length ? ` · pendiente: ${out.pending.join(",")}` : ""}${out.rejected.length ? ` · rechazados: ${out.rejected.length}` : ""}${problem ? ` · FALLO: ${problem}` : ""}`);
    }
  }
  if (failures > 0) process.exitCode = 1;
}

void main();
