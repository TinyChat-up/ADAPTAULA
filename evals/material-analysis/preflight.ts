/**
 * Free preflight of the analysis setup (the Models API costs nothing): is the key present, do the configured models
 * exist, and can they take what the analyzer sends (PDF, images, structured output)? Never prints a secret.
 *
 *   pnpm eval:analysis:preflight
 */
import Anthropic from "@anthropic-ai/sdk";
import { ANALYSIS_DEFAULTS, ANALYSIS_RETRY } from "@/lib/ai/config";
import { resolveModel, type ModelEnv } from "@/lib/ai/registry";
import { TEXT_MODEL_ALIASES } from "@/lib/ai/types";
import { HARD_LIMITS } from "@/lib/materials/config";

const env = process.env as ModelEnv & { ANTHROPIC_API_KEY?: string; AI_ANALYSIS_ALIAS?: string; AI_ANALYSIS_EFFORT?: string; AI_ANALYSIS_MAX_OUTPUT_TOKENS?: string };

const yes = (value: boolean | undefined) => (value === undefined ? "desconocido" : value ? "sí" : "NO");

async function main() {
  const key = env.ANTHROPIC_API_KEY;
  console.log(`ANTHROPIC_API_KEY: ${key ? `definida (${key.length} caracteres)` : "NO definida"}`);
  const analysisAlias = (env.AI_ANALYSIS_ALIAS ?? ANALYSIS_DEFAULTS.alias) as (typeof TEXT_MODEL_ALIASES)[number];
  console.log(`Alias del análisis: ${analysisAlias} · esfuerzo: ${env.AI_ANALYSIS_EFFORT ?? ANALYSIS_DEFAULTS.effort}\n`);
  if (!key) process.exit(2);

  const client = new Anthropic({ apiKey: key, maxRetries: 1 });
  const configuredMax = Number(env.AI_ANALYSIS_MAX_OUTPUT_TOKENS ?? ANALYSIS_DEFAULTS.maxOutputTokens);
  let problems = 0;

  for (const alias of TEXT_MODEL_ALIASES) {
    const selection = resolveModel(alias, env);
    const label = `${alias}${alias === analysisAlias ? " (análisis)" : ""} → ${selection.provider}:${selection.model}`;
    if (selection.provider !== "anthropic") {
      console.log(`${label}\n  no verificable aquí (proveedor sin integración)\n`);
      continue;
    }
    try {
      const info = await client.models.retrieve(selection.model);
      const caps = info.capabilities;
      console.log(label);
      console.log(`  existe: sí · id resuelto: ${info.id} · nombre: ${info.display_name}`);
      console.log(`  PDF: ${yes(caps?.pdf_input.supported)} · imágenes: ${yes(caps?.image_input.supported)} · salida estructurada: ${yes(caps?.structured_outputs.supported)} · effort: ${yes(caps?.effort.supported)}`);
      console.log(`  contexto máx.: ${info.max_input_tokens ?? "?"} tokens · salida máx. (max_tokens): ${info.max_tokens ?? "?"}`);
      if (alias === analysisAlias) {
        const checks: Array<[string, boolean]> = [
          ["acepta PDF", caps?.pdf_input.supported === true],
          ["acepta imágenes", caps?.image_input.supported === true],
          ["salida estructurada", caps?.structured_outputs.supported === true],
          [`AI_ANALYSIS_MAX_OUTPUT_TOKENS (${configuredMax}) ≤ salida máx.`, info.max_tokens === null || configuredMax <= info.max_tokens],
          [`techo de regeneración (${ANALYSIS_RETRY.truncation.outputTokenCeiling}) ≤ salida máx.`, info.max_tokens === null || ANALYSIS_RETRY.truncation.outputTokenCeiling <= info.max_tokens],
        ];
        for (const [name, ok] of checks) {
          console.log(`  ${ok ? "✓" : "✗"} ${name}`);
          if (!ok) problems += 1;
        }
      }
      console.log("");
    } catch (error) {
      problems += 1;
      const status = error instanceof Anthropic.APIError ? error.status : undefined;
      console.log(`${label}\n  ✗ no se puede usar: ${status === 404 ? "el modelo no existe (404)" : status === 401 || status === 403 ? "credenciales rechazadas" : "error de conexión o de servicio"}\n`);
    }
  }

  const mib = 1024 * 1024;
  console.log("Límites de entrada del analizador (duros, independientes del plan):");
  console.log(`  PDF ≤ ${HARD_LIMITS.maxPdfBytes / mib} MiB (≈ ${Math.round(((HARD_LIMITS.maxPdfBytes * 4) / 3) / 1e6)} MB en base64; el proveedor admite 32 MB por petición) y ≤ ${HARD_LIMITS.maxPdfPages} páginas`);
  console.log(`  imagen ≤ ${HARD_LIMITS.maxImageBytes / mib} MiB (límite del proveedor por imagen: 5 MB)`);
  process.exit(problems === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message.replace(/sk-[A-Za-z0-9_-]{10,}/g, "sk-…") : "error desconocido");
  process.exit(2);
});
