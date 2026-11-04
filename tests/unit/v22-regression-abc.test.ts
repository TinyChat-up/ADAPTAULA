import { describe, expect, it } from "vitest";
import { sequentialIds } from "@/lib/adaptation/document";
import { blocksFor, studentText } from "@/lib/adaptation/document-text";
import { createMockGenerator, createMockPlanner, createMockReviewer } from "@/lib/adaptation/mock";
import { runAdaptation, type PipelineResult } from "@/lib/adaptation/pipeline";
import { auditAdaptation } from "@/lib/adaptation/v22/audit";
import { buildAdaptationContext } from "@/lib/adaptation/context";
import { DIMENSION_KEYS, type FunctionalProfile } from "@/lib/schemas/functional-profile";
import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";
import { allBlocks, type Block } from "@/lib/schemas/material-document";
import { argumentationAnalysis, fractionsAnalysis, geographyAnalysis } from "../../evals/adaptation/fixtures";
import { V22_PROFILES, v22ProfileA } from "./fixtures/v22-profiles";

/**
 * Contrastive regression with the fictional profiles A, B and C (ADR-044): the same synthetic sheet, three profiles, the existing
 * mock pipeline (no provider, no cost) and the V2.2 audit on top. It checks that the differences between the sheets follow the
 * differences between the profiles, that what neither profile justifies changing stays identical, and that the current functions
 * (required visuals, review verdict) are preserved.
 */
const SHEETS = [
  ["fracciones (Primaria)", fractionsAnalysis, "primaria"],
  ["geografía (ESO)", geographyAnalysis, "eso"],
  ["argumentación (Bachillerato)", argumentationAnalysis, "bachillerato"],
] as const;

type Stage = (typeof SHEETS)[number][2];
const profiles = (stage: Stage): Record<"A" | "B" | "C", FunctionalProfile> => ({ A: v22ProfileA(stage), B: V22_PROFILES.B, C: V22_PROFILES.C });
const NOT_NEEDED: Record<"A" | "B", string[]> = { A: ["vocabulary_complexity", "fine_motor_demand", "writing_amount"], B: ["reading_level", "text_length", "vocabulary_complexity", "instruction_chunking"] };

async function adapt(analysis: MaterialAnalysis, profile: FunctionalProfile) {
  const input = { profile, education: { stage: null, grade: null, subject: null }, analysis, adaptationType: "accessibility" as const };
  const result = await runAdaptation(input, { planner: createMockPlanner(analysis), generator: createMockGenerator(), reviewer: createMockReviewer(), newBlockId: sequentialIds() });
  const { omitted } = buildAdaptationContext(input);
  const before = structuredClone(result);
  const audit = auditAdaptation({ plan: result.plan, validation: result.validation, context: result.context, analysis, document: result.document, omitted, profile });
  expect(result, "la auditoría no modifica el resultado del pipeline").toEqual(before);
  return { result, audit };
}

/** What a student reads in an activity, without its answer space (which presentation may legitimately enlarge). */
const readOf = (r: PipelineResult, act: string) =>
  blocksFor(r.document, act)
    .filter((b): b is Extract<Block, { type: "activity" }> => b.type === "activity")
    .map((b) => studentText({ ...b, response: { kind: "none" } }))
    .join("\n");

describe.each(SHEETS)("regresión A/B/C · %s", (_, sheet, stage) => {
  it("C: ningún apoyo individual, ninguna barrera inventada; «sin valorar» no es «no necesita»", async () => {
    const { result, audit } = await adapt(sheet(), profiles(stage).C);
    expect(result.context.needs).toEqual([]);
    expect(result.plan.decisions.filter((d) => d.action !== "keep")).toEqual([]);
    expect(audit.ledger.activities.every((a) => a.intervention === "none" && a.needs_not_applied.length === 0)).toBe(true);
    expect(audit.ledger.residual_barriers).toEqual([]);
    expect(audit.ledger.profile).toEqual({ not_needed: [], unassessed_count: DIMENSION_KEYS.length });
  });

  it.each(["A", "B"] as const)("%s: cada cambio se apoya en una necesidad activa del perfil, nunca en una marcada «no necesita»", async (who) => {
    const { result, audit } = await adapt(sheet(), profiles(stage)[who]);
    const needs = new Set(result.context.needs.map((n) => n.dimension));
    for (const d of audit.ledger.decisions.filter((x) => x.action !== "keep")) {
      expect(d.origin).toBe("individual");
      for (const dim of d.dimensions) {
        expect(needs.has(dim), `${d.id} usa ${dim}`).toBe(true);
        expect(NOT_NEEDED[who]).not.toContain(dim);
      }
    }
    for (const n of audit.ledger.activities.flatMap((a) => a.needs_not_applied)) {
      // Never an invented reason: either typed evidence explains it, or it is left to the teacher.
      expect(n.status === "explained" ? n.evidence !== null : n.status === "pending_review").toBe(true);
    }
  });

  it("las diferencias entre A y B siguen a sus perfiles; lo que ninguno justifica cambiar queda idéntico", async () => {
    const analysis = sheet();
    const [a, b, c] = await Promise.all([adapt(analysis, profiles(stage).A), adapt(analysis, profiles(stage).B), adapt(analysis, profiles(stage).C)]);
    const touched = (x: typeof a) => new Set(x.audit.ledger.activities.filter((t) => t.intervention === "changed").map((t) => t.activity));
    const touchedA = touched(a);
    const touchedB = touched(b);
    for (const act of analysis.activities.map((x) => x.id)) {
      if (!touchedA.has(act)) expect(readOf(a.result, act), `A ${act}`).toBe(readOf(c.result, act));
      if (!touchedB.has(act)) expect(readOf(b.result, act), `B ${act}`).toBe(readOf(c.result, act));
    }
    const dims = (x: typeof a) => new Set(x.result.plan.decisions.flatMap((d) => d.dimensions));
    for (const dim of dims(a)) expect(profiles(stage).B.supports[dim] ?? "unassessed", `A usa ${dim}`).not.toMatch(/low|medium|high/);
    for (const dim of dims(b)) expect(profiles(stage).A.supports[dim] ?? "unassessed", `B usa ${dim}`).not.toMatch(/low|medium|high/);
  });

  it("conserva las funciones actuales: visuales necesarios presentes y veredicto utilizable, en los tres perfiles", async () => {
    const analysis = sheet();
    const required = analysis.visuals.filter((v) => v.role === "required").map((v) => v.id);
    for (const profile of Object.values(profiles(stage))) {
      const { result } = await adapt(analysis, profile);
      for (const vis of required) expect(blocksFor(result.document, vis).length, vis).toBeGreaterThan(0);
      expect(["approved", "approved_with_warnings"]).toContain(result.review.verdict);
      expect(allBlocks(result.document).length).toBeGreaterThan(0);
    }
  });

  it("estabilidad: la misma entrada da el mismo registro y los mismos hallazgos", async () => {
    const one = await adapt(sheet(), profiles(stage).A);
    const two = await adapt(sheet(), profiles(stage).A);
    expect(two.audit).toEqual(one.audit);
  });

  it("P1, P5 y P6 nunca se dan por comprobados", async () => {
    for (const profile of Object.values(profiles(stage))) {
      const { audit } = await adapt(sheet(), profile);
      for (const d of audit.ledger.decisions) {
        for (const h of d.hint_test.filter((x) => ["P1", "P5", "P6"].includes(x.question))) expect(["pending_review", "not_applicable"]).toContain(h.result);
      }
      expect(audit.ledger.residual_barriers_complete).toBe(false);
    }
  });
});

describe("P8 frente a answer_space@v1 (hallazgo registrado, no corregido en esta entrega)", () => {
  const p8 = async (sheet: () => MaterialAnalysis) => {
    const { audit } = await adapt(sheet(), V22_PROFILES.C);
    return audit.findings.filter((f) => f.check === "answer_space_homogeneity" && f.result === "flagged").map((f) => f.targets.join("/"));
  };

  it("fracciones: el cálculo con cuadrícula y la respuesta escrita con renglones no se marcan (el enunciado ya distingue los productos)", async () => {
    expect(await p8(fractionsAnalysis)).toEqual([]);
  });

  it("geografía: dos cálculos con el mismo espacio original reciben cuadrícula y renglones; se avisa al docente para el perfil C", async () => {
    expect(await p8(geographyAnalysis)).toEqual(["act_1/act_3"]);
  });

  it("argumentación: la extensión que fija el enunciado no se marca; solo la actividad que se amplía más que las demás", async () => {
    expect(await p8(argumentationAnalysis)).toEqual(["act_1/act_2", "act_2/act_3", "act_2/act_4", "act_2/act_5"]);
  });
});
