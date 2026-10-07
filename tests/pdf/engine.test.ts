import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PRINT_CSP } from "@/lib/render/print/html";
import { PdfEngineError } from "@/lib/render/print/engine";
import { analyzePdf } from "./analyze";
import { engine } from "./harness";

/** The real engine refuses what the printed sheet must never depend on: the network, a missing font, a broken image, scripts. */

const FONT = { fontFamily: "Adaptaula Inter", fontWeights: [400] };
const doc = (head: string, body: string) => `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${PRINT_CSP}">${head}</head><body>${body}</body></html>`;

let server: Server;
let hits = 0;
let origin = "";

beforeAll(async () => {
  server = createServer((_, res) => {
    hits += 1;
    res.end("x");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe("PdfEngine (Chromium) · isolation", () => {
  it("blocks every request: an image, a stylesheet and a font pointing at a live local server never reach it, and the render fails", async () => {
    const html = `<!doctype html><html><head><link rel="stylesheet" href="${origin}/a.css"><style>@font-face{font-family:X;src:url(${origin}/f.woff2)} body{font-family:X}</style></head><body><img src="${origin}/i.png"><p>hola</p></body></html>`;
    const error = await engine.render(html, { fontFamily: "X", fontWeights: [400] }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PdfEngineError);
    expect((error as PdfEngineError).code).toBe("network_attempted");
    expect(hits).toBe(0);
  });

  it("fails explicitly when the sheet font is not available (never prints with a fallback font)", async () => {
    const error = await engine.render(doc("<style>body{font-family:'Adaptaula Inter',sans-serif}</style>", '<div class="ms-root">Hola</div>'), FONT).catch((e: unknown) => e);
    expect((error as PdfEngineError).code).toBe("font_not_ready");
  });

  it("fails explicitly when an image cannot be decoded", async () => {
    const error = await engine.render(doc("", '<img src="data:image/png;base64,AAAA">'), { fontFamily: "", fontWeights: [] }).catch((e: unknown) => e);
    expect((error as PdfEngineError).code).toBe("asset_not_ready");
  });

  it("a script in the document never runs (CSP), even though the engine itself can evaluate readiness checks", async () => {
    const html = doc("", '<p id="t">ESTATICO</p><script>document.getElementById("t").textContent = "EJECUTADO"</script>');
    const result = await engine.render(html, { fontFamily: "", fontWeights: [] });
    const [page] = await analyzePdf(result.pdf);
    expect(page!.text).toContain("ESTATICO");
    expect(page!.text).not.toContain("EJECUTADO");
    expect(result.readiness.readyState).toBe("complete");
    expect(result.engine.chromium).toMatch(/^153\./);
    expect(result.engine["playwright-core"]).toBe("1.63.0");
    expect(result.engine["@sparticuz/chromium"]).toBe("153.0.0");
  });
});
