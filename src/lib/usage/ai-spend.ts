import "server-only";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Internal economic summary of one workspace over a period: what was SPENT on AI (every recorded call, including failed ones
 * and those whose quota unit was given back), apart from what the plan counts. Built on `ai_runs` by `ai_spend_summary`
 * (migration 018, service role only). It carries ids, purposes, tokens, costs and counts: never content, aliases, learner
 * data, prompts or answers. Not shown to teachers.
 */

const Money = z.coerce.number();
const Count = z.coerce.number().int().nonnegative();

export const AiSpendSummarySchema = z.object({
  workspace_id: z.uuid(),
  from: z.string(),
  to: z.string(),
  ai_cost_total: Money,
  analysis_cost: Money,
  planner_cost: Money,
  generator_cost: Money,
  reviewer_cost: Money,
  successful_ai_runs: Count,
  failed_ai_runs: Count,
  /** Calls with tokens but no known price: the totals are a lower bound when this is above 0. */
  unpriced_ai_runs: Count,
  input_tokens: Count,
  output_tokens: Count,
  cached_input_tokens: Count,
  cache_creation_input_tokens: Count,
  /** Analysis jobs and adaptations that made at least one AI call in the period (attempted, delivered or not). */
  analysis_count: Count,
  adaptation_count: Count,
  avg_cost_per_analysis: Money.nullable(),
  avg_cost_per_adaptation: Money.nullable(),
  by_purpose: z.record(z.string(), z.object({ cost: Money, runs: Count, successful: Count, failed: Count })),
  /** Adaptations CREATED in the period per creation mode (migration 019: `automatic` = «Hacer magia», `review`), and how many are ready / blocked now. */
  by_creation_mode: z.record(z.string(), z.object({ adaptations: Count, ready: Count, blocked: Count })).default({}),
  /** AI spend of the period (plan + generate + review) per creation mode, and the adaptations it belongs to. */
  cost_by_creation_mode: z.record(z.string(), z.object({ cost: Money, adaptations: Count })).default({}),
});
export type AiSpendSummary = z.infer<typeof AiSpendSummarySchema>;

interface RpcClient {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

export async function fetchAiSpendSummary(client: RpcClient, workspaceId: string, period: { from: Date; to: Date }): Promise<AiSpendSummary> {
  const { data, error } = await client.rpc("ai_spend_summary", { p_workspace: workspaceId, p_from: period.from.toISOString(), p_to: period.to.toISOString() });
  if (error) throw new Error(`ai_spend_summary: ${error.message.slice(0, 120)}`);
  return AiSpendSummarySchema.parse(data);
}

/** Server-side entry point (service role). For internal reports and the pricing work; never for a teacher-facing screen. */
export const aiSpendSummary = (workspaceId: string, period: { from: Date; to: Date }) =>
  fetchAiSpendSummary(createAdminClient() as unknown as RpcClient, workspaceId, period);
