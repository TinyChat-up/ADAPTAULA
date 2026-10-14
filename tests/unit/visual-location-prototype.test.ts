import { beforeAll, describe, expect, it } from "vitest";
import { CASES, scanCase } from "../../evals/visual-location/fixtures";
import { metrics, runAll, type Trial } from "../../evals/visual-location/harness";
import { instructionLabels, verifyProposal } from "../../evals/visual-location/verify";

/**
 * Phase 8.2B.7 prototype (evals/visual-location, NOT wired to production): the verifier of figure-location proposals on synthetic
 * scans with known truth. Scripted proposals stand for a model (no model is called). These numbers are regression checks of the
 * acceptance CONTRACT on fixtures the verifier was tuned on; they are not an estimate of real precision or coverage.
 */

let perfect: Trial[];
let lossy: Trial[];
beforeAll(async () => {
  perfect = await runAll();
  lossy = await runAll({ ocrLoss: 0.5 });
}, 240_000);

const oracle = (trials: Trial[], caseId: string, visualId = "vis_1") => trials.find((t) => t.caseId === caseId && t.role === "oracle" && t.visualId === visualId)!;

describe("a correct proposal is accepted only when every claim is checked against something the model did not produce", () => {
  it.each(["cell_labels", "decorative", "big_text", "rotated_noisy"])("%s: accepted, the crop is the server's region on the true figure", (id) => {
    const t = oracle(perfect, id);
    expect(t.report.decision).toBe("accepted");
    expect(t.cropMatchesTruth).toBe(true);
    expect(Object.values(t.report.checks).every((c) => c.status === "verified")).toBe(true);
  });

  it("several activities and figures: the bar (pixel signature) and the cell (labels A and B named by its instruction)", () => {
    expect(oracle(perfect, "multi", "vis_1").report.decision).toBe("accepted");
    expect(oracle(perfect, "multi", "vis_2").report.decision).toBe("accepted");
  });

  it.each([
    ["two_similar", "uniqueness"],
    ["incomplete", "integrity"],
    ["far_labels", "labels"],
    ["other_activity", "placement"],
    ["answer_leak", "answer_leak"],
  ] as const)("%s: even the TRUE region is blocked, by «%s»", (id, check) => {
    const t = oracle(perfect, id);
    expect(t.report.decision).toBe("blocked");
    expect(t.report.checks[check].status).toBe("failed");
  });
});

describe("a wrong proposal never gets through", () => {
  it("shifted boxes, decorations, headlines, answer lines, the whole page, another visual's box, a figure that is not there", () => {
    const wrong = perfect.filter((t) => t.role !== "oracle");
    expect(wrong.length).toBeGreaterThan(25);
    for (const t of wrong) expect(t.report.decision, `${t.caseId} ${t.role} ${t.label}`).toBe("blocked");
  });

  it("perfect text layer: 0 false positives, 0 false negatives on these fixtures", () => {
    expect(metrics(perfect)).toMatchObject({ falsePositives: 0, falseNegatives: 0, coverage: 1 });
  });

  it("a weak OCR (half of the short boxes lost) blocks more, and still accepts nothing wrong", () => {
    const m = metrics(lossy);
    expect(m.falsePositives).toBe(0);
    expect(m.falseNegatives).toBeGreaterThan(0);
    for (const t of lossy.filter((x) => x.shouldAccept && x.report.decision === "blocked")) {
      expect(Object.values(t.report.checks).some((c) => c.status === "unverifiable")).toBe(true);
    }
  });
});

describe("provenance and the text layer are preconditions", () => {
  it("a proposal computed on another version of the original, or a page without any text layer, is blocked before anything else", async () => {
    const c = CASES[0]!;
    const s = await scanCase(c);
    const region = s.toRegion(c.visuals[0]!.truth!);
    const proposal = { visual_id: "vis_1", activity_id: "act_1", page: 1, region, identity: "célula", kind: "figure" as const, labels: ["1", "2", "3"], required_elements: [], limitations: [] };
    const base = { page: s.model, pageCount: 1, sourceSha256: s.sha256, proposalSourceSha256: s.sha256, activities: c.activities, proposal };
    expect(verifyProposal({ ...base, proposalSourceSha256: "0".repeat(64) }).checks.provenance.status).toBe("failed");
    const noText = verifyProposal({ ...base, page: { ...s.model, texts: [] } });
    expect(noText).toMatchObject({ decision: "blocked", crop: null, checks: { text_layer: { status: "unverifiable" } } });
  });

  it("labels named by the instruction are read from its own words", () => {
    expect(instructionLabels("Escribe el nombre de las partes señaladas con los números 1, 2 y 3.")).toEqual(["1", "2", "3"]);
    expect(instructionLabels("Escribe qué parte señalan las letras A y B.")).toEqual(["A", "B"]);
    expect(instructionLabels("Explica la función del núcleo.")).toEqual([]);
  });
});
