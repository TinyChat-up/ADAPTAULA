import { buildDocument, sequentialIds } from '@/lib/adaptation/document';
import { normalizePlan } from '@/lib/adaptation/plan';
import { buildRenderModel } from '@/lib/render/model';
import type { Block } from '@/lib/schemas/material-document';
import { galleryAnalysis, galleryContext, type GallerySheet } from './editorial-gallery';

/** Own synthetic material, not a reconstruction of the private worksheet reported in #64. */
export const FRACTIONS_LAYOUT: GallerySheet = {
  id: 'fracciones-64', label: 'Fracciones 4.º', demand: 'campos breves, comparación, problema, recta y explicación',
  profile: { schema_version: 1, supports: { operation_steps: 'medium' }, limits: {}, allowances: {} },
  profileLabel: 'pasos en matemáticas',
  input: {
    title: 'Fracciones · práctica sintética', grade: '4-primaria', subject: 'matematicas', subjectName: 'Matemáticas',
    activities: [
      { id: 'a1', type: 'short_answer', instruction: 'Escribe la fracción que representa tres de ocho partes.\nFracción: ____', context: 'Todas las partes tienen el mismo tamaño.', response: 'write_number', answer_area: 'line', answer_lines: 1 },
      { id: 'a2', type: 'calculation', instruction: 'Escribe >, < o = en cada hueco.', context: '1/4 ___ 3/4\n2/6 ___ 1/6', response: 'write_number', answer_area: 'line' },
      { id: 'a3', type: 'problem_solving', instruction: 'Quedan 3 / 4 de una cinta. Se usa 1 / 4 de la cinta. ¿Qué fracción queda?', response: 'calculate', answer_area: 'lines', answer_lines: 2 },
      { id: 'a4', type: 'short_answer', instruction: 'En la recta, marca la posición de 1/2.', response: 'mark', answer_area: 'none' },
      { id: 'a5', type: 'open_question', instruction: 'Explica por qué dos fracciones pueden representar la misma cantidad.', response: 'write_text', answer_area: 'lines', answer_lines: 3 },
    ],
  },
};
export function layoutDocument(max: number | null = null, roomy = false) {
  const analysis = galleryAnalysis(FRACTIONS_LAYOUT);
  const context = galleryContext(FRACTIONS_LAYOUT, analysis);
  context.presentation.max_tasks_per_page = max;
  if (roomy) context.presentation.answer_space = 'roomy';
  const document = buildDocument({ analysis, context, plan: normalizePlan({ decisions: [], summary: [] }, analysis, context), generated: null, newBlockId: sequentialIds('layout') });
  const trace = { origin: 'support' as const, source_refs: ['act_3'], decision_ids: [] };
  for (const page of document.pages) {
    const at = page.blocks.findIndex(b => b.type === 'activity' && b.label === '3');
    if (at >= 0) {
      page.blocks.splice(at, 0, { id: 'blk_example64', type: 'worked_example', title: 'Ejemplo distinto', problem: 'De cinco partes iguales quedan cuatro y se usa una.', steps: ['Mantén el tamaño de las partes.', 'Resta las partes utilizadas.'], result: 'Quedan tres de las cinco partes.', trace });
      page.blocks.splice(at + 2, 0, { id: 'blk_reminder64', type: 'help_box', variant: 'reminder', text: 'Comprueba que las partes tienen el mismo tamaño.', trace }, { id: 'blk_check64', type: 'checklist', title: 'Comprueba el problema', items: ['He conservado el tamaño de las partes.'], trace });
    }
    const line = page.blocks.find(b => b.type === 'activity' && b.label === '4');
    if (line?.type === 'activity') {
      const figure: Block = { id: 'blk_line64', type: 'image', source: { kind: 'original', visual_ref: 'vis_1' }, alt_text: 'Recta de cero a uno', trace: { origin: 'original', source_refs: ['vis_1'], decision_ids: [] } };
      page.blocks.splice(page.blocks.indexOf(line), 0, figure);
      line.resource_block_ids = [figure.id];
      line.response = { kind: 'none' };
    }
  }
  return document;
}
export function layoutModel(max: number | null = null, roomy = false) {
  return buildRenderModel(layoutDocument(max, roomy), { mode: 'student', deferred: [], subjectLabel: 'Matemáticas', figures: { vis_1: { spec_version: 1, kind: 'number_line', start: { n: 0, d: 1 }, end: { n: 1, d: 1 }, divisions: 4, labels: [{ tick: 0, text: '0' }, { tick: 1, text: '1/4' }, { tick: 2, text: '1/2' }, { tick: 3, text: '3/4' }, { tick: 4, text: '1' }] } } });
}
