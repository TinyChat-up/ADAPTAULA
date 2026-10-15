import { activityAnchors } from "@/lib/materials/visuals/auto/locate";
import { area, components, gap, inkFraction, intersection, isLabel, isLabelLine, iou, textMask, union, type Component, type PageModel, type Rect, type TextBox, type TextLine } from "@/lib/materials/visuals/auto/page-model";
import { tolerantAnchors } from "../ocr-pilot/metrics";
import { CANDIDATE_CHECKS, CHECKS, type CheckName, type CheckStatus, type VerificationReport } from "./contract";
import { barSignature, deskew, dialSignature, gridSignature, normalizePaper, numberLineSignature, polygonCorners, rotateRect } from "./geometry";
import { instructionLabels, type PageActivity } from "./verify";

/**
 * Phase II experimental figure locator (`figure_geometry@v2`, NOT wired to production). Unlike the #31 prefilter it receives no
 * region from anyone: from the OCR of the page (Phase I engine, unchanged), the activity the analysis assigns the visual to, the
 * visual's kind and the labels it claims, it finds the figure itself in a deskewed frame and returns it in ORIGINAL page
 * coordinates. Every geometric check can pass; the three semantic checks stay `unverifiable`, so the decision is always
 * `blocked` and `crop` is always null. Human reference boxes are never an input.
 */

export const LOCATOR_VERSION = "figure_geometry@v2";

export interface OcrBox extends TextBox {
  /** The same box in the OCR's deskewed frame. */
  upright: Rect;
}

export interface LocateInput {
  /** The scan as shown (pixels only). */
  page: PageModel;
  /** Skew the OCR estimated (degrees); the geometry works in the same deskewed frame as the OCR boxes. */
  skewDeg: number;
  /** OCR boxes and the OCR's own reading lines, both in the deskewed frame. */
  words: readonly OcrBox[];
  lines: readonly TextLine[];
  activities: readonly PageActivity[];
  visual: { id: string; activityId: string; kind: "bar" | "number_line" | "figure"; labels: readonly string[] };
  /** Every visual the analysis claims on this page (two claims for one drawing make both ambiguous). */
  siblings: ReadonlyArray<{ id: string; activityId: string }>;
}

export interface LocateReport extends VerificationReport {
  /** Diagnostic: the region the geometry built (original page coordinates), even when a check blocked it. */
  region: Rect | null;
  /** Zone of the activity in the deskewed frame and whether it came from a column split. */
  zone: (Rect & { columns: boolean }) | null;
  /** Components crossing the region border (a cut figure). */
  cut: number;
  /** Shape evidence found, if any. */
  shape: string | null;
  anchor: "exact" | "tolerant" | null;
}

const mm = (model: PageModel, v: number) => Math.max(1, Math.round(v / model.mmPerPx));
const contains = (outer: Rect, r: Rect, share = 0.9) => area(intersection(outer, r)) >= share * Math.max(1, area(r));
const overlapY = (a: Rect, b: Rect) => Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) >= 0.5 * Math.min(a.y1 - a.y0, b.y1 - b.y0);

/**
 * Activity zones that respect columns. Two instruction anchors on one row, horizontally apart, are evidence of columns: each zone
 * spans its own column (split halfway across the gutter) down to the next anchor whose column overlaps it. Anything else keeps the
 * full-width zone of the production locator. A zone never extends above its own anchor.
 */
export function columnZones(anchors: ReadonlyMap<string, TextLine>, model: PageModel): Map<string, Rect & { columns: boolean }> {
  const list = [...anchors.entries()].map(([id, l]) => ({ id, l }));
  const zones = new Map<string, Rect & { columns: boolean }>();
  for (const a of list) {
    const row = list.filter((b) => overlapY(a.l, b.l)).sort((p, q) => p.l.x0 - q.l.x0);
    const i = row.indexOf(a);
    const columns = row.length > 1;
    const x0 = i === 0 ? 0 : (row[i - 1]!.l.x1 + a.l.x0) / 2;
    const x1 = i === row.length - 1 ? model.width : (a.l.x1 + row[i + 1]!.l.x0) / 2;
    const below = list.filter((b) => b !== a && b.l.y0 > a.l.y1 - mm(model, 1) && !overlapY(a.l, b.l) && Math.min(x1, b.l.x1) > Math.max(x0, b.l.x0));
    const y1 = Math.min(model.height, ...below.map((b) => b.l.y0 - mm(model, 0.5)));
    zones.set(a.id, { x0, y0: a.l.y0 - mm(model, 1), x1, y1, columns });
  }
  return zones;
}

/** Thin straight layout lines (answer lines, column dividers, page rules): never part of a figure, never a rival. */
const isRule = (model: PageModel, c: Rect) => {
  const w = c.x1 - c.x0, h = c.y1 - c.y0;
  return (h <= mm(model, 1.5) && w >= mm(model, 10)) || (w <= mm(model, 1.5) && h >= mm(model, 10));
};
/** A scanner shadow or page border: touches the page edge and runs along more than half of it. A cut figure does not. */
export const isEdgeShadow = (model: PageModel, c: Rect) => {
  const e = mm(model, 1);
  const touches = c.x0 <= e || c.y0 <= e || c.x1 >= model.width - e || c.y1 >= model.height - e;
  return touches && (c.y1 - c.y0 >= 0.5 * model.height || c.x1 - c.x0 >= 0.5 * model.width);
};
const hollow = (model: PageModel, mask: Uint8Array, c: Rect) => {
  const inset = mm(model, 1.2);
  const inner = { x0: c.x0 + inset, y0: c.y0 + inset, x1: c.x1 - inset, y1: c.y1 - inset };
  return inner.x1 > inner.x0 && inner.y1 > inner.y0 && inkFraction(model, inner, mask) < 0.002;
};

/** Drawing components of a page: text masked out, minus specks, rules, empty boxes and page frames. */
export function drawings(model: PageModel, mask: Uint8Array, keepOutlines = false): Component[] {
  return components(model, mask).filter((c) => {
    const w = c.x1 - c.x0, h = c.y1 - c.y0;
    if (w < mm(model, 3) && h < mm(model, 3)) return false;
    if (isRule(model, c)) return false;
    if (w >= 0.85 * model.width && h >= 0.5 * model.height) return false;
    if (isEdgeShadow(model, c)) return false;
    // An empty outline is an answer box unless the instruction itself asks about a rectangle.
    return keepOutlines || !hollow(model, mask, c);
  });
}

/** Groups drawings whose gap is at most `linkMm` (strokes and parts of one figure, arrows joining them). */
export function cluster(model: PageModel, parts: readonly Component[], linkMm = 6): Component[] {
  const groups = parts.map((p) => ({ ...p }));
  for (let changed = true; changed; ) {
    changed = false;
    for (let i = 0; i < groups.length && !changed; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        if (gap(groups[i]!, groups[j]!) <= mm(model, linkMm)) {
          groups[i] = { ...union(groups[i]!, groups[j]!), inkPx: groups[i]!.inkPx + groups[j]!.inkPx };
          groups.splice(j, 1);
          changed = true;
          break;
        }
      }
    }
  }
  return groups;
}

const words = (s: string) => new Set(s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 4));
const KEYWORDS: Array<{ shape: string; words: RegExp }> = [
  { shape: "dial", words: /\breloj(es)?\b/ },
  { shape: "triangle", words: /\btriangulos?\b/ },
  { shape: "rectangle", words: /\b(rectangulos?|cuadrados?)\b/ },
  { shape: "grid", words: /\b(cuadricula|casillas?|plano)\b/ },
];
/** Running text: a line with at least one real word. OCR debris read from strokes ("|", "x=") is not text. */
export const isRunningText = (l: TextLine) => !isLabelLine(l.text) && /\p{L}{2,}/u.test(l.text);
/** Label attachment reach: leaders end a few mm from their label; row/column headers sit up to ~1 cm from a grid. */
export const LABEL_REACH_MM = 10;

const plain = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function locateFigure(input: LocateInput): LocateReport {
  const { visual } = input;
  const rad = (input.skewDeg * Math.PI) / 180;
  const checks = Object.fromEntries(CHECKS.map((c) => [c, { status: "unverifiable" as CheckStatus, detail: "sin comprobar" }])) as VerificationReport["checks"];
  const set = (name: CheckName, status: CheckStatus, detail: string) => (checks[name] = { status, detail });
  let region: Rect | null = null, zoneOut: LocateReport["zone"] = null, cutCount = 0, shape: string | null = null, anchorKind: LocateReport["anchor"] = null;
  // Region in the deskewed frame → original page coordinates (axis-aligned envelope of the rotated region).
  const back = (r: Rect) => rotateRect(input.page, r, -rad);
  const finish = (crop: Rect | null): LocateReport => {
    const page = crop ? back(crop) : null;
    const candidate = page && CANDIDATE_CHECKS.every((c) => checks[c].status === "verified") ? norm(input.page, page) : null;
    const ok = CHECKS.every((c) => checks[c].status === "verified");
    return { visualId: visual.id, decision: ok && candidate ? "accepted" : "blocked", crop: ok ? candidate : null, candidate, checks,
      verifier: LOCATOR_VERSION, region: region ? back(region) : null, zone: zoneOut, cut: cutCount, shape, anchor: anchorKind };
  };

  // 1 · Provenance is the caller's responsibility here (the page and its OCR come from the same bytes).
  set("provenance", "verified", "píxeles y OCR de la misma página");
  if (input.words.length === 0) { set("text_layer", "unverifiable", "página sin capa OCR"); return finish(null); }
  set("text_layer", "verified", `${input.words.length} cajas OCR`);

  // 2 · Deskewed, paper-normalised page with the OCR boxes in the same frame. The source pixels are not modified.
  const model: PageModel = { ...normalizePaper(deskew(input.page, rad)), texts: input.words.map((w) => ({ text: w.text, ...w.upright })) };
  const mask = textMask(model);

  // 3 · Anchor: the production matcher, then the edit-tolerant one, which refuses any line that fits two activities.
  const exact = activityAnchors(input.lines, input.activities);
  const tolerant = tolerantAnchors(input.lines, input.activities);
  const anchors = new Map(exact);
  for (const [id, l] of tolerant) if (!anchors.has(id) && ![...anchors.values()].includes(l)) anchors.set(id, l);
  const activity = input.activities.find((a) => a.id === visual.activityId);
  if (!activity) { set("activity_anchor", "failed", "la actividad no es de esta página"); return finish(null); }
  if (!anchors.has(activity.id)) { set("activity_anchor", "unverifiable", "no se encuentra impresa la consigna"); return finish(null); }
  anchorKind = exact.has(activity.id) ? "exact" : "tolerant";
  set("activity_anchor", "verified", `consigna encontrada (${anchorKind})`);
  const zones = columnZones(anchors, model);
  const zone = zones.get(activity.id)!;
  zoneOut = zone;

  // 4 · Drawings of the zone, grouped into figures. A drawing that straddles the zone border belongs to no single activity.
  const named = KEYWORDS.filter((k) => k.words.test(plain(activity.instruction))).map((k) => k.shape);
  const all = drawings(model, mask, named.includes("rectangle"));
  const inZone = all.filter((c) => contains(zone, c, 0.5));
  const straddling = all.filter((c) => area(intersection(zone, c)) > 0.2 * area(c) && !contains(zone, c, 0.8));
  const figures = cluster(model, inZone).filter((f) => f.inkPx >= mm(model, 3) ** 2).sort((a, b) => b.inkPx - a.inkPx);
  if (!figures.length) { set("snap", "failed", "ningún dibujo en la zona de la actividad"); return finish(null); }
  // Kind-specific choice when a signature singles out one figure; otherwise the largest one.
  const signed = visual.kind === "bar" ? figures.filter((f) => barSignature(model, mask, f)) : visual.kind === "number_line" ? figures.filter((f) => numberLineSignature(model, mask, f)) : [];
  const main = signed.length === 1 ? signed[0]! : figures[0]!;
  // Small parts of the same figure (a sun, a cloud, an arrow) join it if they are close; comparable drawings are rivals.
  const diag = Math.hypot(main.x1 - main.x0, main.y1 - main.y0);
  let body: Rect = main;
  const rivals: Component[] = [];
  for (const f of figures) {
    if (f === main) continue;
    if (f.inkPx >= 0.25 * main.inkPx && area(f) >= 0.25 * area(main)) rivals.push(f);
    else if (gap(body, f) <= Math.max(mm(model, 10), 0.2 * diag)) body = union(body, f);
  }
  set("snap", "verified", "dibujo encontrado por la geometría en la zona");

  // 5 · Labels: OCR label boxes of the zone close to the figure (leaders end a few mm away), twice for denominators.
  // Letters inside a line of running text (the instruction's «A, B y C») are words, not labels of the drawing.
  const running = input.lines.filter(isRunningText);
  const standalone = (t: TextBox) => isLabel(t.text) && !running.some((l) => contains(l, t, 0.5));
  const labelsInZone = model.texts.filter((t) => standalone(t) && contains(zone, t, 0.5));
  let crop: Rect = body;
  for (let pass = 0; pass < 2; pass++) for (const t of labelsInZone) if (gap(crop, t) <= mm(model, pass === 0 ? LABEL_REACH_MM : 2)) crop = union(crop, t);
  region = crop;

  // 6 · Placement: in its own zone, not straddling a column or activity border.
  const crossing = straddling.filter((c) => area(intersection(c, crop)) > 0);
  if (!contains(zone, crop, 0.85)) set("placement", "failed", "la figura sale de la zona de su actividad");
  else if (crossing.length) set("placement", "failed", "un dibujo de la figura cruza el límite de la zona o de la columna");
  else set("placement", "verified", zone.columns ? "dentro de su columna" : "dentro de la zona de su actividad");

  // 7 · Uniqueness: no comparable drawing in the zone, no second claim for this activity's single figure.
  const claims = input.siblings.filter((s) => s.activityId === visual.activityId && s.id !== visual.id);
  if (rivals.length) set("uniqueness", "failed", `${rivals.length} dibujo(s) comparables en la zona`);
  else if (claims.length) set("uniqueness", "unverifiable", "la actividad reclama varias figuras: no se puede saber cuál es cuál");
  else set("uniqueness", "verified", "único dibujo de su tamaño en la zona");

  // 8 · Integrity: no drawing crosses the crop border; the crop does not touch the page edge.
  const edge = mm(model, 2);
  const cut = components(model, mask).filter((k) => !isRule(model, k) && !isEdgeShadow(model, k) && area(intersection(k, crop)) > 0 && !contains(crop, k, 0.999));
  cutCount = cut.length;
  if (crop.x0 <= edge || crop.y0 <= edge || crop.x1 >= model.width - edge || crop.y1 >= model.height - edge) set("integrity", "failed", "toca el borde de la página: puede estar incompleta");
  else if (cut.length) set("integrity", "failed", `${cut.length} trazo(s) cruzan el borde del recorte`);
  else set("integrity", "verified", "ningún trazo cortado");

  // 9 · Labels claimed by the analysis or named by the instruction must be inside (OCR boxes; ink not re-read).
  const fromInstruction = instructionLabels(activity.instruction);
  const required = [...new Set([...visual.labels, ...fromInstruction])];
  const labelBoxes = model.texts.filter(standalone);
  const missing = required.filter((l) => !labelBoxes.some((t) => t.text.trim() === l && contains(crop, t)));
  if (!missing.length) set("labels", "verified", required.length ? `etiquetas dentro: ${required.join(", ")}` : "no se reclaman etiquetas");
  else if (missing.some((l) => labelBoxes.some((t) => t.text.trim() === l))) set("labels", "failed", `etiquetas fuera del recorte: ${missing.join(", ")}`);
  else set("labels", "unverifiable", `etiquetas no legibles en el OCR: ${missing.join(", ")}`);

  // 10 · No running text inside.
  const foreign = running.filter((l) => area(intersection(l, crop)) > 0.15 * area(l));
  if (foreign.length) set("foreign_text", "failed", `${foreign.length} línea(s) de texto corrido dentro`);
  else set("foreign_text", "verified", "sin texto corrido");

  // 11 · Lexical answer screen (does not detect drawn answers).
  const near = { x0: crop.x0 - mm(model, 10), y0: crop.y0 - mm(model, 10), x1: crop.x1 + mm(model, 10), y1: crop.y1 + mm(model, 10) };
  const inside = words(model.texts.filter((t) => contains(near, t, 0.5)).map((t) => t.text).join(" "));
  const answer = activity.expectedAnswer ? words(activity.expectedAnswer) : new Set<string>();
  const leaked = [...inside].filter((w) => answer.has(w));
  if (leaked.length) set("answer_leak", "failed", "la figura muestra parte de la respuesta");
  else set("answer_leak", "verified", activity.expectedAnswer ? "ninguna palabra de la respuesta dentro" : "sin respuesta registrada que proteger");

  // 12 · Shape or label evidence: a signature of the claimed kind, a shape the instruction names, or the instruction's labels.
  const evidence =
    visual.kind === "bar" ? (barSignature(model, mask, main) ? "bar" : null)
    : visual.kind === "number_line" ? (numberLineSignature(model, mask, main) ? "number_line" : null)
    : named.includes("dial") && dialSignature(model, mask, main) ? "dial"
    : named.includes("triangle") && polygonCorners(model, mask, main) === 3 ? "triangle"
    : named.includes("rectangle") && polygonCorners(model, mask, main) === 4 ? "rectangle"
    : named.includes("grid") && gridSignature(model, mask, main) ? "grid"
    : fromInstruction.length && checks.labels.status === "verified" ? "instruction_labels" : null;
  shape = evidence;
  if (evidence) set("identity_evidence", "verified", `evidencia de forma o etiquetas: ${evidence}`);
  else if (visual.kind !== "figure") set("identity_evidence", "failed", `sin firma de ${visual.kind} en los píxeles`);
  else set("identity_evidence", "unverifiable", "figura genérica: ni forma nombrada ni etiquetas de la consigna");

  // Never verifiable from geometry: the crop stays blocked whatever the evidence above.
  set("semantic_identity", "unverifiable", "forma y etiquetas no verifican contenido, sombreado ni actividad correcta");
  set("complete_content", "unverifiable", "no se puede detectar una parte sin etiqueta borrada o ausente");
  set("visual_answer_safety", "unverifiable", "la búsqueda léxica no detecta respuestas dibujadas o numéricas");
  return finish(crop);
}

const norm = (model: PageModel, r: Rect) => ({ x: r.x0 / model.width, y: r.y0 / model.height, w: (r.x1 - r.x0) / model.width, h: (r.y1 - r.y0) / model.height });
export { iou };
