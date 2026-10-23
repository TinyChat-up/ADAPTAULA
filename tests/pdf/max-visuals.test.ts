import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { maxVisualCorpus, pilotModel } from '../../evals/max-visuals/corpus';
import { OUT_DIR, printPdf } from './harness';
const reports: unknown[]=[];
describe('Max aislado: comparaciones sintéticas, un solo CLARO', () => {
  for(const c of maxVisualCorpus()) it(c.id, async()=>{
    for(const supported of [false,true]) {
      const {model,validation}=pilotModel(c,supported);
      expect(validation.status).not.toBe('not_renderable');
      const printed=await printPdf(`max-${c.id}-${supported?'con':'sin'}`,model,supported?c.pins:[],supported?c.pins.length:0);
      expect(printed.validation.issues).toEqual([]);
      expect(printed.result.blockedRequests).toEqual([]);
      const text=printed.pages.map(p=>p.body).join(' ').replace(/\s+/g,'');
      expect(text).not.toContain('Respuestacorrecta');
      if(c.category==='C'&&supported) {expect(text).toContain('EJEMPLORESUELTO');expect(text).toContain('4/6');expect(text).not.toContain('2/4');expect(printed.print.html.indexOf('data-spec="fraction_bar"')).toBeLessThan(printed.print.html.indexOf('class="ms-activity-head"'));}
      reports.push({id:c.id,category:c.category,purpose:c.purpose,supported,pages:printed.pages.length,aiCalls:0,estimatedApiCostUsd:0,semanticReview:'manual fixture; not teacher validated'});
    }
  });
  it('informe',()=>{mkdirSync(path.join(OUT_DIR,'max-pilot'),{recursive:true});writeFileSync(path.join(OUT_DIR,'max-pilot','report.json'),JSON.stringify(reports,null,2));expect(reports).toHaveLength(12);});
});


for (const id of ['problema-ejemplo','vocabulario']) it(`${id}: impresión monocroma`,async()=>{
  const c=maxVisualCorpus().find(c=>c.id===id)!;
  c.withSupport.presentation.contrast='high';
  const {model}=pilotModel(c,true);
  const printed=await printPdf(`max-${id}-grises`,model,c.pins,c.pins.length);
  expect(printed.validation.issues).toEqual([]);
  expect(printed.result.blockedRequests).toEqual([]);
  expect(printed.print.html).toContain('--ms-ink:#000000');
});
