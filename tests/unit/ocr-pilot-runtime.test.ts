import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import { CACHE_DIR, LANG_FILE, createOcr, rotateBox, type OcrEngine } from "../../evals/ocr-pilot/engine";
import { CASES, scanCase } from "../../evals/visual-location/fixtures";

describe("rotation envelopes and edge coordinates", () => {
  it.each([[-3, 150], [3, 150], [-4.5, 300], [4.5, 300]])("%s degrees at %s dpi", (degrees, dpi) => {
    const size = { width: Math.round(210 * dpi / 25.4), height: Math.round(297 * dpi / 25.4) };
    const r = { x0: 2, y0: 3, x1: 22, y1: 33 };
    const a = degrees * Math.PI / 180;
    const got = rotateBox(size, r, a);
    // Independent corner calculation. Bounds may be outside the page; clamping would hide clipping.
    const corners = [[r.x0,r.y0],[r.x1,r.y0],[r.x0,r.y1],[r.x1,r.y1]].map(([x,y]) => {
      const dx=x!-size.width/2,dy=y!-size.height/2;
      return {x: size.width/2+dx*Math.cos(a)-dy*Math.sin(a),y:size.height/2+dx*Math.sin(a)+dy*Math.cos(a)};
    });
    expect(got.x0).toBeCloseTo(Math.min(...corners.map(p=>p.x)),8);
    expect(got.y1).toBeCloseTo(Math.max(...corners.map(p=>p.y)),8);
    const back = rotateBox(size, got, -a);
    expect((back.x0+back.x1)/2).toBeCloseTo((r.x0+r.x1)/2,8);
    expect(back.x1-back.x0).toBeGreaterThan(r.x1-r.x0); // AABB inversion does not restore extents
  });
});

describe.skipIf(!existsSync(path.join(CACHE_DIR, LANG_FILE)))("local Tesseract coordinate regression (requires pinned model)", () => {
  let engine: OcrEngine;
  beforeAll(async () => { engine=await createOcr(); },30_000);
  afterAll(async () => { await engine?.terminate(); });
  it.each([[-3,150],[3,200]])("recognizes and maps a word on a %s degree scan at %s dpi", async (degrees,dpi) => {
    const base=CASES[0]!;
    const fixture={...base,scan:{noise:false,rotateDeg:degrees},draw(page: Parameters<typeof base.draw>[0],fonts: Parameters<typeof base.draw>[1]) {
      base.draw(page,fonts);
      page.drawText("BORDE",{x:40,y:35,size:11,font:fonts.bold});
    }};
    const s=await scanCase(fixture,{dpi});
    const read=await engine.page({...s.model,texts:[]},dpi);
    const got=read.words.find(w=>w.text==="BORDE")!;
    const ref=s.model.texts.find(w=>w.text==="BORDE")!;
    expect(got).toBeDefined();
    expect(Math.abs((got.x0+got.x1-ref.x0-ref.x1)/2)*s.model.mmPerPx).toBeLessThan(1);
    expect(Math.abs((got.y0+got.y1-ref.y0-ref.y1)/2)*s.model.mmPerPx).toBeLessThan(1);
  },30_000);
});
