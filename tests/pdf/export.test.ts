import type { PGlite } from "@electric-sql/pglite";
import type { ResourceDeps } from "@/lib/adaptation/resources/service";
import { resourceHarness } from "../db/resource-harness";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ServiceDeps } from "@/lib/adaptation/orchestration/service";
import type { VisualDeps } from "@/lib/materials/visuals/service";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { PdfEngineError } from "@/lib/render/print/engine";
import { pdfEngine } from "@/lib/render/print/server";
import { validatePdf } from "@/lib/render/print/validation";
import { createTestDb } from "../db/harness";
import { deliveredWithVisuals, footprint, replaceDocument, type World } from "../db/pdf-export-harness";
import { analyzePdf } from "./analyze";
import { SPANISH, chart, document, heading, image, lines, paragraph, table } from "./fixtures";
import { OUT_DIR } from "./harness";

/**
 * The product export end to end, LOCALLY, with nothing simulated but the session: real migrations (PGlite), real pipeline output
 * (scripted providers, 0 model calls), real crops located by a person, the real route, the real `material_renderer@v2`, the real
 * serverless Chromium and the production validation; then the PDF is read back with pdf.js. Times are recorded, never asserted.
 */

const session: { userId: string; workspaceId: string; deps: ServiceDeps; visuals: VisualDeps; resources: ResourceDeps } = { userId: "", workspaceId: "", deps: null as never, visuals: null as never, resources: null as never };
vi.mock("@/lib/api/context", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/context")>("@/lib/api/context");
  return { ...actual, getApiContext: async () => ({ ctx: { user: { id: session.userId }, workspace: { id: session.workspaceId }, role: "teacher" } }) };
});
vi.mock("@/lib/auth/session", () => ({ getSupabase: async () => ({}) }));
vi.mock("@/lib/adaptation/orchestration/server", () => ({ serviceDeps: () => session.deps }));
vi.mock("@/lib/materials/visuals/server", () => ({ visualDeps: () => session.visuals }));
vi.mock("@/lib/adaptation/resources/server", () => ({ resourceDeps: () => session.resources }));

const { GET } = await import("@/app/api/adaptations/[id]/pdf/route");

let db: PGlite;
let world: World;
const report: Array<Record<string, unknown>> = [];
beforeAll(async () => {
  db = await createTestDb();
  world = await deliveredWithVisuals(db);
  Object.assign(session, { userId: world.user.id, workspaceId: world.user.workspaceId, deps: world.deps, visuals: world.visuals.deps, resources: resourceHarness(db, world.user).deps });
}, 180_000);
// Written next to the PDFs (vitest hides the console of passing tests); `scripts/smoke-pdf.mjs` prints it.
afterAll(() => writeFileSync(path.join(OUT_DIR, "export-report.json"), JSON.stringify(report, null, 2)));

async function exportNow(name: string) {
  const started = performance.now();
  const res = await GET(new Request(`http://localhost/api/adaptations/${world.id}/pdf`), { params: Promise.resolve({ id: world.id }) } as never);
  const ms = Math.round(performance.now() - started);
  expect(res.status, await res.clone().text().then((t) => t.slice(0, 200))).toBe(200);
  const pdf = new Uint8Array(await res.arrayBuffer());
  const pages = await analyzePdf(pdf);
  mkdirSync(path.join(OUT_DIR, `export_${name}`), { recursive: true });
  writeFileSync(path.join(OUT_DIR, `export_${name}`, "sheet.pdf"), pdf);
  report.push({ case: name, pages: pages.length, kb: Math.round(pdf.length / 1024), requestMs: ms });
  return { res, pdf, pages, text: pages.map((p) => p.text).join(" ") };
}

describe("product PDF export (real Chromium)", () => {
  it("the delivered sheet (pipeline output) with its two located crops: a valid A4 PDF download (cold-ish: first Chromium of this process)", async () => {
    const { res, pdf, pages } = await exportNow("entregada_cold");
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Disposition")).toMatch(/^attachment; filename="[^"\\/]+\.pdf"; filename\*=UTF-8''[A-Za-z0-9%._~-]+\.pdf$/);
    expect(res.headers.get("Content-Disposition")).not.toContain(world.id);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(Number(res.headers.get("Content-Length"))).toBe(pdf.length);
    expect(Buffer.from(pdf.subarray(0, 5)).toString("latin1")).toBe("%PDF-");
    const v = await validatePdf(pdf, { fontPrefix: "Inter", minImages: 2, minPages: 1 });
    expect(v.issues).toEqual([]);
    expect(v.imageCount).toBeGreaterThanOrEqual(2); // vis_1 and vis_2
    expect(pages.length).toBeGreaterThan(0);
  });

  it("warm: the same export again, same pages and same images", async () => {
    const first = await exportNow("entregada_warm");
    const v = await validatePdf(first.pdf, { fontPrefix: "Inter", minImages: 2, minPages: 1 });
    expect(v.issues).toEqual([]);
  });

  it("one sheet of paper", async () => {
    await replaceDocument(db, world.id, document([[heading("Fracciones"), paragraph(SPANISH), image("vis_1", "Tiras de fracciones"), image("vis_2", "Recta numérica"), lines("1", "¿Qué fracción es mayor?", 3)]], "Una hoja"));
    const { pdf, pages } = await exportNow("una_hoja");
    expect(pages.length).toBe(1);
    expect((await validatePdf(pdf, { fontPrefix: "Inter", minImages: 2, minPages: 1 })).issues).toEqual([]);
  });

  it("one logical page; crops, a table, a chart and Spanish text", async () => {
    await replaceDocument(db, world.id, document([[heading("Población y territorio"), paragraph(SPANISH), image("vis_1", "Tiras de fracciones"), image("vis_2", "Recta numérica"), table("Datos del censo", 3), chart([{ label: null, values: [12, 18, 15, 20] }])]], "Población y territorio: 2.º ESO"));
    const { res, pdf, pages, text } = await exportNow("una_pagina");
    expect(res.headers.get("Content-Disposition")).toContain('filename="Poblacion y territorio 2.o ESO.pdf"');
    expect(res.headers.get("Content-Disposition")).toContain("filename*=UTF-8''Poblaci%C3%B3n%20y%20territorio%202.%C2%BA%20ESO.pdf");
    expect(pages.length).toBeGreaterThanOrEqual(1); // one logical page; the browser may need two sheets for it
    const v = await validatePdf(pdf, { fontPrefix: "Inter", minImages: 2, minPages: 1 });
    expect(v.issues).toEqual([]);
    for (const s of ["Ñandú", "pingüino", "¿Qué?", "«comillas»", "Fila 1 · dato 1", "Cabecera 3", "Población por año", "Datos del censo"]) expect(text).toContain(s);
  });

  it("several pages", async () => {
    await replaceDocument(db, world.id, document([[heading("Uno"), image("vis_1", "Tiras"), paragraph(SPANISH)], [heading("Dos"), image("vis_2", "Recta"), table("Tabla", 6)], [heading("Tres"), lines("1", "Explica tu respuesta.", 8)]], "Varias páginas"));
    const { pdf, pages, text } = await exportNow("tres_paginas");
    expect(pages.length).toBeGreaterThanOrEqual(3);
    expect((await validatePdf(pdf, { fontPrefix: "Inter", minImages: 2, minPages: 3 })).issues).toEqual([]);
    expect(text).toContain("Explica tu respuesta.");
  });

  it("ten pages", async () => {
    const tenPages = Array.from({ length: 10 }, (_, i) => [heading(`Página ${i + 1}`), ...(i === 0 ? [image("vis_1", "Tiras"), image("vis_2", "Recta")] : []), paragraph(SPANISH), table(`Tabla ${i + 1}`, 4), lines(String(i + 1), "Responde.", 6)]);
    await replaceDocument(db, world.id, document(tenPages, "Diez páginas"));
    const { pdf, pages } = await exportNow("diez_paginas");
    expect(pages.length).toBeGreaterThanOrEqual(10);
    expect((await validatePdf(pdf, { fontPrefix: "Inter", minImages: 2, minPages: 10 })).issues).toEqual([]);
  });

  it("the engine the route uses (pdfEngine) blocks the network: a live local server is never reached and the render fails", async () => {
    let hits = 0;
    const server = createServer((_, res) => ((hits += 1), res.end("x")));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const error = await pdfEngine().render(`<!doctype html><html><body><img src="${origin}/i.png"><p>hola</p></body></html>`, { fontFamily: "", fontWeights: [] }).catch((e: unknown) => e);
      expect((error as PdfEngineError).code).toBe("network_attempted");
      expect(hits).toBe(0);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("exporting changed nothing: no model call, no ai_runs, no quota, no version, no job", async () => {
    const before = await footprint(db, world);
    await exportNow("sin_efectos");
    expect(await footprint(db, world)).toEqual(before);
  });
});
