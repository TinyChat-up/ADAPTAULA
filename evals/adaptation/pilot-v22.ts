/**
 * Pilot of the V2.2 agent (ADR-045): ONE material, ONE profile, exactly two real calls when authorised:
 *   1. material_analyzer (single call, hard output cap) → MaterialAnalysis v3
 *   2. adaptation_planner@v3 with the verified private rules (single call, hard output cap) → plan v1 + declarations + ledger
 * Without --yes it makes NO call: it validates the inputs and prints the cost ceiling computed in advance (`pilot-lib.ts`). With
 * --yes it refuses to start when that ceiling exceeds --budget-usd, and refuses the planner call when the money already spent plus
 * the planner's recomputed ceiling would exceed it.
 *
 *   pnpm eval:adaptation:pilot -- --material <pdf> --rules-dir <copia privada>                 cotas, sin llamadas
 *   pnpm eval:adaptation:pilot -- --material <pdf> --rules-dir <copia privada> --yes           las dos llamadas
 *
 * The material and the rules are private. The material must be outside any Git checkout or in a git-ignored private folder; the
 * results go to the git-ignored `evals/adaptation/private/pilot-v22/`. The terminal shows hashes, sizes and metrics only.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { validatePlan } from "@/lib/adaptation/invariants";
import { normalizePlanV3 } from "@/lib/adaptation/plan-v3";
import { callPlanner, parsePlanResponse, plannerRequestParts, rulesUse } from "@/lib/adaptation/planner";
import { auditAdaptation } from "@/lib/adaptation/v22/audit";
import { directoryRulesSource } from "@/lib/agent-rules/local-source";
import { loadAgentRules } from "@/lib/agent-rules/loader";
import { AGENT_RULES_V22 } from "@/lib/agent-rules/manifest-v22";
import { buildRulesBlock, fullRulesBlockLength } from "@/lib/agent-rules/prompt-block";
import { toAIError } from "@/lib/ai/errors";
import { schemaInstructions } from "@/lib/ai/providers/anthropic";
import { resolveModel, type ModelEnv } from "@/lib/ai/registry";
import { createProvider } from "@/lib/ai/router";
import { effectiveLimits } from "@/lib/materials/config";
import { validateFileContent } from "@/lib/materials/file-validation";
import { inspectPdf } from "@/lib/materials/pdf";
import { redactSecrets } from "@/lib/security/redact";
import { ADAPTATION_PLANNER_V3 } from "@prompts/adaptation-planner/v3";
import { analyzeCase, resolveSelection } from "../material-analysis/harness";
import { buildExperimentContext } from "./planner-lib";
import { pilotBound, plannerBoundAfterAnalysis } from "./pilot-lib";
import { V22_PROFILES } from "./v22-profiles";

const OUT_DIR = path.resolve(import.meta.dirname, "private/pilot-v22");
const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
};
const usd = (n: number) => `$${n.toFixed(4)}`;

/** A private file may live outside any checkout, or inside one only where Git ignores it. */
function privateLocation(file: string): boolean {
  let root: string;
  try {
    root = execFileSync("git", ["-C", path.dirname(file), "rev-parse", "--show-toplevel"], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return true;
  }
  try {
    execFileSync("git", ["-C", root, "check-ignore", "-q", path.relative(root, file)], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const material = arg("--material");
  const rulesDir = arg("--rules-dir");
  if (!material || !rulesDir) throw new Error("Faltan --material <pdf> y --rules-dir <copia privada de las reglas>.");
  const profileKey = (arg("--profile") ?? "A") as keyof typeof V22_PROFILES;
  if (!(profileKey in V22_PROFILES)) throw new Error("--profile debe ser A, B o C.");
  const budgetUsd = Number(arg("--budget-usd") ?? "1.00");
  const usdPerEur = Number(arg("--usd-per-eur") ?? "1.12");
  const analysisMax = Number(arg("--analysis-max-output") ?? "16000");
  const plannerMax = Number(arg("--planner-max-output") ?? "32000");
  const go = process.argv.includes("--yes");
  const env = process.env as ModelEnv & { ANTHROPIC_API_KEY?: string; AI_ANALYSIS_ALIAS?: string; AI_ANALYSIS_EFFORT?: string };

  const file = path.resolve(material);
  if (!privateLocation(file)) throw new Error("El material está en una ruta que Git puede versionar. Muévelo fuera del repositorio o a una carpeta privada ignorada.");
  const bytes = new Uint8Array(readFileSync(file));
  const content = validateFileContent(bytes, "pdf", effectiveLimits({ max_file_mb: 20, max_pages_per_material: 30 }));
  if (!content.ok) throw new Error(`El material no es un PDF válido (${content.code}).`);
  const inspection = await inspectPdf(bytes);
  if (!inspection.ok) throw new Error("PDF ilegible o cifrado.");
  const label = `material-${createHash("sha256").update(bytes).digest("hex").slice(0, 12)}`;

  const rules = await loadAgentRules(await directoryRulesSource(rulesDir), AGENT_RULES_V22);
  const analysisSelection = resolveSelection({ mock: false, model: null, effort: null }, env);
  const plannerSelection = resolveModel("STANDARD", env);
  const promptChars = ADAPTATION_PLANNER_V3.system.length + schemaInstructions(ADAPTATION_PLANNER_V3.output.schema).length;
  const bound = pilotBound({ analysisSelection, plannerSelection, pages: inspection.pages, analysisMaxOutputTokens: analysisMax, plannerMaxOutputTokens: plannerMax, plannerPromptChars: promptChars, rulesAllChars: await fullRulesBlockLength(rules) });

  console.log("Piloto V2.2 · cotas calculadas antes de cualquier llamada");
  console.log(`  material: ${label} · ${inspection.pages} páginas · perfil ${profileKey} · reglas ${rules.version} (${rules.package_sha256.slice(0, 12)}…, verificadas)`);
  console.log(`  1. análisis: ${analysisSelection.provider}:${analysisSelection.model} (${analysisSelection.effort}) · entrada ≤ ${bound.analysis.inputTokens} · salida ≤ ${analysisMax} → ≤ ${usd(bound.analysis.usd)}`);
  console.log(`  2. planificador v3: ${plannerSelection.provider}:${plannerSelection.model} (${plannerSelection.effort}) · entrada ≤ ${bound.planner.inputTokens} · salida ≤ ${plannerMax} → ≤ ${usd(bound.planner.usd)}`);
  console.log(`  total ≤ ${usd(bound.totalUsd)} ≈ ${(bound.totalUsd / usdPerEur).toFixed(2)} € (a ${usdPerEur} USD/EUR; revisa el tipo de cambio) · presupuesto ${usd(budgetUsd)}`);
  if (bound.totalUsd > budgetUsd) {
    console.log("\nNO se ejecuta: la cota supera el presupuesto.");
    process.exitCode = 2;
    return;
  }
  if (!go) {
    console.log("\nSin llamadas. Añade --yes para ejecutar las dos llamadas reales (análisis y planificador).");
    return;
  }
  if (!env.ANTHROPIC_API_KEY) throw new Error("Falta ANTHROPIC_API_KEY.");

  const out: Record<string, unknown> = { version: 1, kind: "pilot-v22", startedAt: new Date().toISOString(), label, profile: profileKey, bound, budgetUsd };
  let spent = 0;
  const analysisProvider = createProvider(analysisSelection, { anthropicApiKey: env.ANTHROPIC_API_KEY, isProduction: false });
  const analyzed = await analyzeCase({ id: label, title: label, stage: null, file: { kind: "pdf", data: bytes }, pageCount: inspection.pages, selection: analysisSelection, provider: analysisProvider, maxOutputTokens: analysisMax, singleCall: true });
  spent += analyzed.report.costUsd ?? bound.analysis.usd;
  out.analysis = { report: analyzed.report, analysis: analyzed.analysis };
  console.log(`\n1. análisis: ${analyzed.analysis ? "válido" : "SIN análisis utilizable"} · coste ${usd(analyzed.report.costUsd ?? Number.NaN)}`);

  if (analyzed.analysis) {
    const analysis = analyzed.analysis;
    const context = buildExperimentContext(analysis, "accessibility", 2, V22_PROFILES[profileKey]);
    const block = await buildRulesBlock(rules, analysis, context);
    const { parts } = plannerRequestParts({ analysis, context, version: 3, rules: block });
    const userText = parts.slice(1).map((p) => (p.type === "text" ? p.text : "")).join("");
    const plannerCeiling = plannerBoundAfterAnalysis(plannerSelection, { prompt: promptChars, rules: block.text.length, userText: userText.length }, plannerMax);
    out.context = context;
    out.rules = rulesUse(block);
    console.log(`2. planificador: ${block.selection.included.length}/${rules.precedents.length} precedentes · cota ${usd(plannerCeiling)} · gastado ${usd(spent)}`);
    if (spent + plannerCeiling > budgetUsd) {
      console.log("   NO se llama al planificador: se superaría el presupuesto.");
    } else {
      try {
        const plannerProvider = createProvider(plannerSelection, { anthropicApiKey: env.ANTHROPIC_API_KEY, isProduction: false });
        const { response, run } = await callPlanner({ analysis, context, selection: plannerSelection, provider: plannerProvider, maxOutputTokens: plannerMax, version: 3, rules: block });
        spent += run.estimatedCostUsd ?? plannerCeiling;
        const parsed = parsePlanResponse(response, 3);
        out.planner = { run, stopReason: response.stopReason, parse: parsed.outcome, issues: parsed.outcome === "ok" ? [] : parsed.issues, responseText: response.text };
        if (parsed.outcome === "ok") {
          const { plan, declarations } = normalizePlanV3(parsed.draft, analysis, context, rulesUse(block));
          const validation = validatePlan(plan, analysis, context);
          const audit = auditAdaptation({ plan, validation, context, analysis, declarations, profile: V22_PROFILES[profileKey] });
          Object.assign(out, { plan, declarations, validation, ledger: audit.ledger, findings: audit.findings, not_checked: audit.not_checked });
          const withheld = Object.values(declarations.decisions).filter((d) => d.withheld).length;
          console.log(`   ${plan.decisions.length} decisiones (${withheld} retenidas para el docente) · ${declarations.teacher_questions.length} preguntas · ${declarations.residual_barriers.length} barreras declaradas · bloqueadas ${validation.issues.filter((i) => i.severity === "block").length}`);
        } else console.log(`   respuesta no utilizable: ${parsed.outcome}`);
        console.log(`   coste ${usd(run.estimatedCostUsd ?? Number.NaN)} · tokens entrada ${run.inputTokens} · salida ${run.outputTokens}`);
      } catch (error) {
        const failure = toAIError(error);
        out.planner = { error: { code: failure.code, message: redactSecrets(failure.message) } };
        console.log(`   error del proveedor: ${failure.code}`);
      }
    }
  }
  out.spentUsd = spent;
  mkdirSync(OUT_DIR, { recursive: true });
  const target = path.join(OUT_DIR, `${String(out.startedAt).replace(/[:.]/g, "-")}-${label}-${profileKey}.json`);
  writeFileSync(target, JSON.stringify(out, null, 2));
  console.log(`\nGastado: ${usd(spent)} de ${usd(budgetUsd)}. Resultado privado: ${path.relative(process.cwd(), target)}`);
}

void main().catch((error) => {
  console.error(redactSecrets(error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
});
