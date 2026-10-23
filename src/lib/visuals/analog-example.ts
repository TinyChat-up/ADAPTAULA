import { z } from 'zod';
import { fractionText, sameValue, type Fraction } from './spec';
import type { Block } from '@/lib/schemas/material-document';

const Proper = z.object({ n: z.number().int().min(0).max(12), d: z.number().int().min(2).max(12) }).refine(f => f.n <= f.d);
const Calculation = z.object({ left: Proper, right: Proper, operation: z.enum(['add', 'subtract']) }).refine(c => c.left.d === c.right.d);
export const AnalogFractionInput = z.object({ exercise: Calculation, example: Calculation }).superRefine((x, ctx) => {
  if (x.exercise.operation !== x.example.operation) ctx.addIssue({ code: 'custom', message: 'El ejemplo debe enseñar la misma operación.' });
  const result = (c: z.infer<typeof Calculation>): Fraction => ({ n: c.operation === 'add' ? c.left.n + c.right.n : c.left.n - c.right.n, d: c.left.d });
  for (const c of [x.exercise, x.example]) {
    const r = result(c);
    if (r.n < 0 || r.n > r.d) ctx.addIssue({ code: 'custom', message: 'Solo fracciones propias y resultado no negativo en este piloto.' });
  }
  // Changing spelling (2/4 instead of 1/2) is not changing the data; an equal result can also give the evaluated answer away.
  const original = [x.exercise.left, x.exercise.right, result(x.exercise)];
  if ([x.example.left, x.example.right, result(x.example)].some(f => original.some(o => sameValue(f, o)))) ctx.addIssue({ code: 'custom', message: 'Los datos y el resultado del ejemplo deben ser distintos de los evaluados.' });
});

/** Narrow pilot capability: explicitly supplied structured data, never parsed from a model's drawing or selected by profile intensity. */
export function analogFractionBlocks(input: unknown, ids: { example: string; figure: string; activityRef: string }): Block[] {
  const { example: c } = AnalogFractionInput.parse(input);
  const n = c.operation === 'add' ? c.left.n + c.right.n : c.left.n - c.right.n;
  const operator = c.operation === 'add' ? '+' : '−';
  const trace = { origin: 'support' as const, source_refs: [ids.activityRef], decision_ids: [] };
  return [
    { id: ids.example, type: 'worked_example', title: 'Ejemplo resuelto · otros datos', problem: `${fractionText(c.left)} ${operator} ${fractionText(c.right)}`, steps: [`Las partes tienen el mismo tamaño: conservamos el denominador ${c.left.d}.`, `${c.left.n} ${operator} ${c.right.n} = ${n}.`], result: `${n}/${c.left.d}`, trace },
    { id: ids.figure, type: 'image', caption: 'Resultado del ejemplo, no del ejercicio', alt_text: 'Representación del resultado del ejemplo resuelto.', source: { kind: 'figure', example_ref: ids.example, provenance: 'generated', spec: { spec_version: 1, kind: 'fraction_bar', parts: c.left.d, shaded: Array.from({ length: n }, (_, i) => i) } }, trace },
  ];
}
