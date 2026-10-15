import { describe, expect, it } from "vitest";
import {
  caseByHeight,
  digitLetterByRow,
  dropRepeatedMarks,
  detachStrokes,
  isStraightStroke,
  keepLowConfidenceWord,
  loneLabelWords,
  ocrLines,
  resolveGlyphReading,
  type LineWord,
} from "../../evals/ocr-pilot/recognition";

// Pure pieces of the Phase I recognition changes. No Tesseract runs here; references are never an input.
const MM = 25.4 / 200; // 200 ppp
const word = (text: string, x0: number, y0: number, line: number, confidence = 95, w = 60, h = 30): LineWord => ({ text, x0, y0, x1: x0 + w, y1: y0 + h, line, confidence });

describe("reading lines from Tesseract's own structure", () => {
  it("keeps two columns on one baseline as two lines instead of merging them by height", () => {
    const words = [word("1.", 100, 400, 4), word("Observa", 170, 400, 4), word("el", 240, 400, 4), word("triángulo.", 310, 400, 4),
      word("2.", 900, 400, 8), word("Observa", 970, 400, 8), word("el", 1040, 400, 8), word("rectángulo.", 1110, 400, 8)];
    expect(ocrLines(words, MM).map((l) => l.text)).toEqual(["1. Observa el triángulo.", "2. Observa el rectángulo."]);
  });

  it("splits a single Tesseract line at a column-sized gap, but not at an ordinary word gap", () => {
    const words = [word("Señala", 100, 400, 3), word("sus", 170, 400, 3), word("tres", 240, 400, 3), word("Señala", 900, 400, 3), word("cuatro", 970, 400, 3)];
    expect(ocrLines(words, MM).map((l) => l.text)).toEqual(["Señala sus tres", "Señala cuatro"]);
  });
});

describe("reading order of separate segments", () => {
  it("reads labels of one row left to right even when their tops differ by a pixel", () => {
    const labels = ["8", "7", "0", "6", "5"].map((t, i) => word(t, [1173, 1051, 197, 929, 808][i]!, 926 + (i % 2), -1 - i, 95, 20, 30));
    expect(ocrLines(labels, MM).map((l) => l.text)).toEqual(["0", "5", "6", "7", "8"]);
  });
});

describe("low-confidence words inside a confident text line", () => {
  const line = [word("2.", 0, 0, 1, 94), word("¿Cuántos", 0, 0, 1, 30), word("minutos", 0, 0, 1, 96), word("pasan", 0, 0, 1, 96), word("desde", 0, 0, 1, 96)];
  it("keeps a word-like token when three or more neighbours on its line are confident", () => {
    expect(keepLowConfidenceWord(line[1]!, line)).toBe(true);
  });
  it("still drops symbols, single letters and tokens on lines without confident context", () => {
    expect(keepLowConfidenceWord(word("/-:", 0, 0, 1, 34), line)).toBe(false);
    expect(keepLowConfidenceWord(word("Z", 0, 0, 1, 35), line)).toBe(false);
    const weak = [word("Obs", 0, 0, 2, 20), word("erva", 0, 0, 2, 30)];
    expect(keepLowConfidenceWord(weak[0]!, weak)).toBe(false);
  });
});

describe("one connected glyph is one character", () => {
  it("never accepts several different letters read from a single component", () => {
    expect(resolveGlyphReading([{ text: "L", confidence: 98 }, { text: "o", confidence: 98 }, { text: "s", confidence: 93 }], 1)).toBeNull();
    expect(resolveGlyphReading([{ text: "Y", confidence: 91 }, { text: "A", confidence: 98 }], 1)).toBeNull();
  });
  it("merges case variants of one letter and keeps multi-glyph groups as words", () => {
    expect(resolveGlyphReading([{ text: "C", confidence: 97 }, { text: "c", confidence: 93 }], 1)).toBe("C");
    expect(resolveGlyphReading([{ text: "1", confidence: 99 }, { text: "2", confidence: 99 }], 2)).toBe("12");
    expect(resolveGlyphReading([{ text: "B", confidence: 30 }], 1)).toBeNull();
    // Regression found on the degraded historical fixture: confident symbol, word confidence 9.
    expect(resolveGlyphReading([{ text: "E", confidence: 90 }], 1, 50, 9)).toBeNull();
  });
});

describe("case of shape-ambiguous letters from the size of the page's capitals", () => {
  it("reads a capital-height «c» as C, leaves a short «c», «e» and pages without capitals alone", () => {
    const labels = [{ text: "A", h: 3.1 }, { text: "B", h: 3.1 }, { text: "c", h: 3.1 }, { text: "c", h: 2.0 }, { text: "e", h: 3.1 }];
    expect(caseByHeight(labels).map((l) => l.text)).toEqual(["A", "B", "C", "c", "e"]);
    expect(caseByHeight([{ text: "o", h: 3 }]).map((l) => l.text)).toEqual(["o"]);
  });
});

/** Raster helper: pixels set inside the predicate, row-major on a w×h canvas. */
const pixels = (w: number, h: number, on: (x: number, y: number) => boolean) => {
  const out: number[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (on(x, y)) out.push(y * w + x);
  return out;
};

describe("marks that are not characters", () => {
  const W = 200;
  it("a clock tick or a ray (one straight thin stroke) is a stroke, not a glyph", () => {
    expect(isStraightStroke(pixels(W, 60, (x, y) => x >= 50 && x <= 53 && y >= 10 && y <= 45), W, MM)).toBe(true);
    expect(isStraightStroke(pixels(W, 60, (x, y) => Math.abs(y - 10 - (x - 20) * 0.7) <= 2 && x >= 20 && x <= 50), W, MM)).toBe(true);
  });
  it("a flagged «1», a «C» and a «B» are not strokes", () => {
    const one = pixels(W, 60, (x, y) => (x >= 50 && x <= 53 && y >= 10 && y <= 40) || (y >= 10 && y <= 13 && x >= 42 && x <= 52 && y - 10 <= 52 - x));
    expect(isStraightStroke(one, W, MM)).toBe(false);
    const c = pixels(W, 60, (x, y) => { const d = Math.hypot(x - 50, y - 30); return d >= 10 && d <= 13 && x <= 58; });
    expect(isStraightStroke(c, W, MM)).toBe(false);
  });
});

describe("a label touching a straight tick", () => {
  it("detaches the long horizontal run and keeps the glyph", () => {
    const W = 200;
    // A ring-shaped glyph (~3 mm) whose right side touches a 5 mm horizontal tick.
    const glyph = (x: number, y: number) => { const d = Math.hypot(x - 40, y - 30); return d >= 8 && d <= 11; };
    const tick = (x: number, y: number) => y >= 29 && y <= 31 && x >= 50 && x <= 90;
    const parts = detachStrokes(pixels(W, 60, (x, y) => glyph(x, y) || tick(x, y)), W, MM, 2.6);
    expect(parts).toHaveLength(1);
    const xs = parts[0]!.map((i) => i % W);
    expect(Math.max(...xs)).toBeLessThanOrEqual(52);
    expect(Math.min(...xs)).toBeLessThanOrEqual(30);
  });
});

describe("lone single characters from the page pass", () => {
  it("routes lone label-like words to the label pass, keeps words that belong to running text", () => {
    const words = [word("N", 1000, 500, 7, 83), word("A", 1200, 500, 9, 45), word("letras", 100, 300, 3), word("A", 170, 300, 3), word("y", 240, 300, 3), word("B", 300, 300, 3)];
    expect(loneLabelWords(words).map((w) => `${w.text}@${w.line}`)).toEqual(["N@7", "A@9"]);
  });
});

describe("label sequences", () => {
  const lab = (text: string, x0: number, y0 = 500, h = 25) => ({ text, x0, y0, x1: x0 + 20, y1: y0 + h });
  it("reads an ambiguous O/0, B/8, S/5 or Z/2 as the type all its row neighbours share", () => {
    const row = [lab("O", 100), lab("1", 200), lab("2", 300), lab("3", 400)];
    expect(digitLetterByRow(row).map((l) => l.text)).toEqual(["0", "1", "2", "3"]);
    expect(digitLetterByRow([lab("A", 100), lab("8", 200), lab("C", 300)]).map((l) => l.text)).toEqual(["A", "B", "C"]);
  });
  it("leaves a mixed row or a lone label unchanged", () => {
    expect(digitLetterByRow([lab("1", 100), lab("O", 200), lab("A", 300)]).map((l) => l.text)).toEqual(["1", "O", "A"]);
    expect(digitLetterByRow([lab("O", 100), lab("1", 200, 900)]).map((l) => l.text)).toEqual(["O", "1"]);
  });
  it("drops three or more identical, same-size readings on one row as a drawn texture", () => {
    const texture = [lab("X", 100), lab("X", 160), lab("X", 220), lab("A", 300, 400)];
    expect(dropRepeatedMarks(texture).map((l) => l.text)).toEqual(["A"]);
    expect(dropRepeatedMarks([lab("A", 100), lab("A", 400, 900)]).map((l) => l.text)).toEqual(["A", "A"]);
  });
});
