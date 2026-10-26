import { expect, it } from 'vitest';
import { fractionsAnalysis } from '../../evals/adaptation/fixtures';
import { maxVisualCorpus } from '../../evals/max-visuals/corpus';
import { FunctionalProfileSchema } from '@/lib/schemas/functional-profile';
import { buildAdaptationContext } from '@/lib/adaptation/context';
import { addVisualSupports } from '@/lib/adaptation/visual-supports';
import { buildRenderModel } from '@/lib/render/model';
import { printPdf } from './harness';

it('opt-in real determinista: PDF antes/después en color y grises, sin perder el ejercicio',async()=>{
  const analysis=fractionsAnalysis();analysis.activities=[{...analysis.activities[0]!,id:'act_1',type:'calculation',instruction:'Calcula: 3/4 - 1/4.',expected_answer:{...analysis.activities[0]!.expected_answer,value:'1/2'}}];
  const document=maxVisualCorpus()[0]!.without;
  document.meta.title='Resta de fracciones';
  document.pages[0]!.blocks=document.pages[0]!.blocks.map(b=>b.type==='activity'?{...b,prompt:'Calcula: 3/4 - 1/4.'}:b.type==='heading'?{...b,text:'Resta de fracciones'}:b);
  const {context}=buildAdaptationContext({analysis,profile:FunctionalProfileSchema.parse({schema_version:1,supports:{visual_math_support:'high'},limits:{},allowances:{}}),education:{stage:'primaria',grade:'4-primaria',subject:'matematicas'},adaptationType:'accessibility',visualSupports:true});
  for(const enabled of [false,true])for(const grayscale of [false,true]){
    const doc=structuredClone(enabled?addVisualSupports(document,analysis,context):document);if(grayscale)doc.presentation.contrast='high';
    const {model}=buildRenderModel(doc,{mode:'student',deferred:[]});
    const pdf=await printPdf(`opt-in-fracciones-${enabled?'con':'sin'}-${grayscale?'grises':'color'}`,model);
    expect(pdf.validation.issues).toEqual([]);expect(pdf.result.blockedRequests).toEqual([]);
    const text=pdf.pages.map(p=>p.body).join(' ').replace(/\s/g,'');
    expect(text).toMatch(/3\/4.1\/4/);expect(text).not.toContain('1/2');
    expect(text.includes('EJEMPLORESUELTO')).toBe(enabled);
    if(enabled){expect(text).toContain('4/6');expect(pdf.print.html).toContain('data-spec="fraction_bar"');}
  }
});
