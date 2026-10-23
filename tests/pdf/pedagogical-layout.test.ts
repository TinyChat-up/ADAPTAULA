import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { measureLayout } from './layout-measurements';
import { expect, it } from 'vitest';
import { layoutModel } from '../support/pedagogical-layout';
import { printPdf, OUT_DIR } from './harness';

it('fracciones: el problema, su ejemplo y comprobación caben juntos; campos y recta completos', async () => {
  const { model, validation } = layoutModel(4);
  expect(validation.status).not.toBe('not_renderable');
  const printed = await printPdf('layout64-fracciones', model);
  const layout = await measureLayout(printed.print.html);
  expect(layout.grids.map(g => g.heightMm)).toEqual([49]);
  expect(layout.grids[0]!.cellMm).toBe(7);
  expect(layout.activities).toBe(5);
  expect(layout.fields.map(f => f.label)).toEqual(['Fracción:', 'Datos y razonamiento:', 'Operaciones:', 'Respuesta:']);
  expect(layout.writingLinesMm.every(mm => mm >= 9.9)).toBe(true);
  const texts = printed.pages.map(p => p.body.replace(/\s+/g, ''));
  mkdirSync(path.join(OUT_DIR, 'layout64-fracciones'), { recursive: true });
  writeFileSync(path.join(OUT_DIR, 'layout64-fracciones', 'report.json'), JSON.stringify({ pages: texts.length, texts, layout }, null, 2));
  const problem = texts.findIndex(t => t.includes('Quedan3/4deunacinta'));
  expect(problem).toBeGreaterThanOrEqual(0);
  expect(texts[problem]).toContain('Respuest');
  expect(texts[problem]).toContain('EJEMPLODISTINTO');
  expect(texts[problem]).toContain('COMPRUEBAELPROBLEMA');
  expect(texts.join('').replace(/\s+/g, '')).toContain('Fracción:');
  expect(texts.at(-1)).toContain('Enlarecta');
  expect(texts.at(-1)).toContain('Explicaporqué');
  expect(texts.join('')).toContain('3/4');
  expect(printed.validation.issues).toEqual([]);
});


it('espacio motriz prioritario y grises: no se recortan zonas ni contenido', async () => {
  const { model } = layoutModel(4, true);
  model.tokens.contrast = 'high';
  const printed = await printPdf('layout64-motriz-grises', model);
  const layout = await measureLayout(printed.print.html);
  expect(layout.grids.map(g => g.heightMm)).toEqual([59.5]);
  expect(layout.writingLinesMm.every(mm => mm >= 11.9)).toBe(true);
  expect(layout.activities).toBe(5);
  expect(printed.validation.issues).toEqual([]);
  expect(printed.pages.map(p => p.text).join('').replace(/\s+/g, '')).toContain('Fracción:');
  for (const page of printed.pages) {
    const img = await loadImage(page.png);
    const canvas = createCanvas(img.width, img.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const pixels = ctx.getImageData(0, 0, img.width, img.height);
    for (let i = 0; i < pixels.data.length; i += 4) {
      const grey = Math.round(.299 * pixels.data[i]! + .587 * pixels.data[i+1]! + .114 * pixels.data[i+2]!);
      pixels.data[i] = pixels.data[i+1] = pixels.data[i+2] = grey;
    }
    ctx.putImageData(pixels, 0, 0);
    writeFileSync(path.join(OUT_DIR, 'layout64-motriz-grises', `grises-${page.number}.png`), await canvas.encode('png'));
  }
});
