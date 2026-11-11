import type { PlanValidation } from "@/lib/schemas/adaptation-plan";
import type { DecisionLedger } from "@/lib/schemas/decision-ledger";
import type { FunctionalProfile } from "@/lib/schemas/functional-profile";
import type { OmittedNeed } from "../context";
import type { PlannerDeclarations } from "../plan-v3";
import { buildDecisionLedger } from "../decision-ledger";
import { runV22Checks, type V22Finding, type V22Input } from "./checks";

/**
 * The V2.2 audit of one adaptation: the decision ledger fed with the V2.2 checks (ADR-044). Pure, server-side, and advisory: it
 * reads the plan, its validation, the context, the analysis and (when it exists) the assembled sheet, and changes none of them.
 */
export interface V22AuditInput extends V22Input {
  validation: PlanValidation;
  omitted?: readonly OmittedNeed[];
  profile?: Pick<FunctionalProfile, "supports">;
  /** Planner v3 only. Pass the RAW plan with them: a withheld decision is still part of what the teacher must see. */
  declarations?: PlannerDeclarations | null;
}

export interface V22AuditResult {
  ledger: DecisionLedger;
  findings: V22Finding[];
  not_checked: string[];
}

export function auditAdaptation(input: V22AuditInput): V22AuditResult {
  const checks = runV22Checks(input);
  const ledger = buildDecisionLedger({ ...input, hintFindings: checks.hintFindings, overLimit: checks.overLimit });
  return { ledger, findings: checks.findings, not_checked: checks.not_checked };
}
