import { describe, expect, it } from "vitest";
import { labelGroups } from "../../evals/ocr-pilot/engine";
import { instructionOutcomes, labelOutcomes, textErrors } from "../../evals/ocr-pilot/metrics";
import { CorpusManifestSchema } from "../../evals/ocr-pilot/pages";
import type { PageModel, TextBox } from "@/lib/materials/visuals/auto/page-model";

const model: PageModel = { width: 1000, height: 1000, gray: new Uint8Array(0), texts: [], mmPerPx: 0.1 };
const box = (text: string, x0: number, y0 = 100): TextBox => ({ text, x0, y0, x1: x0 + 10, y1: y0 + 20 });

describe("independent audit of label association", () => {
  it("one detection cannot recover two nearby repeated truth labels", () => {
    const r = labelOutcomes(model, [box("1", 100), box("1", 120)], [box("1", 110)]);
    expect(r.outcomes.filter((o) => o.status === "ok")).toHaveLength(1);
    expect(r.outcomes.filter((o) => o.status === "lost")).toHaveLength(1);
  });
  it("a midpoint confusion can be attributed to only one truth label", () => {
    const r = labelOutcomes(model, [box("1", 100), box("2", 120)], [box("I", 110)]);
    expect(r.outcomes.filter((o) => o.status === "confused")).toHaveLength(1);
  });
  it("does not hide an incorrect detection next to a correct one", () => {
    const r = labelOutcomes(model, [box("1", 100)], [box("1", 100), box("I", 102)]);
    expect(r.spurious).toEqual(["I"]);
  });
  it("does not count one extra detection twice as a duplicate of repeated labels", () => {
    const r = labelOutcomes(model, [box("1", 100), box("1", 120)], [box("1", 100), box("1", 120), box("1", 110)]);
    expect(r.outcomes.reduce((n, o) => n + o.duplicates, 0)).toBe(1);
  });
  it("does not declare a same-height anchor in the other column correct", () => {
    const instruction = "Observa la barra coloreada y escribe la fracción.";
    const r = instructionOutcomes(model, [{ ...box(instruction, 100), x1: 300 }], [{ ...box(instruction, 600), x1: 800 }],
      [{ id: "act_1", label: "1", instruction, expectedAnswer: null }]);
    expect(r[0]!.anchor).toBe("wrong");
  });
  it("CER counts Unicode characters rather than UTF-16 code units", () => {
    expect(textErrors([box("😀", 100)], []).chars).toBe(1);
  });
  it.each([["1","I"],["0","O"],["B","8"]])("counts %s/%s as a confusion", (truth, read) => {
    expect(labelOutcomes(model,[box(truth,100)],[box(read,100)]).outcomes[0]!.status).toBe("confused");
  });
  it("counts blank-paper detections and does not recover a label from another exercise", () => {
    expect(labelOutcomes(model,[],[box("B",100)]).spurious).toEqual(["B"]);
    const r=labelOutcomes(model,[box("1",100)],[box("1",500)]);
    expect(r.outcomes[0]!.status).toBe("lost");
    expect(r.spurious).toEqual(["1"]);
  });
  it("does not choose a farther correct string instead of a closer wrong reading", () => {
    const r=labelOutcomes(model,[box("1",100)],[box("I",100),box("1",105)]);
    expect(r.outcomes[0]!.status).toBe("confused");
    expect(r.spurious).toEqual(["1"]);
    expect(r.detections).toBe(2);
  });
  it("a partial transcription contributes word substitutions and deletions", () => {
    expect(textErrors([box("Observa la barra",100)],[box("Obseiva barra",100)]).wordErrors).toBe(2);
  });
  it("scores repeated instructions only at the human-designated activity location", () => {
    const instruction="Observa la barra coloreada.";
    const left={...box(instruction,100),x1:250},right={...box(instruction,600),x1:750};
    const acts=[{id:"act_1",label:"1",instruction,expectedAnswer:null}];
    const r=instructionOutcomes(model,[left,right],[right],acts,new Map([["act_1",left]]),new Map([["act_1",[left]]]));
    expect(r[0]!.anchor).toBe("wrong");
    expect(r[0]!.recall).toBe(0);
  });
  it("bounds edit-distance work instead of silently truncating long transcriptions", () => {
    expect(()=>textErrors([box("a".repeat(10001),100)],[])).toThrow("ocr_text_limit");
  });
});

describe("experimental resource and manifest boundaries", () => {
  it("rejects excessive glyph-sized noise before thousands of OCR calls", () => {
    const gray = new Uint8Array(1600 * 1600).fill(255);
    for (let y = 10; y < 1580; y += 50) for (let x = 10; x < 1580; x += 50)
      for (let dy = 0; dy < 20; dy++) gray.fill(0, (y + dy) * 1600 + x, (y + dy) * 1600 + x + 4);
    expect(() => labelGroups({ ...model, width: 1600, height: 1600, gray }, [])).toThrow();
  });
  it("does not recover a glyph connected to a long leader and excludes out-of-range sizes", () => {
    const width=500,height=500,gray=new Uint8Array(width*height).fill(255);
    for (let y=100;y<120;y++) gray.fill(0,y*width+100,y*width+104);
    for (let x=100;x<250;x++) gray[110*width+x]=0; // label joined to a leader
    for (const [x,h] of [[300,10],[350,20],[400,80]])
      for(let y=100;y<100+h!;y++)gray.fill(0,y*width+x!,y*width+x!+4);
    const groups=labelGroups({...model,width,height,gray},[]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.x0).toBe(350);
  });
  it("an OCR box outside the left edge cannot mask unrelated raster rows", () => {
    const width=200,height=200,gray=new Uint8Array(width*height).fill(255);
    for (let y=70;y<90;y++)gray.fill(0,y*width+100,y*width+104);
    const groups=labelGroups({...model,width,height,gray},[{text:"outside",x0:-100,x1:-50,y0:10,y1:100}]);
    expect(groups).toHaveLength(1);
  });
  const manifest = (file: string) => ({ pages: [{ id: "synthetic", file, page: 1, dpi: 150, docType: "audit", activities: [], texts: [], visuals: [] }] });
  it.each(["../outside.png", "/tmp/outside.png", "folder/../../outside.png", "C:\\outside.png"])("rejects manifest path %s", (file) => {
    expect(CorpusManifestSchema.safeParse(manifest(file)).success).toBe(false);
  });
  it("rejects normalized boxes that extend beyond the page", () => {
    expect(CorpusManifestSchema.safeParse({ pages: [{ ...manifest("page.png").pages[0], texts: [{ text: "1", x: .9, y: .1, w: .2, h: .1 }] }] }).success).toBe(false);
  });
});
