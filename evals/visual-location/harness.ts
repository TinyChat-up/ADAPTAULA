import { iou } from "@/lib/materials/visuals/auto/page-model";
import type { FigureProposal, VerificationReport } from "./contract";
import { CASES, scanCase, type CaseVisual, type FixtureCase, type ScannedCase } from "./fixtures";
import { verifyProposal } from "./verify";

/**
 * Prototype evaluation (no model is called). For each fixture, SCRIPTED proposals play the parts a multimodal model could play:
 *
 *   oracle      the true region, slightly loose, with the true labels (a perfect model)
 *   shifted     the true region moved by half its width (a sloppy box)
 *   distractor  a wrong place: another figure, a decoration, a headline, answer lines, empty paper
 *   page        the whole page
 *   swapped     the right box with the other visual's id (multi-figure sheets)
 *
 * and the verifier decides. Candidate metrics describe only a geometric prefilter on these tuned fixtures. Acceptance is
 * separately gated on semantic evidence unavailable in this prototype. No metric here estimates performance on real scans.
 */

export type Role = "oracle" | "shifted" | "distractor" | "page" | "swapped";

export interface Trial {
  caseId: string;
  role: Role;
  label: string;
  visualId: string;
  report: VerificationReport;
  /** Ground-truth eligible oracle visual, used as a denominator; not permission to accept automatically. */
  shouldAccept: boolean;
  /** When a candidate exists: does its box overlap the true figure (IoU ≥ 0.6)? This does not test its content. */
  cropMatchesTruth: boolean | null;
}

const proposal = (v: CaseVisual, region: FigureProposal["region"], over: Partial<FigureProposal> = {}): FigureProposal => ({
  visual_id: v.id,
  activity_id: v.activityId,
  page: 1,
  region,
  identity: "figura de la actividad",
  kind: v.kind,
  labels: v.labels,
  required_elements: [],
  limitations: [],
  ...over,
});

const loosen = (r: FigureProposal["region"], d = 0.01) => {
  const x = Math.max(0, r.x - d);
  const y = Math.max(0, r.y - d);
  return { x, y, w: Math.min(1 - x, r.w + 2 * d), h: Math.min(1 - y, r.h + 2 * d) };
};
const asRect = (r: { x: number; y: number; w: number; h: number }) => ({ x0: r.x, y0: r.y, x1: r.x + r.w, y1: r.y + r.h });

export function proposalsFor(c: FixtureCase, s: ScannedCase): Array<{ role: Role; label: string; proposal: FigureProposal; truth: CaseVisual }> {
  const out: Array<{ role: Role; label: string; proposal: FigureProposal; truth: CaseVisual }> = [];
  for (const v of c.visuals) {
    if (v.truth) {
      const r = loosen(s.toRegion(v.truth));
      out.push({ role: "oracle", label: "región verdadera", proposal: proposal(v, r), truth: v });
      out.push({ role: "shifted", label: "desplazada media anchura", proposal: proposal(v, { ...r, x: Math.min(1 - r.w, r.x + r.w / 2) }), truth: v });
    }
    for (const [name, box] of Object.entries(c.distractors)) out.push({ role: "distractor", label: name, proposal: proposal(v, loosen(s.toRegion(box))), truth: v });
    out.push({ role: "page", label: "página entera", proposal: proposal(v, { x: 0.02, y: 0.02, w: 0.96, h: 0.96 }), truth: v });
  }
  // Each visual's true box under the other visual's id.
  const placed = c.visuals.filter((v) => v.truth);
  if (placed.length > 1) {
    placed.forEach((v, i) => {
      const other = placed[(i + 1) % placed.length]!;
      out.push({ role: "swapped", label: `caja de ${other.id}`, proposal: proposal(v, loosen(s.toRegion(other.truth!))), truth: v });
    });
  }
  return out;
}

export async function runCase(c: FixtureCase, options: { ocrLoss?: number } = {}): Promise<Trial[]> {
  const s = await scanCase(c, options);
  const all = proposalsFor(c, s);
  return all.map(({ role, label, proposal: p, truth }) => {
    const siblings = all.filter((o) => o.role === "oracle" && o.proposal.visual_id !== p.visual_id).map((o) => o.proposal);
    const report = verifyProposal({ page: s.model, pageCount: 1, sourceSha256: s.sha256, proposalSourceSha256: s.sha256, activities: c.activities, proposal: p, siblings });
    const shouldAccept = role === "oracle" && truth.acceptable;
    const cropMatchesTruth = report.candidate && truth.truth ? iou(asRect(report.candidate), asRect(s.toRegion(truth.truth))) >= 0.6 : report.candidate ? false : null;
    return { caseId: c.id, role, label, visualId: p.visual_id, report, shouldAccept, cropMatchesTruth };
  });
}

export interface Metrics {
  trials: number;
  eligibleOracle: number;
  accepted: number;
  /** Accepted although it should not have been, or accepted with a crop that is not the true figure. */
  falsePositives: number;
  /** Oracle proposals of acceptable visuals that were blocked. */
  falseNegatives: number;
  /** Acceptable visuals accepted with the right crop / acceptable visuals. */
  coverage: number;
  candidates: number;
  /** Wrong scripted proposals that pass the geometric prefilter; does not imply safe acceptance. */
  candidateFalsePositives: number;
  /** Correct scripted proposals whose geometric candidate overlaps ground truth / eligible oracles. */
  candidateCoverage: number;
}

export function metrics(trials: readonly Trial[]): Metrics {
  const accepted = trials.filter((t) => t.report.decision === "accepted");
  const falsePositives = accepted.filter((t) => !t.shouldAccept || t.cropMatchesTruth !== true).length;
  const should = trials.filter((t) => t.shouldAccept);
  const falseNegatives = should.filter((t) => t.report.decision !== "accepted").length;
  const covered = should.filter((t) => t.report.decision === "accepted" && t.cropMatchesTruth === true).length;
  const candidates = trials.filter((t) => t.report.candidate);
  const candidateFalsePositives = candidates.filter((t) => !t.shouldAccept || t.cropMatchesTruth !== true).length;
  const candidateCovered = should.filter((t) => t.report.candidate && t.cropMatchesTruth === true).length;
  return { trials: trials.length, eligibleOracle: should.length, accepted: accepted.length, falsePositives, falseNegatives,
    coverage: should.length ? covered / should.length : 0, candidates: candidates.length, candidateFalsePositives,
    candidateCoverage: should.length ? candidateCovered / should.length : 0 };
}

export async function runAll(options: { ocrLoss?: number } = {}): Promise<Trial[]> {
  return (await Promise.all(CASES.map((c) => runCase(c, options)))).flat();
}
