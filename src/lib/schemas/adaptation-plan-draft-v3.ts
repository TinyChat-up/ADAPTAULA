import { z } from "zod";
import { CaseIdSchema } from "@/lib/agent-rules/types";
import { DraftDecisionV2Schema, NeedRefSchema } from "./adaptation-plan-draft-v2";
import { HINT_QUESTIONS } from "./decision-ledger";

/**
 * DraftAdaptationPlan v3: what `adaptation_planner@v3` writes when it decides with the private V2.2 method (ADR-045). It is the v2
 * draft plus what the method asks the planner to DECLARE for each decision. The canonical plan is still `AdaptationPlan v1`: the
 * declarations travel beside it (`adaptation/plan-v3.ts`) and the server never takes them as proof of anything:
 *  - `status`: `conditional` when the decision depends on a teacher's answer or on means that are not stated. It is never applied
 *    automatically; it needs its `question`;
 *  - `hint_yes`: the hint questions the planner answers «yes» for a presentation, visual or answer-space resource. Required (an
 *    empty list is an answer) for those resources. A «yes» withholds the decision for the teacher; a «no» proves nothing;
 *  - `precedents`: the library cases the decision follows, which must be among the ones sent with the request;
 *  - plan level: the questions for the teacher and the residual barriers the planner leaves on purpose.
 */

export const DRAFT_PLAN_V3_VERSION = 3;

export const QuestionRefSchema = z.string().regex(/^q_[0-9]{1,2}$/, "Referencia a una pregunta no válida");
const ActivityRef = z.string().regex(/^act_[0-9]{1,4}$/);

/** Actions that add or change a presentation, visual or answer-space resource (same set as the ledger's hint test). */
export const RESOURCE_ACTIONS_V3 = ["segment", "reorganize", "add_support", "change_response_format"] as const;

export const DraftDecisionV3Schema = DraftDecisionV2Schema.extend({
  status: z.enum(["active", "conditional"]),
  question: QuestionRefSchema.optional(),
  hint_yes: z.array(z.enum(HINT_QUESTIONS)).max(8).optional(),
  precedents: z.array(CaseIdSchema).max(6).optional(),
});
export type DraftDecisionV3 = z.infer<typeof DraftDecisionV3Schema>;

export const TeacherQuestionSchema = z.object({ id: QuestionRefSchema, text: z.string().trim().min(1).max(200) });

export const DeclaredBarrierSchema = z.object({
  target: ActivityRef,
  need_refs: z.array(NeedRefSchema).min(1).max(4),
  note: z.string().trim().min(1).max(160),
});

export const DraftAdaptationPlanV3Schema = z
  .object({
    decisions: z.array(DraftDecisionV3Schema).max(30),
    summary: z.array(z.string().trim().min(1).max(160)).max(5),
    teacher_questions: z.array(TeacherQuestionSchema).max(8).optional(),
    residual_barriers: z.array(DeclaredBarrierSchema).max(20).optional(),
  })
  .superRefine((plan, ctx) => {
    const questions = new Set<string>();
    (plan.teacher_questions ?? []).forEach((q, i) => {
      if (questions.has(q.id)) ctx.addIssue({ code: "custom", path: ["teacher_questions", i, "id"], message: `Pregunta duplicada: ${q.id}` });
      questions.add(q.id);
    });
    plan.decisions.forEach((d, i) => {
      const resource = (RESOURCE_ACTIONS_V3 as readonly string[]).includes(d.action) || d.visual !== undefined;
      if (resource && d.hint_yes === undefined) ctx.addIssue({ code: "custom", path: ["decisions", i, "hint_yes"], message: "Un recurso de presentación, visual o de espacio necesita la prueba de pista (lista vacía si todas son «no»)" });
      if (d.status === "conditional" && !d.question) ctx.addIssue({ code: "custom", path: ["decisions", i, "question"], message: "Una decisión condicionada necesita su pregunta al docente" });
      if (d.question && !questions.has(d.question)) ctx.addIssue({ code: "custom", path: ["decisions", i, "question"], message: `La pregunta ${d.question} no está en teacher_questions` });
    });
  });
export type DraftAdaptationPlanV3 = z.infer<typeof DraftAdaptationPlanV3Schema>;
