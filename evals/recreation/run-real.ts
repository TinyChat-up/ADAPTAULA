/**
 * FIRST REAL EVALUATION of the recreation engine (ADR-052) — PREPARED, NOT RUN. It spends API money only with every lock open:
 *
 *   RECREATION_EVAL_AUTHORIZED=si RECREATION_EVAL_ARGS="--authorized --max-usd 2.50 --prices-verified 2026-11-20" pnpm eval:recreation
 *   RECREATION_EVAL_ARGS="--dry-run" pnpm eval:recreation     the same route with the simulated models (free): rehearsal of the outputs
 *
 * It runs through vitest (vitest.eval.config.mts), like the PDF tests: the same transform, the same print engine.
 *
 * What it does: «Un estanque en equilibrio» (tests/support/pond-case.ts, its test profile) through EXACTLY the engine of the product
 * (`createRecreation` → planner on `src/lib/ai` → verification → visuals A/B/C → `illustrate()` → documents → print engine):
 * Claude (alias STANDARD) designs the sheet and the teacher's explanation; OpenAI (alias IMAGE_QUALITY) draws the context
 * illustration and the cards' pictures; Claude reviews each picture. Storage, quota and the picture store live in memory: no
 * database, no product environment.
 *
 * Money: ONE ledger with `--max-usd` (hard cap 3 USD). Every request — plan, repair, brief, image, review, and every retry, which
 * is a new request — is admitted by the ledger BEFORE it is sent at its worst case, and settled after at its real usage
 * (budget.ts). When what is left cannot cover the next request, that request is not sent and the run stops spending. The estimate
 * printed before the run is a ceiling, not a promise; the real cost is in the report.
 *
 * Before a real run (preflight, free): the API keys exist (never printed); the configured models are listed by each provider; both
 * have a price in src/lib/ai/costs.ts; a person states with `--prices-verified YYYY-MM-DD` that those prices were checked against
 * the providers' pricing pages on that date (not before the table's date). One real run: a marker refuses another unless `--again`.
 *
 * Writes evals/results/recreation/<stamp>/ (git-ignored): line.json and version.json (what a member would read, no answers),
 * internal.json (answers, plan, verification: local only), assets/*.png, student.pdf, materials.pdf and their print HTML,
 * calls.json (each call: purpose, model, reserved and real cost, status, error), report.md (costs, refusals, rejection reasons).
 * Everything can be reviewed afterwards without calling any API: `ADAPTAULA_DEMO=1 ADAPTAULA_DEMO_DIR=<that folder> pnpm dev`
 * shows the screen at /demo/recreacion.
 */
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { IMAGE_BRIEF_V1 } from "@prompts/image-brief/v1";
import { IMAGE_REVIEW_V1 } from "@prompts/image-review/v1";
import { buildAdaptationContext } from "@/lib/adaptation/context";
import { IMAGE_PRICES_AS_OF, PRICES_AS_OF, estimateImageCostUsd, priceFor } from "@/lib/ai/costs";
import { toAIError } from "@/lib/ai/errors";
import { OpenAIImageProvider } from "@/lib/ai/providers/openai-images";
import { resolveModel, type ModelEnv } from "@/lib/ai/registry";
import { createProvider } from "@/lib/ai/router";
import type { AIRunRecord, ModelSelection } from "@/lib/ai/types";
import { callStructured } from "@/lib/materials/visuals/auto/assistants";
import type { IllustrationDeps, StoredIllustration } from "@/lib/materials/visuals/illustrate/service";
import { createRecreation, type GenerationDeps, type GenerationResult } from "@/lib/recreation/create";
import { createRecreationPlanner, worstCallUsd } from "@/lib/recreation/planner";
import { MemoryRecreationStore } from "@/lib/recreation/record";
import type { IllustrationGate } from "@/lib/recreation/visuals";
import { createChromiumPdfEngine } from "@/lib/render/print/engine";
import { renderPrintHtml } from "@/lib/render/print/html";
import { assetRef } from "@/lib/render/print/pinned-assets";
import { generatedWidthMm } from "@/lib/render/generated";
import { sheetModel } from "@/lib/render/sheet-model";
import type { MaterialDocument } from "@/lib/schemas/material-document";
import { POND_PILOT_PROFILE } from "./pond-plan";
import { createMemoryLedger, imageCeilingUsd, meteredImages, textMeter, type MemoryLedger } from "./budget";
import { pondAnalysis } from "../../tests/support/pond-case";
import { mockStack } from "../../tests/support/recreation-mocks";

export const EVAL_HARD_CAP_USD = 3;
const RESULTS = path.join(process.cwd(), "evals", "results", "recreation");
const MARKER = path.join(RESULTS, "REAL_RUN_DONE.json");

/** Only the variables the run reads (process.env satisfies it; tests pass a plain object). */
export type EvalEnv = Readonly<Record<string, string | undefined>>;

export interface EvalArgs {
  dryRun: boolean;
  authorized: boolean;
  again: boolean;
  maxUsd: number;
  pricesVerified: string | null;
  skipPdf: boolean;
  outDir?: string;
}

export function parseArgs(argv: readonly string[]): EvalArgs {
  const args: EvalArgs = { dryRun: false, authorized: false, again: false, maxUsd: 0, pricesVerified: null, skipPdf: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") args.dryRun = true;
    else if (a === "--authorized") args.authorized = true;
    else if (a === "--again") args.again = true;
    else if (a === "--skip-pdf") args.skipPdf = true;
    else if (a === "--max-usd") args.maxUsd = Number(argv[++i]);
    else if (a === "--prices-verified") args.pricesVerified = argv[++i] ?? null;
    else if (a === "--out") args.outDir = argv[++i];
  }
  return args;
}

/** The locks of a real run. Each failure is a reason in words; an empty list means every lock is open. */
export function realRunBlockers(args: EvalArgs, env: EvalEnv, today = new Date().toISOString().slice(0, 10)): string[] {
  const out: string[] = [];
  if (!args.authorized || env.RECREATION_EVAL_AUTHORIZED !== "si") out.push("falta la autorización expresa (--authorized y RECREATION_EVAL_AUTHORIZED=si)");
  if (!Number.isFinite(args.maxUsd) || args.maxUsd <= 0 || args.maxUsd > EVAL_HARD_CAP_USD) out.push(`--max-usd debe ser positivo y no superar ${EVAL_HARD_CAP_USD} USD`);
  const verified = args.pricesVerified;
  if (!verified || !/^\d{4}-\d{2}-\d{2}$/.test(verified) || verified > today || verified < PRICES_AS_OF || verified < IMAGE_PRICES_AS_OF) out.push(`--prices-verified YYYY-MM-DD: fecha en que una persona comprobó los precios vigentes (no anterior a ${PRICES_AS_OF} ni a ${IMAGE_PRICES_AS_OF}, ni futura)`);
  if (!env.ANTHROPIC_API_KEY) out.push("falta ANTHROPIC_API_KEY");
  if (!env.OPENAI_API_KEY) out.push("falta OPENAI_API_KEY");
  if (existsSync(MARKER) && !args.again) out.push("ya hay una ejecución real registrada (usa --again para otra, con nueva autorización)");
  return out;
}

/** The configured models: by alias, from the environment; both must be priced. Never a model id in the code. */
export function selections(env: EvalEnv): { text: ModelSelection; image: ModelSelection; problems: string[] } {
  const text = resolveModel("STANDARD", env as ModelEnv);
  const image = resolveModel("IMAGE_QUALITY", env as ModelEnv);
  const problems: string[] = [];
  if (text.provider !== "anthropic" || !priceFor(text.provider, text.model)) problems.push(`el modelo de texto (${text.provider}:${text.model}) no es de Anthropic con precio en costs.ts`);
  if (image.provider !== "openai" || imageCeilingUsd(image.model, "1536x1024", "medium") === null) problems.push(`el modelo de imagen (${image.provider}:${image.model}) no es de OpenAI con precio en costs.ts`);
  return { text, image, problems };
}

/** Free: the providers list their models; the configured ones must be there. */
async function modelsAvailable(text: ModelSelection, image: ModelSelection, env: EvalEnv): Promise<string[]> {
  const problems: string[] = [];
  try {
    const ids: string[] = [];
    for await (const m of new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }).models.list()) ids.push(m.id);
    if (!ids.includes(text.model)) problems.push(`Anthropic no ofrece ${text.model}`);
  } catch (error) {
    problems.push(`no se pudo listar los modelos de Anthropic: ${toAIError(error).code}`);
  }
  try {
    const ids: string[] = [];
    for await (const m of new OpenAI({ apiKey: env.OPENAI_API_KEY }).models.list()) ids.push(m.id);
    if (!ids.includes(image.model)) problems.push(`OpenAI no ofrece ${image.model}`);
  } catch (error) {
    problems.push(`no se pudo listar los modelos de OpenAI: ${toAIError(error).code}`);
  }
  return problems;
}

/** The ceiling of the whole run, before anything is sent: what the ledger could admit at most if every call went to its worst case. */
export function worstCaseUsd(text: ModelSelection, image: ModelSelection, images: number): { total: number; lines: string[] } {
  const planner = worstCallUsd(text, 40_000);
  const textCall = worstCallUsd(text, 12_000, 1500);
  const picture = imageCeilingUsd(image.model, "1536x1024", "medium") ?? 0;
  const perImage = textCall + 2 * (picture + textCall); // brief + (image + review) × 2 attempts
  const total = 2 * planner + images * perImage;
  return { total, lines: [`plan + reparación: 2 × ${planner.toFixed(3)} $`, `por ilustración (brief + 2 × (imagen + revisión)): ${perImage.toFixed(3)} $ × ${images}`, `techo total: ${total.toFixed(2)} $`] };
}

/** The real stack: metered Claude and metered OpenAI, the product's planner and illustration pipeline, everything stored in memory. */
function realStack(text: ModelSelection, image: ModelSelection, ledger: MemoryLedger, env: EvalEnv, runs: AIRunRecord[], assets: Map<string, { sha256: string; bytes: Uint8Array; width: number; height: number }>) {
  const provider = createProvider(text, { anthropicApiKey: env.ANTHROPIC_API_KEY, spendMeter: textMeter(ledger), isProduction: false });
  const images = meteredImages(OpenAIImageProvider.fromApiKey(env.OPENAI_API_KEY!), ledger);
  const record = async (run: AIRunRecord) => void runs.push(run);
  const spent = { limitUsd: ledger.limitUsd, spentUsd: async () => ledger.committedUsd() };
  const planner = createRecreationPlanner({ provider, selection: text, budget: spent, recordAiRun: record });
  const stored = new Map<string, StoredIllustration>();
  const deps: IllustrationDeps = {
    brief: (input) => callStructured(provider, text, "image_brief", IMAGE_BRIEF_V1, IMAGE_BRIEF_V1.buildUserText(input), 1500, AbortSignal.timeout(input.timeoutMs)),
    async image({ prompt, size, timeoutMs }) {
      const base = { purpose: "image" as const, attempt: 1, alias: image.alias, provider: image.provider, model: image.model, effort: image.effort, promptKey: "image_render", promptVersion: 1 };
      try {
        const r = await images.generateImage({ selection: image, prompt, size, quality: "medium", timeoutMs });
        return { image: r.image, run: { ...base, inputTokens: r.usage.textInputTokens + r.usage.imageInputTokens, outputTokens: r.usage.outputTokens, cachedInputTokens: 0, cacheCreationInputTokens: 0, estimatedCostUsd: estimateImageCostUsd(r.provider, r.model, r.usage), latencyMs: r.latencyMs, status: "success", errorCode: null } };
      } catch (error) {
        const code = toAIError(error).code;
        return { image: null, run: { ...base, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, cacheCreationInputTokens: 0, estimatedCostUsd: null, latencyMs: 0, status: code === "refusal" ? "refused" : "error", errorCode: code } };
      }
    },
    review: ({ png, stage, activity, brief, timeoutMs }) => callStructured(provider, text, "image_review", IMAGE_REVIEW_V1, [{ type: "image", mediaType: "image/png", data: png }, { type: "text", text: IMAGE_REVIEW_V1.buildUserText({ stage, activity, brief }) }], 1500, AbortSignal.timeout(timeoutMs)),
    store: {
      find: async (_line, needKey) => stored.get(needKey) ?? null,
      async put({ request, png, sha256, width, height, brief }) {
        const id = `00000000-0000-4000-8000-${String(stored.size + 1).padStart(12, "0")}`;
        const asset = { id, sha256, width, height, alt: brief.alt_text.slice(0, 300) };
        stored.set(request.needKey, asset);
        assets.set(id, { sha256, bytes: png, width, height });
        return asset;
      },
    },
    quota: { reserve: async () => true, refund: async () => undefined },
    recordAiRun: record,
    sha256: (bytes) => createHash("sha256").update(bytes).digest("hex"),
    budget: spent,
  };
  const illustrations: IllustrationGate = { available: true, deps, workspaceId: "11111111-1111-4111-8111-111111111111", recreationId: "77777777-7777-4777-8777-777777777777", producer: `OpenAI ${image.model} (IMAGE_QUALITY)` };
  return { planner, illustrations };
}

export interface EvalResult {
  status: GenerationResult["status"] | "blocked" | "stopped_budget";
  outDir: string | null;
  blockers: string[];
  spentUsd: number;
}

/** The evaluation itself; `main` only parses the command line. Exported so the dry run is tested. */
export async function runEvaluation(args: EvalArgs, env: EvalEnv = process.env, log: (line: string) => void = console.log): Promise<EvalResult> {
  const analysis = pondAnalysis();
  const context = buildAdaptationContext({ profile: POND_PILOT_PROFILE, education: { stage: null, grade: null, subject: null }, analysis, adaptationType: "accessibility" }).context;
  let runs: AIRunRecord[] = [];
  let planner: GenerationDeps["planner"];
  let illustrations: IllustrationGate;
  let assets: Map<string, { sha256: string; bytes: Uint8Array; width: number; height: number }>;
  let ledger: MemoryLedger;
  let plannerLabel: string;

  if (args.dryRun) {
    const stack = mockStack({ imagesAuthorized: true });
    planner = stack.planner;
    illustrations = stack.request.illustrations;
    assets = stack.assets;
    ledger = createMemoryLedger(Number.isFinite(args.maxUsd) && args.maxUsd > 0 ? args.maxUsd : EVAL_HARD_CAP_USD);
    plannerLabel = stack.request.plannerLabel;
    runs = stack.runs;
    log("Ensayo sin coste: Claude y OpenAI simulados.");
  } else {
    const blockers = realRunBlockers(args, env);
    const { text, image, problems } = selections(env);
    blockers.push(...problems);
    if (blockers.length === 0) blockers.push(...(await modelsAvailable(text, image, env)));
    if (blockers.length > 0) {
      log(`No se ejecuta la evaluación real:\n- ${blockers.join("\n- ")}`);
      return { status: "blocked", outDir: null, blockers, spentUsd: 0 };
    }
    const ceiling = worstCaseUsd(text, image, 7);
    log([`Modelos: ${text.model} (texto) · ${image.model} (imagen). Precios de costs.ts: ${PRICES_AS_OF} / ${IMAGE_PRICES_AS_OF}; comprobados el ${args.pricesVerified}.`, ...ceiling.lines, `Límite autorizado: ${args.maxUsd.toFixed(2)} $ (la ejecución se detiene antes de cualquier llamada que no quepa).`].join("\n"));
    writeFileSync(path.join(RESULTS, "REAL_RUN_STARTED.json"), JSON.stringify({ at: new Date().toISOString(), maxUsd: args.maxUsd }) + "\n");
    ledger = createMemoryLedger(args.maxUsd);
    assets = new Map();
    const stack = realStack(text, image, ledger, env, runs, assets);
    planner = stack.planner;
    illustrations = stack.illustrations;
    plannerLabel = `recreation_planner v1 · ${text.model}`;
  }

  const store = new MemoryRecreationStore();
  let n = 0;
  const result = await createRecreation(
    { store, planner, canWrite: async () => true, quota: { reserve: async () => "reserved", refund: async () => undefined }, budgetAllows: async () => ledger.committedUsd() < ledger.limitUsd, newId: () => `88888888-8888-4888-8888-${String(++n).padStart(12, "0")}`, now: () => new Date().toISOString(), runs },
    { analysis, context, scope: "methodological", plannerLabel, illustrations, workspaceId: "11111111-1111-4111-8111-111111111111", materialId: "44444444-4444-4444-8444-444444444444", idempotencyKey: `eval-${Date.now()}` },
  );

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = args.outDir ?? path.join(RESULTS, `${args.dryRun ? "ensayo-" : ""}${stamp}`);
  mkdirSync(path.join(outDir, "assets"), { recursive: true });
  const refusals = ledger.refusals();
  const status: EvalResult["status"] = refusals > 0 && result.status !== "created" ? "stopped_budget" : result.status;
  const calls = runs.map((r) => ({ purpose: r.purpose, prompt: `${r.promptKey}@v${r.promptVersion}`, model: r.model, attempt: r.attempt, status: r.status, error: r.errorCode, issues: r.issues ?? [], estimatedCostUsd: r.estimatedCostUsd }));
  writeFileSync(path.join(outDir, "calls.json"), JSON.stringify({ calls, ledger: ledger.entries(), refusals, committedUsd: ledger.committedUsd(), limitUsd: ledger.limitUsd }, null, 1) + "\n");

  const report = [`# Evaluación de recreación · ${args.dryRun ? "ENSAYO (simulado, 0 $)" : "REAL"}`, "", `- Estado: ${status}`, `- Gasto comprometido: ${ledger.committedUsd().toFixed(4)} $ de ${ledger.limitUsd.toFixed(2)} $ · llamadas rechazadas por presupuesto: ${refusals}`, `- Llamadas: ${calls.length} (${calls.filter((c) => c.status !== "success").length} con error)`];
  if (result.status === "created") {
    const { line, version } = result;
    const internal = await store.getInternal(version.id);
    writeFileSync(path.join(outDir, "line.json"), JSON.stringify(line, null, 1) + "\n");
    writeFileSync(path.join(outDir, "version.json"), JSON.stringify(version, null, 1) + "\n");
    writeFileSync(path.join(outDir, "internal.json"), JSON.stringify(internal, null, 1) + "\n");
    for (const a of version.assets) writeFileSync(path.join(outDir, "assets", `${a.asset_id}.png`), assets.get(a.asset_id)!.bytes);
    report.push(`- Estado del material: ${version.state}${version.state_message ? ` — ${version.state_message}` : ""}`, `- Imágenes guardadas: ${version.assets.length}`);
    const visuals = (internal?.visuals ?? []) as Array<{ request_id: string; route: string; attempts: string[] }>;
    for (const v of visuals) report.push(`- Recurso ${v.request_id}: ${v.route} · ${v.attempts.join(" · ")}`);
    const issues = ((internal?.verification as { issues?: Array<{ severity: string; message: string }> } | undefined)?.issues ?? []).map((i) => `${i.severity}: ${i.message}`);
    if (issues.length) report.push("", "## Avisos de la verificación", ...issues.map((i) => `- ${i}`));
    if (!args.skipPdf) {
      const engine = createChromiumPdfEngine({ timeoutMs: 90_000 });
      for (const [name, doc] of [["student", version.student], ["materials", version.materials]] as Array<[string, MaterialDocument | null]>) {
        if (!doc) continue;
        const generated = Object.fromEntries(version.assets.map((a) => [a.asset_id, { src: assetRef({ assetId: a.asset_id, sha256: a.sha256 }), widthMm: generatedWidthMm(a.width, a.height) }]));
        const { model } = sheetModel({ document: doc, subjectName: null, generated, deferred: [] }, "student");
        const json = JSON.stringify(doc);
        const pins = version.assets.filter((a) => json.includes(a.asset_id)).map((a) => ({ assetId: a.asset_id, sha256: a.sha256, mime: "image/png" as const, bytes: assets.get(a.asset_id)!.bytes }));
        const print = await renderPrintHtml(model, pins);
        writeFileSync(path.join(outDir, `${name}.html`), print.html);
        const pdf = await engine.render(print.html, { fontFamily: print.fontFamily, fontWeights: print.fontWeights });
        writeFileSync(path.join(outDir, `${name}.pdf`), pdf.pdf);
      }
    }
  } else {
    report.push(`- Sin material: ${"message" in result ? result.message : result.status}`);
  }
  report.push("", `Revisar sin llamar a ninguna API: \`ADAPTAULA_DEMO=1 ADAPTAULA_DEMO_DIR=${path.relative(process.cwd(), outDir)} pnpm dev\` → /demo/recreacion`);
  writeFileSync(path.join(outDir, "report.md"), report.join("\n") + "\n");
  if (!args.dryRun) writeFileSync(MARKER, JSON.stringify({ at: new Date().toISOString(), outDir, committedUsd: ledger.committedUsd() }) + "\n");
  log(report.join("\n"));
  return { status, outDir, blockers: [], spentUsd: ledger.committedUsd() };
}
