import "server-only";
import { pageRgba, pageText, renderPage, type PageBox, type RasterPage } from "../raster";
import { lumaOf, textBoxesToPx, type PageModel } from "./page-model";

/** An uploaded photo or scan has no physical size: it is read as an A4 page width (thresholds stay in a sensible range). */
const IMAGE_WIDTH_MM = 210;

/** One page of the stored original, rendered by the same rasteriser as the crops, with its PDF text layer on the same surface. */
export async function readPage(bytes: Uint8Array, mime: string, page: number, dpi: number): Promise<{ model: PageModel; box: PageBox; raster: RasterPage }> {
  const raster = await renderPage(bytes, mime, page, { dpi, maxPx: 4096 });
  const texts = await pageText(bytes, mime, page);
  const widthMm = raster.box.kind === "pdf" ? (raster.box.width_pt * 25.4) / 72 : IMAGE_WIDTH_MM;
  return {
    model: { width: raster.width, height: raster.height, gray: lumaOf(pageRgba(raster), raster.width, raster.height), texts: textBoxesToPx(texts, raster.width, raster.height), mmPerPx: widthMm / raster.width },
    box: raster.box,
    raster,
  };
}
