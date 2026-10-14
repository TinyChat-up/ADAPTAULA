import { beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { rgb } from "pdf-lib";
import { CASES, scanCase, type FixtureCase } from "../../evals/visual-location/fixtures";
import { verifyProposal, type VerifyInput } from "../../evals/visual-location/verify";

const cell = CASES.find((c) => c.id === "cell_labels")!;
const multi = CASES.find((c) => c.id === "multi")!;
const other = CASES.find((c) => c.id === "other_activity")!;

async function input(c: FixtureCase, visual = 0): Promise<VerifyInput> {
  const s = await scanCase(c);
  const v = c.visuals[visual]!;
  return { page: s.model, pageCount: 1, sourceSha256: s.sha256, proposalSourceSha256: s.sha256, activities: c.activities,
    proposal: { visual_id: v.id, activity_id: v.activityId, page: 1, region: s.toRegion(v.truth!), identity: "figura correcta de la actividad",
      kind: v.kind, labels: v.labels, required_elements: ["todas las partes y valores correctos"], limitations: [] } };
}

let base: VerifyInput;
beforeAll(async () => { base = await input(cell); }, 60_000);

// Treat edited raster bytes as a new synthetic source version; both hashes follow that version.
const withRaster = (source: VerifyInput, gray: Uint8Array): VerifyInput => {
  const sha256 = createHash("sha256").update(gray).digest("hex");
  return { ...source, sourceSha256: sha256, proposalSourceSha256: sha256, page: { ...source.page, gray } };
};

const eraseNucleus = (source: VerifyInput) => {
  const gray = source.page.gray.slice();
  const x0 = Math.round(227 / 595.28 * source.page.width), x1 = Math.round(290 / 595.28 * source.page.width);
  const y0 = Math.round(228 / 841.89 * source.page.height), y1 = Math.round(285 / 841.89 * source.page.height);
  for (let y = y0; y < y1; y++) gray.fill(255, y * source.page.width + x0, y * source.page.width + x1);
  return withRaster(source, gray);
};

// Semantic truth is defined by the drawing program, not by the verifier's labels or box.
describe("pedagogical counterexamples to a geometric identity claim", () => {
  it("rejects a cell with the labelled nucleus erased from its pixels", () => {
    const report = verifyProposal(eraseNucleus(base));
    expect(report.candidate).not.toBeNull(); // the old verifier accepted this
    expect(report.crop).toBeNull();
    expect(report.checks.complete_content.status).toBe("unverifiable");
  });

  it("does not certify an unlabelled internal dot that has been erased", () => {
    const gray = base.page.gray.slice();
    const x0 = Math.floor(188 / 595.28 * base.page.width), x1 = Math.ceil(202 / 595.28 * base.page.width);
    const y0 = Math.floor(223 / 841.89 * base.page.height), y1 = Math.ceil(238 / 841.89 * base.page.height);
    for (let y = y0; y < y1; y++) gray.fill(255, y * base.page.width + x0, y * base.page.width + x1);
    const report = verifyProposal(withRaster(base, gray));
    expect(report.candidate).not.toBeNull();
    expect(report.checks.complete_content.status).toBe("unverifiable");
    expect(report.crop).toBeNull();
  });

  it("rejects a bar changed from 3/8 to 5/8 while the same eight divisions and activity text remain", async () => {
    const wrong: FixtureCase = { ...multi, id: "wrong_shading", draw(page, fonts) {
      multi.draw(page, fonts);
      for (let i = 3; i < 5; i++) page.drawRectangle({ x: 120 + i * 300 / 8, y: 841.89 - 210,
        width: 300 / 8, height: 40, color: rgb(.6, .6, .6), borderColor: rgb(0, 0, 0), borderWidth: 1.4 });
    } };
    const report = verifyProposal(await input(wrong));
    expect(report.candidate).not.toBeNull(); // an eight-part shape does not prove 3/8
    expect(report.decision).toBe("blocked");
  });

  it("does not accept another activity's figure if OCR loses its instruction", async () => {
    const t = await input(other);
    const texts = t.page.texts.filter((box) => !box.text.includes("función tiene el núcleo"));
    const report = verifyProposal({ ...t, page: { ...t.page, texts } });
    expect(report.candidate).not.toBeNull(); // missing anchor expands the preceding activity zone
    expect(report.decision).toBe("blocked");
  });

  it("does not treat an OCR box as proof that an erased printed label survives", () => {
    const t = withRaster(base, base.page.gray.slice());
    const gray = t.page.gray;
    const one = t.page.texts.find((box) => box.text.trim() === "1")!;
    for (let y = Math.floor(one.y0); y < Math.ceil(one.y1); y++)
      gray.fill(255, y * t.page.width + Math.floor(one.x0), y * t.page.width + Math.ceil(one.x1));
    const report = verifyProposal(withRaster(t, gray));
    expect(report.candidate).not.toBeNull(); // OCR metadata is not proof of printed ink
    expect(report.decision).toBe("blocked");
  });

  it("blocks when OCR confuses label 1 with I, and does not treat duplicate OCR boxes as corroboration", () => {
    const one = base.page.texts.find((box) => box.text.trim() === "1")!;
    const confused = { ...base, page: { ...base.page, texts: base.page.texts.map((box) => box === one ? { ...box, text: "I" } : box) } };
    expect(verifyProposal(confused).checks.labels.status).toBe("unverifiable");
    const duplicated = { ...base, page: { ...base.page, texts: [...base.page.texts, { ...one }] } };
    const report = verifyProposal(duplicated);
    expect(report.decision).toBe("blocked");
    expect(report.checks.semantic_identity.status).toBe("unverifiable");
  });

  it("keeps a plausible OCR coordinate match diagnostic when its label box is displaced", () => {
    const one = base.page.texts.find((box) => box.text.trim() === "1")!;
    const moved = { ...base, page: { ...base.page, texts: base.page.texts.map((box) => box === one ? { ...box, x0: box.x0 + 2, x1: box.x1 + 2 } : box) } };
    const report = verifyProposal(moved);
    expect(report.candidate).not.toBeNull();
    expect(report.decision).toBe("blocked");
    expect(report.crop).toBeNull();
  });

  it("blocks a figure placed before the OCR instruction instead of inferring ownership", () => {
    const texts = base.page.texts.map((box) =>
      box.text.includes("Observa el esquema") || box.text.includes("partes señaladas")
        ? { ...box, y0: box.y0 + 200, y1: box.y1 + 200 }
        : box,
    );
    const report = verifyProposal({ ...base, page: { ...base.page, texts } });
    expect(report.checks.snap.status).toBe("failed");
    expect(report.decision).toBe("blocked");
    expect(report.crop).toBeNull();
  });

  it("does not approve a two-column OCR layout with nearby instruction anchors", () => {
    const second = base.page.texts.find((box) => box.text.includes("función tiene el núcleo"))!;
    const first = base.page.texts.find((box) => box.text.includes("Observa el esquema"))!;
    const moved = { ...second, x0: second.x0 + 200, x1: second.x1 + 200,
      y0: first.y0 + 2, y1: first.y1 + 2 };
    const texts = base.page.texts.map((box) => box === second ? moved : box);
    const report = verifyProposal({ ...base, page: { ...base.page, texts } });
    expect(report.checks.placement.status).toBe("verified"); // y-only zones cannot disambiguate columns
    expect(report.crop).toBeNull();
    expect(report.decision).toBe("blocked");
  });

  it("does not treat rotated/noisy pages at another raster scale as semantic proof", async () => {
    const rotated = CASES.find((c) => c.id === "rotated_noisy")!;
    const s = await scanCase(rotated, { dpi: 120 });
    const v = rotated.visuals[0]!;
    const report = verifyProposal({ page: s.model, pageCount: 1, sourceSha256: s.sha256,
      proposalSourceSha256: s.sha256, activities: rotated.activities,
      proposal: { visual_id: v.id, activity_id: v.activityId, page: 1, region: s.toRegion(v.truth!),
        identity: "célula animal", kind: v.kind, labels: v.labels, required_elements: [], limitations: [] } });
    expect(report.crop).toBeNull();
    expect(report.checks.semantic_identity.status).toBe("unverifiable");
  });

  it("does not approve a region combining a cell with a printed instruction", async () => {
    const mixed: FixtureCase = { ...cell, id: "graphic_with_text", draw(page, fonts) {
      cell.draw(page, fonts);
      page.drawText("Marca la respuesta correcta", { x: 175, y: 841.89 - 275, size: 10, font: fonts.regular });
    } };
    const report = verifyProposal(await input(mixed));
    expect(report.decision).toBe("blocked");
    expect(report.crop).toBeNull();
  });
});
