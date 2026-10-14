import { createCanvas } from "@napi-rs/canvas";
import { PDFDocument } from "pdf-lib";
import { lumaOf, type PageModel } from "@/lib/materials/visuals/auto/page-model";

/** No AI or OCR: ground truth is the drawing program, not a claim from the material analysis. */
export const SCAN_ADVERSARIES = {
  A: "una A mayúscula aislada",
  B: "un signo más aislado",
  C: "un logotipo floral, sin la figura que afirma el análisis",
  D: "un esquema unido a una consigna por una línea",
  E: "dos gráficos unidos accidentalmente por un trazo",
  F: "la figura requerida cortada por el borde y un logotipo interior",
  G: "un formulario con cuadrícula y texto",
  H: "escaneo inclinado con sombra y ruido, sin evidencia de identidad",
  I: "la única figura pertenece a la actividad 2, no a la actividad 1",
  J: "etiquetas imprescindibles separadas más de 4 mm del dibujo",
} as const;
export type ScanAdversary = keyof typeof SCAN_ADVERSARIES;

export function adversarialScan(kind: ScanAdversary) {
  const width = 840, height = 1188;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "white"; ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "#111"; ctx.fillStyle = "#111"; ctx.lineWidth = 4;
  const line = (x: number, y: number, xx: number, yy: number) => { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(xx, yy); ctx.stroke(); };
  const ellipse = (x: number, y: number, rx: number, ry: number) => { ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, 2 * Math.PI); ctx.stroke(); };
  const diagram = () => { ellipse(380, 430, 125, 90); ellipse(380, 430, 30, 25); line(380, 430, 525, 370); };
  const logo = () => {
    for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; ellipse(400 + 40 * Math.cos(a), 440 + 40 * Math.sin(a), 35, 35); }
  };
  ctx.font = "18px sans-serif";
  switch (kind) {
    case "A": line(250, 480, 340, 250); line(340, 250, 430, 480); line(282, 400, 398, 400); break;
    case "B": line(250, 380, 450, 380); line(350, 280, 350, 480); break;
    case "C": logo(); break;
    case "D":
      diagram(); ctx.fillText("Escribe una respuesta y explica por que.", 210, 560);
      line(210, 554, 580, 554); line(380, 520, 380, 554); break;
    case "E": ellipse(290, 430, 65, 80); ellipse(510, 430, 65, 80); line(355, 430, 445, 430); break;
    case "F": ellipse(5, 320, 100, 80); logo(); break;
    case "G":
      ctx.strokeRect(200, 300, 400, 240);
      for (let y = 340; y < 540; y += 40) line(200, y, 600, y);
      for (let x = 280; x < 600; x += 80) line(x, 300, x, 540);
      ctx.fillText("Nombre", 208, 326); ctx.fillText("Curso", 288, 326); break;
    case "H":
      ctx.save(); ctx.translate(420, 594); ctx.rotate(1.5 * Math.PI / 180); ctx.translate(-420, -594);
      diagram(); ctx.restore();
      ctx.fillStyle = "#666"; ctx.fillRect(0, 0, 9, height); break;
    case "I":
      ctx.fillText("1. Observa la celula y nombra sus partes.", 80, 130);
      ctx.fillText("2. Observa el logotipo de la editorial.", 80, 300); logo(); break;
    case "J":
      diagram(); ctx.fillText("1", 570, 374); ctx.fillText("2", 380, 565); break;
  }
  const rgba = ctx.getImageData(0, 0, width, height);
  if (kind === "H") {
    let state = 1234;
    for (let i = 0; i < rgba.data.length; i += 4) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      const v = Math.max(0, rgba.data[i]! - 8 - (state % 9));
      rgba.data[i] = rgba.data[i + 1] = rgba.data[i + 2] = v;
    }
    ctx.putImageData(rgba, 0, 0);
  }
  const model: PageModel = { width, height, gray: lumaOf(rgba.data, width, height), texts: [], mmPerPx: 0.25 };
  return { model, png: () => canvas.encode("png") };
}

export async function adversarialScanPdf(kind: ScanAdversary) {
  const pdf = await PDFDocument.create();
  const png = await pdf.embedPng(await adversarialScan(kind).png());
  const page = pdf.addPage([595.28, 841.89]);
  page.drawImage(png, { x: 0, y: 0, width: 595.28, height: 841.89 });
  return pdf.save();
}
