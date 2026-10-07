import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { z } from "zod";
import { createChromiumPdfEngine, PdfEngineError } from "@/lib/render/print/engine";
import { renderPrintHtml } from "@/lib/render/print/html";
import { validatePdf } from "@/lib/render/print/validation";
import { MATERIAL_RENDERER_VERSION } from "@/lib/render/version";
import { FIXTURES, NETWORK_PROBE_HTML, SPANISH } from "./fixtures";

/**
 * VALIDATION_ONLY (rama phase5/pdf-vercel-validation; nunca entra en main ni en la PR #3). Ejecuta el pipeline real de la Fase
 * 5.2A sobre fichas sintéticas embebidas dentro de una Vercel Function y devuelve solo metadatos: nunca el PDF, el HTML, variables
 * de entorno ni rutas. Sin Supabase, sin sesión, sin Storage, sin modelos.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Only on a Vercel Preview deployment: every other environment (production, local, tests) gets a plain 404.
const isPreview = () => process.env.VERCEL_ENV === "preview";

const FIXTURE_NAMES: [string, ...string[]] = ["network", ...Object.keys(FIXTURES)];
// Strict: only `fixture` is accepted; any other parameter (url, path, file…) is a 400.
const Query = z.object({ fixture: z.enum(FIXTURE_NAMES) }).strict();

const bootedAt = Date.now();
let invocations = 0;
const engine = createChromiumPdfEngine({ timeoutMs: 40_000 });

/** Peak RSS (MB) of this process and of its descendants (Chromium), sampled every 20 ms while `work` runs. */
async function withPeakRss<T>(work: () => Promise<T>): Promise<{ value: T; nodeMb: number; chromiumMb: number }> {
  const rssKb = (pid: number) => {
    try {
      return Number(/VmRSS:\s+(\d+)/.exec(readFileSync(`/proc/${pid}/status`, "utf8"))?.[1] ?? 0);
    } catch {
      return 0;
    }
  };
  const children = (): number[] => {
    const parents = new Map<number, number>();
    try {
      for (const e of readdirSync("/proc")) {
        if (!/^\d+$/.test(e)) continue;
        try {
          const stat = readFileSync(`/proc/${e}/stat`, "utf8");
          parents.set(Number(e), Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]));
        } catch {
          // ended meanwhile
        }
      }
    } catch {
      return [];
    }
    const out = [process.pid];
    for (let i = 0; i < out.length; i++) for (const [pid, ppid] of parents) if (ppid === out[i]) out.push(pid);
    return out.slice(1);
  };
  let node = 0;
  let chromium = 0;
  const sample = () => {
    node = Math.max(node, rssKb(process.pid));
    chromium = Math.max(chromium, children().reduce((n, pid) => n + rssKb(pid), 0));
  };
  const timer = setInterval(sample, 20);
  try {
    const value = await work();
    sample();
    return { value, nodeMb: Math.round(node / 1024), chromiumMb: Math.round(chromium / 1024) };
  } finally {
    clearInterval(timer);
  }
}

/** Text per page (pdf.js, no rendering), to check that text is extractable and where the physical page number is. */
async function pdfText(pdf: Uint8Array): Promise<Array<{ text: string; label: string | null; labelInMargin: boolean; fonts: string[] }>> {
  const napi = await import("@napi-rs/canvas");
  const g = globalThis as Record<string, unknown>;
  g.Path2D ??= napi.Path2D;
  g.DOMMatrix ??= napi.DOMMatrix;
  g.ImageData ??= napi.ImageData;
  const lib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = lib.getDocument({ data: new Uint8Array(pdf), disableFontFace: true, useSystemFonts: false, verbosity: 0 });
  const doc = await task.promise;
  try {
    const pages = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      const items = content.items.filter((i): i is typeof i & { str: string; transform: number[]; fontName: string } => "str" in i);
      const label = items.find((i) => /^\d+ \/ \d+$/.test(i.str.trim()));
      pages.push({
        text: items.map((i) => i.str).join(" ").replace(/\s+/g, " ").trim(),
        label: label?.str.trim() ?? null,
        labelInMargin: Boolean(label && label.transform[5]! < (18 * 72) / 25.4 && label.transform[4]! > 595.28 / 2),
        fonts: [...new Set(items.map((i) => i.fontName))],
      });
    }
    return pages;
  } finally {
    await task.destroy();
  }
}

const version = (name: string) => {
  try {
    return (createRequire(path.join(process.cwd(), "package.json"))(`${name}/package.json`) as { version: string }).version;
  } catch {
    return null;
  }
};
const ms = (n: number) => Math.round(n);

export async function GET(request: Request) {
  if (!isPreview()) return new Response("Not found", { status: 404 });
  const parsed = Query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return Response.json({ ok: false, error: "invalid_request", allowed: FIXTURE_NAMES }, { status: 400 });
  const { fixture } = parsed.data;
  invocations += 1;
  const runtime = { node: process.version, platform: `${process.platform}-${process.arch}`, region: process.env.VERCEL_REGION ?? null, coldInstance: invocations === 1, invocation: invocations, instanceAgeMs: Date.now() - bootedAt };

  if (fixture === "network") {
    const started = performance.now();
    const outcome = await engine.render(NETWORK_PROBE_HTML, { fontFamily: "", fontWeights: [] }).then(
      () => "rendered",
      (e: unknown) => (e instanceof PdfEngineError ? e.code : "error"),
    );
    return Response.json({ ok: outcome === "network_attempted", fixture, outcome, runtime, totalMs: ms(performance.now() - started) });
  }

  const f = FIXTURES[fixture as keyof typeof FIXTURES];
  try {
    const t0 = performance.now();
    const renderModel = f.model();
    const t1 = performance.now();
    const print = await renderPrintHtml(renderModel, f.pins);
    const t2 = performance.now();
    const { value: result, nodeMb, chromiumMb } = await withPeakRss(() => engine.render(print.html, { fontFamily: print.fontFamily, fontWeights: print.fontWeights }));
    const t3 = performance.now();
    const validation = await validatePdf(result.pdf, { fontPrefix: "Inter", minImages: f.images, minPages: renderModel.pages.length });
    const t4 = performance.now();
    const pages = await pdfText(result.pdf);
    const t5 = performance.now();
    const all = pages.map((p) => p.text).join(" ");
    const checks = {
      pdfHeader: Buffer.from(result.pdf.subarray(0, 5)).toString("latin1") === "%PDF-",
      validation: validation.ok,
      expectedPages: validation.pageCount === f.pages,
      a4: validation.pages.every((p) => Math.abs(p.widthPt - 595.28) < 2 && Math.abs(p.heightPt - 841.89) < 2),
      textExtractable: pages.every((p) => p.text.length > 0),
      expectedTexts: f.texts.every((t) => all.includes(t)),
      spanishGlyphs: fixture !== "spanish" || [..."ñÑáéíóúü¿¡º·…«»–—"].every((c) => all.includes(c)) && all.includes(SPANISH),
      pageNumbers: pages.every((p, i) => p.label === `${i + 1} / ${pages.length}` && p.labelInMargin),
      onlyInterFonts: validation.fonts.length > 0 && validation.fonts.every((n) => n.startsWith("Inter-")),
      fontReady: result.readiness.fontFamily === print.fontFamily && print.fontWeights.every((w) => result.readiness.loadedWeights.includes(w)),
      images: validation.imageCount >= f.images && result.readiness.brokenImages === 0,
      networkRequests: result.blockedRequests.length === 0,
    };
    return Response.json({
      ok: Object.values(checks).every(Boolean),
      fixture,
      checks,
      page_count: validation.pageCount,
      byte_size: validation.byteSize,
      pdf_sha256: validation.sha256,
      issues: validation.issues,
      fonts: validation.fonts,
      image_count: validation.imageCount,
      tagged: validation.tagged,
      renderer_version: MATERIAL_RENDERER_VERSION,
      engine: result.engine,
      versions: { "playwright-core": version("playwright-core"), next: version("next"), react: version("react") },
      readiness: result.readiness,
      runtime,
      timings: {
        buildRenderModelMs: ms(t1 - t0),
        renderPrintHtmlMs: ms(t2 - t1),
        launchMs: ms(result.timings.launchMs),
        setContentMs: ms(result.timings.contentMs),
        readinessMs: ms(result.timings.readyMs),
        pagePdfMs: ms(result.timings.pdfMs),
        engineTotalMs: ms(t3 - t2),
        validationMs: ms(t4 - t3),
        textChecksMs: ms(t5 - t4),
        totalMs: ms(t5 - t0),
      },
      memory: { peakNodeRssMb: nodeMb, peakChromiumRssMb: chromiumMb, heapUsedMb: Math.round(process.memoryUsage().heapUsed / 1048576) },
    });
  } catch (e) {
    const code = e instanceof PdfEngineError ? e.code : e instanceof Error ? e.name : "error";
    // A short, safe failure: the error code and its first line with every path masked (no stack).
    return Response.json({ ok: false, fixture, error: code, message: e instanceof Error ? e.message.split("\n")[0]!.replace(/\/[^\s"']+/g, "<ruta>").slice(0, 300) : null, runtime }, { status: 500 });
  }
}
