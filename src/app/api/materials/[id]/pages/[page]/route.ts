import { apiError, getApiContext } from "@/lib/api/context";
import { getMaterialDetail } from "@/lib/materials/repository";
import { downloadSource } from "@/lib/materials/storage";
import { RasterError, encodePng, renderPage } from "@/lib/materials/visuals/raster";

export const dynamic = "force-dynamic";

/** Preview density of a page for the selection tool. Same rasteriser and surface as the crop (200 ppp), only lighter. */
const PREVIEW = { dpi: 110, maxPx: 2000 } as const;

/**
 * One page of a material's ORIGINAL, rendered on the server "as shown" (CropBox, rotation applied). The selection tool draws on
 * this image, so its normalised coordinates are those of the page the crop producer renders. Authorised by the user's RLS.
 */
export async function GET(request: Request, { params }: RouteContext<"/api/materials/[id]/pages/[page]">) {
  const auth = await getApiContext(request, { mutating: false });
  if ("response" in auth) return auth.response;
  const { id, page } = await params;
  const pageNumber = Number(page);
  const notFound = () => apiError(404, "not_found", "No hemos encontrado esa página.");
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > 500) return notFound();

  const detail = await getMaterialDetail(auth.ctx.workspace.id, id);
  if (!detail?.file) return notFound();
  const bytes = await downloadSource(detail.file.storage_path);
  if (!bytes) return notFound();
  try {
    const rendered = await renderPage(bytes, detail.file.mime_type, pageNumber, PREVIEW);
    return new Response(Buffer.from(await encodePng(rendered)), {
      headers: { "Content-Type": "image/png", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
    });
  } catch (error) {
    if (error instanceof RasterError && error.code === "page_missing") return notFound();
    return apiError(422, "unrenderable", "No hemos podido mostrar esta página.");
  }
}
