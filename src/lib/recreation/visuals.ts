import "server-only";
import type { DimensionKey } from "@/lib/schemas/functional-profile";
import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";
import { illustrate, type IllustrationDeps } from "@/lib/materials/visuals/illustrate/service";
import { VISUAL_SPEC_VERSION, type VisualSpec } from "@/lib/visuals/spec";
import type { RecreationPlan, VisualRequest } from "./contract";
import { normalize, type Verification } from "./verify";

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
}

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

/** Whether the request can go to an image model at all: nothing exact needed, and nothing exact named in what must be shown. */
export function generable(r: VisualRequest): { ok: true } | { ok: false; reason: string } {
  if (r.needs_exact.labels || r.needs_exact.arrows || r.needs_exact.numbers) return { ok: false, reason: "la actividad depende de rótulos, flechas o números exactos" };
  if ([...r.must_show, ...r.concepts].some((t) => EXACT_WORDS.test(normalize(t)))) return { ok: false, reason: "pide texto, flechas o números dentro de la imagen" };
  return { ok: true };
}

export async function resolveVisuals(ctx: VisualContext): Promise<ResolvedVisual[]> {
  const out: ResolvedVisual[] = [];
  for (const r of ctx.plan.visual_requests) out.push(await resolveOne(r, ctx));
  return out;
}

async function resolveOne(r: VisualRequest, ctx: VisualContext): Promise<ResolvedVisual> {
  const attempts: string[] = [];
  const base = { request_id: r.id, activity_ids: r.activity_ids, essential: r.essential, alt: r.alt_text };
  const provenance = (produced_by: string | null, reviewed_by: string | null) => ({ requested_by: ctx.planner, decided_by: RECREATION_VISUALS_VERSION, produced_by, reviewed_by });

  // A · a located original.
  if (r.original_ref && ctx.locatedOriginals.has(r.original_ref)) return { ...base, route: "A_original", source: { kind: "original", visual_ref: r.original_ref }, attempts: ["A: original localizado"], provenance: provenance(`original ${r.original_ref}`, "localizador automático") };
  attempts.push(r.original_ref ? `A: ${r.original_ref} no está localizado` : "A: no hay original que sirva");

  // B · an exact scheme from code, when the original's labels allow it.
  const scheme = exactSchemeFor(r, ctx.analysis);
  const exact = generable(r);
  if (scheme && (!exact.ok || !ctx.illustrations.available)) return { ...base, route: "B_code", source: { kind: "figure", spec: scheme, visual_ref: r.original_ref! }, attempts: [...attempts, "B: esquema exacto dibujado por el renderer"], provenance: provenance(`renderer (${scheme.kind})`, "datos del original") };
  attempts.push(scheme ? "B: posible, pero no se necesita exactitud" : "B: no hay esquema exacto que construir");

  // C · the illustration pipeline, gated.
  const missing = (reason: string): ResolvedVisual => ({ ...base, route: "none", source: r.essential ? { kind: "missing", purpose: r.purpose } : null, attempts: [...attempts, reason], provenance: provenance(null, null) });
  if (!exact.ok) return missing(`C: no se genera: ${exact.reason}`);
  if (!ctx.illustrations.available) return missing(`C: generación no disponible (${ctx.illustrations.reason})`);
  const gate = ctx.illustrations;
  const signatures = answersOf(ctx, r.activity_ids);
  const activities = ctx.plan.activities.filter((a) => r.activity_ids.includes(a.id));
  const objectives = ctx.analysis.pedagogical_intent.objectives.filter((o) => r.objective_ids.includes(o.id)).map((o) => o.text);
  const prohibited = [...ALWAYS_PROHIBITED, ...r.prohibited];
  const outcome = await illustrate(withoutText(gate.deps, prohibited), {
    workspaceId: gate.workspaceId,
    adaptationId: gate.recreationId,
    needKey: `recreation:${r.id}`,
    stage: ctx.analysis.identification.stage.value,
    grade: ctx.analysis.identification.grade.value,
    subject: ctx.analysis.identification.subject.value,
    activity: activities.map((a) => a.prompt).join(" "),
    objective: objectives.join("; ") || null,
    // The prompt of the brief (image_brief v1) is reused as published: what must be shown and avoided travels in its «missing» field.
    // The material's one style goes into every brief, so its pictures look like one set.
    missing: `Debe verse: ${r.must_show.join(", ")}. Estilo común del material: ${ctx.plan.visual_style} Tipo: ${r.style}; detalle: ${r.detail}. Accesibilidad: ${r.accessibility} Prohibido: ${prohibited.join("; ")}.`.slice(0, 1400),
    purpose: r.purpose,
    supports: ctx.needs.slice(0, 8),
    expectedAnswer: null,
    signatures,
    lowDetail: r.detail !== "moderate" || ctx.needs.some((n) => LOW_DETAIL.includes(n)),
  });
  if (outcome.ok) return { ...base, alt: outcome.asset.alt || r.alt_text, route: "C_generated", source: { kind: "generated", asset_id: outcome.asset.id, sha256: outcome.asset.sha256, width: outcome.asset.width, height: outcome.asset.height }, attempts: [...attempts, outcome.cached ? "C: ilustración ya aprobada, reutilizada" : `C: generada y aprobada en ${outcome.attempts} intento(s)`], provenance: provenance(gate.producer, "image_review v1 + puertas de Adaptaula") };
  if (scheme) return { ...base, route: "B_code", source: { kind: "figure", spec: scheme, visual_ref: r.original_ref! }, attempts: [...attempts, `C: ${outcome.reason}`, "B: esquema exacto como alternativa"], provenance: provenance(`renderer (${scheme.kind})`, "datos del original") };
  return missing(`C: ${outcome.reason}${outcome.detail.length ? ` (${outcome.detail.slice(0, 3).join(", ")})` : ""}`);
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
