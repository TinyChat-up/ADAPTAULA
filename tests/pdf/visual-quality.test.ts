import { createHash } from 'node:crypto';
import { createCanvas } from '@napi-rs/canvas';
import { chromium } from 'playwright-core';
import { expect, it } from 'vitest';
import { buildRenderModel } from '@/lib/render/model';
import { MaterialDocumentSchema } from '@/lib/schemas/material-document';
import { assetRef } from '@/lib/render/print/pinned-assets';
import { printPdf, localChromium } from './harness';

function sheet(blocks: unknown[]) {
  return MaterialDocumentSchema.parse({ schema_version: 1,
    meta: { title: 'Ciencias · demostración sintética', language: 'es', stage: 'primaria', grade: '5-primaria', subject: 'ciencias-naturales', topic: 'Observación' },
    presentation: { font_scale: 1, line_spacing: 'normal', spacing: 'wide', contrast: 'normal', decoration: 'standard', max_tasks_per_page: null, color_independent: true, text_alternatives_for_visuals: true }, admin_fields: [], pages: [{ blocks }], answer_key: [] });
}
const trace = { origin: 'original', source_refs: ['act_1'], decision_ids: [] };
const task = (id: string, lines: number) => ({ id, type: 'activity', prompt: `Observa y justifica tu respuesta (${id}).`, response: { kind: 'lines', lines }, trace });

it('el cierre de revisión acompaña la última actividad corta sin hoja exclusiva', async () => {
  const doc = sheet([task('blk_first', 15), task('blk_last', 4), { id: 'blk_check', type: 'checklist', title: 'Revisión final', items: ['He revisado mis respuestas.', 'He comprobado los datos.'], trace: { origin: 'support', source_refs: [], decision_ids: ['dec_1'] } }]);
  const { model } = buildRenderModel(doc, { mode: 'student', deferred: [] });
  const pdf = await printPdf('quality-closing', model);
  const last = pdf.pages.find(p => p.body.includes('(blk_last)'))!;
  expect(last.body.toLowerCase()).toContain('revisión final');
  expect(pdf.pages.at(-1)!.body).toContain('(blk_last)');
  expect(pdf.validation.issues).toEqual([]);
});

it('un recorte alto conserva proporciones y las cuatro esquinas en pantalla y PDF', async () => {
  const canvas = createCanvas(400, 1200), ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 400, 1200);
  ctx.fillStyle = '#05234b'; ctx.fillRect(20, 80, 360, 1040);
  ctx.fillStyle = '#ff0000';
  for (const x of [0, 380]) for (const y of [0, 1180]) ctx.fillRect(x, y, 20, 20);
  const bytes = await canvas.encode('png');
  const pin = { assetId: '11111111-1111-4111-8111-111111111111', sha256: createHash('sha256').update(bytes).digest('hex'), mime: 'image/png' as const, bytes };
  const doc = sheet([{ id: 'blk_image', type: 'image', source: { kind: 'original', visual_ref: 'vis_1' }, alt_text: 'Esquema sintético con cuatro marcas en sus extremos', trace }, task('blk_last', 2)]);
  const { model } = buildRenderModel(doc, { mode: 'student', deferred: [], requiredVisuals: ['vis_1'], assets: { vis_1: { src: assetRef(pin), widthMm: 100, heightMm: 300 } } });
  model.header = { subject: null, grade: null, fields: [] };
  const pdf = await printPdf('quality-tall-figure', model, [pin], 1);
  const browser = await chromium.launch({ executablePath: localChromium(), args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.route('**/*', r => r.abort());
    await page.setContent(pdf.print.html);
    for (const media of ['screen', 'print'] as const) {
      await page.emulateMedia({ media });
      const dims = await page.locator('img').evaluate(async el => { const img = el as HTMLImageElement; await img.decode(); const r = img.getBoundingClientRect(); return { ratio: r.width / r.height, height: r.height * 25.4 / 96 }; });
      expect(dims.ratio).toBeCloseTo(1 / 3, 2);
      expect(dims.height).toBeLessThanOrEqual(156.7);
    }
  } finally { await browser.close(); }
  const marked = pdf.pages.find(p => p.red)!;
  expect(marked.red).not.toBeNull();
  expect((marked.red!.right - marked.red!.left) / (marked.red!.bottom - marked.red!.top)).toBeCloseTo(1 / 3, 1);
  expect(pdf.validation.issues).toEqual([]);
});

it('el vocabulario no queda aislado al pasar su actividad a otra hoja', async () => {
  const doc = sheet([task('blk_first', 2), { id: 'blk_vocabulary', type: 'vocabulary', items: [{ term: 'Orilla', definition: 'Borde del estanque.' }], trace: { origin: 'support', source_refs: ['act_2'], decision_ids: ['dec_2'] } }, { ...task('blk_second', 2), trace: { ...trace, source_refs: ['act_2'] } }]);
  doc.presentation.max_tasks_per_page = 1;
  const { model } = buildRenderModel(doc, { mode: 'student', deferred: [] });
  const pdf = await printPdf('quality-vocabulary', model);
  expect(pdf.pages.find(p => p.body.includes('Orilla'))?.body).toContain('(blk_second)');
  expect(pdf.pages[0]!.body).not.toContain('Orilla');
  expect(pdf.validation.issues).toEqual([]);
});

it('estanque del repositorio: mantiene todos los textos en alto contraste sin aumentar páginas', async () => {
  const { pondModel } = await import('../support/pond-plan');
  const { model } = pondModel();
  model.tokens.contrast = 'high';
  const pdf = await printPdf('quality-pond-high-contrast', model);
  expect(pdf.pages).toHaveLength(5);
  expect(pdf.pages.map(p => p.body).join(' ')).toContain('30 cm de profundidad');
  expect(pdf.pages.map(p => p.body).join(' ')).toContain('18 cm de profundidad');
  expect(pdf.validation.issues).toEqual([]);
});
