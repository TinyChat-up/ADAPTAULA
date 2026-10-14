import { describe, expect, it } from "vitest";
import { textLines, type PageModel, type TextBox } from "@/lib/materials/visuals/auto/page-model";
import { rotateBox } from "../../evals/ocr-pilot/engine";
import { labelOutcomes, levenshtein, readingText, textErrors, tolerantAnchors } from "../../evals/ocr-pilot/metrics";

// Pure scoring of the OCR pilot: no engine runs here (pnpm eval:ocr runs the real OCR).
const model: PageModel = { width: 2480, height: 3508, gray: new Uint8Array(0), texts: [], mmPerPx: 25.4 / 300 };
const box = (text: string, x0: number, y0: number, w = 30, h = 40): TextBox => ({ text, x0, y0, x1: x0 + w, y1: y0 + h });

describe("OCR pilot metrics", () => {
  it("edit distance over words and characters", () => {
    expect(levenshtein([..."observa"], [..."obseiva"])).toBe(1);
    expect(levenshtein(["a", "b", "c"], ["a", "c"])).toBe(1);
    expect(levenshtein([], ["x"])).toBe(1);
  });

  it("reads lines top to bottom and ignores fill-in underscores", () => {
    const truth = [box("Nombre:", 100, 100, 200), box("__________", 320, 100, 400), box("1. Observa", 100, 300, 300)];
    expect(readingText(truth)).toBe("Nombre: 1. Observa");
    expect(textErrors(truth, [box("Nombre:", 100, 100, 200), box("1.", 100, 300), box("Obseiva", 140, 300, 200)])).toEqual({ words: 3, wordErrors: 1, chars: 18, charErrors: 1 });
  });

  it("classifies each label as read, confused (1→I) or lost, and counts duplicates and labels read on blank paper", () => {
    const truth = [box("1", 1000, 800), box("2", 1000, 1200), box("3", 400, 1300), box("A", 1600, 1600)];
    const ocr = [box("1", 1002, 801), box("1", 1004, 803), box("I", 1000, 1200), box("A", 1601, 1600), box("0", 2000, 3000)];
    const { outcomes, spurious } = labelOutcomes(model, truth, ocr);
    expect(outcomes.map((o) => [o.text, o.status, o.read, o.duplicates])).toEqual([
      ["1", "ok", "1", 1],
      ["2", "confused", "I", 0],
      ["3", "lost", null, 0],
      ["A", "ok", "A", 0],
    ]);
    expect(spurious).toEqual(["0"]);
  });

  it("a tolerant anchor recovers an OCR typo but never takes a line that fits two activities", () => {
    const acts = [
      { id: "act_1", label: "1", instruction: "Observa la barra. ¿Qué fracción de la barra está coloreada?", expectedAnswer: null },
      { id: "act_2", label: "2", instruction: "Observa la barra. ¿Qué fracción de la barra está en blanco?", expectedAnswer: null },
      { id: "act_3", label: "3", instruction: "Escribe una fracción equivalente a un medio.", expectedAnswer: null },
    ];
    const lines = textLines([box("1. Obseiva la barra. ¿Qué fracción de la barra está coloreada?", 100, 300, 1500), box("3. Escribe una fraccion equivalente a-un medio.", 100, 900, 1500)]);
    const anchors = tolerantAnchors(lines, acts);
    expect(anchors.has("act_1")).toBe(false);
    expect(anchors.has("act_2")).toBe(false);
    expect(anchors.get("act_3")?.y0).toBe(900);
  });

  it("maps a deskewed box back onto the page and returns it", () => {
    const r = { x0: 500, y0: 700, x1: 900, y1: 760 };
    const back = rotateBox(model, rotateBox(model, r, 0.05), -0.05);
    expect((back.x0 + back.x1) / 2).toBeCloseTo(700, 6);
    expect((back.y0 + back.y1) / 2).toBeCloseTo(730, 6);
  });
});
