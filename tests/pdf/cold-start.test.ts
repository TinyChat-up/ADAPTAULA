import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

// A new instance: Chromium not unpacked yet. Set before the engine is imported, because @sparticuz/chromium reads the temporary
// directory when it loads (its native libraries' path on Amazon Linux, as in Vercel).
process.env.TMPDIR = mkdtempSync(path.join(tmpdir(), "adaptaula-cold-"));

const { createChromiumPdfEngine } = await import("@/lib/render/print/engine");

describe("PdfEngine (Chromium) · a new instance", () => {
  it("two exports at once on a cold instance both print: Chromium is unpacked once, never run half-written", async () => {
    const engine = createChromiumPdfEngine();
    const html = (n: number) => `<!doctype html><html lang="es"><body><p>Ficha ${n}</p></body></html>`;
    const results = await Promise.allSettled([engine.render(html(1), { fontFamily: "", fontWeights: [] }), engine.render(html(2), { fontFamily: "", fontWeights: [] })]);
    expect(results.map((r) => (r.status === "fulfilled" ? "ok" : String((r.reason as Error).message)))).toEqual(["ok", "ok"]);
  });
});
