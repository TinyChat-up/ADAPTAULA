import "server-only";
import type { DimensionKey } from "@/lib/schemas/functional-profile";
import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";
import { illustrate, type IllustrationDeps } from "@/lib/materials/visuals/illustrate/service";
import { briefOf, decideResource } from "./tools";
import { VISUAL_SPEC_VERSION, type VisualSpec } from "@/lib/visuals/spec";
import type { RecreationPlan, VisualRequest } from "./contract";
import { normalize, type Verification } from "./verify";
import { fingerprint } from "@/lib/adaptation/fingerprint";
import { normalizeText } from "@/lib/adaptation/text";

/**
 * How each picture the planner asked for is produced (ADR-050). The planner never decides it; this does, in this order:
 *
 *   A · original    an original picture that serves and has been located (its bytes are the original's): reuse it.
 *   B · code        the activity needs exact labels, arrows or numbers: only a scheme drawn by our renderer from verified data
 *                   (`flow` from the original's own labels). If none can be built, NOTHING is generated in its place.
 *   C · generated   nothing exact is needed and generation is authorised for this workspace: the existing illustration pipeline
 *                   (`illustrate`: brief → image → review → private storage, with its quota, budget and pilot gate). The brief may not
 *                   carry labels or numbered markers: text belongs to the renderer.
 *   none            reported with its reason; an ESSENTIAL picture that cannot be made is printed as a visible gap and listed for
 *                   the teacher, never silently dropped.
 */

export const RECREATION_VISUALS_VERSION = "recreation_visuals@v1";

export type VisualRoute = "A_original" | "B_code" | "C_generated" | "none";

export interface ResolvedVisual {
  request_id: string;
  activity_ids: string[];
  essential: boolean;
  route: VisualRoute;
  /** What goes on the sheet: an original, a scheme, a generated image, or the visible gap of an essential picture. */
  source:
    | { kind: "original"; visual_ref: string }
    | { kind: "figure"; spec: VisualSpec; visual_ref: string }
    | { kind: "generated"; asset_id: string; sha256: string; width: number; height: number }
    | { kind: "missing"; purpose: string }
    | null;
  alt: string;
  /** For a request that illustrates cards: each card's picture (or why it has none). The cards print their names either way. */
  cards?: Array<{ text: string; asset: { asset_id: string; sha256: string; width: number; height: number } | null; reason: string }>;
  /** Each route considered, and why it was or was not taken. */
  attempts: string[];
  provenance: { requested_by: string; decided_by: string; produced_by: string | null; reviewed_by: string | null };
}

/** Whether the illustration pipeline may run for this recreation, decided by the caller with the product's gate. */
export type IllustrationGate =
  | { available: true; deps: IllustrationDeps; workspaceId: string; recreationId: string; producer: string }
  | { available: false; reason: "disabled" | "plan" | "not_offered" | "service" | "budget" | "quota" };

export interface VisualContext {
  plan: RecreationPlan;
  verification: Verification;
  analysis: MaterialAnalysis;
  needs: readonly DimensionKey[];
  /** Original pictures already located for this material (their asset can be reused): option A. */
  locatedOriginals: ReadonlySet<string>;
  illustrations: IllustrationGate;
  planner: string;
  /** Pictures already asked for in this recreation (shared by every request: the cap is per recreation). */
  imagesUsed: { count: number };
  /**
   * ADR-054: `new_images` (planner v5 on) never reuses the original's pictures: the original is the source of WHAT is learnt, and
   * every picture is a new one designed for this student and this activity (OpenAI), or an exact scheme drawn by code from verified
   * data. `reuse_originals` (absent) keeps the behaviour adaptations created before it were frozen with.
   */
  policy?: "reuse_originals" | "new_images";
  /** The same picture asked twice in one recreation is made once (requests run concurrently). */
  inflight?: Map<string, Promise<unknown>>;
}

const FUNCTION_ES: Record<VisualRequest["function"], string> = { context: "situar y reconocer lo que nombra el texto", observation: "observar y localizar elementos", vocabulary: "reconocer el vocabulario", process: "comprender un proceso", comparison: "comparar situaciones" };

const EXACT_WORDS = /\b(flecha|flechas|etiqueta|etiquetas|rotulo|rotulos|numero|numeros|cifra|cifras|texto escrito|letra|letras|grafica|tabla)\b|\d/;
const ALWAYS_PROHIBITED = ["texto, letras, números o rótulos dentro de la imagen", "flechas, líneas o símbolos que indiquen relaciones"];
const LOW_DETAIL: readonly DimensionKey[] = ["visual_density", "visual_distraction_reduction", "unnecessary_decoration"];

/** A scheme the renderer can draw exactly from the original (B): its flow, when the request is about that diagram's boxes. */
function exactSchemeFor(r: VisualRequest, analysis: MaterialAnalysis): VisualSpec | null {
  if (!r.original_ref) return null;
  const visual = analysis.visuals.find((v) => v.id === r.original_ref);
  const text = visual?.text ?? "";
  if (!visual || !text.includes("→")) return null;
  const labels = text.split("→").map((l) => l.trim()).filter(Boolean);
  if (labels.length < 2 || labels.length > 6) return null;
  const sentence = (l: string) => l.charAt(0).toUpperCase() + l.slice(1).toLowerCase();
  return { spec_version: VISUAL_SPEC_VERSION, kind: "flow", ...(visual.title ? { title: visual.title.slice(0, 60) } : {}), items: labels.map(sentence) };
}

/**
 * The original's own diagram as an exact scheme drawn by code (option B for an activity that names arrows or a scheme it was not
 * given): the preferred visual first, then the first one of the analysis whose labels are joined by «→» (2–6 labels). Never invented.
 */
export function originalFlow(analysis: MaterialAnalysis, preferred: string | null): { visual_ref: string; title: string; items: string[] } | null {
  const candidates = [...analysis.visuals.filter((v) => v.id === preferred), ...analysis.visuals.filter((v) => v.id !== preferred)];
  for (const visual of candidates) {
    const labels = (visual.text ?? "").split("→").map((l) => l.trim()).filter(Boolean);
    if (!(visual.text ?? "").includes("→") || labels.length < 2 || labels.length > 6 || labels.some((l) => l.length > 40)) continue;
    const sentence = (l: string) => l.charAt(0).toUpperCase() + l.slice(1).toLowerCase();
    return { visual_ref: visual.id, title: (visual.title ?? "Esquema").slice(0, 60), items: labels.map(sentence) };
  }
  return null;
}

/** Whether the request can go to an image model at all: nothing exact needed, and nothing exact named in what must be shown. */
export function generable(r: VisualRequest): { ok: true } | { ok: false; reason: string } {
  if (r.needs_exact.labels || r.needs_exact.arrows || r.needs_exact.numbers) return { ok: false, reason: "la actividad depende de rótulos, flechas o números exactos" };
  if ([...r.must_show, ...r.concepts].some((t) => EXACT_WORDS.test(normalize(t)))) return { ok: false, reason: "pide texto, flechas o números dentro de la imagen" };
  return { ok: true };
}

export async function resolveVisuals(ctx: VisualContext): Promise<ResolvedVisual[]> {
  // Independent requests run together (the cap on pictures is taken synchronously, in the plan's order); the result keeps that order.
  return Promise.all(ctx.plan.visual_requests.map((r) => resolveOne(r, ctx)));
}

async function resolveOne(r: VisualRequest, ctx: VisualContext): Promise<ResolvedVisual> {
  const attempts: string[] = [];
  const base = { request_id: r.id, activity_ids: r.activity_ids, essential: r.essential, alt: r.alt_text };
  const provenance = (produced_by: string | null, reviewed_by: string | null) => ({ requested_by: ctx.planner, decided_by: RECREATION_VISUALS_VERSION, produced_by, reviewed_by });

  // A · a located original (only for adaptations frozen before ADR-054).
  if (ctx.policy === "new_images") attempts.push("A: no se reutilizan imágenes del original: se diseña una nueva");
  else if (r.original_ref && ctx.locatedOriginals.has(r.original_ref)) return { ...base, route: "A_original", source: { kind: "original", visual_ref: r.original_ref }, attempts: ["A: original localizado"], provenance: provenance(`original ${r.original_ref}`, "localizador automático") };
  else attempts.push(r.original_ref ? `A: ${r.original_ref} no está localizado` : "A: no hay original que sirva");

  // B · an exact scheme from code, when the original's labels allow it.
  const scheme = exactSchemeFor(r, ctx.analysis);
  // ADR-056: with the new-pictures policy a limit of the image tool is adapted for (see tools.ts), not a reason to refuse the idea.
  const decision = ctx.policy === "new_images" ? decideResource(r, ctx.plan) : null;
  const exact = decision ? (decision.route === "gap" ? ({ ok: false, reason: decision.gap!.message } as const) : ({ ok: true } as const)) : generable(r);
  if (scheme && (!exact.ok || !ctx.illustrations.available)) return { ...base, route: "B_code", source: { kind: "figure", spec: scheme, visual_ref: r.original_ref! }, attempts: [...attempts, "B: esquema exacto dibujado por el renderer"], provenance: provenance(`renderer (${scheme.kind})`, "datos del original") };
  attempts.push(scheme ? "B: posible, pero no se necesita exactitud" : "B: no hay esquema exacto que construir");

  // C · the illustration pipeline, gated.
  const missing = (reason: string): ResolvedVisual => ({ ...base, route: "none", source: r.essential ? { kind: "missing", purpose: r.purpose } : null, attempts: [...attempts, reason], provenance: provenance(null, null) });
  if (!exact.ok) return missing(`C: no se genera: ${exact.reason}`);
  if (!ctx.illustrations.available) return missing(`C: generación no disponible (${ctx.illustrations.reason})`);
  const gate = ctx.illustrations;
  if (r.for_cards) return resolveCards(r, ctx, gate, base, attempts, provenance);
  if (!takeImage(ctx)) return missing(`C: límite de ${RECREATION_VISUAL_LIMITS.maxImages} imágenes por recreación`);
  const outcome = await illustrateFor(r, ctx, gate, null);
  if (outcome.ok) return { ...base, alt: outcome.asset.alt || r.alt_text, route: "C_generated", source: { kind: "generated", asset_id: outcome.asset.id, sha256: outcome.asset.sha256, width: outcome.asset.width, height: outcome.asset.height }, attempts: [...attempts, outcome.cached ? "C: ilustración ya aprobada, reutilizada" : `C: generada y aprobada en ${outcome.attempts} intento(s)`], provenance: provenance(gate.producer, "image_review v1 + puertas de Adaptaula") };
  if (scheme) return { ...base, route: "B_code", source: { kind: "figure", spec: scheme, visual_ref: r.original_ref! }, attempts: [...attempts, `C: ${outcome.reason}`, "B: esquema exacto como alternativa"], provenance: provenance(`renderer (${scheme.kind})`, "datos del original") };
  return missing(`C: ${outcome.reason}${outcome.detail.length ? ` (${outcome.detail.slice(0, 3).join(", ")})` : ""}`);
}

/** Pictures one recreation may have (each a unit of the plan's image allowance and a share of the budget). */
export const RECREATION_VISUAL_LIMITS = { maxImages: 8 } as const;

function takeImage(ctx: VisualContext): boolean {
  if (ctx.imagesUsed.count >= RECREATION_VISUAL_LIMITS.maxImages) return false;
  ctx.imagesUsed.count++;
  return true;
}

/**
 * The stored key of a picture of this recreation: within the database's own contract for `generated_assets.need_key` (`act_N`), one
 * per request and card (request position × 100 + card). Recreation keys used to be rejected by that CHECK: every approved picture was lost.
 */
export const needKeyOf = (plan: Pick<RecreationPlan, "visual_requests">, r: VisualRequest, cardIndex: number | null) => `act_${(plan.visual_requests.findIndex((x) => x.id === r.id) + 1) * 100 + (cardIndex === null ? 0 : cardIndex + 1)}`;

/**
 * One call of the existing illustration pipeline for a request (or for one card of it). The need key carries a fingerprint of
 * what is asked: the same request in a later version REUSES the approved picture (no call); a different one makes a new picture
 * and never overwrites the old (generated_assets rows are inserted, not replaced).
 */
function illustrateFor(r: VisualRequest, ctx: VisualContext, gate: Extract<IllustrationGate, { available: true }>, card: string | null, cardIndex: number | null = null) {
  const signatures = answersOf(ctx, r.activity_ids);
  const activities = ctx.plan.activities.filter((a) => r.activity_ids.includes(a.id));
  const objectives = ctx.analysis.pedagogical_intent.objectives.filter((o) => r.objective_ids.includes(o.id)).map((o) => o.text);
  const prohibited = [...ALWAYS_PROHIBITED, ...r.prohibited];
  const show = card ? [`solo esto: ${card}`, ...r.must_show] : r.must_show;
  const asked = { show, style: ctx.plan.visual_style, kind: r.style, detail: r.detail, prohibited, purpose: r.purpose };
  // From ADR-054 on the key follows the database's contract; older adaptations keep theirs (it never stored, see `needKeyOf`).
  const needKey = ctx.policy === "new_images" ? needKeyOf(ctx.plan, r, cardIndex) : `recreation:${r.id}:${fingerprint(asked).slice(0, 16)}`;
  // One generation per distinct picture of this recreation: the same request (same content, style and card) shares one call.
  const shared = fingerprint(asked);
  const known = ctx.inflight?.get(shared) as ReturnType<typeof illustrate> | undefined;
  if (known) return known;
  const made = illustrate(withoutText(gate.deps, prohibited), {
    workspaceId: gate.workspaceId,
    adaptationId: gate.recreationId,
    needKey,
    stage: ctx.analysis.identification.stage.value,
    grade: ctx.analysis.identification.grade.value,
    subject: ctx.analysis.identification.subject.value,
    activity: activities.map((a) => a.prompt).join(" "),
    objective: objectives.join("; ") || null,
    // The prompt of the brief (image_brief v1) is reused as published: what must be shown and avoided travels in its «missing» field.
    // The material's one style goes into every brief, so its pictures look like one set.
    missing: `${card ? `Ilustración para una tarjeta recortable: ${card}. ` : ""}Función en la actividad: ${FUNCTION_ES[r.function]}. Conceptos que ayuda a comprender: ${r.concepts.join(", ")}. Debe verse: ${show.join(", ")}. Estilo común del material: ${ctx.plan.visual_style} Tipo: ${r.style}; detalle: ${r.detail}. Accesibilidad: ${r.accessibility} Prohibido: ${prohibited.join("; ")}.`.slice(0, 1400),
    purpose: card ? `${r.purpose} (tarjeta: ${card})` : r.purpose,
    supports: ctx.needs.slice(0, 8),
    expectedAnswer: null,
    // The leak check compares normalised text: the signatures must be normalised too (a raw one never matched).
    signatures: ctx.policy === "new_images" ? signatures.map(normalizeText).filter(Boolean) : signatures,
    lowDetail: r.detail !== "moderate" || ctx.needs.some((n) => LOW_DETAIL.includes(n)),
    ...(ctx.policy === "new_images" ? { brief: briefOf(r, ctx.plan, card).brief } : {}),
  });
  ctx.inflight?.set(shared, made);
  return made;
}

/** How many card pictures are made at once (each is a brief, an image and a review). */
const CARD_CONCURRENCY = 3;

/** `map` with at most `limit` calls in flight; the result keeps the input's order. */
async function mapPool<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!, i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** Cards: one picture per card, in order. A card without a picture keeps its printed name (the card works without it). */
async function resolveCards(
  r: VisualRequest,
  ctx: VisualContext,
  gate: Extract<IllustrationGate, { available: true }>,
  base: Pick<ResolvedVisual, "request_id" | "activity_ids" | "essential" | "alt">,
  attempts: string[],
  provenance: (produced: string | null, reviewed: string | null) => ResolvedVisual["provenance"],
): Promise<ResolvedVisual> {
  const material = ctx.plan.materials.find((m) => m.id === r.for_cards);
  const items = material?.kind === "cut_out_cards" ? material.cards : [];
  // The cap is applied in card order BEFORE anything is asked; the pictures themselves are made a few at a time (a minutes-long
  // request cannot afford one card after another), and the result keeps the cards' order.
  const allowed = items.map(() => takeImage(ctx));
  const cards: NonNullable<ResolvedVisual["cards"]> = await mapPool(items, CARD_CONCURRENCY, async (text, i) => {
    if (!allowed[i]) return { text, asset: null, reason: "límite de imágenes" };
    const outcome = await illustrateFor(r, ctx, gate, text, i);
    return outcome.ok ? { text, asset: { asset_id: outcome.asset.id, sha256: outcome.asset.sha256, width: outcome.asset.width, height: outcome.asset.height }, reason: outcome.cached ? "reutilizada" : "generada y aprobada" } : { text, asset: null, reason: outcome.reason };
  });
  const made = cards.filter((c) => c.asset).length;
  return {
    ...base,
    route: made > 0 ? "C_generated" : "none",
    source: null,
    cards,
    attempts: [...attempts, `C: ${made} de ${items.length} tarjetas ilustradas`, ...cards.filter((c) => !c.asset).map((c) => `${c.text}: ${c.reason}`)],
    provenance: provenance(made > 0 ? gate.producer : null, made > 0 ? "image_review v1 + puertas de Adaptaula" : null),
  };
}

/** The answers of the activities a picture serves: no label or description of the picture may carry them (`validateBrief`). */
function answersOf(ctx: VisualContext, activityIds: readonly string[]): string[] {
  return ctx.verification.activities.filter((v) => activityIds.includes(v.id)).flatMap((v) => {
    const s = v.solution;
    return s.kind === "options" ? s.correct : s.kind === "pairs" ? s.pairs.map((p) => `${p.item} ${p.category}`) : s.kind === "order" ? [s.solution.join(" ")] : s.kind === "number" ? [String(s.value)] : [];
  });
}

/**
 * The same pipeline with two recreation rules on the brief: no labels and no numbered markers (the renderer places text; a model
 * does not draw it), and the request's prohibited elements added to the brief, so the image review checks them.
 */
function withoutText(deps: IllustrationDeps, prohibited: readonly string[]): IllustrationDeps {
  return {
    ...deps,
    async brief(input) {
      const answer = await deps.brief(input);
      const draft = answer.draft;
      if (!draft) return answer;
      const elements = draft.required_elements ?? [];
      if (elements.some((e) => e.label !== null || e.marker !== null)) return { ...answer, draft: { ...draft, feasible: false } };
      return { ...answer, draft: { ...draft, prohibited_elements: [...new Set([...(draft.prohibited_elements ?? []), ...prohibited])].slice(0, 10) } };
    },
  };
}
