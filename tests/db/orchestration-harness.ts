import type { PGlite } from "@electric-sql/pglite";
import { createMockGenerator, createMockPlanner, createMockReviewer } from "@/lib/adaptation/mock";
import { fingerprint } from "@/lib/adaptation/fingerprint";
import { buildGeneratorInputV2 } from "@/lib/adaptation/generator";
import { AdaptationStore, type RpcClient } from "@/lib/adaptation/orchestration/store";
import type { OrchestratorDeps, PipelineServices } from "@/lib/adaptation/orchestration/orchestrator";
import type { AdaptationEntitlements } from "@/lib/adaptation/orchestration/entitlements";
import { resolvePipelineVersions, type PipelineVersions } from "@/lib/adaptation/orchestration/versions";
import type { AdaptationPlanner, MaterialGenerator, PedagogicalReviewer, StageRunRecord } from "@/lib/adaptation/services";
import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";
import { EXECUTIVE_EXPERIMENT_PROFILE } from "../../evals/adaptation/planner-lib";
import { as, createUser } from "./harness";

export type User = Awaited<ReturnType<typeof createUser>>;

/** `rpc` over PGlite as service_role. Calls are serialised (one connection), but workers interleave between them. */
export function pgRpc(db: PGlite): RpcClient & { calls: string[] } {
  let chain: Promise<unknown> = Promise.resolve();
  const calls: string[] = [];
  return {
    calls,
    rpc(name, args) {
      const run = async () => {
        calls.push(name);
        const keys = Object.keys(args);
        const params = keys.map((k) => (args[k] !== null && typeof args[k] === "object" ? JSON.stringify(args[k]) : args[k]));
        const sql = `select public.${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")}) as data`;
        try {
          const { rows } = await as(db, "service_role", null, () => db.query<{ data: unknown }>(sql, params));
          return { data: rows[0]!.data ?? null, error: null };
        } catch (error) {
          return { data: null, error: { message: (error as Error).message } };
        }
      };
      const result = chain.then(run, run);
      chain = result.catch(() => undefined);
      return result as never;
    },
  };
}

export async function seedMaterial(db: PGlite, u: User, analysis: MaterialAnalysis, status = "analyzed"): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    "insert into public.materials (workspace_id, created_by, title, source_type, status, analysis, analysis_prompt_version) values ($1, $2, 'Ficha de prueba', 'pdf', 'uploading', null, null) returning id",
    [u.workspaceId, u.id],
  );
  const id = rows[0]!.id;
  await db.query("update public.materials set status = $2, analysis = $3, analysis_prompt_version = 'material_analyzer@v3' where id = $1", [id, status, JSON.stringify(analysis)]);
  return id;
}

export async function seedLearner(db: PGlite, u: User, displayName = "Marta Alumna"): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    "insert into public.learner_profiles (workspace_id, display_name, created_by, functional_profile) values ($1, $2, $3, $4) returning id",
    [u.workspaceId, displayName, u.id, JSON.stringify(EXECUTIVE_EXPERIMENT_PROFILE)],
  );
  return rows[0]!.id;
}

export const versions = (): PipelineVersions => resolvePipelineVersions({});

export function stageRun(purpose: "plan" | "generate" | "review", component: PipelineVersions["planner"], key: string, over: Partial<StageRunRecord> = {}): StageRunRecord {
  return {
    purpose,
    attempt: 1,
    alias: component.selection.alias,
    provider: component.selection.provider,
    model: component.selection.model,
    effort: component.selection.effort,
    promptKey: key,
    promptVersion: component.prompt_version,
    inputTokens: 1000,
    outputTokens: 500,
    cachedInputTokens: 0,
    cacheCreationInputTokens: 3000,
    estimatedCostUsd: 0.02,
    latencyMs: 4000,
    status: "success",
    errorCode: null,
    schemaKey: key,
    schemaVersion: component.schema_version,
    callKind: "initial",
    reasoningTokens: null,
    ...over,
  };
}

export interface Spy {
  planner: number;
  generator: number;
  reviewer: number;
  generatorInputs: Array<{ decisions: string[] }>;
  seenVersions: PipelineVersions[];
}

export interface Scripted {
  planner?: (inner: AdaptationPlanner, call: number, input: Parameters<AdaptationPlanner["plan"]>[0]) => ReturnType<AdaptationPlanner["plan"]>;
  generator?: (inner: MaterialGenerator, call: number, input: Parameters<MaterialGenerator["generate"]>[0]) => ReturnType<MaterialGenerator["generate"]>;
  reviewer?: (inner: PedagogicalReviewer, call: number, input: Parameters<PedagogicalReviewer["review"]>[0]) => ReturnType<PedagogicalReviewer["review"]>;
}

/** Services built from the PERSISTED versions (they record which ones they were given), over the deterministic mocks. */
export function scriptedServices(spy: Spy, script: Scripted = {}): OrchestratorDeps["services"] {
  return (v: PipelineVersions, analysis: MaterialAnalysis): PipelineServices => {
    spy.seenVersions.push(v);
    const planner = createMockPlanner(analysis, 2);
    const generator = createMockGenerator(2);
    const reviewer = createMockReviewer();
    return {
      planner: {
        plan: async (input) => {
          spy.planner += 1;
          const out = await (script.planner?.(planner, spy.planner, input) ?? planner.plan(input));
          return { ...out, runs: [stageRun("plan", v.planner, "adaptation_planner", { callKind: input.repairOf ? "repair" : "initial" })] };
        },
      },
      generator: {
        generate: async (input) => {
          spy.generator += 1;
          spy.generatorInputs.push({ decisions: buildGeneratorInputV2(input.reviewed, input.analysis, input.context).approved.decisions.map((d) => d.id) });
          const out = await (script.generator?.(generator, spy.generator, input) ?? generator.generate(input));
          return { ...out, runs: [stageRun("generate", v.generator, "material_generator")] };
        },
      },
      reviewer: {
        review: async (input) => {
          spy.reviewer += 1;
          const out = await (script.reviewer?.(reviewer, spy.reviewer, input) ?? reviewer.review(input));
          return { ...out, runs: [stageRun("review", v.reviewer, "pedagogical_reviewer")] };
        },
      },
    };
  };
}

export const newSpy = (): Spy => ({ planner: 0, generator: 0, reviewer: 0, generatorInputs: [], seenVersions: [] });

export interface Recording extends AdaptationEntitlements {
  events: string[];
}
export const recordingEntitlements = (): Recording => {
  const events: string[] = [];
  return {
    events,
    reserve: async (a) => void events.push(`reserve:${a.id}`),
    release: async (a, reason) => void events.push(`release:${reason}`),
    consume: async (a) => void events.push(`consume:${a.id}`),
  };
};

export function deps(db: PGlite, services: OrchestratorDeps["services"], extra: Partial<OrchestratorDeps> = {}): OrchestratorDeps & { rpc: ReturnType<typeof pgRpc> } {
  const rpc = pgRpc(db);
  return { store: new AdaptationStore(rpc), services, retryBackoffSeconds: 0, rpc, ...extra };
}

export const fp = fingerprint;

export async function expireLeases(db: PGlite) {
  await db.query("update public.adaptation_jobs set locked_until = now() - interval '1 second' where status = 'processing'");
}

import type { AdaptationReader } from "@/lib/adaptation/orchestration/service";

/** The USER's view of the database: every query runs as `authenticated` under RLS. */
export function readerFor(db: PGlite, user: User): AdaptationReader {
  const q = <T>(sql: string, params: unknown[]) => as(db, "authenticated", user.id, () => db.query<T>(sql, params)).then((r) => r.rows);
  return {
    getMaterial: async (id) => (await q<never>("select id, workspace_id, title, status, analysis, stage_slug, grade_slug, subject_slug from public.materials where id = $1", [id]))[0] ?? null,
    getLearnerProfile: async (id) => (await q<never>("select id, workspace_id, stage_slug, grade_slug, functional_profile from public.learner_profiles where id = $1", [id]))[0] ?? null,
    getAdaptation: async (id) => (await q<never>("select id, workspace_id, material_id, status, current_version, delivered_at from public.adaptations where id = $1", [id]))[0] ?? null,
    getVersion: async (id, version) => (await q<never>(`select id, version, document, review, source, created_at::text from public.adaptation_versions where adaptation_id = $1 ${version === null ? "order by version desc" : "and version = $2"} limit 1`, version === null ? [id] : [id, version]))[0] ?? null,
    getArtifacts: async (id, kinds) => q<never>("select id, kind, input_fingerprint, fingerprint, payload, created_at::text from public.adaptation_artifacts where adaptation_id = $1 and kind = any($2::text[]) order by created_at", [id, kinds as unknown as string[]]),
  };
}
