import type { DimensionKey } from "@/lib/schemas/functional-profile";
import type { MaterialAnalysis } from "@/lib/schemas/material-analysis";
import { normalizeText } from "@/lib/adaptation/text";
import { validateBrief, type BriefDraft } from "@/lib/visuals/illustration";
import type { RecreationPlan, VisualRequest } from "./contract";
import { mentions } from "./references";
import { activityTexts, chooseScheme } from "./relations";
import { normalize, type PlanIssue, type Verification } from "./verify";

/**
 * Resource tools (ADR-056). Claude designs the material and says WHAT it needs; the system decides WHICH tool makes each resource and
 * adapts the order to that tool, instead of rejecting the plan because an image model cannot do something. A limit of a tool is not an
 * invalid idea: the validator keeps for Claude only what is wrong pedagogically (answers given away, a resource nothing can make
 * that the activity depends on, too many pictures for the budget), and says clearly which of the two it is.
 */

export const RESOURCE_TOOLS = {
  /** OpenAI: new educational scenes, animals, objects, concepts, cards' pictures. Text, numbers, arrows and exact counts are NOT asked of it. */
  openai_illustration: { does: "escenas, animales, objetos y conceptos nuevos; una ilustración por tarjeta", limits: "sin texto, números, flechas ni cantidades exactas dentro de la imagen" },
  /** The renderer, from verified data (the original's labels and relations). */
  code_scheme: { does: "flechas, relaciones, rótulos, cifras y diagramas exactos (esquemas de flujo)", limits: "necesita rótulos citados del original" },
  /** Cards and boards the student cuts out and sorts. */
  materials: { does: "tarjetas recortables (con ilustración por tarjeta) y tableros de clasificación", limits: "ligados a una actividad de clasificar" },
  /** An illustration and an exact scheme of the same activity: both printed with it. */
  hybrid: { does: "una ilustración nueva junto al esquema exacto de la misma actividad", limits: "el esquema va declarado en visuals; la ilustración, en visual_requests" },
} as const;

/**
 * What the system does NOT have yet, said plainly (never simulated). A resource that needs one of these is reported as a capability
 * gap: it never silently disappears and nothing fake is produced in its place.
 */
export const PENDING_CAPABILITIES = {
  counted_group: "un grupo con una cantidad EXACTA de elementos ilustrados (repetir N veces un dibujo)",
  custom_resource: "recursos fuera del catálogo (se registran como demanda; no hay fabricante genérico)",
  exact_scheme_without_data: "un esquema con flechas o rótulos exactos sin datos verificados de los que dibujarlo (ni en el plan ni en el original)",
} as const;

// ---------------------------------------------------------------------------------------------------------------------------
// Translating what Claude asks into what OpenAI can be asked
// ---------------------------------------------------------------------------------------------------------------------------

const NUMBER_WORDS = "dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce";
const MEASURE = /\b\d+(?:[.,]\d+)?\s?(?:mm|cm|dm|m|km|g|kg|mg|l|ml|cl|s|min|h|%|°|º|grados|metros|kilos|litros|euros|€)\b/g;
const COUNT = new RegExp(`\\b(?:\\d+|${NUMBER_WORDS})\\s+(?=\\p{L})`, "giu");
const EXACT_PHRASE = /\b(?:exactamente|cantidad de|grupo de)\s+(?:\d+|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\b\s*/gi;
const TEXTUAL = /\b(?:etiquetas?|rotulos?|rótulos?|flechas?|numeros?|números?|cifras?|texto escrito|letras?)\b/gi;
const clean = (t: string) => t.replace(/\s{2,}/g, " ").replace(/\s+([,.;:])/g, "$1").replace(/^[\s,;:.-]+|[\s,;:-]+$/g, "").trim();

/** The same idea without what an image model cannot get exactly right: counts, measures, text. The text itself moves to the renderer. */
export function qualitative(text: string): { text: string; changed: boolean } {
  const out = clean(text.replace(EXACT_PHRASE, "").replace(MEASURE, "").replace(COUNT, "").replace(TEXTUAL, ""));
  return { text: out, changed: out !== text.trim() };
}

export interface ResourceDecision {
  /** How this request is made. `gap`: no tool can make it as ordered (see `gap`). */
  route: "illustration" | "scheme" | "gap";
  /** What was adapted to the tool, in plain words (kept in the record, never shown to the student). */
  adapted: string[];
  gap?: { capability: keyof typeof PENDING_CAPABILITIES; message: string };
}

/**
 * Which tool makes a request. Exact numbers of drawn things need a capability that does not exist yet: that is a GAP, not an invalid
 * idea. Arrows and labels are the renderer's: the activity gets them from its scheme (`visuals`), the picture does not carry them.
 */
export function decideResource(r: VisualRequest, plan: Pick<RecreationPlan, "visuals" | "activities" | "facts" | "visual_requests">, analysis?: MaterialAnalysis): ResourceDecision {
  const adapted: string[] = [];
  if (r.needs_exact.numbers) {
    return { route: "gap", adapted, gap: { capability: "counted_group", message: `Pide una cantidad exacta de elementos dibujados (${PENDING_CAPABILITIES.counted_group}), que todavía no se puede fabricar. Alternativas: una ilustración sin cantidad exacta y la cifra en el enunciado, tarjetas (una por elemento) o un esquema con datos del original.` } };
  }
  if (r.needs_exact.arrows || r.needs_exact.labels) {
    // Marked exact by Claude: EACH activity of the request must get the scheme that corresponds to it (its own, or the one its facts and
    // words point at), never "any scheme of the plan". Otherwise it cannot be made faithfully.
    const missing: string[] = [];
    for (const id of r.activity_ids) {
      const a = plan.activities.find((x) => x.id === id);
      if (!a || a.visual_ids.length > 0) continue;
      const choice = chooseScheme(a, plan, analysis);
      if (!choice.ok) missing.push(`${id} (${choice.reason === "ambiguous" ? `varios esquemas posibles: ${choice.candidates.join(", ")}` : "ninguno corresponde"})`);
    }
    if (missing.length > 0) return { route: "gap", adapted, gap: { capability: "exact_scheme_without_data", message: `Necesita flechas o rótulos exactos, pero no se puede saber qué esquema corresponde a ${missing.join("; ")} (${PENDING_CAPABILITIES.exact_scheme_without_data}). Enlaza en visual_ids de cada actividad el esquema que necesita, o rediseña la actividad sin depender de él.` } };
    adapted.push("flechas o rótulos: los dibuja el renderizador en el esquema que corresponde a cada actividad; la ilustración no los lleva");
  }
  return { route: "illustration", adapted };
}

// ---------------------------------------------------------------------------------------------------------------------------
// A quantity is only translated away when the activity does not need it (ADR-057)
// ---------------------------------------------------------------------------------------------------------------------------

const WORD_VALUE: Record<string, number> = { dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12 };
const QUANTITY = new RegExp(`\\b(\\d+(?:[.,]\\d+)?|${NUMBER_WORDS})\\s+(?=\\p{L})`, "giu");
const valueOf = (token: string) => (/^\d/.test(token) ? Number(token.replace(",", ".")) : (WORD_VALUE[token.toLowerCase()] ?? NaN));
const COUNTING = /\b(cuant[oa]s?|cuenta\w*|contar|total|mas|menos|compara\w*|suma\w*|resta\w*|numero de|diferencia|veces)\b/;

export interface QuantityNeed {
  token: string;
  activity: string;
  why: string;
}

/**
 * The quantities of a picture request that the activity NEEDS the picture to carry exactly: the activity asks to count, compare or
 * calculate from the picture, or the number is part of a verified answer, and the activity's own text does not already state it. Only
 * then is the quantity pedagogical information that cannot be dropped («tres ranas» → «ranas» would change what the student can do).
 */
export function necessaryQuantities(r: VisualRequest, plan: Pick<RecreationPlan, "activities" | "facts">, verification: Verification): QuantityNeed[] {
  const out: QuantityNeed[] = [];
  const asked = [...r.must_show, ...r.concepts, r.alt_text, r.purpose].flatMap((t) => [...t.matchAll(QUANTITY)].map((m) => m[1]!));
  if (asked.length === 0) return out;
  for (const id of r.activity_ids) {
    const a = plan.activities.find((x) => x.id === id);
    if (!a) continue;
    const text = activityTexts(a, plan);
    const norm = normalize(text);
    const statedNumbers = new Set([...norm.matchAll(/\b\d+(?:[.,]\d+)?\b/g)].map((m) => Number(m[0].replace(",", "."))).concat([...norm.matchAll(new RegExp(`\\b(${NUMBER_WORDS})\\b`, "g"))].map((m) => WORD_VALUE[m[1]!]!)));
    const solution = verification.activities.find((v) => v.id === id)?.solution;
    const answers = solution?.kind === "number" ? [String(solution.value)] : solution?.kind === "options" ? solution.correct : solution?.kind === "pairs" ? solution.pairs.map((p) => `${p.item} ${p.category}`) : solution?.kind === "order" ? solution.solution : [];
    const answerNumbers = new Set(answers.flatMap((t) => [...normalize(t).matchAll(/\b\d+(?:[.,]\d+)?\b/g)].map((m) => Number(m[0].replace(",", ".")))));
    const countsFromPicture = COUNTING.test(norm) && mentions(text, "picture");
    for (const token of new Set(asked)) {
      const value = valueOf(token);
      // «1» is an index or «un/una»: a quantity that matters is two or more.
      if (Number.isNaN(value) || value < 2 || statedNumbers.has(value)) continue;
      if (countsFromPicture) out.push({ token, activity: id, why: "la actividad pide contar, comparar o calcular a partir de la imagen" });
      else if (answerNumbers.has(value)) out.push({ token, activity: id, why: "la cantidad forma parte de la respuesta" });
    }
  }
  return out;
}

/** The brief of an illustration, written by the server from the request Claude designed (purpose, concepts, what to show and avoid, accessibility). */
const ALWAYS_PROHIBITED = ["texto, letras, números o rótulos dentro de la imagen", "flechas, líneas o símbolos que indiquen relaciones"];
const KIND: Record<VisualRequest["function"], NonNullable<BriefDraft["kind"]>> = { context: "context_picture", observation: "everyday_scene", vocabulary: "vocabulary_support", process: "process_sequence", comparison: "everyday_scene" };
const FUNCTION_ES: Record<VisualRequest["function"], string> = { context: "situar y reconocer lo que nombra el texto", observation: "observar y localizar elementos", vocabulary: "reconocer el vocabulario", process: "comprender un proceso", comparison: "comparar situaciones" };
const cut = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

export function briefOf(r: VisualRequest, plan: Pick<RecreationPlan, "visual_style">, card: string | null): { brief: BriefDraft; adapted: string[] } {
  const adapted: string[] = [];
  const q = (t: string) => {
    const x = qualitative(t);
    if (x.changed) adapted.push(`«${cut(t, 40)}» → «${cut(x.text, 40)}»`);
    return x.text;
  };
  const seen = new Set<string>();
  const elements = [...(card ? [card] : []), ...r.must_show].map((t) => cut(q(t.trim()), 60)).filter((t) => t && !seen.has(normalize(t)) && seen.add(normalize(t)));
  const concepts = r.concepts.map(q).filter(Boolean);
  const brief: BriefDraft = {
    feasible: true,
    kind: card ? "vocabulary_support" : KIND[r.function],
    concept: cut(concepts.join(", ") || elements[0] || "ilustración educativa", 200),
    pedagogical_purpose: cut(q(card ? `${r.purpose} (tarjeta: ${card})` : r.purpose) || r.purpose, 300),
    required_elements: elements.slice(0, 10).map((name) => ({ name, marker: null, label: null })),
    prohibited_elements: [...ALWAYS_PROHIBITED, ...r.prohibited].map((t) => cut(t, 120)).slice(0, 10),
    composition: cut(`${card ? `Solo «${card}», centrado, sobre fondo claro; mismo encuadre y escala que las demás tarjetas.` : FUNCTION_ES[r.function]}. Estilo común: ${plan.visual_style}`, 300),
    detail_level: r.detail,
    conceptual_constraints: [cut(q(r.accessibility) || "contraste alto y partes claramente diferenciadas", 160)],
    alt_text: cut(q(card ? `${card}.` : r.alt_text) || r.alt_text.replace(/\d+/g, "").trim() || "Ilustración educativa", 300),
  };
  return { brief, adapted };
}

// ---------------------------------------------------------------------------------------------------------------------------
// What stays an error for Claude (a pedagogical problem) and what is only a tool's limit (adapted, never an error)
// ---------------------------------------------------------------------------------------------------------------------------

/** Violations of the brief contract that are limits of the image tool: the brief carries no markers or labels and no exact data by construction. */
export const TOOL_LIMIT_VIOLATIONS: ReadonlySet<string> = new Set(["exact_data", "markers_do_not_match_activity", "letter_markers_do_not_match_activity", "markers_not_consecutive", "duplicate_markers", "marker_with_name", "too_many_labels", "duplicate_elements"]);

const MESSAGE: Record<string, string> = {
  answer_leaked: "lo que debe verse contiene la respuesta de una actividad",
  label_gives_answer: "un rótulo da la respuesta",
  markup: "contiene marcas de formato (<, >, llaves, corchetes)",
  incomplete: "falta la función, los conceptos o lo que debe verse",
  no_required_elements: "no indica qué debe verse",
  not_feasible: "no es una ilustración",
};

export interface ToolReport {
  /** Pedagogical or unfulfillable problems: they go back to Claude with the plan (the one repair call that already exists). */
  errors: PlanIssue[];
  /** Adaptations to the tools and demands the system cannot meet yet: recorded, never an error. */
  notes: string[];
}

/** Everything about the resources of a plan that can be decided before a provider is called. */
export function toolReport(plan: RecreationPlan, verification: Verification, needs: readonly DimensionKey[], limits: { maxImages: number }, analysis?: MaterialAnalysis): ToolReport {
  const errors: PlanIssue[] = [];
  const notes: string[] = [];
  const error = (code: string, path: string, message: string) => errors.push({ severity: "error", code, path, message });
  const solutions = (ids: readonly string[]) => verification.activities.filter((v) => ids.includes(v.id)).flatMap((v) => (v.solution.kind === "options" ? v.solution.correct : v.solution.kind === "pairs" ? v.solution.pairs.map((p) => `${p.item} ${p.category}`) : v.solution.kind === "order" ? [v.solution.solution.join(" ")] : v.solution.kind === "number" ? [String(v.solution.value)] : []));
  let essentialImages = 0;
  let images = 0;
  for (const r of plan.visual_requests) {
    const decision = decideResource(r, plan, analysis);
    notes.push(...decision.adapted.map((a) => `${r.id}: ${a}`));
    // A quantity the activity needs the picture to carry is never translated away (ADR-057): no tool draws an exact quantity yet.
    for (const q of necessaryQuantities(r, plan, verification)) {
      error("tool_gap", `visual_requests.${r.id}`, `Limitación de herramienta, no de tu idea: la cantidad «${q.token}» de lo que pides dibujar es necesaria en la actividad ${q.activity} (${q.why}) y ninguna herramienta dibuja una cantidad exacta (${PENDING_CAPABILITIES.counted_group}). Alternativas: escribe la cantidad en el enunciado, usa tarjetas (una por elemento) o un esquema con datos del original.`);
    }
    if (decision.route === "gap") {
      if (r.essential || decision.gap!.capability === "exact_scheme_without_data") error("tool_gap", `visual_requests.${r.id}`, `Limitación de herramienta, no de tu idea: ${decision.gap!.message}`);
      else notes.push(`${r.id}: sin herramienta (${decision.gap!.capability}); se omite`);
      continue;
    }
    const material = plan.materials.find((m) => m.id === r.for_cards);
    const cards = material?.kind === "cut_out_cards" ? material.cards : [null];
    images += cards.length;
    if (r.essential) essentialImages += cards.length;
    const activity = plan.activities.filter((a) => r.activity_ids.includes(a.id)).map((a) => a.prompt).join(" ");
    const lowDetail = r.detail !== "moderate" || needs.some((n) => n === "visual_density" || n === "visual_distraction_reduction" || n === "unnecessary_decoration");
    for (const card of cards) {
      const { brief, adapted } = briefOf(r, plan, card);
      notes.push(...adapted.map((a) => `${r.id}: ${a}`));
      const checked = validateBrief(brief, { activity, expectedAnswer: null, signatures: solutions(r.activity_ids).map(normalizeText).filter(Boolean), lowDetail, ignore: TOOL_LIMIT_VIOLATIONS });
      if (!checked.ok) error("illustration_unsafe", `visual_requests.${r.id}`, `Problema de la idea, no de la herramienta: ${checked.violations.map((v) => MESSAGE[v] ?? v).join("; ")}.`);
    }
  }
  // The budget: what is ESSENTIAL must fit; the rest is cut at run time (cards beyond the cap keep their printed name).
  if (essentialImages > limits.maxImages) error("too_many_illustrations", "visual_requests", `Las ilustraciones imprescindibles (${essentialImages}) superan el máximo del presupuesto (${limits.maxImages}): comparte una imagen entre varias actividades.`);
  else if (images > limits.maxImages) notes.push(`visual_requests: ${images} ilustraciones pedidas; las que superen ${limits.maxImages} no se generan`);
  for (const c of plan.custom_resources ?? []) {
    // No generic maker exists: said, never invented.
    if (c.essential) error("tool_gap", `custom_resources.${c.id}`, `Limitación de herramienta, no de tu idea: «${c.title}» es un recurso fuera del catálogo (${PENDING_CAPABILITIES.custom_resource}). Resuélvelo con una ilustración, un esquema con datos del original, tarjetas o un tablero.`);
    else notes.push(`${c.id}: recurso «${c.title}» sin herramienta (demanda registrada); no se genera`);
  }
  return { errors, notes };
}
