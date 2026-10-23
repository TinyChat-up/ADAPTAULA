import { describe, expect, it } from 'vitest';
import { validateBrief, acceptReview } from '@/lib/visuals/illustration';
import { CELL_BRIEF, CELL_REVIEW_APPROVED } from '../support/cell-case';
const ctx = { activity: 'Observa la escena.', expectedAnswer: null, signatures: [], lowDetail: false };
it('no confía a imagen fracciones, operaciones, recuentos ni ejes exactos', () => {
  for (const composition of ['Una barra con 3/4 sombreados.', 'Escribe 3 + 2 = 5.', 'Resta 3 - 2.', 'Multiplica 3 x 2.', 'Compara 3 ≤ 4.', 'Dibuja exactamente tres manzanas.', 'Una recta numérica dividida en cuartos.'])
    expect(validateBrief({ ...CELL_BRIEF, composition }, ctx), composition).toMatchObject({ ok: false });
});
it('una sola evidencia no acredita dos elementos distintos por coincidencia parcial', () => {
  const valid = validateBrief({ ...CELL_BRIEF, required_elements: [{ name: 'raíz', marker: null, label: null }, { name: 'raíz principal', marker: null, label: null }] }, ctx);
  if (!valid.ok) throw new Error('fixture');
  expect(acceptReview({ ...CELL_REVIEW_APPROVED, elements: [{ name: 'raíz principal', present: true, marker_ok: null, label_ok: null }] }, valid.brief).ok).toBe(false);
});

import { imagePilotAllows } from '@/lib/materials/visuals/illustrate/pilot';
import { analogFractionBlocks } from '@/lib/visuals/analog-example';
const config = { AI_IMAGES_PILOT_MODE: 'local' as const, AI_IMAGES_PILOT_WORKSPACE_ID: 'one', AI_IMAGES_PILOT_SUPABASE_URL: 'http://127.0.0.1:54399' };
describe('aislamiento del piloto', () => {
  it('solo backend y workspace explícitos, nunca Vercel Production', () => {
    expect(imagePilotAllows(config, 'one', config.AI_IMAGES_PILOT_SUPABASE_URL)).toBe(true);
    expect(imagePilotAllows({}, 'one', config.AI_IMAGES_PILOT_SUPABASE_URL)).toBe(false);
    expect(imagePilotAllows(config, 'two', config.AI_IMAGES_PILOT_SUPABASE_URL)).toBe(false);
    expect(imagePilotAllows(config, 'one', 'https://production.supabase.co')).toBe(false);
    expect(imagePilotAllows(config, 'one', config.AI_IMAGES_PILOT_SUPABASE_URL, 'production')).toBe(false);
    expect(imagePilotAllows({ ...config, AI_IMAGES_PILOT_SUPABASE_URL: 'https://production.supabase.co' }, 'one', 'https://production.supabase.co')).toBe(false);
  });
});
const fraction = (n: number, d: number) => ({ n, d });
export const analog = { exercise: { left: fraction(3,4), right: fraction(1,4), operation: 'subtract' }, example: { left: fraction(5,6), right: fraction(1,6), operation: 'subtract' } };
it('ejemplo calculado con datos y solución distintos, sin alterar el ejercicio', () => {
  const original = JSON.stringify(analog);
  const blocks = analogFractionBlocks(analog, { example: 'blk_example', figure: 'blk_figure', activityRef: 'act_1' });
  expect(blocks[0]).toMatchObject({ type: 'worked_example', result: '4/6' });
  expect(blocks[1]).toMatchObject({ source: { spec: { parts: 6, shaded: [0,1,2,3] } } });
  expect(JSON.stringify(analog)).toBe(original);
  expect(() => analogFractionBlocks({ ...analog, example: analog.exercise }, { example: 'x', figure: 'y', activityRef: 'act_1' })).toThrow();
});

import { resolveGenerated } from '@/lib/render/generated';
it('un SHA válido no basta: una ilustración sin aprobación persistida no se sirve', async () => {
  const bytes=new Uint8Array([1,2,3]);
  const { createHash }=await import('node:crypto'); const sha256=createHash('sha256').update(bytes).digest('hex');
  const deps={row:async()=>({id:'asset',adaptation_id:'adapt',storage_path:'private',sha256,width:512,height:512,review:{approved:false}}),readObject:async()=>bytes};
  expect((await resolveGenerated(deps,'adapt',[{assetId:'asset',sha256}])).ready.size).toBe(0);
});

import { buildRenderModel } from '@/lib/render/model';
import { maxVisualCorpus } from '../../evals/max-visuals/corpus';
it('apoyo opcional ausente no se imprime; uno imprescindible bloquea, y el legado falla cerrado', () => {
  const c=maxVisualCorpus().find(c=>c.id==='vocabulario')!;
  const doc=structuredClone(c.withSupport);
  expect(buildRenderModel(doc,{mode:'student',deferred:[]}).validation.status).not.toBe('not_renderable');
  const image=doc.pages[0]!.blocks.find(b=>b.type==='image')!;
  if(image.type!=='image'||image.source.kind!=='generated') throw new Error('fixture');
  image.source.essential=true;
  expect(buildRenderModel(doc,{mode:'student',deferred:[]}).validation.status).toBe('not_renderable');
  delete image.source.essential;
  expect(buildRenderModel(doc,{mode:'student',deferred:[]}).validation.status).toBe('not_renderable');
});

it('una etiqueta numérica tampoco puede escribir la respuesta evaluada', () => {
  const result=validateBrief({...CELL_BRIEF,required_elements:[{name:'caja',marker:null,label:'4'}]}, {...ctx,expectedAnswer:'4'});
  expect(result).toMatchObject({ok:false});
});
it('la revisión rechaza respuestas reveladas, errores de concepto, decoración y mala impresión', () => {
  const valid=validateBrief(CELL_BRIEF,ctx); if(!valid.ok)throw new Error('fixture');
  for(const bad of [{answer_revealed:true},{conceptual_errors:['La célula animal tiene pared celular.']},{prohibited_found:['personaje decorativo']},{printable:false},{matches_activity:false}])
    expect(acceptReview({...CELL_REVIEW_APPROVED,...bad},valid.brief).ok).toBe(false);
});


it('la figura del ejemplo viaja dentro de él y una referencia a otro ejemplo bloquea la ficha', () => {
  const c=maxVisualCorpus().find(c=>c.category==='C')!;
  const valid=buildRenderModel(c.withSupport,{mode:'student',deferred:[]});
  expect(valid.validation.status).not.toBe('not_renderable');
  const activity=valid.model.pages.flatMap(p=>p.nodes).find(n=>n.kind==='activity');
  expect(activity?.kind==='activity'&&activity.leads.some(n=>n.kind==='worked_example'&&n.figures?.length===1)).toBe(true);
  const malformed=structuredClone(c.withSupport);
  const image=malformed.pages[0]!.blocks.find(b=>b.type==='image')!;
  if(image.type!=='image'||image.source.kind!=='figure')throw new Error('fixture');
  image.source.example_ref='blk_other';
  expect(buildRenderModel(malformed,{mode:'student',deferred:[]}).validation.status).toBe('not_renderable');
});

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { VisualNeedsPanel } from '@/components/material/visual-needs-panel';
import { visualNeedsOf } from '@/lib/adaptation/presentation/visual-needs';
it('Hacer magia también identifica la ilustración lista y su finalidad sin una segunda aprobación', () => {
  const c=maxVisualCorpus().find(c=>c.id==='vocabulario')!;
  const needs=visualNeedsOf({document:c.withSupport,visuals:[],requiredVisuals:[],requested:[],generated:c.generated});
  const html=renderToStaticMarkup(createElement(VisualNeedsPanel,{needs,adaptationId:'test',canWrite:true,locateHref:()=>'/no-usado',manual:false}));
  expect(html).toContain('Ilustraciones generadas · revisión docente');
  expect(html).toContain(c.purpose);
  expect(html).toContain('puede equivocarse');
  expect(html).not.toContain('Localizar en el original');
});
