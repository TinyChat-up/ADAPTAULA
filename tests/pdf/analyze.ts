import { createRequire } from "node:module";
import path from "node:path";
import { encodePng, renderPage } from "@/lib/materials/visuals/raster";

/**
 * Deep checks of a produced PDF, for the smoke and the tests only (never in the production bundle): text as a reader extracts it
 * (pdf.js), and every page rasterised to PNG at 100 ppp with the visual pipeline's own rasteriser, measured, not compared byte by
 * byte (a valid render differs between runtimes).
 */

export const DPI = 100;
const MM = DPI / 25.4;
export const MARGIN_PX = 18 * MM;

export interface PageAnalysis {
  number: number;
  /** All the text, as a reader extracts it. */
  text: string;
  /** The text without the physical page number. */
  body: string;
  /** The physical page number (`N / M`) and where it is printed, in pt from the bottom-left corner. */
  pageLabel: { text: string; xPt: number; yPt: number } | null;
  fonts: string[];
  widthPx: number;
  heightPx: number;
  /** Share of non-white pixels in the whole page. */
  ink: number;
  /** Share of non-white pixels in the printable area (inside the 18 mm margins). */
  contentInk: number;
  /** Non-white pixels in the margins, outside the page-number box (bottom right). */
  marginInk: number;
  /** Bounding box (px) of pure red pixels: the fixtures' visuals. */
  red: { top: number; bottom: number; left: number; right: number; count: number } | null;
  png: Buffer;
}

const require = createRequire(path.join(process.cwd(), "package.json"));
const pdfjs = () => import("pdfjs-dist/legacy/build/pdf.mjs");
const fontsDir = () => path.join(path.dirname(require.resolve("pdfjs-dist/package.json")), "standard_fonts") + path.sep;

export async function analyzePdf(pdf: Uint8Array): Promise<PageAnalysis[]> {
  const lib = await pdfjs();
  const task = lib.getDocument({ data: new Uint8Array(pdf), standardFontDataUrl: fontsDir(), disableFontFace: true, useSystemFonts: false, verbosity: 0 });
  const doc = await task.promise;
  const pages: PageAnalysis[] = [];
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      const items = content.items.filter((i): i is typeof i & { str: string; fontName: string } => "str" in i);
      const isLabel = (i: { str: string }) => /^\d+ \/ \d+$/.test(i.str.trim());
      const label = items.find(isLabel) as (typeof items)[number] & { transform: number[] } | undefined;
      const fonts = [...new Set(items.filter((i) => i.str.trim()).map((i) => (content.styles as Record<string, { fontFamily: string }>)[i.fontName]?.fontFamily ?? i.fontName))];
      const raster = await renderPage(pdf, "application/pdf", n, { dpi: DPI, maxPx: 4096 });
      const { width, height } = raster;
      const data = raster.canvas.getContext("2d").getImageData(0, 0, width, height).data;
      let ink = 0;
      let contentInk = 0;
      let marginInk = 0;
      let red: PageAnalysis["red"] = null;
      const m = Math.floor(MARGIN_PX) - 4;
      const numberBox = { left: width - m - 40 * MM, top: height - m };
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4;
          const r = data[i]!, g = data[i + 1]!, b = data[i + 2]!;
          if (r > 200 && g < 70 && b < 70) {
            red = red ? { top: Math.min(red.top, y), bottom: Math.max(red.bottom, y), left: Math.min(red.left, x), right: Math.max(red.right, x), count: red.count + 1 } : { top: y, bottom: y, left: x, right: x, count: 1 };
          }
          if (r > 235 && g > 235 && b > 235) continue;
          ink++;
          const inside = x >= m && x < width - m && y >= m && y < height - m;
          if (inside) contentInk++;
          else if (!(x >= numberBox.left && y >= numberBox.top)) marginInk++;
        }
      }
      const area = width * height;
      const inner = (width - 2 * m) * (height - 2 * m);
      const join = (list: typeof items) => list.map((i) => i.str).join(" ").replace(/\s+/g, " ").trim();
      pages.push({ number: n, text: join(items), body: join(items.filter((i) => !isLabel(i))), pageLabel: label ? { text: label.str.trim(), xPt: label.transform[4]!, yPt: label.transform[5]! } : null, fonts, widthPx: width, heightPx: height, ink: ink / area, contentInk: contentInk / inner, marginInk, red, png: await encodePng(raster) });
    }
  } finally {
    await task.destroy();
  }
  return pages;
}

export const bodyText = (page: PageAnalysis) => page.body;
