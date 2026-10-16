import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

/** Original sintético propio, sin soluciones. No procede de ningún alumno ni evaluación real. */
export async function workspacePdf(marker: string): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  for (let index = 0; index < 2; index++) {
    const p = pdf.addPage([595.28, 841.89]);
    const ink = rgb(.1, .16, .22);
    const text = (s: string, y: number, size = 12, strong = false) => p.drawText(s, { x: 48, y, size, font: strong ? bold : font, color: ink });
    text("MATEMATICAS  /  5.º DE PRIMARIA", 790, 10);
    text(index === 0 ? "Exploramos las fracciones" : "Comparamos y explicamos", 746, 23, true);
    text("Nombre: ________________________     Fecha: ______________", 705, 11);
    text("1. Observa las partes coloreadas. Escribe la fraccion.", 648, 13, true);
    for (let group = 0; group < 2; group++) for (let part = 0; part < 4; part++) {
      p.drawRectangle({ x: 48 + group * 250 + part * 43, y: 550, width: 43, height: 52, borderColor: ink, borderWidth: 1, color: part < group + 1 ? rgb(.72, .79, .82) : rgb(1,1,1) });
    }
    text("Fraccion: __________                       Fraccion: __________", 515);
    text("2. Compara las fracciones. Explica como lo has pensado.", 447, 13, true);
    text("1/2       2/4", 404, 18);
    for (let line = 0; line < 4; line++) p.drawLine({ start: { x: 48, y: 356 - line * 28 }, end: { x: 544, y: 356 - line * 28 }, thickness: .5, color: rgb(.65,.67,.7) });
    text("3. Calcula 2/3 + 1/6. Conserva los pasos de tu razonamiento.", 210, 13, true);
    text("Material sintetico de prueba. Sin validacion docente.", 70, 10);
    text(`Pagina ${index + 1} de 2`, 48, 10);
  }
  return Buffer.concat([Buffer.from(await pdf.save()), Buffer.from(`\n% ${marker}\n`)]);
}
