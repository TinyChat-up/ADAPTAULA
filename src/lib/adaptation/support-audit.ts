import type { AdaptationContext } from "@/lib/schemas/adaptation-context";
import type { AdaptationPlan } from "@/lib/schemas/adaptation-plan";
import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";
import type { MaterialDocument } from "@/lib/schemas/material-document";
import { assessSupports, type FindingAction, type FindingEvidence, type SupportCleared, type SupportFindingCode } from "./assessment-safety";

/**
 * support_audit@v2 (SHADOW MODE): the record of what `assessSupports` (assessment-safety.ts, the single home of the rule) found in a
 * generated sheet, with the needs that motivated each support. It never blocks, never changes the document, is never shown and
 * asks the teacher nothing: it is stored next to the deterministic review (codes, block/activity/decision ids and counts; no
 * wording of the material and no answer) so that the precision of every finding can be measured before any of them may act.
 * The one finding that does block (`defines_listed_categories`) blocks in the generation audit, as it always has; here it is only
 * recorded. Pure and deterministic.
 */

export const SUPPORT_AUDIT_VERSION = "support_audit@v2";

export interface SupportWarning {
  code: SupportFindingCode;
  evidence: FindingEvidence;
  action: FindingAction;
  block_id: string;
  activity_id: string;
  decision_ids: string[];
  /** Every need the support answers is a LOW one: a minor need drove a support that touches what is evaluated. */
  low_need_only: boolean;
}

export interface SupportAudit {
  version: typeof SUPPORT_AUDIT_VERSION;
  mode: "shadow";
  supports_checked: number;
  warnings: SupportWarning[];
  /** Supports that look like a finding but are legitimate (a criterion card to apply knowledge) or a mere coincidence. */
  cleared: Array<{ block_id: string; activity_id: string; class: SupportCleared }>;
}

export interface SupportAuditInput {
  analysis: MaterialAnalysis;
  plan: Pick<AdaptationPlan, "decisions">;
  context: Pick<AdaptationContext, "needs">;
  document: MaterialDocument;
}

export function auditSupports({ analysis, plan, context, document }: SupportAuditInput): SupportAudit {
  const level = new Map(context.needs.map((n) => [n.dimension, n.level] as const));
  const { findings, cleared, supports_checked } = assessSupports(analysis, document);
  const lowOnly = (decisionIds: readonly string[]) => {
    const dimensions = plan.decisions.filter((d) => decisionIds.includes(d.id)).flatMap((d) => d.dimensions);
    return dimensions.length > 0 && dimensions.every((dim) => level.get(dim) === "low");
  };
  return {
    version: SUPPORT_AUDIT_VERSION,
    mode: "shadow",
    supports_checked,
    warnings: findings.map((f) => ({ ...f, low_need_only: lowOnly(f.decision_ids) })),
    cleared,
  };
}
