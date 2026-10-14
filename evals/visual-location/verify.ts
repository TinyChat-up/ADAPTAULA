import { MIN_SIDE, NormalizedBoundsSchema } from "@/lib/materials/visuals/geometry";
import { activityAnchors, activityZones, candidates, toBounds, type ActivityText } from "@/lib/materials/visuals/auto/locate";
import { area, components, intersection, iou, isLabel, isLabelLine, px, textLines, textMask, type PageModel, type Rect } from "@/lib/materials/visuals/auto/page-model";
import { barShape, numberLineShape } from "@/lib/materials/visuals/auto/shapes";
import { CHECKS, type CheckName, type CheckStatus, type FigureProposal, type VerificationReport } from "./contract";

/**
 * Prototype verifier (NOT wired to production). Every check uses something the proposing model did not produce:
 *
 *   pixels of the original page · its text layer (the PDF's own, or a local OCR's: independent of the multimodal model) · the
 *   activity text and expected answer already in the analysis · the original's sha-256.
 *
 * It reuses the anchored locator's own pieces (`activityAnchors`, `activityZones`, `candidates`, shape signatures), so a scan with
 * a text layer is judged exactly like a born-digital PDF. The model's box is only used to say WHICH server-found region it means.
 */

export const VERIFIER_VERSION = "figure_proposal_verifier@proto1";

export interface PageActivity extends ActivityText {
  /** The analysis's expected answer, if any (never shown to the student). */
  expectedAnswer: string | null;
}

export interface VerifyInput {
  page: PageModel;
  pageCount: number;
  /** sha-256 of the stored original, and the one the proposal was computed on. */
  sourceSha256: string;
  proposalSourceSha256: string;
  /** Activities of THIS page from the analysis (their printed instruction anchors the zones). */
  activities: readonly PageActivity[];
  proposal: FigureProposal;
  /** Other proposals for the same page: two claims on one drawing make both ambiguous. */
  siblings?: readonly FigureProposal[];
}

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/** Labels the instruction itself says the figure shows: «los números 1, 2 y 3», «las letras A y B». */
export function instructionLabels(instruction: string): string[] {
  const m = /(?:numeros|letras|etiquetas)\s+((?:[0-9a-z]{1,2})(?:\s*(?:,|y|e)\s*[0-9a-z]{1,2})*)/i.exec(norm(instruction));
  if (!m) return [];
  return m[1]!
    .split(/\s*(?:,|\by\b|\be\b)\s*/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .map((t) => (/^[a-z]$/.test(t) ? t.toUpperCase() : t));
}

const STOP = new Set(["parte", "partes", "esta", "este", "como", "para", "entre", "sobre", "tiene", "donde"]);
const words = (s: string) => new Set(norm(s).split(/[^a-z]+/).filter((w) => w.length >= 4 && !STOP.has(w)));

const toPx = (model: PageModel, b: { x: number; y: number; w: number; h: number }): Rect => ({ x0: b.x * model.width, y0: b.y * model.height, x1: (b.x + b.w) * model.width, y1: (b.y + b.h) * model.height });
const contains = (outer: Rect, r: Rect, share = 0.9) => area(intersection(outer, r)) >= share * area(r);
const centre = (r: Rect) => ({ x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 });

export function verifyProposal(input: VerifyInput): VerificationReport {
  const { page: model, proposal } = input;
  const checks = Object.fromEntries(CHECKS.map((c) => [c, { status: "unverifiable" as CheckStatus, detail: "sin comprobar" }])) as VerificationReport["checks"];
  const set = (name: CheckName, status: CheckStatus, detail: string) => (checks[name] = { status, detail });
  const finish = (crop: Rect | null): VerificationReport => {
    const ok = CHECKS.every((c) => checks[c].status === "verified");
    return { visualId: proposal.visual_id, decision: ok && crop ? "accepted" : "blocked", crop: ok && crop ? toBounds(model, crop) : null, checks, verifier: VERIFIER_VERSION };
  };

  // 1 · Provenance: right material version, a page that exists, a region inside it.
  const region = NormalizedBoundsSchema.safeParse(proposal.region);
  if (input.proposalSourceSha256 !== input.sourceSha256) set("provenance", "failed", "la propuesta se hizo sobre otra versión del original");
  else if (proposal.page < 1 || proposal.page > input.pageCount) set("provenance", "failed", "página inexistente");
  else if (!region.success || proposal.region.w < MIN_SIDE || proposal.region.h < MIN_SIDE) set("provenance", "failed", "región fuera de la página o degenerada");
  else set("provenance", "verified", "sha y página coinciden");
  if (checks.provenance.status !== "verified") return finish(null);

  // 2 · Text layer: the only independent anchor of «which activity».
  if (model.texts.length === 0) {
    set("text_layer", "unverifiable", "página sin capa de texto (ni PDF ni OCR local)");
    return finish(null);
  }
  set("text_layer", "verified", `${model.texts.length} cajas de texto`);

  // 3 · Activity anchor and zone.
  const lines = textLines(model.texts);
  const anchors = activityAnchors(lines, input.activities);
  const zones = activityZones(anchors, model);
  const activity = input.activities.find((a) => a.id === proposal.activity_id);
  const zone = zones.get(proposal.activity_id);
  if (!activity) set("activity_anchor", "failed", "la actividad no es de esta página según el análisis");
  else if (!zone) set("activity_anchor", "unverifiable", "no se encuentra impresa la consigna de la actividad");
  else set("activity_anchor", "verified", "consigna encontrada en la capa de texto");
  if (checks.activity_anchor.status !== "verified" || !zone || !activity) return finish(null);

  // 4 · Snap to a region the server found itself; the crop is the server's.
  const mask = textMask(model);
  const regions = candidates(model, mask);
  const proposed = toPx(model, proposal.region);
  const best = regions.map((c) => ({ c, overlap: iou(c.crop, proposed) })).sort((a, b) => b.overlap - a.overlap)[0];
  if (!best || best.overlap < 0.5) {
    set("snap", "failed", `la región propuesta no coincide con ningún dibujo (IoU ${best ? best.overlap.toFixed(2) : "0"})`);
    return finish(null);
  }
  const crop = best.c.crop;
  set("snap", "verified", `IoU ${best.overlap.toFixed(2)} con un dibujo encontrado por el servidor`);

  // 5 · Placement: in its activity's zone and in no other.
  const c = centre(crop);
  const inZone = (z: Rect) => c.y >= z.y0 && c.y <= z.y1;
  const elsewhere = [...zones.entries()].filter(([id, z]) => id !== proposal.activity_id && inZone(z)).map(([id]) => id);
  if (!inZone(zone)) set("placement", "failed", elsewhere.length ? `está en la zona de ${elsewhere.join(", ")}` : "fuera de la zona de su actividad");
  else set("placement", "verified", "en la zona de su actividad");

  // 6 · Uniqueness: no other drawing of comparable size in the zone; no sibling proposal on the same drawing.
  // A straight rule (an answer line, even skewed by the scanner) is not a drawing the model could have meant.
  // A group made only of such rules (three answer lines) is not one either.
  const single = (r: (typeof regions)[number]) => Math.max(r.x1 - r.x0, r.y1 - r.y0) >= 6 * Math.min(r.x1 - r.x0, r.y1 - r.y0) && r.inkPx / Math.max(r.x1 - r.x0, r.y1 - r.y0) <= px(model, 1.2);
  const singleRules = regions.filter(single);
  const rule = (r: (typeof regions)[number]) => single(r) || singleRules.filter((k) => contains(r, k, 0.999)).reduce((n, k) => n + k.inkPx, 0) >= 0.9 * r.inkPx;
  const rivals = regions.filter((r) => r !== best.c && !rule(r) && centre(r.crop).y >= zone.y0 && centre(r.crop).y <= zone.y1 && area(r.crop) >= 0.25 * area(crop) && !contains(crop, r.crop) && !contains(r.crop, crop));
  const claimed = (input.siblings ?? []).filter((s) => s.visual_id !== proposal.visual_id && iou(toPx(model, s.region), crop) >= 0.5);
  if (rivals.length > 0) set("uniqueness", "failed", `${rivals.length} dibujo(s) más en la zona`);
  else if (claimed.length > 0) set("uniqueness", "failed", `otra propuesta (${claimed.map((s) => s.visual_id).join(", ")}) reclama el mismo dibujo`);
  else set("uniqueness", "verified", "único dibujo de su tamaño en la zona");

  // 7 · Integrity: nothing cut by the crop, not cut by the page.
  const edge = px(model, 2);
  const cut = components(model, mask).filter((k) => area(intersection(k, crop)) > 0 && !contains(crop, k, 0.999));
  if (crop.x0 <= edge || crop.y0 <= edge || crop.x1 >= model.width - edge || crop.y1 >= model.height - edge) set("integrity", "failed", "el dibujo toca el borde de la página: puede estar incompleto");
  else if (cut.length > 0) set("integrity", "failed", `${cut.length} trazo(s) cruzan el borde del recorte`);
  else set("integrity", "verified", "ningún trazo cortado");

  // 8 · Labels: claimed by the proposal + named by the instruction, all printed inside the crop.
  const fromInstruction = instructionLabels(activity.instruction);
  const required = [...new Set([...proposal.labels, ...fromInstruction])];
  const labelBoxes = model.texts.filter((t) => isLabel(t.text));
  const missing = required.filter((l) => !labelBoxes.some((t) => t.text.trim() === l && contains(crop, t)));
  const elsewhereOnPage = missing.filter((l) => labelBoxes.some((t) => t.text.trim() === l));
  if (missing.length === 0) set("labels", "verified", required.length ? `etiquetas dentro: ${required.join(", ")}` : "no se reclaman etiquetas");
  else if (elsewhereOnPage.length > 0) set("labels", "failed", `etiquetas fuera del recorte: ${elsewhereOnPage.join(", ")}`);
  else set("labels", "unverifiable", `etiquetas no legibles en la capa de texto: ${missing.join(", ")}`);

  // 9 · Foreign text.
  const foreign = lines.filter((l) => !isLabelLine(l.text) && area(intersection(l, crop)) > 0.15 * area(l));
  if (foreign.length > 0) set("foreign_text", "failed", `${foreign.length} línea(s) de texto corrido dentro`);
  else set("foreign_text", "verified", "sin texto corrido");

  // 10 · Answer leak: a word of the expected answer printed inside the crop OR attached to it (within 10 mm: the figure's own
  // captions, which a correct crop would have to include).
  const near = { x0: crop.x0 - px(model, 10), y0: crop.y0 - px(model, 10), x1: crop.x1 + px(model, 10), y1: crop.y1 + px(model, 10) };
  const inside = model.texts.filter((t) => contains(near, t, 0.5)).map((t) => t.text).join(" ");
  const answer = activity.expectedAnswer ? words(activity.expectedAnswer) : new Set<string>();
  const leaked = [...words(inside)].filter((w) => answer.has(w));
  if (leaked.length > 0) set("answer_leak", "failed", `la figura muestra parte de la respuesta: ${leaked.join(", ")}`);
  else set("answer_leak", "verified", activity.expectedAnswer ? "ninguna palabra de la respuesta dentro" : "sin respuesta registrada que proteger");

  // 11 · Identity evidence beyond position.
  if (proposal.kind === "bar") set("identity_evidence", barShape(model, best.c, mask) ? "verified" : "failed", "firma de barra en los píxeles");
  else if (proposal.kind === "number_line") set("identity_evidence", numberLineShape(model, best.c, mask) ? "verified" : "failed", "firma de recta numérica en los píxeles");
  else if (fromInstruction.length > 0 && checks.labels.status === "verified") set("identity_evidence", "verified", "las etiquetas que nombra la consigna están en el dibujo");
  else set("identity_evidence", "unverifiable", "figura genérica sin etiquetas nombradas por la consigna: solo la posición la respalda");

  return finish(crop);
}
