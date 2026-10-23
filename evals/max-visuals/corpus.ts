import { createHash, randomUUID } from 'node:crypto';
import { createCanvas } from '@napi-rs/canvas';
import { MaterialDocumentSchema, type Block, type MaterialDocument } from '@/lib/schemas/material-document';
import { analogFractionBlocks } from '@/lib/visuals/analog-example';
import type { VisualSpec } from '@/lib/visuals/spec';
import { buildRenderModel, type AssetSource } from '@/lib/render/model';
import type { PinnedAsset } from '@/lib/render/print/pinned-assets';

const trace = { origin: 'support' as const, source_refs: ['act_1'], decision_ids: [] };
const activity = (prompt: string, resource_block_ids: string[] = []): Block => ({ id: 'blk_task', type: 'activity', label: '1', prompt, resource_block_ids, response: { kind: 'lines', lines: 3 }, trace: { ...trace, origin: 'original' } });
const figure = (spec: VisualSpec): Block => ({ id: 'blk_visual', type: 'image', source: { kind: 'figure', provenance: 'generated', spec }, alt_text: 'Apoyo visual del ejercicio.', caption: 'Apoyo estructurado · demostración sintética', trace });
const doc = (title: string, blocks: Block[]): MaterialDocument => MaterialDocumentSchema.parse({ schema_version: 1, meta: { title, language: 'es', stage: 'primaria', grade: '4-primaria', subject: 'matematicas', topic: null }, presentation: { font_scale: 1, line_spacing: 'normal', spacing: 'normal', contrast: 'normal', decoration: 'standard', max_tasks_per_page: null, color_independent: true, text_alternatives_for_visuals: true }, admin_fields: [{ type: 'student_name', label: 'Nombre' }], answer_key: [], pages: [{ blocks: [{ id: 'blk_title', type: 'heading', level: 1, text: title, trace }, ...blocks] }] });
export interface PilotCase { id: string; category: 'A' | 'B' | 'C'; purpose: string; without: MaterialDocument; withSupport: MaterialDocument; pins: PinnedAsset[]; generated: Record<string, AssetSource & { purpose: string }> }

/** Manual test drawings, NOT image-model outputs. No external resources, school files or student data. */
function scene(kind: 'books' | 'plant'): Uint8Array {
  const c = createCanvas(768, 512); const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0,0,768,512); g.strokeStyle = '#222'; g.lineWidth = 7;
  if (kind === 'books') {
    g.strokeRect(100,80,560,330); g.beginPath(); g.moveTo(100,250); g.lineTo(660,250); g.stroke();
    for (const x of [140,205,280,440,510]) { g.strokeRect(x,120,40,125); }
    g.beginPath(); g.moveTo(285,380); g.lineTo(380,355); g.lineTo(475,380); g.lineTo(475,450); g.lineTo(380,425); g.lineTo(285,450); g.closePath(); g.stroke(); g.beginPath(); g.moveTo(380,355); g.lineTo(380,425); g.stroke();
  } else {
    g.strokeRect(80,60,200,250); g.beginPath(); g.moveTo(180,60); g.lineTo(180,310); g.moveTo(80,185); g.lineTo(280,185); g.stroke();
    g.beginPath(); g.moveTo(440,420); g.lineTo(440,180); g.moveTo(440,250); g.bezierCurveTo(350,260,345,180,440,250); g.moveTo(440,320); g.bezierCurveTo(545,310,540,240,440,320); g.stroke(); g.strokeRect(390,420,105,55);
  }
  return new Uint8Array(c.toBuffer('image/png'));
}
export function maxVisualCorpus(): PilotCase[] {
  const exact: Array<[string, string, string, VisualSpec]> = [
    ['fracciones-equivalencia', 'Fracciones equivalentes', '1/2 y 2/4 son fracciones equivalentes. Explica por qué representan la misma cantidad.', { spec_version: 1, kind: 'comparison', items: [{ left: { n:1,d:2 }, right: { n:2,d:4 } }] }],
    ['recta', 'Situarse en la recta', 'Representa 3/4 en una recta de cero a uno.', { spec_version:1,kind:'number_line',start:{n:0,d:1},end:{n:1,d:1},divisions:4,labels:[{tick:0,text:'0'},{tick:4,text:'1'}] }],
    ['procesos', 'Agua y cambios', 'El agua pasa de líquida a vapor y vuelve a formar gotas. Explica qué cambia al calentarla y al enfriarla.', { spec_version:1,kind:'steps',items:['Agua líquida','Vapor de agua','Gotas de agua'] }],
  ];
  // Equivalence uses two bars, not a comparison box that would ask a different question.
  const result: PilotCase[] = exact.map(([id,title,prompt,spec]) => {
    const visuals = id === 'fracciones-equivalencia' ? [figure({spec_version:1,kind:'fraction_bar',parts:2,shaded:[0]}), { ...figure({spec_version:1,kind:'fraction_bar',parts:4,shaded:[0,1]}), id:'blk_visual2' }] : [figure(spec)];
    const base = activity(prompt, visuals.map(b=>b.id));
    // The without variant retains data in words; the task still makes sense without its optional support.
    const withoutPrompt = prompt;
    return { id, category:'A', purpose: id === 'procesos' ? 'Organizar estados ya dados en la consigna.' : 'Representar los datos con SVG verificable.', without:doc(title,[activity(withoutPrompt)]), withSupport:doc(title,[...visuals,base]), pins:[], generated:{} };
  });
  const exercise = {left:{n:3,d:4},right:{n:1,d:4},operation:'subtract'};
  const examples = analogFractionBlocks({exercise,example:{left:{n:5,d:6},right:{n:1,d:6},operation:'subtract'}}, {example:'blk_example',figure:'blk_visual',activityRef:'act_1'});
  const prompt = 'Una cinta mide 3/4 de metro. Se utiliza 1/4 de metro. ¿Cuánto queda?';
  result.push({id:'problema-ejemplo',category:'C',purpose:'Mostrar una resta análoga con otros datos y resultado distinto.',without:doc('Una resta de fracciones',[activity(prompt)]),withSupport:doc('Una resta de fracciones',[...examples,activity(prompt,['blk_visual','blk_example'])]),pins:[],generated:{}});
  for (const [id,title,prompt,kind,purpose] of [
    ['vocabulario','En la biblioteca','Describe qué acciones se pueden hacer en una biblioteca.','books','Situar el vocabulario en un entorno cotidiano.'],
    ['ciencias','Luz y plantas','Explica por qué una planta necesita luz para crecer.','plant','Contextualizar la relación entre una planta y su entorno luminoso.'],
  ] as const) {
    const bytes=scene(kind), assetId=randomUUID(), sha256=createHash('sha256').update(bytes).digest('hex');
    const image: Block={id:'blk_visual',type:'image',source:{kind:'generated',essential:false,asset_id:assetId,sha256,decision_id:'dec_1'},alt_text:kind==='books'?'Estantería y libro abierto, sin texto escrito.':'Planta junto a una ventana.',caption:'Ilustración sintética dibujada para la prueba',trace};
    result.push({id,category:'B',purpose,without:doc(title,[activity(prompt)]),withSupport:doc(title,[image,activity(prompt,['blk_visual'])]),pins:[{assetId,sha256,mime:'image/png',bytes}],generated:{[assetId]:{src:`asset:${assetId}@${sha256}`,widthMm:120,purpose}}});
  }
  for (const c of result) {
    const subject = c.id === 'vocabulario' ? 'lengua' : ['ciencias','procesos'].includes(c.id) ? 'conocimiento-medio' : 'matematicas';
    c.withSupport.meta.subject = subject;
    c.without.meta.subject = subject;
  }
  return result;
}
export const pilotModel = (c: PilotCase, withSupport: boolean) => buildRenderModel(withSupport ? c.withSupport : c.without, { mode:'student', deferred:[], generated:c.generated, subjectLabel:c.id==='ciencias'||c.id==='procesos'?'Ciencias':c.id==='vocabulario'?'Lengua':'Matemáticas' });
