import type { NextConfig } from "next";
import { packageFiles } from "./next.tracing";

/** Files the PDF rasteriser needs at run time that the tracer does not find by itself (checked by `scripts/smoke-raster.mjs`). */
// The package.json too: the rasteriser resolves it at run time to find `standard_fonts/`. From the package's physical directory,
// never through the `node_modules/pdfjs-dist` symlink of pnpm (next.tracing.ts).
const RASTER_FILES = packageFiles("pdfjs-dist", ["package.json", "legacy/build/pdf.worker.mjs", "standard_fonts/**/*"]);

const nextConfig: NextConfig = {
  // Los E2E arrancan su propio `next dev` con otro directorio de build para no chocar con el servidor de desarrollo del docente/dev.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Rasteriser of original pages (src/lib/materials/visuals/raster.ts): a native addon and pdf.js run from node_modules, unbundled.
  serverExternalPackages: ["pdfjs-dist", "@napi-rs/canvas"],
  outputFileTracingIncludes: {
    // Keys are picomatch globs of the route path (a literal `[id]` would be a character class): one `*` per dynamic segment.
    // `scripts/smoke-raster.mjs` checks after every build that both traces really contain these files.
    "/api/materials/*/pages/*": RASTER_FILES,
    "/api/materials/*/visuals/*": RASTER_FILES,
    // VALIDATION ONLY (fix/vercel-pnpm-tracing; removed before the production PR): the PDF smoke route. The serverless Chromium is
    // read by path at run time and never traced on its own; physical directory, like every include.
    "/api/preview-pdf-smoke": [...RASTER_FILES, ...packageFiles("@sparticuz/chromium", ["bin/*"])],
  },
};

export default nextConfig;
