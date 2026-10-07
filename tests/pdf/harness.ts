import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createChromiumPdfEngine, type PdfRenderResult } from "@/lib/render/print/engine";
import { renderPrintHtml, type PrintHtml } from "@/lib/render/print/html";
import type { PinnedAsset } from "@/lib/render/print/pinned-assets";
import { validatePdf, type PdfValidation } from "@/lib/render/print/validation";
import type { RenderModel } from "@/lib/render/model";
import { analyzePdf, type PageAnalysis } from "./analyze";

export const OUT_DIR = path.join(process.cwd(), ".pdf-smoke");
export const engine = createChromiumPdfEngine({ timeoutMs: 60_000 });

export interface Printed {
  name: string;
  print: PrintHtml;
  result: PdfRenderResult;
  validation: PdfValidation;
  pages: PageAnalysis[];
  /** Peak RSS of Chromium alone (every descendant process of this one). */
  peakRssMb: number;
  validationMs: number;
}

/** Peak resident memory of this process's descendants (Chromium), sampled while `work` runs. Linux only (`/proc`). */
async function withPeakRss<T>(work: () => Promise<T>): Promise<{ value: T; peakMb: number }> {
  const rssKb = (pid: number) => {
    try {
      return Number(/VmRSS:\s+(\d+)/.exec(readFileSync(`/proc/${pid}/status`, "utf8"))?.[1] ?? 0);
    } catch {
      return 0;
    }
  };
  const tree = (): number[] => {
    const parents = new Map<number, number>();
    for (const entry of readdirSync("/proc")) {
      if (!/^\d+$/.test(entry)) continue;
      try {
        const stat = readFileSync(`/proc/${entry}/stat`, "utf8");
        parents.set(Number(entry), Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]));
      } catch {
        // the process ended while we were looking
      }
    }
    const out = [process.pid];
    for (let i = 0; i < out.length; i++) for (const [pid, ppid] of parents) if (ppid === out[i]) out.push(pid);
    return out;
  };
  let peak = 0;
  const sample = () => (peak = Math.max(peak, tree().filter((pid) => pid !== process.pid).reduce((n, pid) => n + rssKb(pid), 0)));
  const timer = setInterval(sample, 25);
  try {
    const value = await work();
    sample();
    return { value, peakMb: Math.round(peak / 1024) };
  } finally {
    clearInterval(timer);
  }
}

export async function printPdf(name: string, model: RenderModel, pins: PinnedAsset[] = [], minImages = 0): Promise<Printed> {
  const print = await renderPrintHtml(model, pins);
  const { value: result, peakMb } = await withPeakRss(() => engine.render(print.html, { fontFamily: print.fontFamily, fontWeights: print.fontWeights }));
  const started = performance.now();
  const validation = await validatePdf(result.pdf, { fontPrefix: "Inter", minImages, minPages: model.pages.length });
  const validationMs = performance.now() - started;
  const pages = await analyzePdf(result.pdf);
  const dir = path.join(OUT_DIR, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "sheet.pdf"), result.pdf);
  writeFileSync(path.join(dir, "sheet.html"), print.html);
  for (const page of pages) writeFileSync(path.join(dir, `page-${page.number}.png`), page.png);
  return { name, print, result, validation, pages, peakRssMb: peakMb, validationMs };
}
