/**
 * Generated illustrations with the REAL models (spends API money): case B («La célula animal», 1.º ESO) through the production
 * pipeline (`illustrate`): image_brief@v1 (alias STANDARD) → image model (alias IMAGE_QUALITY, prompt image_render@v1) →
 * image_review@v1 (alias STANDARD, vision) → accepted only by the deterministic gates.
 *
 *   pnpm eval:illustrations -- --yes                 one illustration of the cell, at most 2 image attempts, budget 0.50 USD
 *   pnpm eval:illustrations -- --budget 0.30 --yes
 *   pnpm eval:illustrations:mock                     the same harness with the local mock drawing and a scripted brief/review (free)
 *
 * ONE authorised real run: after it, a marker (evals/results/illustrations/REAL_RUN_DONE.json) refuses another unless `--again`.
 * The production spending ceiling (`ILLUSTRATION_BUDGET`) is applied with `--budget` as the limit, so no call starts that would
 * not fit.
 *
 * Writes evals/results/illustrations/<stamp>/ (illustration.png, brief.json, review.json, runs.json, summary.json, report.html) for a person
 * to LOOK at the picture: the automated review is evidence, not the final word. Never part of `pnpm check`. The case is
 * synthetic (no learner, no private material); storage and quota live in memory (no database is touched).
 * Needs ANTHROPIC_API_KEY and OPENAI_API_KEY in the environment (.env.local); their values are never printed.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { IMAGE_BRIEF_V1 } from "@prompts/image-brief/v1";
import { IMAGE_REVIEW_V1 } from "@prompts/image-review/v1";
import { IMAGE_RENDER_V1 } from "@prompts/image-render/v1";
import { estimateImageCostUsd } from "@/lib/ai/costs";
import { toAIError } from "@/lib/ai/errors";
import { MockImageProvider } from "@/lib/ai/providers/mock-images";
import { resolveModel, type ModelEnv } from "@/lib/ai/registry";
import { createImageProvider, createProvider } from "@/lib/ai/router";
import type { AIRunRecord, ImageProvider, ModelSelection } from "@/lib/ai/types";
import { callStructured } from "@/lib/materials/visuals/auto/assistants";
import { ILLUSTRATION_BUDGET, IllustrationDeferred, illustrate, type IllustrationDeps, type IllustrationOutcome, type IllustrationRequest } from "@/lib/materials/visuals/illustrate/service";
import { CELL_BRIEF, CELL_REVIEW_APPROVED, cellCaseAnalysis } from "../../tests/support/cell-case";

interface Args {
  yes: boolean;
  again: boolean;
  mock: boolean;
  budgetUsd: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { yes: false, again: false, mock: false, budgetUsd: 0.5 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--yes") args.yes = true;
    else if (a === "--again") args.again = true;
    else if (a === "--mock") args.mock = true;
    else if (a === "--budget") args.budgetUsd = Number(argv[++i]);
  }
  if (!Number.isFinite(args.budgetUsd) || args.budgetUsd <= 0) throw new Error("--budget debe ser un número positivo (USD).");
  return args;
}

/** Worst case before anything is spent: one brief, two images at medium quality, two reviews (the production ceilings). */
const WORST_CASE_USD = 3 * ILLUSTRATION_BUDGET.textUsd + 2 * ILLUSTRATION_BUDGET.imageUsd;
const MARKER = path.join(process.cwd(), "evals", "results", "illustrations", "REAL_RUN_DONE.json");

const usd = (n: number) => `${n.toFixed(4)} USD`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const analysis = cellCaseAnalysis();
  const activity = analysis.activities.find((a) => a.id === "act_1")!;
  const visual = analysis.visuals.find((v) => v.id === "vis_1")!;
  const request: IllustrationRequest = {
    workspaceId: "eval",
    adaptationId: "eval",
    needKey: "vis_1",
    stage: "eso",
    grade: "1-eso",
    subject: "biologia-geologia",
    activity: activity.instruction,
    objective: analysis.pedagogical_intent.objectives.find((o) => activity.objective_ids.includes(o.id))?.text ?? null,
    missing: visual.description,
    purpose: "Sustituye a una imagen del original que no está disponible",
    supports: ["Apoyo a la memoria de trabajo", "Menos distracciones visuales"],
    expectedAnswer: activity.expected_answer.value,
    signatures: [],
    lowDetail: true,
  };

  if (!args.mock) {
    if (!process.env.ANTHROPIC_API_KEY || !process.env.OPENAI_API_KEY) {
      console.error("Faltan credenciales: ANTHROPIC_API_KEY (brief y revisión) y OPENAI_API_KEY (imagen). No se ha llamado a ningún modelo.");
      process.exitCode = 2;
      return;
    }
    if (existsSync(MARKER) && !args.again) {
      console.error(`Ya se hizo la ejecución real autorizada (${readFileSync(MARKER, "utf8").trim()}). Para otra, repite con --again.`);
      process.exitCode = 2;
      return;
    }
    if (WORST_CASE_USD > args.budgetUsd) {
      console.error(`El peor caso (${usd(WORST_CASE_USD)}) supera el presupuesto (${usd(args.budgetUsd)}). Sube --budget.`);
      process.exitCode = 2;
      return;
    }
    if (!args.yes) {
      console.log(`Esto llama a modelos reales: como mucho ${usd(WORST_CASE_USD)} (presupuesto ${usd(args.budgetUsd)}). Repite con --yes.`);
      return;
    }
  }

  const env = process.env as ModelEnv;
  const textSelection: ModelSelection = args.mock ? resolveModel("STANDARD", { AI_MODEL_STANDARD: "mock:default" }) : resolveModel("STANDARD", env);
  const imageSelection: ModelSelection = args.mock ? resolveModel("IMAGE_QUALITY", { AI_MODEL_IMAGE_QUALITY: "mock:dibujo" }) : resolveModel("IMAGE_QUALITY", env);
  const textProvider = args.mock ? null : createProvider(textSelection, { anthropicApiKey: process.env.ANTHROPIC_API_KEY });
  const imageProvider: ImageProvider = args.mock ? new MockImageProvider() : createImageProvider(imageSelection, { openaiApiKey: process.env.OPENAI_API_KEY });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = path.join(process.cwd(), "evals", "results", "illustrations", `${stamp}${args.mock ? "-mock" : ""}`);
  mkdirSync(outDir, { recursive: true });
  const runs: AIRunRecord[] = [];
  let spent = 0;
  const reviews: unknown[] = [];

  const deps: IllustrationDeps = {
    brief: async (input) => {
      if (!textProvider) return { draft: structuredClone(CELL_BRIEF), run: { purpose: "image_brief", attempt: 1, alias: "STANDARD", provider: "mock", model: "mock", effort: "low", promptKey: IMAGE_BRIEF_V1.key, promptVersion: IMAGE_BRIEF_V1.version, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, cacheCreationInputTokens: 0, estimatedCostUsd: 0, latencyMs: 0, status: "success", errorCode: null } };
      return callStructured(textProvider, textSelection, "image_brief", IMAGE_BRIEF_V1, IMAGE_BRIEF_V1.buildUserText(input), 1500, AbortSignal.timeout(input.timeoutMs));
    },
    image: async ({ prompt, size, timeoutMs }) => {
      const base = { purpose: "image" as const, attempt: 1, alias: imageSelection.alias, provider: imageSelection.provider, model: imageSelection.model, effort: imageSelection.effort, promptKey: IMAGE_RENDER_V1.key, promptVersion: IMAGE_RENDER_V1.version };
      try {
        const r = await imageProvider.generateImage({ selection: imageSelection, prompt, size, quality: "medium", timeoutMs });
        return { image: r.image, run: { ...base, inputTokens: r.usage.textInputTokens + r.usage.imageInputTokens, outputTokens: r.usage.outputTokens, cachedInputTokens: 0, cacheCreationInputTokens: 0, estimatedCostUsd: estimateImageCostUsd(r.provider, r.model, r.usage), latencyMs: r.latencyMs, status: "success", errorCode: null } };
      } catch (error) {
        const code = toAIError(error).code;
        return { image: null, run: { ...base, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, cacheCreationInputTokens: 0, estimatedCostUsd: null, latencyMs: 0, status: code === "refusal" ? "refused" : "error", errorCode: code } };
      }
    },
    review: async ({ png, stage, activity: text, brief, timeoutMs }) => {
      writeFileSync(path.join(outDir, `attempt-${reviews.length + 1}.png`), png);
      const result = textProvider
        ? await callStructured(textProvider, textSelection, "image_review", IMAGE_REVIEW_V1, [{ type: "image", mediaType: "image/png", data: png }, { type: "text", text: IMAGE_REVIEW_V1.buildUserText({ stage, activity: text, brief }) }], 1500, AbortSignal.timeout(timeoutMs))
        : { draft: structuredClone(CELL_REVIEW_APPROVED), run: { purpose: "image_review" as const, attempt: 1, alias: "STANDARD" as const, provider: "mock" as const, model: "mock", effort: "low" as const, promptKey: IMAGE_REVIEW_V1.key, promptVersion: IMAGE_REVIEW_V1.version, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, cacheCreationInputTokens: 0, estimatedCostUsd: 0, latencyMs: 0, status: "success" as const, errorCode: null } };
      reviews.push(result.draft);
      return result;
    },
    store: {
      find: async () => null,
      put: async ({ brief, prompt, png, sha256, width, height, review }) => {
        writeFileSync(path.join(outDir, "illustration.png"), png);
        writeFileSync(path.join(outDir, "brief.json"), JSON.stringify({ brief, prompt }, null, 2));
        writeFileSync(path.join(outDir, "review.json"), JSON.stringify(review, null, 2));
        return { id: "eval", sha256, width, height, alt: brief.alt_text };
      },
    },
    quota: { reserve: async () => true, refund: async () => undefined },
    recordAiRun: async (run) => {
      runs.push(run);
      spent += run.estimatedCostUsd ?? 0;
    },
    sha256: (bytes) => createHash("sha256").update(bytes).digest("hex"),
    budget: { limitUsd: args.budgetUsd, spentUsd: async () => 0 },
  };

  let outcome: IllustrationOutcome | { ok: false; reason: "deferred"; detail: string[] };
  try {
    outcome = await illustrate(deps, request);
  } catch (error) {
    // Transient provider trouble: in production the stage would be retried later; here it is reported as such.
    if (!(error instanceof IllustrationDeferred)) throw error;
    outcome = { ok: false, reason: "deferred", detail: ["transient provider trouble: try again later"] };
  }
  writeFileSync(path.join(outDir, "runs.json"), JSON.stringify(runs.map(({ issues, ...r }) => ({ ...r, issues: issues?.length ?? 0 })), null, 2));
  writeFileSync(path.join(outDir, "reviews.json"), JSON.stringify(reviews, null, 2));
  const unpriced = runs.filter((r) => r.estimatedCostUsd === null).length;
  const summary = { mode: args.mock ? "mock" : "real", outcome: outcome.ok ? { ok: true, attempts: outcome.attempts } : outcome, calls: runs.map((r) => `${r.purpose}:${r.status}`), costUsd: Number(spent.toFixed(6)), unpricedCalls: unpriced, budgetUsd: args.budgetUsd };
  writeFileSync(path.join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
  writeFileSync(path.join(outDir, "report.html"), reportHtml(outDir, summary, reviews));
  if (!args.mock) writeFileSync(MARKER, JSON.stringify({ at: stamp, costUsd: summary.costUsd, approved: outcome.ok, dir: path.relative(process.cwd(), outDir) }));
  console.log(`${outcome.ok ? "APROBADA" : "NO APROBADA"} · llamadas: ${summary.calls.join(", ")} · coste: ${usd(spent)}${unpriced > 0 ? ` (+${unpriced} sin precio)` : ""}`);
  console.log(`Resultados en ${path.relative(process.cwd(), outDir)} (mira illustration.png antes de dar nada por bueno).`);
  if (!outcome.ok) process.exitCode = 1;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** A page for the person who judges the picture: the image(s), what the automatic review said, the cost, and what to check. */
function reportHtml(dir: string, summary: { mode: string; outcome: unknown; calls: string[]; costUsd: number; unpricedCalls: number; budgetUsd: number }, reviews: unknown[]): string {
  const images = [1, 2].map((n) => path.join(dir, `attempt-${n}.png`)).filter((f) => existsSync(f));
  const imgs = images.map((f, i) => `<figure><img alt="Intento ${i + 1}" src="data:image/png;base64,${readFileSync(f).toString("base64")}"><figcaption>Intento ${i + 1}</figcaption></figure>`).join("");
  const checks = [
    "Es una célula ANIMAL: membrana plasmática, citoplasma y núcleo; sin pared celular, sin cloroplastos, sin vacuola central grande.",
    "Los marcadores 1, 2 y 3 señalan exactamente membrana, citoplasma y núcleo, y no hay ningún nombre escrito.",
    "No hay ningún otro texto, número ni letra; nada revela la respuesta.",
    "Proporciones razonables (el núcleo dentro de la célula y claramente visible); estilo sobrio de 1.º ESO, nada infantil.",
    "Se entiende impresa en blanco y negro a unos 12 cm de ancho.",
  ].map((c) => `<li><label><input type="checkbox"> ${esc(c)}</label></li>`).join("");
  return `<!doctype html><html lang="es"><meta charset="utf-8"><title>Ilustración de prueba · célula animal</title>
<style>body{font-family:system-ui,sans-serif;max-width:900px;margin:2rem auto;padding:0 1rem;color:#111;background:#fff}img{max-width:100%;border:1px solid #ccc}figure{margin:1rem 0}pre{background:#f4f4f4;padding:1rem;overflow:auto}li{margin:.4rem 0}</style>
<h1>Ilustración de prueba · célula animal (1.º ESO)</h1>
<p>Modo: <b>${esc(summary.mode)}</b> · coste: <b>${summary.costUsd.toFixed(4)} USD</b>${summary.unpricedCalls ? ` (+${summary.unpricedCalls} llamadas sin precio)` : ""} · tope: ${summary.budgetUsd.toFixed(2)} USD</p>
<p>Llamadas: ${esc(summary.calls.join(", "))}</p>
${imgs || "<p>No se generó ninguna imagen.</p>"}
<h2>Comprobación humana (exactitud científica y pedagógica)</h2><ol>${checks}</ol>
<h2>Resultado y revisión automática (es una evidencia, no la última palabra)</h2><pre>${esc(JSON.stringify({ outcome: summary.outcome, reviews }, null, 2))}</pre>
</html>`;
}

void main();
