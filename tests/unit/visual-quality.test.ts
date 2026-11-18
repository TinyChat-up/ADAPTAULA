import { expect, it, vi } from 'vitest';
import { buildDocument, sequentialIds } from '@/lib/adaptation/document';
import { allBlocks } from '@/lib/schemas/material-document';
import { autoTargets } from '@/lib/materials/visuals/auto/service';
import { resolveMagicVisuals } from '@/lib/materials/visuals/auto/policy';
import { pondCase } from '../support/pond-plan';

it('un visual usado por una actividad no se elimina como decoración', () => {
  const c = pondCase();
  c.analysis.visuals[1]!.role = 'decorative';
  c.context.presentation.decoration = 'none';
  const doc = buildDocument({ analysis: c.analysis, plan: c.plan, context: c.context, generated: c.generation.segments, newBlockId: sequentialIds() });
  expect(allBlocks(doc).some(b => b.type === 'image' && b.source.kind === 'original' && b.source.visual_ref === 'vis_2')).toBe(true);
  expect(autoTargets(c.analysis).some(v => v.id === 'vis_2')).toBe(true);
});

it('la decoración sin uso se omite; la imagen informativa se conserva incluso sin actividad', () => {
  const c = pondCase();
  c.analysis.visuals.push({ ...c.analysis.visuals[1]!, id: 'vis_4', role: 'informative', activity_ids: [] }, { ...c.analysis.visuals[1]!, id: 'vis_5', role: 'decorative', activity_ids: [] });
  c.context.presentation.decoration = 'none';
  const doc = buildDocument({ analysis: c.analysis, plan: c.plan, context: c.context, generated: c.generation.segments, newBlockId: sequentialIds() });
  const refs = allBlocks(doc).flatMap(b => b.type === 'image' && b.source.kind === 'original' ? [b.source.visual_ref] : []);
  expect(refs).toContain('vis_4'); expect(refs).not.toContain('vis_5');
});

it.each(['disabled', 'not_offered', 'plan', 'quota', 'service'] as const)('registra la puerta %s sin fingir un intento de imagen', async reason => {
  const c = pondCase();
  const plan = await resolveMagicVisuals({ readyOriginals: async () => new Set(['vis_2']), illustrationsWithheld: reason }, { analysis: c.analysis, document: c.document, requiredVisuals: ['vis_2'], stage: 'primaria', functionalNeeds: ['visual_support'], visualSupports: true });
  expect(plan.illustrationsWithheld).toBe(reason);
  const scene = plan.needs.find(n => n.contract?.reason === 'teacher_requested_context_support');
  expect(scene?.resolution).toEqual({ action: 'omit', reason: `illustration_withheld_${reason}` });
  expect(scene?.attempts).not.toContain('illustrate');
});

it('reutiliza el original listo sin llamar al ilustrador para reemplazarlo', async () => {
  const c = pondCase(), illustrate = vi.fn();
  const plan = await resolveMagicVisuals({ readyOriginals: async () => new Set(['vis_2']), illustrate }, { analysis: c.analysis, document: c.document, requiredVisuals: ['vis_2'], stage: 'primaria' });
  expect(plan.needs.find(n => n.key === 'vis_2')?.resolution).toEqual({ action: 'located' });
  expect(illustrate).not.toHaveBeenCalled();
});

it('pedir que se escriba la operación no duplica la operación del estanque', async () => {
  const { operationsOf } = await import('@/lib/adaptation/answer-space');
  const c = pondCase(), activity = c.analysis.activities.find(a => a.label === '4a')!;
  expect(operationsOf(activity)).toBe(1);
  expect(operationsOf({ ...activity, instruction: 'Calcula 30 − 18 y 15 + 2. Escribe la operación.' })).toBe(2);
});
