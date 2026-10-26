import { expect, it } from 'vitest';
import { shortCellGlossary } from '../support/glossary-budget-case';
import { maxVisualCorpus } from '../../evals/max-visuals/corpus';
import { buildRenderModel } from '@/lib/render/model';
import { printPdf } from './harness';

it('CLARO imprime las cinco entradas completas del glosario abreviado de prueba',async()=>{
  const document=maxVisualCorpus()[0]!.without;
  document.meta={...document.meta,title:'La célula · ensayo sintético',stage:'eso',grade:'1-eso',subject:'biologia'};
  document.pages=[{blocks:[{id:'blk_glossary',type:'vocabulary',items:shortCellGlossary.items,trace:{origin:'support',source_refs:['act_1'],decision_ids:['dec_1']}},{id:'blk_activity',type:'activity',prompt:'Lee el texto y responde a las preguntas.',response:{kind:'lines',lines:3},trace:{origin:'original',source_refs:['act_1'],decision_ids:[]}}]}];
  for(const grayscale of [false,true]){
    document.presentation.contrast=grayscale?'high':'normal';
    const {model}=buildRenderModel(document,{mode:'student',deferred:[]});
    const pdf=await printPdf(`glosario-reparado-${grayscale?'grises':'color'}`,model);
    expect(pdf.validation.issues).toEqual([]);expect(pdf.result.blockedRequests).toEqual([]);
    for(const item of shortCellGlossary.items){expect(pdf.print.html).toContain(item.term);expect(pdf.print.html).toContain(item.definition);}
    expect(pdf.pages).toHaveLength(1);
  }
});
