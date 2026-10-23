import { describe, expect, it } from 'vitest';
import { buildRenderModel, flatNodes, mapNodes } from '@/lib/render/model';
import { calculationRows, spaceContextOf } from '@/lib/adaptation/answer-space';
import { responseFor, activityPrompt } from '@/lib/adaptation/document';
import { galleryAnalysis, galleryContext } from '../support/editorial-gallery';
import { FRACTIONS_LAYOUT, layoutDocument } from '../support/pedagogical-layout';

describe('issue 64: maquetación sin alterar la tarea', () => {
  it('conserva Fracción como campo, incluso con contexto separado', () => {
    const a = galleryAnalysis(FRACTIONS_LAYOUT).activities[0]!;
    expect(responseFor(a)).toEqual({ kind: 'fields', fields: [{ label: 'Fracción', space: 'lines', lines: 1 }] });
    expect(activityPrompt(a)).not.toContain('Fracción:');
    expect(activityPrompt(a)).toContain('Todas las partes');
  });
  it('una fracción con espacios sigue siendo un dato, no dos números independientes', () => {
    const analysis = galleryAnalysis(FRACTIONS_LAYOUT);
    const context = spaceContextOf(analysis, galleryContext(FRACTIONS_LAYOUT, analysis));
    const a = analysis.activities[2]!;
    expect(calculationRows(a, context)).toBe(7);
    expect(calculationRows({ ...a, instruction: a.instruction.replaceAll(' / ', '/') }, context)).toBe(7);
  });
  it('el ensamblador no deja una quinta actividad sola por contar antes del renderer', () => {
    const document = layoutDocument(4);
    expect(document.pages.map(p => p.blocks.filter(b => b.type === 'activity').length)).toEqual([2, 3]);
  });
});

it('no cuenta dos fracciones sueltas como dos operaciones; sí dos cálculos completos', () => {
  const analysis = galleryAnalysis(FRACTIONS_LAYOUT);
  const context = spaceContextOf(analysis, galleryContext(FRACTIONS_LAYOUT, analysis));
  const a = analysis.activities[2]!;
  expect(calculationRows({ ...a, type: 'calculation', instruction: 'Calcula 3/4 − 1/4.' }, context)).toBe(7);
  expect(calculationRows({ ...a, type: 'calculation', instruction: 'Calcula 3/4 − 1/4 y 2/5 + 1/5.' }, context)).toBe(11);
});

it('conserva los campos distintos de consigna y contexto, sin convertir una frase en etiqueta', () => {
  const a = galleryAnalysis(FRACTIONS_LAYOUT).activities[0]!;
  expect(responseFor({ ...a, context: 'Explicación: ____' })).toMatchObject({ fields: [{ label: 'Fracción' }, { label: 'Explicación' }] });
  expect(activityPrompt({ ...a, instruction: 'Observa la razón: 3/4.' })).toContain('razón: 3/4');
});

it('el perfil mantiene el máximo y el ensamblador no cambia los datos ni el orden', () => {
  const plain = layoutDocument();
  const grouped = layoutDocument(4);
  const content = (d: typeof plain) => d.pages.flatMap(p => p.blocks);
  expect(content(grouped)).toEqual(content(plain));
  expect(grouped.pages.every(p => p.blocks.filter(b => b.type === 'activity').length <= 4)).toBe(true);
  const roomy = layoutDocument(4, true);
  expect(roomy.presentation.answer_space).toBe('roomy');
  expect(content(roomy)).toEqual(content(grouped));
});


it('la comprobación propia sigue tras la respuesta; la ajena permanece independiente; el documento no se muta', () => {
  const document = layoutDocument(4);
  const page = document.pages[1]!;
  const at = page.blocks.findIndex(b => b.type === 'checklist');
  page.blocks.splice(at + 1, 0, { id: 'blk_other64', type: 'checklist', title: 'Comprobación ajena', items: ['Revisa la actividad anterior.'], trace: { origin: 'support', source_refs: ['act_1'], decision_ids: [] } });
  const before = JSON.stringify(document);
  const { model } = buildRenderModel(document, { mode: 'student', deferred: [] });
  expect(JSON.stringify(document)).toBe(before);
  const nodes = model.pages.flatMap(p => p.nodes);
  const problem = nodes.find(n => n.kind === 'activity' && n.label === '3');
  expect(problem?.kind === 'activity' && problem.checks?.map(n => n.kind)).toEqual(['checklist']);
  expect(nodes.some(n => n.kind === 'checklist' && n.title === 'Comprobación ajena')).toBe(true);
  const flat = flatNodes(nodes);
  expect(flat.filter(n => n.kind === 'checklist')).toHaveLength(2);
  expect(flatNodes(mapNodes(nodes, n => n)).map(n => n.key)).toEqual(flat.map(n => n.key));
});
