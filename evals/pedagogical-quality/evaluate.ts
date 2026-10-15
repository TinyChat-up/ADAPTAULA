import { answerSignatures, averageSentenceLength, hasToken, leakedSignature, normalizeText, numbersIn, wordCount } from "@/lib/adaptation/text";
import { CRITERIA, type AdaptedActivity, type AdaptedSheet, type Criterion, type Evaluation, type Finding, type ReferenceSheet, type Status } from "./contract";

/**
 * Deterministic pedagogical checks of an adaptation against its reference (Phase III, experimental). They reuse the production
 * text helpers (`src/lib/adaptation/text.ts`) and decide only what can be decided mechanically. Every criterion that needs a
 * teacher's judgement ends at NEEDS_TEACHER_REVIEW at best: no adaptation is ever "approved" here.
 */

const RANK: Record<Status, number> = { NOT_APPLICABLE: 0, PASS: 1, NEEDS_TEACHER_REVIEW: 2, FAIL: 3 };
const worst = (a: Status, b: Status): Status => (RANK[a] >= RANK[b] ? a : b);
const norm = (s: string) => normalizeText(s);
const includesPhrase = (text: string, phrase: string) => norm(text).includes(norm(phrase));
const escape = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Whole-word presence ("m" must not match inside "mide"). */
const hasWord = (text: string, word: string) => new RegExp(`(^|[^a-z0-9])${escape(norm(word))}([^a-z0-9]|$)`).test(norm(text));
const factValue = (v: unknown) => (typeof v === "string" ? v.trim() : v);
/** Explicit operations written in the text ("6 × 24", "3450 − 1875"): the plan the student had to build. */
const OPERATION_WRITTEN = /\d+(?:[.,]\d+)?\s*[×x*+−\-:÷]\s*\d+/;

/** Everything the student sees for one adapted activity, with and without its supports. */
const statement = (a: AdaptedActivity) => `${a.instruction}\n${a.content}`;
const withSupports = (a: AdaptedActivity) => `${statement(a)}\n${a.supports.map((s) => s.text).join("\n")}`;

function materialNumbers(ref: ReferenceSheet, extra: readonly string[]): Set<string> {
  const texts = [
    ...ref.activities.flatMap((a) => [a.number, a.instruction, ...a.data.numbers, ...a.data.sequence, ...a.data.options, ...a.data.names]),
    ...ref.figures.flatMap((f) => Object.values(f.facts).map(String)),
    ...ref.sourceTexts.flatMap((t) => t.keyFacts),
  ];
  return new Set<string>([...extra, ...ref.admissibleNumbers, ...texts.flatMap(numbersIn)]);
}

export function evaluate(ref: ReferenceSheet, sheet: AdaptedSheet, options: { allowedExtraNumbers?: readonly string[] } = {}): Evaluation {
  const findings: Finding[] = [];
  const add = (criterion: Criterion, check: string, status: Status, activityId: string | null, detail: string) => findings.push({ criterion, check, status, activityId, detail });
  const covering = (id: string) => sheet.activities.filter((a) => a.sourceIds.includes(id));
  const studentText = [...sheet.sourceTexts.map((t) => t.text), ...sheet.activities.map(withSupports), ...sheet.figures.map((f) => Object.entries(f.facts).map(([k, v]) => `${k} ${v}`).join(" "))].join("\n");

  // ── B · Integridad de la actividad ────────────────────────────────────────────────────────────────────────────────
  for (const a of ref.activities) {
    const c = covering(a.id);
    if (c.length === 0) add("B_integridad_actividad", "actividad_omitida", a.required ? "FAIL" : "NEEDS_TEACHER_REVIEW", a.id, `falta la actividad ${a.number}`);
    else if (c.length > 1) add("B_integridad_actividad", "actividad_duplicada", "FAIL", a.id, `la actividad ${a.number} aparece ${c.length} veces`);
    else add("B_integridad_actividad", "actividad_presente", "PASS", a.id, "presente una vez");
  }
  for (const a of sheet.activities) {
    if (a.sourceIds.length > 1) add("B_integridad_actividad", "consignas_mezcladas", "FAIL", a.sourceIds.join("+"), `una actividad adaptada mezcla ${a.sourceIds.join(", ")}`);
    const unknown = a.sourceIds.filter((id) => !ref.activities.some((r) => r.id === id));
    if (unknown.length) add("B_integridad_actividad", "actividad_inventada", "FAIL", unknown.join(","), "actividad sin correspondencia en el original");
  }
  const order = sheet.activities.flatMap((a) => a.sourceIds).filter((id, i, all) => all.indexOf(id) === i);
  const refOrder = ref.activities.map((a) => a.id).filter((id) => order.includes(id));
  if (order.join() !== refOrder.join()) add("B_integridad_actividad", "orden_actividades", "NEEDS_TEACHER_REVIEW", null, "el orden de las actividades cambia: puede ser admisible, decide el docente");
  for (const f of ref.figures) {
    const got = sheet.figures.find((g) => g.id === f.id);
    if (got && [...got.activityIds].sort().join() !== [...f.activityIds].sort().join())
      add("B_integridad_actividad", "figura_en_otra_actividad", "FAIL", f.activityIds.join(","), `${f.id} se asocia a ${got.activityIds.join(", ")} en lugar de ${f.activityIds.join(", ")}`);
  }

  // ── A · Conservación de datos ─────────────────────────────────────────────────────────────────────────────────────
  for (const a of ref.activities) {
    const c = covering(a.id)[0];
    if (!c) continue;
    const text = statement(c);
    const missingNumbers = a.data.numbers.filter((n) => !numbersIn(n).every((m) => hasToken(text, { kind: "number", value: m })));
    const missingUnits = a.data.units.filter((u) => !hasWord(text, u));
    const missingNames = a.data.names.filter((n) => !hasWord(text, n));
    const missingRelations = a.data.relations.filter((group) => !group.some((w) => hasWord(text, w)));
    const missingOptions = a.data.options.filter((o) => !hasWord(text, o));
    const check = (name: string, missing: string[], label: string) =>
      add("A_conservacion_datos", name, missing.length ? "FAIL" : "PASS", a.id, missing.length ? `${label} que faltan o cambian: ${missing.map((m) => (Array.isArray(m) ? m.join("/") : m)).join(", ")}` : `${label} conservados`);
    if (a.data.numbers.length) check("numeros", missingNumbers, "números");
    if (a.data.units.length) check("unidades", missingUnits, "unidades");
    if (a.data.names.length) check("nombres", missingNames, "nombres");
    if (a.data.relations.length) check("relaciones", missingRelations.map((g) => g.join("/")), "relaciones");
    if (a.data.options.length) check("opciones", missingOptions, "opciones");
    if (a.data.sequence.length) {
      const positions = a.data.sequence.map((s) => norm(text).indexOf(norm(s)));
      const ok = positions.every((p) => p >= 0) && positions.every((p, i) => i === 0 || p > positions[i - 1]!);
      add("A_conservacion_datos", "secuencia", ok ? "PASS" : "FAIL", a.id, ok ? "elementos y orden impreso conservados" : "faltan elementos o cambia su orden impreso");
    }
  }
  const known = materialNumbers(ref, options.allowedExtraNumbers ?? []);
  const fresh = [...new Set(numbersIn(studentText))].filter((n) => !known.has(n));
  add("A_conservacion_datos", "cantidades_nuevas", fresh.length ? "FAIL" : "PASS", null, fresh.length ? `cantidades que no están en el original: ${fresh.join(", ")}` : "ninguna cantidad nueva");
  for (const f of ref.figures) {
    const got = sheet.figures.find((g) => g.id === f.id);
    if (!got) { add("A_conservacion_datos", "figura", "FAIL", f.activityIds.join(","), `falta la figura ${f.id}`); continue; }
    if (got.kind !== f.kind) { add("A_conservacion_datos", "figura", "FAIL", f.activityIds.join(","), `${f.id}: ${f.kind} sustituida por ${got.kind}`); continue; }
    const changed = Object.entries(f.facts).filter(([k, v]) => !f.unresolved.includes(k) && factValue(got.facts[k]) !== factValue(v)).map(([k]) => k);
    add("A_conservacion_datos", "figura", changed.length ? "FAIL" : "PASS", f.activityIds.join(","), changed.length ? `${f.id}: cambian ${changed.join(", ")}` : `${f.id} conservada`);
  }
  for (const t of ref.sourceTexts) {
    const got = sheet.sourceTexts.find((s) => s.id === t.id);
    const missing = got ? t.keyFacts.filter((k) => !includesPhrase(got.text, k)) : t.keyFacts;
    add("A_conservacion_datos", "texto_fuente", missing.length ? "FAIL" : "PASS", null, missing.length ? `${t.id}: faltan hechos clave (${missing.length}/${t.keyFacts.length})` : `${t.id}: hechos clave conservados`);
  }

  // ── C · Seguridad de respuestas ───────────────────────────────────────────────────────────────────────────────────
  // A short phrase already printed in the original (an option, a place named in another question) is data, not a leak.
  const printed = norm([...ref.activities.map((a) => a.instruction), ...ref.sourceTexts.flatMap((t) => t.keyFacts)].join("\n"));
  for (const ans of ref.answers) {
    const signatures = answerSignatures(ans.value, known).filter((sig) => /\d/.test(sig) || !printed.includes(sig));
    const patterns = ans.leakPatterns.map((p) => new RegExp(p, "i"));
    const where: string[] = [];
    for (const a of sheet.activities) {
      const support = a.supports.map((s) => s.text).join("\n");
      if (leakedSignature(statement(a), signatures) || patterns.some((p) => p.test(norm(statement(a))))) where.push(`enunciado ${a.number}`);
      if (leakedSignature(support, signatures) || patterns.some((p) => p.test(norm(support)))) where.push(`apoyo ${a.number}`);
    }
    if (where.length) add("C_seguridad_respuestas", "respuesta_revelada", "FAIL", ans.activityId, `respuesta visible en: ${where.join(", ")}`);
    else if (!signatures.length && !patterns.length) add("C_seguridad_respuestas", "respuesta_revelada", "NEEDS_TEACHER_REVIEW", ans.activityId, "respuesta abierta: no se puede excluir mecánicamente");
    else add("C_seguridad_respuestas", "respuesta_revelada", "PASS", ans.activityId, "ninguna huella de la respuesta");
  }
  for (const f of ref.figures) {
    const got = sheet.figures.find((g) => g.id === f.id);
    if (!got || !f.unresolved.length) continue;
    const solved = f.unresolved.filter((k) => { const v = got.facts[k]; return v !== undefined && v !== "" && v !== 0 && v !== false && v !== f.facts[k]; });
    add("C_seguridad_respuestas", "figura_resuelta", solved.length ? "FAIL" : "PASS", f.activityIds.join(","), solved.length ? `${f.id}: la figura ya trae resuelto ${solved.join(", ")}` : `${f.id}: sin resolver, como en el original`);
  }
  for (const a of sheet.activities) {
    const orig = a.sourceIds.map((id) => ref.activities.find((r) => r.id === id)?.instruction ?? "").join(" ");
    if (OPERATION_WRITTEN.test(withSupports(a)) && !OPERATION_WRITTEN.test(orig))
      add("C_seguridad_respuestas", "operacion_dada", "FAIL", a.sourceIds.join(","), "el enunciado o un apoyo ya plantea la operación");
  }

  // ── D · Accesibilidad (proxies deterministas; la claridad real la juzga el docente) ───────────────────────────────
  const barrierIds = new Set(ref.barriers.map((b) => b.id));
  const addressed = new Set<string>();
  for (const a of sheet.activities) {
    const id = a.sourceIds.join(",");
    const orig = ref.activities.find((r) => r.id === a.sourceIds[0]);
    for (const s of a.supports) {
      const unknown = s.addresses.filter((b) => !barrierIds.has(b));
      s.addresses.forEach((b) => addressed.add(b));
      if (!s.addresses.length || unknown.length) add("D_accesibilidad", "apoyo_coherente", "NEEDS_TEACHER_REVIEW", id, `apoyo «${s.kind}» sin barrera declarada del original`);
    }
    if (orig) {
      const longer = averageSentenceLength(a.instruction) > Math.max(averageSentenceLength(orig.instruction), 14);
      add("D_accesibilidad", "consigna_comprensible", longer ? "NEEDS_TEACHER_REVIEW" : "PASS", id, longer ? "frases de la consigna más largas que en el original" : "frases de la consigna no más largas");
      const supportWords = a.supports.reduce((n, s) => n + wordCount(s.text), 0);
      const overload = a.supports.length > 3 || supportWords > 2 * wordCount(orig.instruction) + 40;
      add("D_accesibilidad", "sin_sobrecarga", overload ? "NEEDS_TEACHER_REVIEW" : "PASS", id, overload ? `posible sobrecarga: ${a.supports.length} apoyos, ${supportWords} palabras` : "apoyos acotados");
    }
  }
  const uncovered = [...barrierIds].filter((b) => !addressed.has(b));
  add("D_accesibilidad", "barreras_atendidas", uncovered.length ? "NEEDS_TEACHER_REVIEW" : "PASS", null, uncovered.length ? `barreras sin apoyo: ${uncovered.join(", ")}` : "cada barrera declarada tiene algún apoyo");
  add("D_accesibilidad", "organizacion_visual", "NEEDS_TEACHER_REVIEW", null, "la claridad visual de la ficha la juzga el docente al verla");

  // ── E · Fidelidad pedagógica ──────────────────────────────────────────────────────────────────────────────────────
  for (const a of ref.activities) {
    const c = covering(a.id)[0];
    if (!c) continue;
    const lost = a.operations.filter((o) => !c.operations.includes(o));
    const cueLost = a.operationCues.length > 0 && !a.operationCues.some((cue) => includesPhrase(statement(c), cue));
    if (lost.length || cueLost) add("E_fidelidad_pedagogica", "operacion_cognitiva", "FAIL", a.id, lost.length ? `desaparece la operación: ${lost.join(", ")}` : "la consigna ya no pide lo que pedía (explicar, justificar, ordenar…)");
    else add("E_fidelidad_pedagogica", "operacion_cognitiva", "PASS", a.id, "se mantiene la operación declarada y su marca en la consigna");
  }
  add("E_fidelidad_pedagogica", "aprendizaje_preservado", "NEEDS_TEACHER_REVIEW", null, "si la adaptación conserva el aprendizaje que se evalúa lo decide el docente");

  const byCriterion = Object.fromEntries(CRITERIA.map((c) => [c, findings.filter((f) => f.criterion === c).reduce<Status>((s, f) => worst(s, f.status), "NOT_APPLICABLE")])) as Record<Criterion, Status>;
  return { referenceId: ref.id, verdict: findings.some((f) => f.status === "FAIL") ? "FAIL" : "NEEDS_TEACHER_REVIEW", byCriterion, findings };
}
