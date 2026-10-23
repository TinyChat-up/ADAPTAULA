import "server-only";
import { createHash } from "node:crypto";
import { IMAGE_BRIEF_V1 } from "@prompts/image-brief/v1";
import { IMAGE_RENDER_V1 } from "@prompts/image-render/v1";
import { IMAGE_REVIEW_V1 } from "@prompts/image-review/v1";
import { estimateImageCostUsd } from "@/lib/ai/costs";
import { toAIError } from "@/lib/ai/errors";
import { resolveModel, type ModelEnv } from "@/lib/ai/registry";
import { toAiRunRow } from "@/lib/ai/run-record";
import { imageProviderFor, providerFor } from "@/lib/ai/runtime";
import type { AIRunRecord, ImageProvider, ModelSelection } from "@/lib/ai/types";
import { publicEnv } from "@/lib/config/env.public";
import { imagePilotAllows } from "./pilot";
import { serverEnv } from "@/lib/config/env.server";
import { getFlags } from "@/lib/config/flags";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { callStructured } from "../auto/assistants";
import type { IllustrationWithheld } from "../auto/policy";
import { ILLUSTRATION_BUDGET, ILLUSTRATION_LIMITS, type IllustrationDeps, type StoredIllustration } from "./service";

/**
 * Production `IllustrationDeps` for one adaptation, or null when illustrations are not available to it. Available only when ALL
 * hold (docs/BILLING.md, `image.generate`): the `FLAG_AI_IMAGES_ENABLED` flag, the workspace's plan has `image_generation` and a
 * `monthly_images` allowance (each approved illustration consumes one unit through `consume_quota('image')`, given back if none is
 * approved), an image model and its credentials, and a text/vision model for the brief and the review. Spending is capped per
 * adaptation (`ILLUSTRATION_BUDGET`, or the plan's `features.illustration_budget_usd`), counted from `ai_runs` before each call.
 * Service role only: a server job after the adaptation authorised its material. Logs carry ids and codes only.
 */
const BUCKET = "generated-assets";
const COLUMNS = "id, sha256, width, height, alt_text";

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const toStored = (row: { id: string; sha256: string; width: number; height: number; alt_text: string | null }): StoredIllustration => ({ id: row.id, sha256: row.sha256, width: row.width, height: row.height, alt: row.alt_text ?? "Ilustración de la actividad" });

/** Why an adaptation cannot have illustrations (`IllustrationWithheld`): never «your plan» when the feature is off for everyone. */
export type IllustrationAvailability = { available: true; deps: IllustrationDeps; perAdaptation: number | null } | { available: false; reason: IllustrationWithheld };

const ILLUSTRATION_PURPOSES = ["image_brief", "image", "image_review"] as const;

export async function illustrationAvailability(ids: { workspaceId: string; adaptationId: string; materialId: string }): Promise<IllustrationAvailability> {
  // Switched off in Adaptaula: true for every plan, so the stop must not suggest changing plans (fichas 06/07 of the real run).
  if (!getFlags().aiImagesEnabled) return { available: false, reason: "disabled" };
  if (!imagePilotAllows(serverEnv(), ids.workspaceId, publicEnv().NEXT_PUBLIC_SUPABASE_URL, process.env.VERCEL_ENV)) return { available: false, reason: "disabled" };
  const admin = createAdminClient();
  const { data: plan } = await admin.rpc("workspace_plan", { ws: ids.workspaceId });
  const effective = (plan as { slug?: string; features?: Record<string, unknown>; monthly_images?: number } | null) ?? null;
  if (effective?.slug !== "max" || effective?.features?.image_generation !== true || !(Number(effective.monthly_images) > 0)) return { available: false, reason: (await anyPlanOffersIllustrations(admin)) ? "plan" : "not_offered" };
  const planBudget = Number(effective.features?.illustration_budget_usd);
  const deps = await illustrationDeps(ids, Number.isFinite(planBudget) && planBudget > 0 ? planBudget : ILLUSTRATION_BUDGET.perAdaptationUsd);
  const perAdaptation = Number(effective.features?.illustrations_per_adaptation);
  return deps ? { available: true, deps, perAdaptation: Number.isInteger(perAdaptation) && perAdaptation >= 0 ? perAdaptation : null } : { available: false, reason: "service" };
}

/** Whether some active plan of the catalogue includes illustrations (an unknown answer says no: never an upgrade that may not exist). */
async function anyPlanOffersIllustrations(admin: ReturnType<typeof createAdminClient>): Promise<boolean> {
  const { data, error } = await admin.from("plans").select("id").eq("active", true).eq("features->>image_generation", "true").gt("monthly_images", 0).limit(1);
  return !error && (data?.length ?? 0) > 0;
}

async function illustrationDeps(ids: { workspaceId: string; adaptationId: string; materialId: string }, budgetUsd: number): Promise<IllustrationDeps | null> {
  if (!getFlags().aiImagesEnabled) return null;
  const env = serverEnv() as ModelEnv;
  let imageSelection: ModelSelection;
  let textSelection: ModelSelection;
  let imageProvider: ImageProvider;
  try {
    imageSelection = resolveModel("IMAGE_QUALITY", env);
    textSelection = resolveModel("STANDARD", env);
    if (textSelection.provider === "mock") return null;
    imageProvider = imageProviderFor(imageSelection);
  } catch {
    return null;
  }
  const admin = createAdminClient();
  const textProvider = providerFor(textSelection);

  return {
    brief: (input) => callStructured(textProvider, textSelection, "image_brief", IMAGE_BRIEF_V1, IMAGE_BRIEF_V1.buildUserText(input), 1500, AbortSignal.timeout(input.timeoutMs)),
    async image({ prompt, size, timeoutMs }) {
      const base = { purpose: "image" as const, attempt: 1, alias: imageSelection.alias, provider: imageSelection.provider, model: imageSelection.model, effort: imageSelection.effort, promptKey: IMAGE_RENDER_V1.key, promptVersion: IMAGE_RENDER_V1.version };
      try {
        const r = await imageProvider.generateImage({ selection: imageSelection, prompt, size, quality: "medium", timeoutMs });
        const run: AIRunRecord = { ...base, inputTokens: r.usage.textInputTokens + r.usage.imageInputTokens, outputTokens: r.usage.outputTokens, cachedInputTokens: 0, cacheCreationInputTokens: 0, estimatedCostUsd: estimateImageCostUsd(r.provider, r.model, r.usage), latencyMs: r.latencyMs, status: "success", errorCode: null };
        return { image: r.image, run };
      } catch (error) {
        const code = toAIError(error).code;
        return { image: null, run: { ...base, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, cacheCreationInputTokens: 0, estimatedCostUsd: null, latencyMs: 0, status: code === "refusal" ? "refused" : "error", errorCode: code } };
      }
    },
    review: ({ png, stage, activity, brief, timeoutMs }) =>
      callStructured(textProvider, textSelection, "image_review", IMAGE_REVIEW_V1, [{ type: "image", mediaType: "image/png", data: png }, { type: "text", text: IMAGE_REVIEW_V1.buildUserText({ stage, activity, brief }) }], 1500, AbortSignal.timeout(timeoutMs)),
    store: {
      async find(adaptationId, needKey) {
        // The illustration already approved for this need (a resumed job, a correction cycle): reused, never paid twice.
        const { data } = await admin.from("generated_assets").select(COLUMNS).eq("adaptation_id", adaptationId).eq("need_key", needKey).not("sha256", "is", null).eq("review->>approved", "true").order("created_at", { ascending: false }).limit(1);
        const row = data?.[0] as { id: string; sha256: string; width: number; height: number; alt_text: string | null } | undefined;
        return row ? toStored(row) : null;
      },
      async put({ request, brief, briefFingerprint, prompt, png, sha256: hash, width, height, attempts, review }) {
        const path = `${request.workspaceId}/${request.adaptationId}/illustrations/${hash}.png`;
        const { error: uploadError } = await admin.storage.from(BUCKET).upload(path, png, { contentType: "image/png", upsert: false });
        if (uploadError && !/already exists|duplicate|409/i.test(`${uploadError.message} ${(uploadError as { statusCode?: string }).statusCode ?? ""}`)) throw new Error("illustration_upload_failed");
        const row = { workspace_id: request.workspaceId, adaptation_id: request.adaptationId, block_id: null, type: "illustration", storage_path: path, image_brief: brief, prompt, alt_text: brief.alt_text.slice(0, 300), metadata: { kind: brief.kind }, need_key: request.needKey, brief_fingerprint: briefFingerprint, sha256: hash, mime: "image/png", width, height, bytes: png.byteLength, model_alias: imageSelection.alias, review, attempts };
        const { data, error } = await admin.from("generated_assets").insert(row).select(COLUMNS).single();
        if (!error && data) return toStored(data as { id: string; sha256: string; width: number; height: number; alt_text: string | null });
        // A concurrent producer stored the same illustration (same adaptation, need and brief): that row is the one.
        const { data: existing } = await admin.from("generated_assets").select(COLUMNS).eq("adaptation_id", request.adaptationId).eq("need_key", request.needKey).eq("brief_fingerprint", briefFingerprint).eq("review->>approved", "true").maybeSingle();
        if (existing) return toStored(existing as { id: string; sha256: string; width: number; height: number; alt_text: string | null });
        throw new Error("illustration_insert_failed");
      },
    },
    quota: {
      async reserve(key) {
        const { data: approved, error: countError } = await admin.from("generated_assets").select("id").eq("adaptation_id", ids.adaptationId).not("sha256", "is", null).eq("review->>approved", "true").limit(ILLUSTRATION_LIMITS.perAdaptation);
        if (countError || !approved || approved.length >= ILLUSTRATION_LIMITS.perAdaptation) return false;
        const { data, error } = await admin.rpc("consume_quota", { p_workspace: ids.workspaceId, p_kind: "image", p_units: 1, p_user: null, p_job: null, p_key: key });
        return !error && (data as { allowed?: boolean } | null)?.allowed === true;
      },
      async refund(key) {
        await admin.rpc("refund_quota", { p_reserve_key: key });
      },
    },
    async recordAiRun(run) {
      const { error } = await admin.from("ai_runs").insert({ ...toAiRunRow(run, { workspaceId: ids.workspaceId, jobId: null, materialId: ids.materialId }), adaptation_id: ids.adaptationId });
      if (error) logger.warn("ai_run_record_failed", { purpose: run.purpose, code: error.code ?? null });
    },
    sha256,
    budget: {
      limitUsd: budgetUsd,
      // Everything this adaptation's illustrations have cost so far (resumed jobs and correction cycles included); a run with no
      // price, including a failed call without usage, counts at its defensive estimate.
      async spentUsd() {
        const { data, error } = await admin.from("ai_runs").select("purpose, status, estimated_cost_usd").eq("adaptation_id", ids.adaptationId).in("purpose", [...ILLUSTRATION_PURPOSES]);
        if (error) throw new Error("illustration_spend_unavailable");
        return ((data ?? []) as Array<{ purpose: string; status: string; estimated_cost_usd: number | string | null }>).reduce((sum, r) => sum + (r.estimated_cost_usd !== null ? Number(r.estimated_cost_usd) : (r.purpose === "image" ? ILLUSTRATION_BUDGET.imageUsd : ILLUSTRATION_BUDGET.textUsd)), 0);
      },
    },
  };
}
