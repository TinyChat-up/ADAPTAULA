import { expect,it } from 'vitest';
import { maxVisualCorpus } from '../../evals/max-visuals/corpus';
import { cellCaseAnalysis } from '../support/cell-case';
import { resolveMagicVisuals } from '@/lib/materials/visuals/auto/policy';
import { applyVisualResolution } from '@/lib/adaptation/visual-policy';
import { buildRenderModel } from '@/lib/render/model';
import { printPdf } from './harness';

it('pregunta abierta de ciencias: recurso adicional aprobado simulado llega al mismo PDF CLARO',async()=>{
  const c=maxVisualCorpus().find(c=>c.id==='ciencias')!, pin=c.pins[0]!;
  const analysis=cellCaseAnalysis();analysis.visuals=[];
  analysis.activities=[{...analysis.activities[1]!,id:'act_1',instruction:'Explica por qué una planta necesita luz para crecer.',type:'open_question',resource_ids:[],expected_answer:{basis:'not_inferable',value:null}}];
  const original=JSON.stringify(c.without);
  let called=0;
  const plan=await resolveMagicVisuals({readyOriginals:async()=>new Set(),illustrate:async()=>{called++;return {ok:true,cached:false,attempts:1,asset:{id:pin.assetId,sha256:pin.sha256,width:768,height:512,alt:'Planta junto a una ventana; dibujo manual de prueba.'}};}},{analysis,document:c.without,requiredVisuals:[],stage:'primaria',subject:'ciencias',visualSupports:true,functionalNeeds:['visual_support']});
  expect(called).toBe(1);
  const document=applyVisualResolution(c.without,plan);
  const {model}=buildRenderModel(document,{mode:'student',deferred:[],generated:c.generated});
  const pdf=await printPdf('ciencias-apoyo-contextual',model,c.pins,1);
  expect(pdf.validation.issues).toEqual([]);expect(pdf.result.blockedRequests).toEqual([]);
  expect(JSON.stringify(c.without)).toBe(original);
  expect(pdf.print.html).toContain('Planta junto a una ventana');
});
