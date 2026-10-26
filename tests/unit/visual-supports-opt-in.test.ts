import { expect, it, vi } from 'vitest';
import { fractionsAnalysis } from '../../evals/adaptation/fixtures';
import { maxVisualCorpus } from '../../evals/max-visuals/corpus';
import { buildAdaptationContext, contextFingerprint } from '@/lib/adaptation/context';
import { FunctionalProfileSchema } from '@/lib/schemas/functional-profile';
import { addVisualSupports } from '@/lib/adaptation/visual-supports';
import { allBlocks } from '@/lib/schemas/material-document';
import { resolveMagicVisuals } from '@/lib/materials/visuals/auto/policy';
import { applyVisualResolution } from '@/lib/adaptation/visual-policy';

export function supportedFraction() {
  const analysis = fractionsAnalysis();
  analysis.activities = [{ ...analysis.activities[0]!, id:'act_1', instruction:'Calcula: 3/4 - 1/4.', type:'calculation', response_format:'calculate', expected_answer:{...analysis.activities[0]!.expected_answer,value:'1/2'} }];
  const document = structuredClone(maxVisualCorpus()[0]!.without);
  const task = allBlocks(document).find(b=>b.type==='activity')!;
  if(task.type!=='activity') throw new Error('fixture');
  document.pages=[{blocks:[{...task,trace:{...task.trace,source_refs:['act_1']},prompt:'Calcula: 3/4 - 1/4.'}]}];
  const profile=FunctionalProfileSchema.parse({schema_version:1,supports:{visual_math_support:'high'},limits:{},allowances:{}});
  const input={analysis,profile,education:{stage:'primaria',grade:'4-primaria',subject:'matematicas'},adaptationType:'accessibility' as const};
  return {analysis,document,input,context:buildAdaptationContext({...input,visualSupports:true}).context};
}

it('consentimiento separado y fingerprint distinto, legado sin consentimiento',()=>{
  const {input}=supportedFraction(); const off=buildAdaptationContext(input).context, on=buildAdaptationContext({...input,visualSupports:true}).context;
  expect(off.visual_supports).toBeUndefined();expect(on.visual_supports?.requested).toBe(true);expect(contextFingerprint(off)).not.toBe(contextFingerprint(on));
});
it('ejemplo análogo exacto y figura vinculada; original intacto y aplicación idempotente',()=>{
  const {analysis,document,context}=supportedFraction(), before=JSON.stringify(document);
  const enriched=addVisualSupports(document,analysis,context);
  expect(allBlocks(enriched).map(b=>b.type)).toEqual(['worked_example','image','activity']);
  expect(allBlocks(enriched)[0]).toMatchObject({result:'4/6'});
  expect(JSON.stringify(document)).toBe(before);
  expect(addVisualSupports(enriched,analysis,context)).toEqual(enriched);
  expect(addVisualSupports(document,analysis,{...context,visual_supports:undefined})).toBe(document);
});
it('no inventa ejemplos de comparaciones, denominadores distintos ni consignas ambiguas',()=>{
  for(const instruction of ['Compara 3/4 y 1/4.','Calcula: 3/4 - 1/3.','Calcula: 3/4 - 1/4 y explica la respuesta.']){
    const f=supportedFraction();f.analysis.activities[0]!.instruction=instruction;
    expect(addVisualSupports(f.document,f.analysis,f.context)).toBe(f.document);
  }
});
it('no filtra una respuesta equivalente de otra actividad',()=>{
  const f=supportedFraction();f.analysis.activities.push({...f.analysis.activities[0]!,id:'act_2',expected_answer:{...f.analysis.activities[0]!.expected_answer,value:'2/3'}});
  const example=allBlocks(addVisualSupports(f.document,f.analysis,f.context)).find(b=>b.type==='worked_example');
  expect(example).toMatchObject({result:'4/12'});
});
it('problema verbal: solo opt-in con barrera funcional intenta escena; rechazo no inserta imagen',async()=>{
  const f=supportedFraction(); f.analysis.activities[0]!.type='problem_solving';f.analysis.activities[0]!.instruction='Ana reparte una merienda con sus amigos. ¿Qué parte queda?';
  const illustrate=vi.fn().mockResolvedValue({ok:false,reason:'brief_rejected'});
  const input={analysis:f.analysis,document:f.document,requiredVisuals:[],stage:'primaria',functionalNeeds:['visual_math_support']};
  const deps={readyOriginals:async()=>new Set<string>(),illustrate};
  await resolveMagicVisuals(deps,input);expect(illustrate).not.toHaveBeenCalled();
  const plan=await resolveMagicVisuals(deps,{...input,visualSupports:true});expect(illustrate).toHaveBeenCalledOnce();
  expect(plan.needs[0]).toMatchObject({essential:false,resolution:{action:'omit'}});
  expect(applyVisualResolution(f.document,plan)).toEqual(f.document);
  illustrate.mockClear();await resolveMagicVisuals(deps,{...input,visualSupports:true,functionalNeeds:[]});expect(illustrate).not.toHaveBeenCalled();
});
it('escena aprobada se vincula al ejercicio y no transforma los datos',async()=>{
  const f=supportedFraction();f.analysis.activities[0]!.type='problem_solving';
  const asset={id:'11111111-1111-4111-8111-111111111111',sha256:'a'.repeat(64),width:768,height:512,alt:'Escena sin cantidades'};
  const plan=await resolveMagicVisuals({readyOriginals:async()=>new Set(),illustrate:async()=>({ok:true,asset,cached:false,attempts:1})},{analysis:f.analysis,document:f.document,requiredVisuals:[],stage:'primaria',visualSupports:true,functionalNeeds:['visual_math_support']});
  const resolved=applyVisualResolution(f.document,plan), blocks=allBlocks(resolved);expect(blocks[0]).toMatchObject({type:'image',source:{kind:'generated',essential:false}});expect(blocks[1]).toMatchObject({prompt:'Calcula: 3/4 - 1/4.'});
  expect(applyVisualResolution(resolved,plan)).toEqual(resolved);
});
