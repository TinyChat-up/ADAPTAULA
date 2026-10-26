import type { SupportV2 } from '@/lib/schemas/generated-segments-v2';

// Educational content supplied by the founder; no account, document identity or learner data.
export const cellGlossary: Extract<SupportV2,{kind:'glossary'}> = {kind:'glossary',items:[
  {term:'Orgánulo',definition:'Parte de la célula con una función.'},
  {term:'Núcleo',definition:'Orgánulo que guarda el ADN.'},
  {term:'Mitocondria',definition:'Orgánulo que libera energía.'},
  {term:'Membrana plasmática',definition:'Capa que rodea la célula.'},
  {term:'Citoplasma',definition:'Medio interior de la célula.'},
]};
// Manually written test response, never presented as a real model's successful correction.
export const shortCellGlossary: typeof cellGlossary = {kind:'glossary',items:[
  {term:'Orgánulo',definition:'Estructura celular con función específica.'},
  {term:'Núcleo',definition:'Contiene el ADN.'},
  {term:'Mitocondria',definition:'Libera energía.'},
  {term:'Membrana plasmática',definition:'Delimita la célula.'},
  {term:'Citoplasma',definition:'Medio interior celular.'},
]};
