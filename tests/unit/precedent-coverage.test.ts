import { describe, expect, it, vi } from "vitest";
import { buildAdaptationContext } from "@/lib/adaptation/context";
import { needRefTable } from "@/lib/adaptation/plan-v2";
import { normalizePlanV3 } from "@/lib/adaptation/plan-v3";
import { DIMENSION_STRATEGIES, STRATEGIES } from "@/lib/adaptation/strategies";
import { GENERAL_RESOURCES, RESOURCES_BY_STRATEGY, possibleResources, selectPrecedents } from "@/lib/agent-rules/precedents";
import { STRATEGY_KEYS, type StrategyKey } from "@/lib/schemas/adaptation-plan";
import type { FunctionalProfile } from "@/lib/schemas/functional-profile";
import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";
import { argumentationAnalysis, fractionsAnalysis, geographyAnalysis } from "../../evals/adaptation/fixtures";
import { PROFILES } from "../../evals/adaptation/scenarios";
import { V22_PROFILES } from "../../evals/adaptation/v22-profiles";

vi.mock("server-only", () => ({}));

/**
 * The precedent selection drops cases only when the plan cannot use their resources (ADR-045). These tests prove it, without the
 * private rules: a v3 decision that is applied without the teacher can only realise resources of the selection, and one that would
 * realise anything else is withheld. The last block repeats the proof on the real index where a private copy exists.
 */
const SHEETS: Array<[string, () => MaterialAnalysis]> = [["fracciones", fractionsAnalysis], ["geografía", geographyAnalysis], ["argumentación", argumentationAnalysis]];
const ALL_PROFILES: Array<[string, FunctionalProfile]> = [...Object.entries(V22_PROFILES), ...Object.entries(PROFILES)];

const contextOf = (analysis: MaterialAnalysis, profile: FunctionalProfile) => buildAdaptationContext({ profile, education: { stage: null, grade: null, subject: null }, analysis, adaptationType: "accessibility" }).context;

/** A minimal v3 decision on the first activity, with the action the strategy can carry out. */
const decisionWith = (strategy: StrategyKey, needRef: string) => {
  const action = STRATEGIES[strategy].actions.find((a) => a === "add_support" || a === "segment" || a === "reorganize" || a === "change_response_format" || a === "rephrase") ?? STRATEGIES[strategy].actions[0]!;
  return { target: "document", action, strategies: [strategy], need_refs: [needRef], intensity: "light", status: "active", hint_yes: [] };
};

describe("cobertura de la selección de precedentes, por construcción", () => {
  it.each(SHEETS)("%s: lo que una decisión aplicable puede realizar está siempre en la selección", (_, sheet) => {
    for (const [who, profile] of ALL_PROFILES) {
      const analysis = sheet();
      const context = contextOf(analysis, profile);
      const enabled = possibleResources(analysis, context);
      for (const { ref, dimension } of needRefTable(context)) {
        for (const strategy of STRATEGY_KEYS) {
          const { declarations } = normalizePlanV3({ decisions: [decisionWith(strategy, ref)], summary: [] }, analysis, context, null);
          const withheld = declarations.decisions.dec_1!.withheld;
          const served = DIMENSION_STRATEGIES[dimension].includes(strategy);
          // A strategy that serves the cited need is applicable; one that does not is withheld for the teacher.
          expect(withheld, `${who} ${dimension} ${strategy}`).toBe(!served);
          if (!withheld) {
            const reachable = RESOURCES_BY_STRATEGY[strategy].filter((r) => r !== "imagenes" || analysis.visuals.length > 0);
            for (const r of reachable) expect(enabled.has(r), `${who} ${dimension} ${strategy} → ${r}`).toBe(true);
          }
        }
      }
    }
  });

  it("sin necesidades no hay recursos individuales: solo los generales y los casos de control", () => {
    expect(possibleResources(fractionsAnalysis(), contextOf(fractionsAnalysis(), V22_PROFILES.C))).toEqual(new Set(["perfil_C"]));
  });

  it("la tabla de recursos cubre todas las estrategias del catálogo y no mezcla recursos generales", () => {
    expect(Object.keys(RESOURCES_BY_STRATEGY).sort()).toEqual([...STRATEGY_KEYS].sort());
    for (const list of Object.values(RESOURCES_BY_STRATEGY)) for (const r of list) expect(GENERAL_RESOURCES.has(r)).toBe(false);
  });
});

const PRIVATE_DIR = process.env.AGENT_RULES_PRIVATE_DIR;
describe.skipIf(!PRIVATE_DIR)("cobertura con el índice real (solo con copia privada local)", () => {
  it("ningún caso excluido toca un recurso utilizable y todos los E/R de recursos utilizables van siempre", async () => {
    const { directoryRulesSource } = await import("@/lib/agent-rules/local-source");
    const { loadAgentRules } = await import("@/lib/agent-rules/loader");
    const { AGENT_RULES_V22 } = await import("@/lib/agent-rules/manifest-v22");
    const rules = await loadAgentRules(await directoryRulesSource(PRIVATE_DIR!), AGENT_RULES_V22);
    // Every specific resource of the library is reachable by some strategy: no case is dropped for every profile.
    const reachable = new Set([...Object.values(RESOURCES_BY_STRATEGY).flat(), "perfil_C"]);
    for (const c of rules.precedents) for (const r of c.recursos) expect(GENERAL_RESOURCES.has(r) || reachable.has(r), `${c.id} ${r}`).toBe(true);

    for (const [, sheet] of SHEETS) {
      for (const [who, profile] of ALL_PROFILES) {
        const analysis = sheet();
        const context = contextOf(analysis, profile);
        const enabled = possibleResources(analysis, context);
        const selection = selectPrecedents(rules.precedents, analysis, context);
        const included = new Set(selection.included.map((c) => c.id));
        for (const c of rules.precedents) {
          const usable = c.recursos.filter((r) => r !== "perfil_C" && (GENERAL_RESOURCES.has(r) || enabled.has(r)));
          const mandatory = c.tipo === "error_corregido" || c.tipo === "alternativa_rechazada";
          if (c.recursos.includes("perfil_C")) expect(included.has(c.id), `${who} ${c.id}`).toBe(context.needs.length === 0);
          else if (mandatory && usable.length > 0) expect(included.has(c.id), `${who} ${c.id} obligatorio`).toBe(true);
          else if (!included.has(c.id)) expect(c.recursos.some((r) => enabled.has(r)), `${who} ${c.id} excluido con recurso utilizable`).toBe(false);
        }
      }
    }
  });
});
