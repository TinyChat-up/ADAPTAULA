import "server-only";
import { logger } from "@/lib/logger";
import { serverEnv } from "@/lib/config/env.server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createSpendMeter, type SpendLedger, type SpendMeter } from "./spend";

/**
 * The pilot's spend ledger over the database (migration 035, ADR-046): admissions serialised by a lock per campaign, service role
 * only. Metered per WORKSPACE (ADR-047): only the authorised pilot workspace (AI_PLANNER_V3_PILOT_WORKSPACE_ID) with a budget
 * (AI_PILOT_BUDGET_USD) goes through the ledger, on any deployment, so a budget can never stop another workspace's calls.
 */

export function pilotSpendMeter(workspaceId: string | null | undefined): SpendMeter | undefined {
  const env = serverEnv();
  if (!env.AI_PILOT_BUDGET_USD || !env.AI_PLANNER_V3_PILOT_WORKSPACE_ID) return undefined;
  // Only the authorised pilot workspace is metered (ADR-047): every other workspace's calls never see the ledger, so a budget
  // can never stop a real user. A call with no known workspace is not metered either.
  if (!workspaceId || workspaceId !== env.AI_PLANNER_V3_PILOT_WORKSPACE_ID) return undefined;
  const campaign = env.AI_PILOT_CAMPAIGN;
  const budget = env.AI_PILOT_BUDGET_USD;
  const ledger: SpendLedger = {
    async admit(row) {
      const { data, error } = await createAdminClient().rpc("ai_spend_admit", {
        p_campaign: campaign,
        p_budget_usd: budget,
        p_provider: row.provider,
        p_model: row.model,
        p_counted_input_tokens: row.countedInputTokens,
        p_max_output_tokens: row.maxOutputTokens,
        p_reserved_usd: row.reservedUsd,
      });
      if (error) throw new Error(`ai_spend_admit: ${error.message.slice(0, 120)}`);
      const first = (Array.isArray(data) ? data[0] : data) as { reservation_id: string | null; committed_usd: number | string } | undefined;
      if (!first) throw new Error("ai_spend_admit: empty answer");
      return { id: first.reservation_id, committedUsd: Number(first.committed_usd) };
    },
    async settle(id, settledUsd) {
      const { error } = await createAdminClient().rpc("ai_spend_settle", { p_reservation: id, p_settled_usd: settledUsd });
      if (error) throw new Error(`ai_spend_settle: ${error.message.slice(0, 120)}`);
    },
  };
  return createSpendMeter(ledger, (reason, detail) => logger.warn("ai_spend_refused", { campaign, reason, committedUsd: detail.committedUsd ?? null, reservedUsd: detail.reservedUsd ?? null }));
}
