import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { editorDocument } from "./editor-document";

export function reviewDocument() {
  const document = editorDocument();
  const last = document.pages[0]!.blocks.pop()!;
  document.pages.push({ blocks: [last] });
  return document;
}

/** Paired synthetic original, not a private school document or a generator evaluation. */
export async function reviewOriginal(marker: string) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  for (let i = 0; i < 2; i++) {
    const p = pdf.addPage([595.28, 841.89]);
    const text = (s: string, y: number, size = 13, strong = false) => p.drawText(s, { x: 48, y, size, font: strong ? bold : font, color: rgb(.1,.16,.22) });
    text("MATEMATICAS / 5.º DE PRIMARIA", 790, 10);
    text("Medidas y decisiones", 744, 25, true);
    text("Nombre: __________________     Fecha: ______________", 705, 11);
    if (!i) {
      text("Datos de la actividad", 650, 15, true);
      text("Cinta: 25 cm                      Cordon: 40 cm", 612);
      for (let j=0; j<4; j++) p.drawRectangle({ x: 48+j*70, y: 520, width: 70, height: 45, borderWidth: 1, borderColor: rgb(.2,.3,.4), color: j ? rgb(1,1,1) : rgb(.65,.75,.8) });
      text("1. Compara 25 cm y 40 cm. Explica tu eleccion.", 470, 14, true);
      for(let j=0; j<5; j++) p.drawLine({start:{x:48,y:420-j*35},end:{x:540,y:420-j*35},thickness:.5,color:rgb(.6,.65,.7)});
    } else {
      text("2. Elige una medida.", 650, 16, true);
      text("A. 25 cm", 600); text("B. 40 cm", 555);
    }
    text("Documento sintetico. Sin soluciones ni datos de alumnado.", 70, 10);
    text(`Pagina ${i+1} de 2`, 48, 10);
  }
  return Buffer.concat([Buffer.from(await pdf.save()), Buffer.from(`\n% ${marker}\n`)]);
}
