import "server-only";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import Sparticuz from "@sparticuz/chromium";
import { chromium, type Browser } from "playwright-core";

/**
 * HTML → PDF. The engine prints what it is given and nothing else: it never lays content out itself (one renderer: the sheet's
 * HTML/CSS), never touches the network and holds no secret, session or cookie. Pagination, page size and page numbers come from
 * `material.css` (`@page`); Chromium only applies them.
 */
export interface PdfEngine {
  readonly name: string;
  render(html: string, expect: PrintExpectations): Promise<PdfRenderResult>;
}

export interface PrintExpectations {
  /** The font family the sheet must have loaded (every weight) before printing. */
  fontFamily: string;
  fontWeights: readonly number[];
}

export interface PdfRenderResult {
  pdf: Uint8Array;
  timings: { launchMs: number; contentMs: number; readyMs: number; pdfMs: number; totalMs: number };
  readiness: Readiness;
  /** Requests the document tried to make (all blocked). A non-empty list fails the render. */
  blockedRequests: string[];
  engine: Record<string, string | null>;
}

export interface Readiness {
  readyState: string;
  fontFamily: string;
  loadedWeights: number[];
  images: number;
  brokenImages: number;
  stableFrames: boolean;
}

export type PdfEngineErrorCode = "launch_failed" | "content_failed" | "font_not_ready" | "asset_not_ready" | "layout_unstable" | "network_attempted" | "render_failed" | "timeout";

export class PdfEngineError extends Error {
  constructor(
    readonly code: PdfEngineErrorCode,
    readonly detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
  }
}

export interface ChromiumEngineOptions {
  /** Per step (launch, content, readiness, print). */
  timeoutMs?: number;
}

const require = createRequire(path.join(process.cwd(), "package.json"));

// The serverless build's own flags, minus the two that would weaken the page's isolation: the sheet needs neither.
const UNSAFE_FLAGS = new Set(["--disable-web-security", "--allow-running-insecure-content"]);

/**
 * Chromium is unpacked to /tmp once per instance. Two exports arriving together on a new instance (concurrent requests share it)
 * would each start unpacking, and one could run the binary while the other is still writing it (`spawn ETXTBSY`): one unpacking
 * per process, shared by every export; retried on the next export if it failed.
 */
let unpacked: Promise<string> | null = null;
function chromiumExecutable(): Promise<string> {
  unpacked ??= Sparticuz.executablePath().catch((error: unknown) => {
    unpacked = null;
    throw error;
  });
  return unpacked;
}

/** Read at run time, for provenance only. Some packages do not export their package.json: walk up from their entry point. */
function packageVersion(name: string): string | null {
  try {
    let dir = path.dirname(require.resolve(name));
    for (let i = 0; i < 5; i++, dir = path.dirname(dir)) {
      const candidate = path.join(dir, "package.json");
      if (!existsSync(candidate)) continue;
      const pkg = JSON.parse(readFileSync(candidate, "utf8")) as { name?: string; version?: string };
      if (pkg.name === name) return pkg.version ?? null;
    }
    return null;
  } catch {
    return null;
  }
}

async function withTimeout<T>(work: Promise<T>, ms: number, code: PdfEngineErrorCode): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new PdfEngineError(code, `más de ${ms} ms`)), ms)))]);
  } finally {
    clearTimeout(timer);
  }
}

/** Runs inside the page (Playwright evaluates it; the document itself has no script). */
async function inspectReadiness({ family, weights }: { family: string; weights: number[] }): Promise<Readiness> {
  await document.fonts.ready;
  await Promise.all(weights.map((w) => document.fonts.load(`${w} 16px "${family}"`)));
  const loadedWeights = [...document.fonts].filter((f) => f.family.replace(/["']/g, "") === family && f.status === "loaded").map((f) => Number(f.weight));
  const root = document.querySelector(".ms-root");
  const used = root ? getComputedStyle(root).fontFamily.split(",")[0]!.trim().replace(/["']/g, "") : "";
  const images = [...document.images];
  const decoded = await Promise.all(
    images.map(async (img) => {
      try {
        if (!img.complete) await new Promise((resolve, reject) => ((img.onload = resolve), (img.onerror = reject)));
        await img.decode();
        return img.naturalWidth > 0 && img.naturalHeight > 0;
      } catch {
        return false;
      }
    }),
  );
  const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const height = () => document.documentElement.scrollHeight;
  await frame();
  const h1 = height();
  await frame();
  await frame();
  return { readyState: document.readyState, fontFamily: used, loadedWeights, images: images.length, brokenImages: decoded.filter((ok) => !ok).length, stableFrames: height() === h1 };
}

/**
 * Chromium through `playwright-core`, with the serverless Chromium of `@sparticuz/chromium` (versions pinned together: Playwright
 * 1.63 drives Chromium 153). One browser per render: in the serverless build (`--single-process`) closing the last page ends the
 * browser, and a fresh browser per export also means no state is ever shared between two documents.
 */
export function createChromiumPdfEngine(options: ChromiumEngineOptions = {}): PdfEngine {
  const timeoutMs = options.timeoutMs ?? 30_000;
  return {
    name: "chromium",
    async render(html, expect) {
      const started = performance.now();
      Sparticuz.setGraphicsMode = false;

      let browser: Browser;
      try {
        const executablePath = await chromiumExecutable();
        browser = await chromium.launch({ executablePath, args: Sparticuz.args.filter((a) => !UNSAFE_FLAGS.has(a)), headless: true, timeout: timeoutMs });
      } catch (error) {
        throw new PdfEngineError("launch_failed", (error as Error).message.split("\n")[0]);
      }
      const launched = performance.now();
      const blockedRequests: string[] = [];
      try {
        const context = await browser.newContext({ offline: true, serviceWorkers: "block", acceptDownloads: false, bypassCSP: false, locale: "es-ES", timezoneId: "UTC", colorScheme: "light", reducedMotion: "reduce" });
        await context.route("**/*", async (route) => {
          blockedRequests.push(route.request().url());
          await route.abort("blockedbyclient");
        });
        const page = await context.newPage();
        page.on("request", (request) => {
          const url = request.url();
          if (!url.startsWith("data:") && !blockedRequests.includes(url)) blockedRequests.push(url);
        });

        try {
          await page.setContent(html, { waitUntil: "load", timeout: timeoutMs });
        } catch (error) {
          throw new PdfEngineError("content_failed", (error as Error).message.split("\n")[0]);
        }
        const contentLoaded = performance.now();

        let readiness: Readiness;
        try {
          readiness = await withTimeout(page.evaluate(inspectReadiness, { family: expect.fontFamily, weights: [...expect.fontWeights] }), timeoutMs, "timeout");
        } catch (error) {
          if (blockedRequests.length > 0) throw new PdfEngineError("network_attempted", `${blockedRequests.length} petición(es)`);
          if (error instanceof PdfEngineError) throw error;
          throw new PdfEngineError("font_not_ready", (error as Error).message.split("\n")[0]);
        }
        if (blockedRequests.length > 0) throw new PdfEngineError("network_attempted", `${blockedRequests.length} petición(es)`);
        if (readiness.readyState !== "complete") throw new PdfEngineError("content_failed", readiness.readyState);
        if (readiness.fontFamily !== expect.fontFamily || expect.fontWeights.some((w) => !readiness.loadedWeights.includes(w))) throw new PdfEngineError("font_not_ready", readiness.fontFamily);
        if (readiness.brokenImages > 0) throw new PdfEngineError("asset_not_ready", `${readiness.brokenImages} imagen(es)`);
        if (!readiness.stableFrames) throw new PdfEngineError("layout_unstable");
        const ready = performance.now();

        let pdf: Buffer;
        try {
          pdf = await withTimeout(page.pdf({ format: "A4", preferCSSPageSize: true, printBackground: true, tagged: true, outline: false }), timeoutMs, "timeout");
        } catch (error) {
          if (error instanceof PdfEngineError) throw error;
          throw new PdfEngineError("render_failed", (error as Error).message.split("\n")[0]);
        }
        if (blockedRequests.length > 0) throw new PdfEngineError("network_attempted", `${blockedRequests.length} petición(es)`);
        const printed = performance.now();

        return {
          pdf: new Uint8Array(pdf),
          timings: { launchMs: launched - started, contentMs: contentLoaded - launched, readyMs: ready - contentLoaded, pdfMs: printed - ready, totalMs: printed - started },
          readiness,
          blockedRequests,
          engine: { "playwright-core": packageVersion("playwright-core"), "@sparticuz/chromium": packageVersion("@sparticuz/chromium"), chromium: browser.version(), node: process.version, platform: process.platform, arch: process.arch },
        };
      } finally {
        await browser.close().catch(() => undefined);
      }
    },
  };
}
