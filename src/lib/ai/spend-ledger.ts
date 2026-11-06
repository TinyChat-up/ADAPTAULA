import "server-only";
import { logger } from "@/lib/logger";
import { serverEnv } from "@/lib/config/env.server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createSpendMeter, type SpendLedger, type SpendMeter } from "./spend";

/**
 * The pilot's spend ledger over the database (migration 035, ADR-046): admissions serialised by a lock per campaign, service role
 * only. Active only where AI_PILOT_BUDGET_USD is set and the deployment is NOT production: a budget copied into production by
 * mistake must never stop real users, so there it is ignored (and said in the log).
 */
let warned = false;

export function pilotSpendMeter(): SpendMeter | undefined {
  const env = serverEnv();
  if (!env.AI_PILOT_BUDGET_USD) return undefined;
  if (process.env.VERCEL_ENV === "production") {
    if (!warned) logger.warn("ai_spend_ignored_in_production", { campaign: env.AI_PILOT_CAMPAIGN });
    warned = true;
    return undefined;
  }
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
