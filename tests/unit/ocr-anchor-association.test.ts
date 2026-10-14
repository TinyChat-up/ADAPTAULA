import { describe, expect, it } from "vitest";
import { instructionOutcomes } from "../../evals/ocr-pilot/metrics";
import { instructionLabels } from "../../evals/visual-location/verify";
import { buildReport, type PageResult } from "../../evals/ocr-pilot/run";
import type { PageActivity } from "../../evals/visual-location/verify";
import type { PageModel, TextBox } from "@/lib/materials/visuals/auto/page-model";

const model: PageModel = { width: 1000, height: 1000, gray: new Uint8Array(0), texts: [], mmPerPx: .1 };
const instruction = "Observa el dibujo y escribe el nombre de sus partes.";
const activity = (id = "act_1"): PageActivity => ({ id, label: id === "act_1" ? "1" : "2", instruction, expectedAnswer: null });
const box = (text = instruction, x0 = 160, y0 = 100, w = 500): TextBox => ({ text, x0, y0, x1: x0 + w, y1: y0 + 20 });
const score = (truth: TextBox[], ocr: TextBox[], activities = [activity()], refs = new Map(activities.map((a, i) => [a.id, truth[i]!])) , parts = new Map(activities.map((a, i) => [a.id, [truth[i]!]]))) =>
  instructionOutcomes(model, truth, ocr, activities, refs, parts);

describe("association of a detected instruction, without changing the locator", () => {
  it("does not compare a numbered OCR line centre with an unnumbered reference centre", () => {
    const r = score([box()], [box("1.", 60, 100, 20), box()])[0]!;
    expect(r.anchor).toBe("correct");
    expect(r.found).toBe(true);
  });
  it("handles a single OCR box including numbering and a longer outer extent", () => {
    expect(score([box()], [box("1. " + instruction, 60, 100, 600)])[0]!.anchor).toBe("correct");
  });
  it("also handles a numbered reference and OCR without numbering", () => {
    const ref=box("1. " + instruction,60,100,600);
    expect(score([ref],[box()])[0]!.anchor).toBe("correct");
  });
  it("the tolerant scorer prefers the unique best prefix over a weaker match including numbering", () => {
    const r=score([box()],[box("1.",60,100,20),box()])[0]!;
    expect(r.tolerantFound).toBe(true);
    expect(r.tolerant).toBe("correct");
  });
  it("separates a typo recovered by the existing tolerant matcher from exact detection", () => {
    const r=score([box()],[box("1. Obseiva el dibujo y escribe el nombre de sus partes.",60,100,600)])[0]!;
    expect(r.found).toBe(false);
    expect(r.tolerantFound).toBe(true);
    expect(r.tolerant).toBe("correct");
  });
  it("can associate a sufficiently specific partial box without claiming full transcription", () => {
    const r = score([box()], [box("Observa el dibujo y escribe el", 160, 100, 250)])[0]!;
    expect(r.anchor).toBe("correct");
    expect(r.recall).toBeLessThan(1);
  });
  it("leaves a short generic prefix unverifiable, although the exact matcher finds it", () => {
    const r = score([box()], [box("Observa el", 160, 100, 100)])[0]!;
    expect(r.found).toBe(true);
    expect(r.anchor).toBe("unverifiable");
  });
  it("does not accept an identical instruction from the next exercise", () => {
    const r = score([box(), box(instruction, 160, 400)], [box(instruction, 160, 400)], [activity(), activity("act_2")]);
    expect(r[0]!.anchor).toBe("wrong");
    expect(r[1]!.anchor).toBe("missed");
  });
  it("associates repeated instructions when both independent locations are present", () => {
    const truth = [box(), box(instruction, 160, 400)];
    expect(score(truth, truth, [activity(), activity("act_2")]).map(r => r.anchor)).toEqual(["correct", "correct"]);
  });
  it("rejects an instruction in the other column even at exactly the same height", () => {
    expect(score([box(instruction, 50, 100, 300)], [box(instruction, 600, 100, 300)])[0]!.anchor).toBe("wrong");
  });
  it("does not validate a line merged across two activity regions", () => {
    const other = { ...activity("act_2"), instruction: "Describe la figura y cuenta sus lados con cuidado." };
    const truth = [box(instruction, 50, 100, 350), box(other.instruction, 550, 100, 350)];
    const r = score(truth, truth, [activity(), other]);
    expect(r[0]!.found).toBe(true);
    expect(r[0]!.anchor).toBe("unverifiable");
  });
  it("does not resolve identical reference regions by activity order", () => {
    expect(score([box(),box()],[box()],[activity(),activity("act_2")])[0]!.anchor).toBe("unverifiable");
  });
  it("does not use contradictory or missing human reference metadata as a successful association", () => {
    const invalid = new Map([["act_1", [box("Este texto pertenece a una actividad diferente.")]]]);
    expect(score([box()], [box()], [activity()], new Map([["act_1", box()]]), invalid)[0]!.anchor).toBe("unverifiable");
    expect(score([box()], [box()], [activity()], new Map())[0]!.anchor).toBe("unverifiable");
  });
  it("reports detection separately from correct, wrong, unverifiable and missed association", () => {
    const instructions=[score([box()],[box()])[0]!,score([box()],[box("Observa el",160,100,100)])[0]!,
      score([box()],[])[0]!,score([box()],[box(instruction,160,400)])[0]!];
    const reading={text:{words:0,wordErrors:0,chars:0,charErrors:0},labels:[],spurious:[],labelDetections:0,instructions,candidates:[],meanConfidence:0};
    const p: PageResult={id:"test",docType:"test",condition:"test",dpi:150,pageMs:0,labelMs:0,labelCalls:0,skewDeg:0,engines:{pagina:reading,"pagina+etiquetas":reading},referenceCandidates:[]};
    const report=buildReport([p],{beforeEngineRssMb:0,withEngineRssMb:0,peakRssMb:0},{tesseractJsMb:0,coreMb:0,coreWasmVariants:0,spaModelGzMb:0});
    expect(report.overall.pagina!.anchors).toEqual({found:3,correct:1,wrong:1,unverifiable:1,missed:1,of:4});
    expect(report.overall.pagina).toMatchObject({instructionsDetected:75,instructionsAssociated:25});
  });
});

describe("only explicitly enumerated figure labels become requirements", () => {
  it.each([
    ["Los números 1, 2 y 3", ["1", "2", "3"]],
    ["Las letras A, B y C", ["A", "B", "C"]],
    ["Las etiquetas A y B", ["A", "B"]],
    ["Las letras A, E e I", ["A", "E", "I"]],
    ["Los números están junto a las letras A y B", ["A", "B"]],
  ])("extracts the complete explicit list: %s", (text, expected) => {
    expect(instructionLabels(text as string)).toEqual(expected);
  });
  it.each([
    "Las etiquetas están junto al dibujo", "Las letras escritas dentro de la figura", "Observa el dibujo y explica lo que ves",
    "Los números están señalados", "Las etiquetas a la derecha", "Las letras de una palabra", "Las letras A, B y colorea el dibujo",
    "Los números 1, 2 y tres", "Las letras A, Borradas", "Las etiquetas son importantes",
  ])("does not turn ordinary words or incomplete lists into labels: %s", (text) => {
    expect(instructionLabels(text)).toEqual([]);
  });
});
