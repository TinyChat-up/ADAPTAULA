import { createHash } from "node:crypto";
import { IMAGE_BRIEF_V1 } from "@prompts/image-brief/v1";
import { IMAGE_REVIEW_V1 } from "@prompts/image-review/v1";
import { buildAdaptationContext } from "@/lib/adaptation/context";
import { MockProvider } from "@/lib/ai/providers/mock";
import { MockImageProvider } from "@/lib/ai/providers/mock-images";
import type { ImageRequest } from "@/lib/ai/types";
import { resolveModel } from "@/lib/ai/registry";
import type { AIRunRecord, StructuredRequest } from "@/lib/ai/types";
import { callStructured } from "@/lib/materials/visuals/auto/assistants";
import type { IllustrationDeps, StoredIllustration } from "@/lib/materials/visuals/illustrate/service";
import { createRecreationPlanner } from "@/lib/recreation/planner";
import { runRecreation, type RecreationOutcome } from "@/lib/recreation/pilot";
import type { IllustrationGate } from "@/lib/recreation/visuals";
import { POND_PILOT_PROFILE, POND_RECREATION_PLAN } from "../../evals/recreation/pond-plan";
import { pondAnalysis } from "./pond-case";

/**
 * The whole recreation route WITHOUT spending (Fase 5): «Claude» is `MockProvider` answering the planner, the brief and the review
 * with scripted fixtures; «OpenAI» is `MockImageProvider` (a local schematic drawing). Everything else is the product's code: the
 * planner (`createRecreationPlanner` over `callStructured`), the verifier, the illustration pipeline (`illustrate`: gates, quota,
 * budget, review, storage — here in memory) and the renderer. 0 paid calls.
 */

export const MOCK_TEXT = resolveModel("STANDARD", { AI_MODEL_STANDARD: "mock:claude-simulado" });
export const MOCK_IMAGE = resolveModel("IMAGE_QUALITY", { AI_MODEL_IMAGE_QUALITY: "mock:imagen-simulada" });

/** What the simulated image model is asked to show for vr_1 (a brief a model could write: no labels, no markers, no numbers). */
const BRIEF_ELEMENTS = ["agua del estanque", "algas", "plantas acuáticas en la orilla", "una rana", "una garza", "el sol"];
export const MOCK_BRIEF = {
  feasible: true,
  kind: "context_picture",
  concept: "Un estanque con sus seres vivos y su medio",
  pedagogical_purpose: "Reconocer los componentes que nombra el texto antes de clasificarlos.",
  required_elements: BRIEF_ELEMENTS.map((name) => ({ name, marker: null, label: null })),
  prohibited_elements: ["texto o rótulos"],
  composition: "Vista lateral de un estanque con la orilla a la izquierda, el agua en el centro y el cielo arriba.",
  detail_level: "simple",
  conceptual_constraints: ["Ningún animal está comiendo a otro."],
  alt_text: "Dibujo de un estanque con agua, algas, plantas acuáticas en la orilla, una rana, una garza y el sol.",
};
const textOf = (r: StructuredRequest) => r.messages.flatMap((m) => m.content).map((c) => (c.type === "text" ? c.text : "")).join("\n");
/** The brief a model would write for a card: the one item named on it, nothing else (no labels, no markers). */
const cardBrief = (card: string) => ({
  ...MOCK_BRIEF,
  kind: "vocabulary_support",
  concept: card,
  pedagogical_purpose: "Reconocer el elemento de la tarjeta al clasificarla.",
  required_elements: [{ name: card.toLowerCase(), marker: null, label: null }],
  composition: "El elemento solo, centrado, sobre fondo claro.",
  conceptual_constraints: [],
  alt_text: `Ilustración de ${card.toLowerCase()}.`,
});
/** The review echoes the elements of the brief it is shown (the brief travels as JSON in the review's text). */
const approve = (r?: StructuredRequest) => {
  const names = r ? [...textOf(r).matchAll(/"name":"([^"]+)"/g)].map((m) => m[1]!) : BRIEF_ELEMENTS;
  return { elements: (names.length ? names : BRIEF_ELEMENTS).map((name) => ({ name, present: true, marker_ok: null, label_ok: null })), prohibited_found: [], conceptual_errors: [], extra_text: false, illegible_text: false, answer_revealed: false, age_appropriate: true, printable: true, matches_activity: true, verdict: "approved" };
};
const reject = (r?: StructuredRequest) => ({ ...approve(r), extra_text: true, verdict: "rejected" });

export interface MockOptions {
  /** Whether the workspace may generate illustrations (the product's flag + pilot + plan gate, decided by the caller). */
  imagesAuthorized?: boolean;
  /** What the simulated planner answers (the pond plan by default; a list = one answer per call). */
  plans?: unknown[];
  /** What the simulated reviewer says of every image. */
  review?: "approve" | "reject";
  budgetUsd?: number;
  brief?: unknown;
  /** The frozen planner prompt version (v1 by default): v7 asks for, and keeps, new schemes (`diagrams`). */
  promptVersion?: number;
}

export interface MockRun {
  outcome: RecreationOutcome;
  /** Every model call recorded, as `ai_runs` would get it (no content). */
  runs: AIRunRecord[];
  /** The images the in-memory store kept (bytes for printing), by asset id. */
  assets: Map<string, { sha256: string; bytes: Uint8Array; width: number; height: number }>;
  calls: Record<string, number>;
}

/** The simulated stack (planner, illustration gate, counters), to run the route or to create and regenerate through the service. */
export function mockStack(options: MockOptions = {}) {
  const analysis = pondAnalysis();
  const context = buildAdaptationContext({ profile: POND_PILOT_PROFILE, education: { stage: null, grade: null, subject: null }, analysis, adaptationType: "accessibility" }).context;
  const plans = options.plans ?? [POND_RECREATION_PLAN];
  const calls: Record<string, number> = {};
  const count = (name: string) => (calls[name] = (calls[name] ?? 0) + 1);
  const fixtures: Record<string, (r: StructuredRequest) => unknown> = {
    recreation_plan: () => plans[Math.min(count("recreation_plan") - 1, plans.length - 1)],
    illustration_brief: (r) => {
      count("illustration_brief");
      const card = /tarjeta recortable: ([^.]+)\./.exec(textOf(r))?.[1];
      return options.brief ?? (card ? cardBrief(card) : MOCK_BRIEF);
    },
    illustration_review: (r) => (count("illustration_review"), options.review === "reject" ? reject(r) : approve(r)),
  };
  const provider = new MockProvider({ fixtures });
  const runs: AIRunRecord[] = [];
  const record = async (run: AIRunRecord) => void runs.push(run);
  const planner = createRecreationPlanner({ provider, selection: MOCK_TEXT, budget: { limitUsd: options.budgetUsd ?? 0.6, spentUsd: async () => 0 }, recordAiRun: record, ...(options.promptVersion ? { promptVersion: options.promptVersion } : {}) });

  const assets = new Map<string, { sha256: string; bytes: Uint8Array; width: number; height: number }>();
  const stored = new Map<string, StoredIllustration>();
  let reserved = 0;
  const images = new DistinctMockImages();
  const deps: IllustrationDeps = {
    brief: (input) => callStructured(provider, MOCK_TEXT, "image_brief", IMAGE_BRIEF_V1, IMAGE_BRIEF_V1.buildUserText(input), 1500),
    async image({ prompt, size, timeoutMs }) {
      count("image");
      const r = await images.generateImage({ selection: MOCK_IMAGE, prompt, size, quality: "medium", timeoutMs });
      return { image: r.image, run: { purpose: "image", attempt: 1, alias: MOCK_IMAGE.alias, provider: "mock", model: MOCK_IMAGE.model, effort: MOCK_IMAGE.effort, promptKey: "image_render", promptVersion: 1, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, cacheCreationInputTokens: 0, estimatedCostUsd: 0, latencyMs: r.latencyMs, status: "success", errorCode: null } };
    },
    review: ({ png, stage, activity, brief }) => callStructured(provider, MOCK_TEXT, "image_review", IMAGE_REVIEW_V1, [{ type: "image", mediaType: "image/png", data: png }, { type: "text", text: IMAGE_REVIEW_V1.buildUserText({ stage, activity, brief }) }], 1500),
    store: {
      find: async (_adaptation, needKey) => stored.get(needKey) ?? null,
      async put({ request, png, sha256, width, height }) {
        // Derived from the need, not from arrival order: pictures are made concurrently, and ids must not depend on who finishes first.
        const id = `00000000-0000-4000-8000-${createHash("sha256").update(request.needKey).digest("hex").slice(0, 12)}`;
        const asset = { id, sha256, width, height, alt: "Ilustración de la actividad" };
        stored.set(request.needKey, asset);
        assets.set(id, { sha256, bytes: png, width, height });
        return asset;
      },
    },
    quota: { reserve: async () => (++reserved, true), refund: async () => void reserved-- },
    recordAiRun: record,
    sha256: (bytes) => createHash("sha256").update(bytes).digest("hex"),
    budget: { limitUsd: 0.5, spentUsd: async () => 0 },
  };
  const illustrations: IllustrationGate = options.imagesAuthorized ? { available: true, deps, workspaceId: "11111111-1111-4111-8111-111111111111", recreationId: "22222222-2222-4222-8222-222222222222", producer: `MockImageProvider (${MOCK_IMAGE.model})` } : { available: false, reason: "disabled" };
  const request = { analysis, context, scope: "methodological" as const, plannerLabel: `recreation_planner v1 · ${MOCK_TEXT.model}`, illustrations };
  return { planner, request, runs, assets, calls };
}

export async function runMockRecreation(options: MockOptions = {}): Promise<MockRun> {
  const { planner, request, runs, assets, calls } = mockStack(options);
  const outcome = await runRecreation(planner, request);
  return { outcome, runs, assets, calls };
}

/**
 * The product's `MockImageProvider` draws the same outline for every prompt. For the visual example, each prompt gets its own
 * simple drawing (a shape and a soft colour from the prompt's hash), still a local placeholder: no model, no quality claim.
 */
class DistinctMockImages {
  private readonly base = new MockImageProvider();
  async generateImage(request: ImageRequest) {
    const result = await this.base.generateImage(request);
    const [width, height] = request.size.split("x").map(Number) as [number, number];
    const hash = createHash("sha256").update(request.prompt).digest();
    const napi = await import("@napi-rs/canvas");
    const canvas = napi.createCanvas(width, height);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    const hue = hash[0]! * 360 / 255;
    ctx.fillStyle = `hsl(${hue}, 45%, 72%)`;
    ctx.strokeStyle = `hsl(${hue}, 50%, 28%)`;
    ctx.lineWidth = Math.round(width / 90);
    const shape = hash[1]! % 3;
    ctx.beginPath();
    if (shape === 0) ctx.ellipse(width / 2, height / 2, width * 0.3, height * 0.3, 0, 0, Math.PI * 2);
    else if (shape === 1) ctx.roundRect(width * 0.2, height * 0.22, width * 0.6, height * 0.56, width * 0.08);
    else { ctx.moveTo(width / 2, height * 0.18); ctx.lineTo(width * 0.8, height * 0.78); ctx.lineTo(width * 0.2, height * 0.78); ctx.closePath(); }
    ctx.fill();
    ctx.stroke();
    return { ...result, image: { data: new Uint8Array(await canvas.encode("png")), mediaType: "image/png" as const } };
  }
}
