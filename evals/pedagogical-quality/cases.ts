import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { AdaptationPlanSchema } from "./adapter";
import { OriginalSheetSchema, ReferenceSheetSchema } from "./contract";
import { MutationSpecSchema } from "./mutations";

/**
 * One evaluation case: the transcription of an original sheet, its scoring reference, the plans of the correct candidates
 * (controlled adapter) and the deliberate errors applied on top of `mutationBase`.
 */
export const CaseSchema = z.object({
  original: OriginalSheetSchema,
  reference: ReferenceSheetSchema,
  plans: z.array(AdaptationPlanSchema).min(1),
  mutationBase: z.string(),
  mutations: z.array(MutationSpecSchema),
}).superRefine((c, ctx) => {
  if (c.original.id !== c.reference.id) ctx.addIssue({ code: "custom", message: "original y referencia no coinciden" });
  if (!c.plans.some((p) => p.id === c.mutationBase)) ctx.addIssue({ code: "custom", message: `mutationBase ${c.mutationBase} no es un plan` });
  const ids = c.original.activities.map((a) => a.id).join();
  if (ids !== c.reference.activities.map((a) => a.id).join()) ctx.addIssue({ code: "custom", message: "las actividades del original y de la referencia no coinciden" });
});
export type Case = z.infer<typeof CaseSchema>;

/** External corpus: one folder per sheet with a `case.json` (outside Git). */
export function loadCorpus(dir: string): Case[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(dir, d.name, "case.json")))
    .map((d) => d.name)
    .sort()
    .map((name) => {
      const parsed = CaseSchema.safeParse(JSON.parse(readFileSync(join(dir, name, "case.json"), "utf8")));
      if (!parsed.success) throw new Error(`${name}/case.json no es válido: ${parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
      return parsed.data;
    });
}
