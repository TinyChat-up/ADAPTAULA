import { describe, expect, it } from "vitest";
import { area, intersection, textMask, type PageModel, type Rect, type TextLine } from "@/lib/materials/visuals/auto/page-model";
import { barSignature, deskew, dialSignature, gridSignature, normalizePaper, numberLineSignature, polygonCorners, rotateRect } from "../../evals/visual-location/geometry";
import { columnZones, isEdgeShadow, isRunningText, locateFigure, type OcrBox } from "../../evals/visual-location/locate-v2";

// Synthetic rasters drawn here; no OCR engine runs. Reference boxes are never an input of the locator.
const page = (dpi = 200, paper = 255): PageModel => {
  const width = Math.round((210 / 25.4) * dpi), height = Math.round((297 / 25.4) * dpi);
  return { width, height, gray: new Uint8Array(width * height).fill(paper), texts: [], mmPerPx: 25.4 / dpi };
};
const mmToPx = (m: PageModel, v: number) => Math.round(v / m.mmPerPx);
const fill = (m: PageModel, r: Rect, v = 30) => { for (let y = Math.max(0, r.y0); y < Math.min(m.height, r.y1); y++) for (let x = Math.max(0, r.x0); x < Math.min(m.width, r.x1); x++) m.gray[y * m.width + x] = v; };
const R = (m: PageModel, x0: number, y0: number, x1: number, y1: number): Rect => ({ x0: mmToPx(m, x0), y0: mmToPx(m, y0), x1: mmToPx(m, x1), y1: mmToPx(m, y1) });
/** An outline of stroke `t` mm, optional vertical dividers and inner horizontal rules (mm). */
function outlineBox(m: PageModel, x0: number, y0: number, x1: number, y1: number, t = 0.5, dividers: number[] = [], rules: number[] = []) {
  fill(m, R(m, x0, y0, x1, y0 + t)); fill(m, R(m, x0, y1 - t, x1, y1)); fill(m, R(m, x0, y0, x0 + t, y1)); fill(m, R(m, x1 - t, y0, x1, y1));
  for (const d of dividers) fill(m, R(m, d, y0, d + t, y1));
  for (const r of rules) fill(m, R(m, x0, r, x1, r + t));
}
const centre = (r: Rect) => ({ x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 });
const mask = (m: PageModel) => textMask(m);

describe("deskewed frame and original coordinates", () => {
  it.each([[2.3, 150], [-3.1, 300], [1.2, 200]])("a region found at %s° and %s ppp returns to the original with its centre and contents", (deg, dpi) => {
    const m = page(dpi);
    const box = R(m, 60, 80, 120, 110);
    fill(m, box);
    const rad = (deg * Math.PI) / 180;
    const up = deskew(m, rad);
    const upBox = rotateRect(m, box, rad);
    // The ink lands where the transform says it does.
    let n = 0;
    for (let y = Math.round(centre(upBox).y) - 2; y <= Math.round(centre(upBox).y) + 2; y++) for (let x = Math.round(centre(upBox).x) - 2; x <= Math.round(centre(upBox).x) + 2; x++) if (up.gray[y * m.width + x]! < 100) n++;
    expect(n).toBe(25);
    const back = rotateRect(m, upBox, -rad);
    expect(centre(back).x).toBeCloseTo(centre(box).x, 6);
    expect(back.x0).toBeLessThanOrEqual(box.x0);
    expect(back.y1).toBeGreaterThanOrEqual(box.y1);
    // A label inside the crop in the deskewed frame stays inside the crop mapped back to the original.
    const label = { x0: upBox.x1 - 20, y0: upBox.y0 + 5, x1: upBox.x1 - 5, y1: upBox.y0 + 25 };
    expect(area(intersection(rotateRect(m, label, -rad), back))).toBeCloseTo(area(rotateRect(m, label, -rad)), 6);
    expect(m.gray[box.y0 * m.width + box.x0]).toBe(30); // the source is never modified
  });

  it("a figure near the border is not wrapped or invented: outside the page is white", () => {
    const m = page(150);
    fill(m, R(m, 0, 100, 6, 140));
    const up = deskew(m, (3 * Math.PI) / 180);
    expect(up.gray[0]).toBe(255);
  });
});

describe("activity zones that respect columns", () => {
  const m = page(200);
  const ln = (x0: number, y0: number, x1: number, text: string): TextLine => ({ ...R(m, x0, y0, x1, y0 + 4), text });
  it("two anchors on one row split the page at the gutter; an anchor below closes only its own column", () => {
    const anchors = new Map([["act_1", ln(18, 40, 95, "1. Observa el triángulo")], ["act_2", ln(110, 40, 190, "2. Observa el rectángulo")], ["act_3", ln(18, 150, 95, "3. Escribe")]]);
    const z = columnZones(anchors, m);
    expect(z.get("act_1")!.columns).toBe(true);
    expect(z.get("act_1")!.x1).toBeCloseTo((mmToPx(m, 95) + mmToPx(m, 110)) / 2, 6);
    expect(z.get("act_2")!.x0).toBe(z.get("act_1")!.x1);
    expect(z.get("act_1")!.y1).toBeLessThan(mmToPx(m, 150));
    expect(z.get("act_2")!.y1).toBe(m.height);
  });
  it("a single column keeps the full-width zone, closed by the next anchor", () => {
    const z = columnZones(new Map([["act_1", ln(18, 40, 190, "1. Observa")], ["act_2", ln(18, 150, 190, "2. Escribe")]]), m);
    expect(z.get("act_1")).toMatchObject({ x0: 0, x1: m.width, columns: false });
    expect(z.get("act_1")!.y1).toBeLessThan(mmToPx(m, 150));
  });
});

describe("paper, shadows and running text", () => {
  it("grey paper becomes white and ink stays darker than the stroke threshold", () => {
    const m = page(100, 200);
    fill(m, R(m, 50, 50, 60, 60), 60);
    const n = normalizePaper(m);
    expect(n.gray[0]).toBe(255);
    expect(n.gray[R(m, 55, 55, 56, 56).y0 * m.width + R(m, 55, 55, 56, 56).x0]).toBeLessThan(160);
  });
  it("a scanner shadow along the edge is not a figure; a figure cut by the edge still is", () => {
    const m = page(200);
    expect(isEdgeShadow(m, R(m, 0, 0, 4, 297))).toBe(true);
    expect(isEdgeShadow(m, R(m, 150, 60, 210, 80))).toBe(false);
  });
  it("OCR debris from strokes is not running text; an instruction is", () => {
    const l = (text: string): TextLine => ({ x0: 0, y0: 0, x1: 10, y1: 10, text });
    expect(isRunningText(l("x="))).toBe(false);
    expect(isRunningText(l("|"))).toBe(false);
    expect(isRunningText(l("A B"))).toBe(false);
    expect(isRunningText(l("Observa la barra"))).toBe(true);
  });
});

describe("shape signatures (evidence of form only, never of content)", () => {
  it("a fraction bar is found even with a speck below it and white gaps between shaded parts", () => {
    const m = page(150);
    outlineBox(m, 30, 50, 150, 80, 0.5, [60, 90, 120]);
    fill(m, R(m, 30.5, 50.5, 59.6, 79.5), 140); // a shaded part
    fill(m, R(m, 90, 82, 90.4, 82.4)); // a speck under the bar
    expect(barSignature(m, mask(m), R(m, 29, 49, 151, 83))).toMatchObject({ parts: 4 });
  });
  it("a table is not a bar, unequal parts are not a fraction bar", () => {
    const t = page(150);
    outlineBox(t, 30, 50, 150, 80, 0.5, [60, 90, 120], [65]);
    expect(barSignature(t, mask(t), R(t, 29, 49, 151, 81))).toBeNull();
    const u = page(150);
    outlineBox(u, 30, 50, 150, 80, 0.5, [40, 140]);
    expect(barSignature(u, mask(u), R(u, 29, 49, 151, 81))).toBeNull();
  });
  it("a number line has an axis and ticks; a bar is not a number line", () => {
    const m = page(150);
    fill(m, R(m, 20, 100, 180, 100.5));
    for (let x = 30; x <= 170; x += 20) fill(m, R(m, x, 98, x + 0.4, 102.5));
    expect(numberLineSignature(m, mask(m), R(m, 19, 97, 181, 103))).not.toBeNull();
    const b = page(150);
    outlineBox(b, 30, 50, 150, 70, 0.5, [60, 90, 120]);
    expect(numberLineSignature(b, mask(b), R(b, 29, 49, 151, 71))).toBeNull();
  });
  it("a dial is a circle with hands; a square or an empty ring is not", () => {
    const m = page(150);
    const c = { x: mmToPx(m, 100), y: mmToPx(m, 150) }, r = mmToPx(m, 25);
    for (let a = 0; a < 2 * Math.PI; a += 0.002) for (let t = 0; t < 3; t++) m.gray[Math.round(c.y + Math.sin(a) * (r - t)) * m.width + Math.round(c.x + Math.cos(a) * (r - t))] = 30;
    const ring = { ...m, gray: m.gray.slice() };
    fill(m, { x0: c.x - 2, y0: c.y - mmToPx(m, 15), x1: c.x + 2, y1: c.y });
    const box = { x0: c.x - r - 2, y0: c.y - r - 2, x1: c.x + r + 3, y1: c.y + r + 3 };
    expect(dialSignature(m, mask(m), box)).toBe(true);
    expect(dialSignature(ring, mask(ring), box)).toBe(false);
    const sq = page(150);
    outlineBox(sq, 75, 125, 125, 175);
    fill(sq, R(sq, 99, 140, 101, 150));
    expect(dialSignature(sq, mask(sq), R(sq, 74, 124, 126, 176))).toBe(false);
  });
  it("counts the corners of a triangle and a rectangle; a grid has rows and columns", () => {
    const tri = page(150);
    for (let y = 0; y < mmToPx(tri, 40); y++) { const half = Math.round(y * 0.6); const x = mmToPx(tri, 100); fill(tri, { x0: x - half, y0: mmToPx(tri, 60) + y, x1: x + half + 1, y1: mmToPx(tri, 60) + y + 1 }); }
    expect(polygonCorners(tri, mask(tri), R(tri, 70, 59, 130, 101))).toBe(3);
    const rect = page(150);
    outlineBox(rect, 40, 60, 120, 100);
    expect(polygonCorners(rect, mask(rect), R(rect, 39, 59, 121, 101))).toBe(4);
    const grid = page(150);
    outlineBox(grid, 40, 60, 120, 120, 0.5, [60, 80, 100], [75, 90, 105]);
    expect(gridSignature(grid, mask(grid), R(grid, 39, 59, 121, 121))).toBe(true);
    expect(gridSignature(rect, mask(rect), R(rect, 39, 59, 121, 101))).toBe(false);
  });
});

describe("the experimental locator never approves a crop", () => {
  const m = page(150);
  const word = (text: string, x0: number, y0: number, x1: number, line: number): OcrBox & { line: number } => {
    const r = R(m, x0, y0, x1, y0 + 3.5);
    return { text, ...r, upright: { ...r }, line };
  };
  const words = [word("1.", 18, 30, 21, 0), word("Observa", 23, 30, 40, 0), word("la", 41, 30, 44, 0), word("barra", 45, 30, 55, 0), word("con", 56, 30, 62, 0), word("atención.", 63, 30, 80, 0)];
  const lines: TextLine[] = [{ ...R(m, 18, 30, 80, 33.5), text: "1. Observa la barra con atención." }];
  const activities = [{ id: "act_1", label: "1", instruction: "Observa la barra con atención. ¿Qué fracción está coloreada?", expectedAnswer: null }];
  outlineBox(m, 30, 50, 150, 80, 0.5, [60, 90, 120]);
  it("finds the bar by itself, returns it in page coordinates, and still blocks it", () => {
    const r = locateFigure({ page: m, skewDeg: 0, words, lines, activities, visual: { id: "vis_1", activityId: "act_1", kind: "bar", labels: [] }, siblings: [{ id: "vis_1", activityId: "act_1" }] });
    expect(r.shape).toBe("bar");
    expect(r.candidate).not.toBeNull();
    expect(r.decision).toBe("blocked");
    expect(r.crop).toBeNull();
    expect(r.checks.semantic_identity.status).toBe("unverifiable");
    expect(r.checks.visual_answer_safety.status).toBe("unverifiable");
  });
  it("a table claimed as a bar is not a candidate", () => {
    const t = page(150);
    outlineBox(t, 30, 50, 150, 80, 0.5, [60, 90, 120], [65]);
    const r = locateFigure({ page: t, skewDeg: 0, words, lines, activities, visual: { id: "vis_1", activityId: "act_1", kind: "bar", labels: [] }, siblings: [] });
    expect(r.candidate).toBeNull();
    expect(r.checks.identity_evidence.status).toBe("failed");
  });
  it("no drawing in the zone gives no candidate (answer lines are not figures)", () => {
    const e = page(150);
    for (const y of [60, 75, 90]) fill(e, R(e, 20, y, 190, y + 0.3));
    const r = locateFigure({ page: e, skewDeg: 0, words, lines, activities, visual: { id: "vis_1", activityId: "act_1", kind: "bar", labels: [] }, siblings: [] });
    expect(r.candidate).toBeNull();
    expect(r.checks.snap.status).toBe("failed");
  });
});
