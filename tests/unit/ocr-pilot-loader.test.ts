import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, symlinkSync, truncateSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { PDFDocument } from "pdf-lib";
import { corpusFile, corpusPages, corpusRoot, validateDimensions, CORPUS_LIMITS } from "../../evals/ocr-pilot/pages";
import { buildReport, finishOutput, prepareOutput, type PageResult } from "../../evals/ocr-pilot/run";

const dirs: string[] = [];
const dir = () => { const d = mkdtempSync(path.join(tmpdir(), "ocr-audit-")); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { force: true, recursive: true }); });
const manifest = (file = "page.png", texts: object[] = []) => ({ pages: [{ id: "test", file, page: 1, dpi: 150, docType: "test", activities: [], texts, visuals: [] }] });
const saveManifest = (d: string, m: object) => writeFileSync(path.join(d, "manifest.json"), JSON.stringify(m));

describe("corpus boundaries with synthetic temporary files", () => {
  it("rejects files and manifest symlinks escaping the corpus", async () => {
    const root = dir(), outside = dir();
    writeFileSync(path.join(outside, "page.png"), "not a scan");
    symlinkSync(path.join(outside, "page.png"), path.join(root, "page.png"));
    expect(() => corpusFile(root, "page.png")).toThrow("corpus_path_escape");
    writeFileSync(path.join(outside, "manifest.json"), "{}");
    symlinkSync(path.join(outside, "manifest.json"), path.join(root, "manifest.json"));
    await expect(corpusPages(root).next()).rejects.toThrow("corpus_manifest_invalid");
  });
  it("rejects a corpus inside this repository", () => {
    expect(() => corpusRoot(path.resolve("evals/ocr-pilot"))).toThrow("corpus_must_be_outside_repository");
  });
  it("rejects oversized files before rendering", async () => {
    const root = dir(); saveManifest(root, manifest());
    writeFileSync(path.join(root, "page.png"), "x");
    truncateSync(path.join(root, "page.png"), CORPUS_LIMITS.fileBytes + 1);
    await expect(corpusPages(root).next()).rejects.toThrow("corpus_file_limit");
  });
  it("checks decoded image dimensions before allocation", async () => {
    const root = dir(); saveManifest(root, manifest());
    const header = Buffer.alloc(24); Buffer.from([137,80,78,71,13,10,26,10]).copy(header); header.write("IHDR", 12); header.writeUInt32BE(100000,16); header.writeUInt32BE(100000,20);
    writeFileSync(path.join(root, "page.png"), header);
    await expect(corpusPages(root).next()).rejects.toThrow("corpus_dimension_limit");
    expect(() => validateDimensions(4000, 4000)).toThrow();
  });
  it("rejects PDFs beyond the page limit", async () => {
    const root = dir(); saveManifest(root, manifest("page.pdf"));
    const pdf = await PDFDocument.create(); for (let i=0; i<31; i++) pdf.addPage();
    writeFileSync(path.join(root, "page.pdf"), await pdf.save());
    await expect(corpusPages(root).next()).rejects.toThrow("corpus_page_limit");
  });
  it("does not score a human label annotation over blank pixels as a lost OCR label", async () => {
    const root = dir(); saveManifest(root, manifest("page.png", [{ text: "1", x: .2, y: .2, w: .1, h: .1 }]));
    const canvas = createCanvas(100,100); const ctx = canvas.getContext("2d"); ctx.fillStyle="white";ctx.fillRect(0,0,100,100);
    writeFileSync(path.join(root, "page.png"), canvas.toBuffer("image/png"));
    await expect(corpusPages(root).next()).rejects.toThrow("corpus_reference_blank");
  });
  it("does not include malformed manifest content in its errors", async () => {
    const root = dir(); writeFileSync(path.join(root,"manifest.json"), '{"private_sentinel":');
    await expect(corpusPages(root).next()).rejects.toThrow(/^corpus_manifest_invalid$/);
  });
});

describe("reports do not expose transcription or retain a misleading partial result", () => {
  it("rejects an output directory symlink", () => {
    const root = dir(), outside = dir(); symlinkSync(outside,path.join(root,"results"));
    expect(() => prepareOutput(root)).toThrow("report_path_invalid");
  });
  it("invalidates previous results and publishes a failure status without reports", () => {
    const root = dir(); const out=prepareOutput(root);writeFileSync(path.join(out,"report.json"), "old report");
    prepareOutput(root);finishOutput(out,null,true);
    expect(existsSync(path.join(out,"report.json"))).toBe(false);
    expect(JSON.parse(readFileSync(path.join(out,"run-status.json"),"utf8"))).toEqual({status:"failed"});
  });
  it("redacts arbitrary label, document and group text from real reports", () => {
    const reading = { text:{words:1,wordErrors:0,chars:1,charErrors:0}, labels:[{text:"private_sentinel",read:"private_sentinel",status:"confused" as const,duplicates:0,offsetMm:0,iou:1}],spurious:["private_sentinel"],labelDetections:2,instructions:[],candidates:[],meanConfidence:99 };
    const page: PageResult = { id:"private_sentinel",docType:"private_sentinel",condition:"real",dpi:150,pageMs:1,labelMs:1,labelCalls:1,skewDeg:0,engines:{pagina:reading,"pagina+etiquetas":reading},referenceCandidates:[] };
    const report=buildReport([page],{beforeEngineRssMb:1,withEngineRssMb:1,peakRssMb:1},{tesseractJsMb:1,coreMb:1,coreWasmVariants:1,spaModelGzMb:1},true);
    expect(JSON.stringify(report)).not.toContain("private_sentinel");
    const out=prepareOutput(dir());finishOutput(out,report,true);
    expect(readFileSync(path.join(out,"report.md"),"utf8")).not.toContain("private_sentinel");
    expect(JSON.parse(readFileSync(path.join(out,"run-status.json"),"utf8")).status).toBe("complete");
  });
});
