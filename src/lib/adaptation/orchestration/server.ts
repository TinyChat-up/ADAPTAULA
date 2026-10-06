import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serverEnv } from "@/lib/config/env.server";
import { providerFor } from "@/lib/ai/runtime";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ModelEnv } from "@/lib/ai/registry";
import { createModelGenerator } from "../generator";
import { createModelPlanner } from "../planner";
import { createModelReviewer } from "../reviewer";
import { dbEntitlements } from "./entitlements-db";
import type { OrchestratorDeps, PipelineServices } from "./orchestrator";
import type { AdaptationReader, ServiceDeps } from "./service";
import { AdaptationStore, ARTIFACT_KINDS, type RpcClient } from "./store";
import { modelSelectionOf, resolvePipelineVersions, type PipelineVersions } from "./versions";

/**
 * Production wiring. The ONLY file of the pipeline that touches the service-role client (workers and the application layer
 * call RPC functions that only service_role may execute) and the provider credentials. Reads on behalf of a user go through the
 * user's own client, so RLS decides what exists for them.
 */

export const adaptationStore = () => new AdaptationStore(createAdminClient() as unknown as RpcClient);

/** The AI services of a stage, built from the PERSISTED versions: the alias and model frozen at creation, never today's env. */
export function productionServices(versions: PipelineVersions, analysis: Parameters<typeof createModelPlanner>[0]["analysis"]): PipelineServices {
  const selection = (c: PipelineVersions["planner"]) => modelSelectionOf(c);
  return {
    planner: createModelPlanner({ analysis, selection: selection(versions.planner), provider: providerFor(selection(versions.planner)), maxOutputTokens: versions.planner.max_output_tokens, version: versions.planner.prompt_version }),
    generator: createModelGenerator({ selection: selection(versions.generator), provider: providerFor(selection(versions.generator)), maxOutputTokens: versions.generator.max_output_tokens, version: versions.generator.prompt_version }),
    reviewer: createModelReviewer({ selection: selection(versions.reviewer), provider: providerFor(selection(versions.reviewer)), maxOutputTokens: versions.reviewer.max_output_tokens }),
  };
}

export const orchestratorDeps = (): OrchestratorDeps => {
  const store = adaptationStore();
  return { store, services: productionServices, entitlements: dbEntitlements(store) };
};

/** Versions for NEW adaptations: resolved from the environment once, then persisted with the adaptation. */
export const resolveVersionsFromEnv = () => resolvePipelineVersions(serverEnv() as ModelEnv);

/** `AdaptationReader` over the USER's client (RLS): a row of another workspace is simply not there. */
export function supabaseReader(supabase: SupabaseClient): AdaptationReader {
  return {
    async getMaterial(id) {
      const { data } = await supabase.from("materials").select("id, workspace_id, title, status, analysis, stage_slug, grade_slug, subject_slug").eq("id", id).maybeSingle();
      return data ?? null;
    },
    async getLearnerProfile(id) {
      const { data } = await supabase.from("learner_profiles").select("id, workspace_id, stage_slug, grade_slug, functional_profile").eq("id", id).maybeSingle();
      return data ?? null;
    },
    async getAdaptation(id) {
      const { data } = await supabase.from("adaptations").select("id, workspace_id, material_id, status, current_version, delivered_at").eq("id", id).maybeSingle();
      return data ?? null;
    },
    async getVersion(adaptationId, version) {
      let query = supabase.from("adaptation_versions").select("id, version, document, review, source, created_at").eq("adaptation_id", adaptationId);
      query = version === null ? query.order("version", { ascending: false }) : query.eq("version", version);
      const { data } = await query.limit(1);
      return data?.[0] ?? null;
    },
    async getArtifacts(adaptationId, kinds) {
      const { data } = await supabase.from("adaptation_artifacts").select("id, kind, input_fingerprint, fingerprint, payload, created_at").eq("adaptation_id", adaptationId).in("kind", [...kinds]).order("created_at");
      return (data ?? []).filter((a) => (ARTIFACT_KINDS as readonly string[]).includes(a.kind)) as never;
    },
  };
}

export function serviceDeps(supabase: SupabaseClient): ServiceDeps {
  return { orchestrator: orchestratorDeps(), reader: supabaseReader(supabase), resolveVersions: resolveVersionsFromEnv };
}
