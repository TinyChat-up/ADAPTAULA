import { z } from "zod";
import { CRITERIA, SUPPORT_KINDS, type AdaptedSheet } from "./contract";

/**
 * Deliberate pedagogical errors injected into a correct candidate (adversarial test data, Phase III). Some of them have to write
 * a known answer into the sheet (a leak cannot be simulated otherwise); that is the point of the test, never a generation path.
 * A mutation is declarative so the external corpus can describe its own in JSON.
 */

export const ERROR_TYPES = ["cambio_dato", "unidad_cambiada", "relacion_cambiada", "respuesta_revelada", "operacion_dada", "actividad_omitida", "actividad_duplicada",
  "consignas_mezcladas", "objetivo_cambiado", "etiquetas_confundidas", "figura_sustituida", "figura_resuelta", "figura_reasignada", "sobresimplificacion",
  "texto_recortado", "orden_cambiado"] as const;

const Target = z.enum(["instruction", "content"]);
export const MutationOpSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("replace"), activity: z.string(), target: Target, find: z.string().min(1), replace: z.string() }),
  z.object({ op: z.literal("set_text"), activity: z.string(), target: Target, value: z.string().min(1) }),
  z.object({ op: z.literal("replace_source"), textId: z.string(), find: z.string().min(1), replace: z.string() }),
  z.object({ op: z.literal("add_support"), activity: z.string(), kind: z.enum(SUPPORT_KINDS), text: z.string().min(1), addresses: z.array(z.string()).default([]) }),
  z.object({ op: z.literal("drop_activity"), activity: z.string() }),
  z.object({ op: z.literal("duplicate_activity"), activity: z.string() }),
  z.object({ op: z.literal("merge_activities"), activities: z.array(z.string()).length(2), instruction: z.string().min(3) }),
  z.object({ op: z.literal("set_figure_fact"), figure: z.string(), key: z.string(), value: z.union([z.string(), z.number(), z.boolean()]) }),
  z.object({ op: z.literal("swap_figure_facts"), figure: z.string(), keys: z.array(z.string()).length(2) }),
  z.object({ op: z.literal("set_figure_kind"), figure: z.string(), kind: z.string() }),
  z.object({ op: z.literal("set_figure_activities"), figure: z.string(), activityIds: z.array(z.string()).min(1) }),
]);
export type MutationOp = z.infer<typeof MutationOpSchema>;

export const MutationSpecSchema = z.object({
  id: z.string().regex(/^[a-z0-9_]{1,60}$/),
  errorType: z.enum(ERROR_TYPES),
  description: z.string().max(300),
  /**
   * Whether the error is mechanically verifiable (the run counts it as detected only with a FAIL on `expect`). A non-verifiable
   * error is kept to measure honestly what is NOT detected yet: it must at least never come out better than NEEDS_TEACHER_REVIEW.
   */
  verifiable: z.boolean(),
  expect: z.object({ criterion: z.enum(CRITERIA), check: z.string() }).nullable(),
  ops: z.array(MutationOpSchema).min(1),
});
export type MutationSpec = z.infer<typeof MutationSpecSchema>;

const clone = (s: AdaptedSheet): AdaptedSheet => structuredClone(s);

function covering(sheet: AdaptedSheet, id: string) {
  const a = sheet.activities.find((x) => x.sourceIds.includes(id));
  if (!a) throw new Error(`mutación sobre una actividad inexistente: ${id}`);
  return a;
}
function figure(sheet: AdaptedSheet, id: string) {
  const f = sheet.figures.find((x) => x.id === id);
  if (!f) throw new Error(`mutación sobre una figura inexistente: ${id}`);
  return f;
}

/** Applies the ops in order. A `find` that does not match is an authoring error, not a silent no-op. */
export function applyMutation(base: AdaptedSheet, spec: MutationSpec): AdaptedSheet {
  const sheet = clone(base);
  sheet.producedBy = `${base.producedBy}+mutacion:${spec.id}`;
  for (const op of spec.ops) {
    switch (op.op) {
      case "replace": {
        const a = covering(sheet, op.activity);
        if (!a[op.target].includes(op.find)) throw new Error(`${spec.id}: «${op.find}» no está en ${op.activity}.${op.target}`);
        a[op.target] = a[op.target].replace(op.find, op.replace);
        break;
      }
      case "set_text": covering(sheet, op.activity)[op.target] = op.value; break;
      case "replace_source": {
        const t = sheet.sourceTexts.find((x) => x.id === op.textId);
        if (!t || !t.text.includes(op.find)) throw new Error(`${spec.id}: «${op.find.slice(0, 30)}» no está en ${op.textId}`);
        t.text = t.text.replace(op.find, op.replace);
        break;
      }
      case "add_support": covering(sheet, op.activity).supports.push({ kind: op.kind, text: op.text, addresses: [...op.addresses] }); break;
      case "drop_activity": sheet.activities = sheet.activities.filter((a) => !a.sourceIds.includes(op.activity)); break;
      case "duplicate_activity": {
        const i = sheet.activities.findIndex((a) => a.sourceIds.includes(op.activity));
        if (i < 0) throw new Error(`${spec.id}: ${op.activity} no existe`);
        sheet.activities.splice(i + 1, 0, structuredClone(sheet.activities[i]!));
        break;
      }
      case "merge_activities": {
        const [x, y] = op.activities.map((id) => covering(sheet, id));
        const merged = { ...x!, sourceIds: [...x!.sourceIds, ...y!.sourceIds], instruction: op.instruction, content: [x!.content, y!.content].filter(Boolean).join("\n"),
          operations: [...new Set([...x!.operations, ...y!.operations])], supports: [...x!.supports, ...y!.supports] };
        sheet.activities = sheet.activities.flatMap((a) => (a === x ? [merged] : a === y ? [] : [a]));
        break;
      }
      case "set_figure_fact": figure(sheet, op.figure).facts[op.key] = op.value; break;
      case "swap_figure_facts": {
        const f = figure(sheet, op.figure);
        const [k1, k2] = op.keys as [string, string];
        [f.facts[k1], f.facts[k2]] = [f.facts[k2]!, f.facts[k1]!];
        break;
      }
      case "set_figure_kind": figure(sheet, op.figure).kind = op.kind; break;
      case "set_figure_activities": figure(sheet, op.figure).activityIds = [...op.activityIds]; break;
    }
  }
  return sheet;
}
