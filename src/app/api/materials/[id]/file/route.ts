import { NextResponse } from "next/server";
import { apiError, getApiContext } from "@/lib/api/context";
import { downloadSource, createReadUrl } from "@/lib/materials/storage";
import { getMaterialDetail } from "@/lib/materials/repository";

/** Largest PDF streamed through the app (the platform caps response bodies); bigger ones use a signed URL. */
const MAX_INLINE_BYTES = 4 * 1024 * 1024;

/**
 * Original file of a material. Authorization is the user's own RLS: no permanent URL exists. Images and
 * downloads redirect to a signed URL that lives one minute; small PDFs are streamed for in-page preview.
 */
export async function GET(request: Request, { params }: RouteContext<"/api/materials/[id]/file">) {
  const auth = await getApiContext(request, { mutating: false });
  if ("response" in auth) return auth.response;
  const { id } = await params;

  const detail = await getMaterialDetail(auth.ctx.workspace.id, id);
  if (!detail?.file) return apiError(404, "not_found", "No hemos encontrado ese material.");
  const { file } = detail;
  const wantsDownload = new URL(request.url).searchParams.get("download") === "1";

  if (!wantsDownload && file.mime_type === "application/pdf" && file.size_bytes <= MAX_INLINE_BYTES) {
    const bytes = await downloadSource(file.storage_path);
    if (!bytes) return apiError(404, "not_found", "No hemos encontrado el archivo.");
    return new Response(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": "inline",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  }

  const url = await createReadUrl(file.storage_path, { download: wantsDownload });
  if (!url) return apiError(404, "not_found", "No hemos encontrado el archivo.");
  return NextResponse.redirect(url, { status: 302, headers: { "Cache-Control": "private, no-store" } });
}
