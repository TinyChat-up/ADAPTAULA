import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { z } from "zod";
import { encodePng, renderPage } from "@/lib/materials/visuals/raster";
import { VISUAL_CROP_RECIPE } from "@/lib/materials/visuals/recipe";
import { expectedMarker, visualFixtureImage, visualFixturePdf } from "../../../../tests/support/visual-fixture";

export const dynamic = "force-dynamic";

// Only on a Vercel Preview deployment: every other environment (production, local, tests) gets a plain 404.
const isPreview = () => process.env.VERCEL_ENV === "preview";

const FIXTURES = {
  basic: { page: 1, mime: "application/pdf" },
  vector: { page: 2, mime: "application/pdf" },
  rot90: { page: 3, mime: "application/pdf" },
  rot180: { page: 4, mime: "application/pdf" },
  rot270: { page: 5, mime: "application/pdf" },
  cropbox: { page: 6, mime: "application/pdf" },
  image: { page: 1, mime: "image/png" },
} as const;

const Query = z.object({
  fixture: z.enum(Object.keys(FIXTURES) as [keyof typeof FIXTURES, ...(keyof typeof FIXTURES)[]]),
  repeat: z.coerce.number().int().min(1).max(3).default(2),
});

const bootedAt = Date.now();
let invocations = 0;
let sources: Promise<{ pdf: Uint8Array; image: Uint8Array }> | null = null;

function nativeBinding() {
  const require = createRequire(path.join(process.cwd(), "package.json"));
  const fromCanvas = createRequire(require.resolve("@napi-rs/canvas"));
  const candidates = ["linux-x64-gnu", "linux-x64-musl", "linux-arm64-gnu", "linux-arm64-musl", "darwin-arm64", "darwin-x64"];
  const resolved = candidates.filter((c) => {
    try {
      fromCanvas.resolve(`@napi-rs/canvas-${c}/package.json`);
      return true;
    } catch {
      return false;
    }
  });
  const version = (name: string) => (fromCanvas(`${name}/package.json`) as { version: string }).version;
  const report = process.report?.getReport() as { header?: { glibcVersionRuntime?: string } } | undefined;
  return {
    napiCanvasVersion: version("@napi-rs/canvas"),
    pdfjsVersion: (require("pdfjs-dist/package.json") as { version: string }).version,
    bindingPackages: resolved,
    platform: `${process.platform}-${process.arch}`,
    glibc: report?.header?.glibcVersionRuntime ?? null,
  };
}

export async function GET(request: Request) {
  if (!isPreview()) return new Response("Not found", { status: 404 });
  const parsed = Query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return Response.json({ ok: false, error: "invalid_fixture", allowed: Object.keys(FIXTURES) }, { status: 400 });
  const { fixture, repeat } = parsed.data;
  const spec = FIXTURES[fixture];
  const coldStart = invocations++ === 0;

  try {
    sources ??= Promise.all([visualFixturePdf(), visualFixtureImage()]).then(([pdf, image]) => ({ pdf, image }));
    const { pdf, image } = await sources;
    const bytes = spec.mime === "application/pdf" ? pdf : image;
    const runs: { width: number; height: number; box: unknown; pngBytes: number; pngSignatureOk: boolean; markerIsRed: boolean; sha256: string; durationMs: number }[] = [];
    for (let i = 0; i < repeat; i++) {
      const started = performance.now();
      const page = await renderPage(bytes, spec.mime, spec.page, { dpi: VISUAL_CROP_RECIPE.dpi, maxPx: VISUAL_CROP_RECIPE.max_px });
      const png = await encodePng(page);
      const durationMs = Math.round(performance.now() - started);
      const marker = spec.mime === "application/pdf" ? expectedMarker(spec.page) : { x: 130 / 800, y: 110 / 600 };
      const px = page.canvas.getContext("2d").getImageData(Math.round(marker.x * page.width), Math.round(marker.y * page.height), 1, 1).data;
      runs.push({
        width: page.width,
        height: page.height,
        box: page.box,
        pngBytes: png.length,
        pngSignatureOk: png.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
        markerIsRed: px[0]! > 200 && px[1]! < 60 && px[2]! < 60,
        sha256: createHash("sha256").update(png).digest("hex"),
        durationMs,
      });
    }
    return Response.json(
      {
        ok: runs.every((r) => r.pngSignatureOk && r.markerIsRed),
        fixture,
        recipe: VISUAL_CROP_RECIPE.version,
        deterministic: runs.every((r) => r.sha256 === runs[0]!.sha256),
        runs,
        runtime: { node: process.version, region: process.env.VERCEL_REGION ?? null, coldStart, instanceAgeMs: Date.now() - bootedAt, rssMb: Math.round(process.memoryUsage().rss / 2 ** 20), ...nativeBinding() },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const e = error as { name?: string; code?: string; message?: string };
    return Response.json({ ok: false, fixture, error: { name: e.name ?? "Error", code: e.code ?? null, message: String(e.message ?? "").slice(0, 200) } }, { status: 500 });
  }
}
