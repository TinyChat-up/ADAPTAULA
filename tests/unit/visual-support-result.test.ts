import { expect, it } from 'vitest';
import { maxVisualCorpus } from '../../evals/max-visuals/corpus';
import { visualSupportResult } from '@/lib/adaptation/presentation/visual-support-result';

it('cuenta recursos de la versión guardada, no llamadas ni repeticiones de la misma imagen',()=>{
  const c=maxVisualCorpus().find(c=>c.id==='vocabulario')!;
  const image=c.withSupport.pages[0]!.blocks.find(b=>b.type==='image')!;
  c.withSupport.pages.push({blocks:[{...image,id:'blk_repeat'}]});
  expect(visualSupportResult(c.withSupport)).toEqual({generated:1,original:0,structured:0});
  expect(visualSupportResult(c.without)).toEqual({generated:0,original:0,structured:0});
  expect(visualSupportResult({})).toBeNull();
});
it('distingue una imagen original de las ilustraciones nuevas',()=>{
  const c=maxVisualCorpus()[0]!;
  const doc=c.without;
  doc.pages[0]!.blocks.push({id:'blk_original',type:'image',source:{kind:'original',visual_ref:'vis_1'},alt_text:'Esquema A-D',trace:{origin:'original',source_refs:['vis_1'],decision_ids:[]}});
  expect(visualSupportResult(doc)).toEqual({generated:0,original:1,structured:0});
});
