/**
 * Pilot of the V2.2 agent (ADR-045): ONE material, ONE profile, at most TWO paid calls, each counted and reserved before it is made.
 *   1. material_analyzer (single call: no repair, no regeneration; prompted delivery, fixed) → MaterialAnalysis v3
 *   2. adaptation_planner@v3 with the verified private rules (single call; native structured output, fixed) → plan v1 + declarations
 *
 *   pnpm eval:adaptation:pilot -- --material <pdf> --rules-dir <copia privada>                  sin red: cota por caracteres
 *   pnpm eval:adaptation:pilot -- --material <pdf> --rules-dir <copia privada> --count-tokens   recuento gratuito, sin llamadas de pago
 *   pnpm eval:adaptation:pilot -- --material <pdf> --rules-dir <copia privada> --yes            las dos llamadas de pago
 *
 * Guarantees (pilot-lib.ts, metered-client.ts):
 *  - the client is created with `maxRetries: 0` and every HTTP request is recorded: one request is one entry;
 *  - structured-output fallback is OFF and each output's mode is fixed: a rejected schema stops the run instead of a second request;
 *  - before each paid call its exact input is counted (free endpoint) and its ceiling reserved: counted × 1.10 + 1.000 tokens, all
 *    priced as cache writes, plus the full `max_tokens`; reservations must fit in 80 % of --budget-usd;
 *  - a complete answer settles with its real usage; an error, a missing usage or a cost above the reservation keeps the reservation
 *    whole and stops. A failed count, a missing price or any other uncertainty stops before paying.
 * Both --count-tokens and --yes send the material and the rules to the provider: they need the owner's authorisation. Results go to the
 * git-ignored `evals/adaptation/private/pilot-v22/`; the terminal shows hashes, sizes and metrics only.
 */
import Anthropic from "@anthropic-ai/sdk";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { directoryRulesSource } from "@/lib/agent-rules/local-source";
import { loadAgentRules } from "@/lib/agent-rules/loader";
import { AGENT_RULES_V22 } from "@/lib/agent-rules/manifest-v22";
import { fullRulesBlock } from "@/lib/agent-rules/prompt-block";
import { schemaInstructions } from "@/lib/ai/providers/anthropic";
import { resolveModel, type ModelEnv } from "@/lib/ai/registry";
import { effectiveLimits } from "@/lib/materials/config";
import { validateFileContent } from "@/lib/materials/file-validation";
import { inspectPdf } from "@/lib/materials/pdf";
import { redactSecrets } from "@/lib/security/redact";
import { ADAPTATION_PLANNER_V3 } from "@prompts/adaptation-planner/v3";
import { resolveAnalyzer, resolveSelection } from "../material-analysis/harness";
import { PilotBudget, pilotBound } from "./pilot-lib";
import { runPilotCalls } from "./pilot-run";
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
  const budget = new PilotBudget(Number(arg("--budget-usd") ?? "1.00"));
  const usdPerEur = Number(arg("--usd-per-eur") ?? "1.12");
  const analysisMax = Number(arg("--analysis-max-output") ?? "16000");
  const plannerMax = Number(arg("--planner-max-output") ?? "32000");
  const pay = process.argv.includes("--yes");
  const count = pay || process.argv.includes("--count-tokens");
  const env = process.env as ModelEnv & { ANTHROPIC_API_KEY?: string; AI_ANALYSIS_ALIAS?: string; AI_ANALYSIS_EFFORT?: string; AI_ANALYSIS_PROMPT_VERSION?: string };

  const file = path.resolve(material);
  if (!privateLocation(file)) throw new Error("El material está en una ruta que Git puede versionar. Muévelo fuera del repositorio o a una carpeta privada ignorada.");
  const bytes = new Uint8Array(readFileSync(file));
  const content = validateFileContent(bytes, "pdf", effectiveLimits({ max_file_mb: 20, max_pages_per_material: 30 }));
  if (!content.ok) throw new Error(`El material no es un PDF válido (${content.code}).`);
  const inspection = await inspectPdf(bytes);
  if (!inspection.ok) throw new Error("PDF ilegible o cifrado.");
  const label = `material-${createHash("sha256").update(bytes).digest("hex").slice(0, 12)}`;

  const rules = await loadAgentRules(await directoryRulesSource(rulesDir), AGENT_RULES_V22);
  const analyzer = resolveAnalyzer(null, env);
  const analysisSelection = resolveSelection({ mock: false, model: null, effort: null }, env);
  const plannerSelection = resolveModel("STANDARD", env);
  const allRules = await fullRulesBlock(rules);
  const promptChars = ADAPTATION_PLANNER_V3.system.length + schemaInstructions(ADAPTATION_PLANNER_V3.output.schema).length;
  const bound = pilotBound({ analysisSelection, plannerSelection, pages: inspection.pages, analysisMaxOutputTokens: analysisMax, plannerMaxOutputTokens: plannerMax, plannerPromptChars: promptChars, rulesAllChars: allRules.length });

  console.log("Piloto V2.2 · comprobación previa (sin red)");
  console.log(`  material: ${label} · ${inspection.pages} páginas · perfil ${profileKey} · reglas ${rules.version} (${rules.package_sha256.slice(0, 12)}…, verificadas)`);
  console.log(`  análisis ${analyzer.key}@v${analyzer.version} · ${analysisSelection.model} (${analysisSelection.effort}) · salida ≤ ${analysisMax} → ≤ ${usd(bound.analysis.usd)} (estimado)`);
  console.log(`  planificador v3 · ${plannerSelection.model} (${plannerSelection.effort}) · salida ≤ ${plannerMax} → ≤ ${usd(bound.planner.usd)} (estimado)`);
  console.log(`  total estimado ≤ ${usd(bound.totalUsd)} ≈ ${(bound.totalUsd / usdPerEur).toFixed(2)} € · límite seguro ${usd(budget.cap)} (80 % de ${usd(budget.budgetUsd)})`);
  if (bound.totalUsd > budget.cap) {
    console.log("\nNO se continúa: la estimación previa ya supera el límite seguro.");
    process.exitCode = 2;
    return;
  }
  if (!count) {
    console.log("\nSin red. --count-tokens mide la entrada exacta (gratis; envía el material y las reglas). --yes hace las llamadas de pago.");
    return;
  }
  if (!env.ANTHROPIC_API_KEY) throw new Error("Falta ANTHROPIC_API_KEY.");

  // One request is one entry: the SDK client never retries by itself.
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 0 });
  const startedAt = new Date().toISOString();
  const { out, calls } = await runPilotCalls({ client, budget, analyzer, analysisSelection, plannerSelection, pdf: bytes, pages: inspection.pages, profile: profileKey, rules, allRules, analysisMax, plannerMax, pay, log: (line) => console.log(line) });
  const record = { version: 2, kind: "pilot-v22", startedAt, label, profile: profileKey, estimate: bound, budgetUsd: budget.budgetUsd, safeCapUsd: budget.cap, ...out, calls, ledger: budget.events, committedUsd: budget.committedUsd, stopReason: budget.stopReason };
  mkdirSync(OUT_DIR, { recursive: true });
  const target = path.join(OUT_DIR, `${startedAt.replace(/[:.]/g, "-")}-${label}-${profileKey}.json`);
  writeFileSync(target, JSON.stringify(record, null, 2));
  const paid = calls.filter((c) => c.kind === "message").length;
  console.log(`\nPeticiones: ${calls.length - paid} recuentos (gratis) · ${paid} de pago · comprometido ${usd(budget.committedUsd)} de ${usd(budget.cap)}${budget.stopReason ? ` · detenido: ${budget.stopReason}` : ""}`);
  console.log(`Resultado privado: ${path.relative(process.cwd(), target)}`);
}

void main().catch((error) => {
  console.error(redactSecrets(error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
});
