import type { SupportKind } from "@/lib/schemas/adaptation-plan";
import type { DimensionKey } from "@/lib/schemas/functional-profile";
import type { SupportClass, SupportHow } from "@/lib/schemas/reviewer-findings";
import type { SemanticStatus } from "@/lib/adaptation/support-semantic";

/**
 * Etapa 2.3 · corpus of real supports for the semantic review. EVERY LABEL IS PROVISIONAL: they are the engineering team's first reading
 * (AI-assisted) and are NOT ground truth. Each entry waits for a person with pedagogical and PT criterion (`review.status`), who writes the
 * final label; the measurement (`score.ts`) uses `review.final_label` when there is one and says so when it does not. The sheets are the
 * team's own pilot sheets (célula, estanque, fracciones, números primos, seres vivos) and variants of their supports: no learner data.
 *
 * Distinguishes six classes:
 *   legitimate_access     gives access to the task (secondary vocabulary, observation questions, a reminder of the method)
 *   criterion_card        recalls the criterion the student must APPLY to concrete items
 *   method_example        a worked example with other data or another domain that teaches a procedure
 *   over_hint             facilitates the answer more than access requires without performing it (an analogy that lets an item be deduced)
 *   performs_competence   carries out what the activity evaluates (states the concept to explain, resolves or assigns an item, gives a result)
 *   ambiguous             a person's criterion is needed: reasonable readings differ
 */

export type CorpusLabel = "legitimate_access" | "criterion_card" | "method_example" | "over_hint" | "performs_competence" | "ambiguous";
export const CORPUS_LABELS: readonly CorpusLabel[] = ["legitimate_access", "criterion_card", "method_example", "over_hint", "performs_competence", "ambiguous"];

export interface CorpusSheet {
  type: string;
  instruction: string;
  answer?: string;
  /** The activity's protected concept/operation (what it evaluates). */
  evaluates: string[];
  objective: string;
  context?: string;
  table?: { headers: string[]; rows: string[][] };
  reading?: string;
  /** In plain words: the competence the activity evaluates. */
  competence: string;
}

export interface CorpusEntry {
  id: string;
  sheet: keyof typeof SHEETS;
  /** `pilot_sheet`: the support the pilot's generator really wrote (or its exact leak); `variant`: built by the team to cover a class. */
  source: "pilot_sheet" | "variant";
  kind: SupportKind;
  block: Record<string, unknown>;
  /** The functional need the support serves, and why this support is a reasonable answer to it. */
  need: { dimension: DimensionKey; note: string };
  provisional: { label: CorpusLabel; rationale: string; by: "ai_assisted" };
  /** What a competent semantic reviewer is expected to answer, and what the server policy then makes of it. */
  expected: { judgment: { class: SupportClass; how?: SupportHow; cites_protected?: boolean }; status: SemanticStatus };
  review: CorpusReview;
}

/**
 * WHO wrote a label matters as much as the label. `human`: a person's own judgment. `human_ai_assisted`: a person who used an AI assistant to
 * think it through: it is ONE reviewer, never two. `ai`: a label proposed by an AI (including the provisional one): it is never a human label and
 * never counts as a review. Independence is counted only over distinct `human` reviewers.
 */
export type LabelSource = "human" | "human_ai_assisted" | "ai";
export interface ReviewLabel {
  source: LabelSource;
  /** An opaque name or initials of the person; for `ai`, the assistant used. */
  reviewer: string;
  label: CorpusLabel;
  /** Would this reviewer accept the support being withdrawn or regenerated automatically? */
  accept_removal: "yes" | "no" | "depends";
  comment?: string;
}
export interface CorpusReview {
  status: "pending_human_review" | "reviewed";
  /** Every label received, with its source. The provisional one of the team is NOT in this list. */
  labels: ReviewLabel[];
  /** The decision of the person who owns it; absent until there is one. It is the reference of the measurement. */
  final_label: CorpusLabel | null;
  final_by: LabelSource | null;
}

export const SHEETS = {
  celula: {
    type: "short_answer",
    instruction: "Escribe la estructura celular que corresponde a cada pista.",
    answer: "a) Núcleo; b) Membrana plasmática; c) Citoplasma; d) Mitocondria",
    evaluates: ["Identificar la estructura celular a partir de su función"],
    objective: "Identificar estructuras celulares a partir de su función",
    table: { headers: ["Pista", "Estructura"], rows: [["a) Contiene el ADN.", ""], ["b) Regula el paso de sustancias entre la célula y el exterior.", ""], ["c) Es el medio interno donde se encuentran los orgánulos.", ""], ["d) Participa en la obtención de energía a partir de nutrientes.", ""]] },
    reading: "Todas las células tienen una membrana plasmática y citoplasma. En las células animales y vegetales, el núcleo contiene el ADN.",
    competence: "Deducir la estructura celular a partir de la descripción de su función",
  },
  estanque_flechas: {
    type: "short_answer",
    instruction: "Explica qué indican las flechas del esquema.",
    evaluates: ["Significado de las flechas como relación alimentaria"],
    objective: "Interpretar una cadena alimentaria y predecir efectos de cambios en ella",
    competence: "Interpretar el esquema: qué relación expresan las flechas",
  },
  estanque_clasificar: {
    type: "classification",
    instruction: "Clasifica estos componentes del estanque.",
    answer: "Seres vivos: algas, larvas de insectos, garzas. No vivos: agua, luz solar, temperatura.",
    evaluates: ["Clasificar los seis componentes en seres vivos y elementos no vivos"],
    objective: "Clasificar componentes como seres vivos o elementos no vivos",
    context: "Algas · Agua · Larvas de insectos · Luz solar · Garzas · Temperatura",
    table: { headers: ["SERES VIVOS", "ELEMENTOS NO VIVOS"], rows: [["", ""]] },
    competence: "Aplicar el criterio de ser vivo a cada componente",
  },
  fracciones: {
    type: "short_answer",
    instruction: "Compara las fracciones. Escribe >, < o = en cada recuadro.",
    answer: "2/3 > 3/5; 4/8 = 1/2",
    evaluates: ["Fracciones equivalentes (1/2 = 4/8)"],
    objective: "Comparar fracciones con distinto denominador usando >, < o =",
    context: "2/3 [ ] 3/5   4/8 [ ] 1/2",
    competence: "Comparar fracciones con distinto denominador (y reconocer equivalentes)",
  },
  restar_fracciones: {
    type: "problem_solving",
    instruction: "¿Cuánta agua quedó? Escribe la operación y la respuesta con unidad.",
    answer: "3/4 - 1/4 = 2/4 (=1/2) de litro",
    evaluates: ["Restar fracciones de igual denominador (3/4 - 1/4)"],
    objective: "Resolver problemas de resta de fracciones",
    context: "Había 3/4 de litro y se gastó 1/4 de litro.",
    competence: "Restar fracciones de igual denominador",
  },
  primos: {
    type: "classification",
    instruction: "Rodea los números que sean primos: 131, 243, 218, 143.",
    answer: "131",
    evaluates: ["Reconocer números primos"],
    objective: "Reconocer números primos y descomponer números en factores primos",
    competence: "Aplicar el criterio de número primo a cada número",
  },
} satisfies Record<string, CorpusSheet>;

const vocab = (...items: Array<[string, string]>) => ({ type: "vocabulary", items: items.map(([term, definition]) => ({ term, definition })) });
const example = (problem: string, result: string, steps: string[]) => ({ type: "worked_example", problem, result, steps });
const help = (variant: "key_idea" | "reminder", text: string) => ({ type: "help_box", variant, text });
const list = (...items: string[]) => ({ type: "list", style: "bullet", items });

const pending = { status: "pending_human_review", labels: [], final_label: null, final_by: null } as const;
const e = (entry: Omit<CorpusEntry, "review" | "provisional"> & { label: CorpusLabel; why: string }): CorpusEntry => {
  const { label, why, ...rest } = entry;
  return { ...rest, provisional: { label, rationale: why, by: "ai_assisted" }, review: { ...pending, labels: [] } };
};

export const CORPUS: readonly CorpusEntry[] = [
  // ── Estanque · 3a «Explica qué indican las flechas del esquema» ───────────────────────────────────────────────────
  e({ id: "est-01", sheet: "estanque_flechas", source: "pilot_sheet", kind: "glossary", block: vocab(["flecha", "Indica quién es el alimento de quién: la flecha va del alimento al que se lo come."]), need: { dimension: "vocabulary_support", note: "vocabulario del esquema" }, label: "performs_competence", why: "Define lo que la actividad pide explicar: el alumno copiaría el significado de las flechas.", expected: { judgment: { class: "performs", how: "states_concept", cites_protected: true }, status: "confirmed" } }),
  e({ id: "est-02", sheet: "estanque_flechas", source: "variant", kind: "glossary", block: vocab(["recuadro", "Cuadro que encierra una palabra."], ["esquema", "Dibujo sencillo que muestra cómo se relacionan unas cosas con otras."]), need: { dimension: "vocabulary_support", note: "palabras de la consigna" }, label: "legitimate_access", why: "Vocabulario secundario de la consigna; no explica lo evaluado.", expected: { judgment: { class: "legitimate" }, status: "legitimate" } }),
  e({ id: "est-03", sheet: "estanque_flechas", source: "variant", kind: "key_idea", block: help("key_idea", "Las flechas indican quién es alimento de quién."), need: { dimension: "background_knowledge_support", note: "activar lo que ya sabe" }, label: "performs_competence", why: "Enuncia el significado de las flechas con otras palabras: es la respuesta.", expected: { judgment: { class: "performs", how: "states_concept", cites_protected: true }, status: "confirmed" } }),
  e({ id: "est-04", sheet: "estanque_flechas", source: "variant", kind: "guiding_questions", block: list("¿Qué seres vivos aparecen en el esquema?", "¿Qué hay dibujado entre cada dos recuadros?"), need: { dimension: "background_knowledge_support", note: "preguntas de observación" }, label: "legitimate_access", why: "Orienta la mirada sin nombrar ni explicar lo que significan las flechas.", expected: { judgment: { class: "legitimate" }, status: "legitimate" } }),
  e({ id: "est-05", sheet: "estanque_flechas", source: "variant", kind: "reminder", block: help("reminder", "Mira el esquema de izquierda a derecha y lee cada recuadro."), need: { dimension: "working_memory_support", note: "recordar cómo leer el esquema" }, label: "legitimate_access", why: "Recuerda el método de lectura, no el contenido.", expected: { judgment: { class: "legitimate" }, status: "legitimate" } }),
  e({ id: "est-06", sheet: "estanque_flechas", source: "variant", kind: "guiding_questions", block: list("¿Quién se alimenta de las algas?", "¿Y de las larvas?"), need: { dimension: "background_knowledge_support", note: "activar lo que ya sabe" }, label: "ambiguous", why: "Orienta hacia la relación alimentaria casi nombrándola: según el docente, acceso o pista excesiva.", expected: { judgment: { class: "hints", how: "other" }, status: "suspected" } }),
  // ── Estanque · «Clasifica estos componentes» ──────────────────────────────────────────────────────────────────────
  e({ id: "est-07", sheet: "estanque_clasificar", source: "pilot_sheet", kind: "glossary", block: vocab(["Ser vivo", "Ser que nace, crece, se alimenta y puede reproducirse."], ["Elemento no vivo", "Parte del ecosistema que no tiene vida."]), need: { dimension: "vocabulary_support", note: "vocabulario de las categorías" }, label: "criterion_card", why: "Recuerda el criterio para clasificar; el alumno sigue clasificando cada componente.", expected: { judgment: { class: "legitimate" }, status: "legitimate" } }),
  e({ id: "est-08", sheet: "estanque_clasificar", source: "variant", kind: "glossary", block: vocab(["Seres vivos", "Las algas y las garzas."], ["Elementos no vivos", "El agua."]), need: { dimension: "vocabulary_support", note: "vocabulario de las categorías" }, label: "performs_competence", why: "Asigna componentes de la hoja a su categoría: la clasificación hecha.", expected: { judgment: { class: "performs", how: "assigns_item", cites_protected: true }, status: "confirmed" } }),
  e({ id: "est-09", sheet: "estanque_clasificar", source: "pilot_sheet", kind: "worked_example", block: example("Clasifica: Pez", "Pez → ser vivo.", ["Me pregunto: ¿nace, crece y se alimenta?", "Sí: es un ser vivo."]), need: { dimension: "working_memory_support", note: "ver el método aplicado" }, label: "method_example", why: "Aplica el criterio a un elemento que no está en la hoja.", expected: { judgment: { class: "legitimate" }, status: "legitimate" } }),
  // ── Célula · «Escribe la estructura celular que corresponde a cada pista» ─────────────────────────────────────────
  e({ id: "cel-01", sheet: "celula", source: "pilot_sheet", kind: "worked_example", block: example("Pista: «Contiene la información que dirige la actividad de la célula». ¿Qué estructura es?", "Núcleo.", ["Lee la pista y localiza la función que describe."]), need: { dimension: "working_memory_support", note: "ver el método aplicado" }, label: "performs_competence", why: "El ejemplo resuelve el apartado a): el resultado es la respuesta de un ítem.", expected: { judgment: { class: "performs", how: "resolves_item", cites_protected: true }, status: "confirmed" } }),
  e({ id: "cel-02", sheet: "celula", source: "pilot_sheet", kind: "worked_example", block: example("Pista: «Bombea la sangre por todo el cuerpo». ¿Qué órgano corresponde?", "El corazón.", ["Leo la pista y subrayo la función."]), need: { dimension: "working_memory_support", note: "ver el método aplicado" }, label: "method_example", why: "Otro ámbito (un órgano) con el mismo método; no resuelve ningún ítem.", expected: { judgment: { class: "legitimate" }, status: "legitimate" } }),
  e({ id: "cel-03", sheet: "celula", source: "pilot_sheet", kind: "worked_example", block: example("Pista: «Es la parte de una casa que protege y separa el interior del exterior». Escribe qué parte de la casa es.", "Respuesta del ejemplo: la pared.", ["Lee la pista y subraya la palabra clave: protege y separa."]), need: { dimension: "working_memory_support", note: "ver el método aplicado" }, label: "over_hint", why: "La analogía de la casa («protege y separa el interior del exterior») permite deducir la función de la membrana del ítem b).", expected: { judgment: { class: "hints", how: "analogy_of_item" }, status: "suspected" } }),
  e({ id: "cel-04", sheet: "celula", source: "variant", kind: "reminder", block: help("reminder", "Lee cada pista entera y busca en el texto la función que describe."), need: { dimension: "working_memory_support", note: "recordar el procedimiento" }, label: "legitimate_access", why: "Recuerda cómo trabajar; no nombra ninguna estructura.", expected: { judgment: { class: "legitimate" }, status: "legitimate" } }),
  e({ id: "cel-05", sheet: "celula", source: "variant", kind: "glossary", block: vocab(["función", "Lo que hace una parte para que la célula viva."], ["orgánulo", "Parte pequeña de la célula con un trabajo propio."]), need: { dimension: "vocabulary_support", note: "palabras de la consigna y del texto" }, label: "legitimate_access", why: "Vocabulario secundario; no nombra ninguna estructura pedida.", expected: { judgment: { class: "legitimate" }, status: "legitimate" } }),
  e({ id: "cel-06", sheet: "celula", source: "variant", kind: "reminder", block: help("reminder", "Recuerda: la membrana plasmática rodea la célula."), need: { dimension: "working_memory_support", note: "recordar lo leído" }, label: "performs_competence", why: "Nombra la estructura del ítem b): entrega parte de la respuesta.", expected: { judgment: { class: "performs", how: "gives_result", cites_protected: true }, status: "confirmed" } }),
  e({ id: "cel-07", sheet: "celula", source: "variant", kind: "key_idea", block: help("key_idea", "Cada estructura de la célula tiene una función distinta que puedes reconocer en la pista."), need: { dimension: "background_knowledge_support", note: "activar lo que ya sabe" }, label: "legitimate_access", why: "Orienta el razonamiento sin decir qué estructura es cada una.", expected: { judgment: { class: "legitimate" }, status: "legitimate" } }),
  // ── Fracciones · «Compara las fracciones» ─────────────────────────────────────────────────────────────────────────
  e({ id: "fra-01", sheet: "fracciones", source: "pilot_sheet", kind: "worked_example", block: example("Compara 1/3 [ ] 2/5 y 2/4 [ ] 1/2. Escribe >, < o =.", "1/3 < 2/5 y 2/4 = 1/2", ["Mira cuántas partes tiene cada fracción."]), need: { dimension: "working_memory_support", note: "ver el método aplicado" }, label: "performs_competence", why: "Demuestra la misma equivalencia (…= 1/2) que el ítem 4/8 [ ] 1/2: casi la misma operación.", expected: { judgment: { class: "performs", how: "performs_operation", cites_protected: true }, status: "confirmed" } }),
  e({ id: "fra-02", sheet: "fracciones", source: "variant", kind: "worked_example", block: example("Compara 3/4 [ ] 5/8. Escribe >, < o =.", "3/4 > 5/8", ["Paso 3/4 a octavos: 3/4 = 6/8.", "Comparo 6/8 y 5/8: 6 es mayor que 5."]), need: { dimension: "working_memory_support", note: "ver el método aplicado" }, label: "method_example", why: "Otros números y otras fracciones; enseña el procedimiento del denominador común sin resolver ningún ítem.", expected: { judgment: { class: "legitimate" }, status: "legitimate" } }),
  e({ id: "fra-03", sheet: "fracciones", source: "variant", kind: "reminder", block: help("reminder", "Para comparar fracciones, busca primero un denominador común."), need: { dimension: "working_memory_support", note: "recordar el procedimiento" }, label: "legitimate_access", why: "Recuerda el método.", expected: { judgment: { class: "legitimate" }, status: "legitimate" } }),
  e({ id: "fra-04", sheet: "fracciones", source: "variant", kind: "key_idea", block: help("key_idea", "Dos fracciones son equivalentes si representan la misma cantidad, como 1/2 y 4/8."), need: { dimension: "background_knowledge_support", note: "activar lo que ya sabe" }, label: "ambiguous", why: "Usa exactamente la equivalencia del ítem 4/8 [ ] 1/2 como ejemplo del concepto: ¿criterio o respuesta?", expected: { judgment: { class: "performs", how: "resolves_item", cites_protected: true }, status: "confirmed" } }),
  e({ id: "fra-05", sheet: "restar_fracciones", source: "pilot_sheet", kind: "worked_example", block: example("En una botella había 5/6 de litro de zumo. Se bebieron 2/6 de litro. ¿Cuánto zumo quedó?", "Quedaron 3/6 de litro de zumo.", ["Resto los numeradores y dejo el mismo denominador.", "5/6 - 2/6 = 3/6"]), need: { dimension: "working_memory_support", note: "ver el método aplicado" }, label: "method_example", why: "Otro problema de restar fracciones con otros datos: el procedimiento sin el resultado del ítem.", expected: { judgment: { class: "legitimate" }, status: "legitimate" } }),
  e({ id: "fra-06", sheet: "restar_fracciones", source: "variant", kind: "worked_example", block: example("Había 3/4 de litro y se gastó 1/4 de litro. ¿Cuánto agua quedó?", "Quedó 2/4 de litro.", ["Resto 3/4 - 1/4 = 2/4."]), need: { dimension: "working_memory_support", note: "ver el método aplicado" }, label: "performs_competence", why: "Resuelve el propio problema de la actividad.", expected: { judgment: { class: "performs", how: "resolves_item", cites_protected: true }, status: "confirmed" } }),
  // ── Números primos · «Rodea los números que sean primos» ──────────────────────────────────────────────────────────
  e({ id: "pri-01", sheet: "primos", source: "pilot_sheet", kind: "reminder", block: help("reminder", "Un número primo solo es divisible entre 1 y entre sí mismo."), need: { dimension: "working_memory_support", note: "recordar el criterio" }, label: "criterion_card", why: "Recuerda el criterio; el alumno decide si cada número lo cumple.", expected: { judgment: { class: "legitimate" }, status: "legitimate" } }),
  e({ id: "pri-02", sheet: "primos", source: "variant", kind: "worked_example", block: example("¿Es primo el 7?", "Sí, 7 es primo.", ["Pruebo a dividir: solo se divide entre 1 y entre 7."]), need: { dimension: "working_memory_support", note: "ver el método aplicado" }, label: "method_example", why: "Aplica el criterio a un número que no está en la hoja.", expected: { judgment: { class: "legitimate" }, status: "legitimate" } }),
  e({ id: "pri-03", sheet: "primos", source: "variant", kind: "guiding_questions", block: list("131 es primo.", "243 no es primo porque se divide entre 3."), need: { dimension: "background_knowledge_support", note: "activar lo que ya sabe" }, label: "performs_competence", why: "Clasifica los números de la hoja: la respuesta hecha.", expected: { judgment: { class: "performs", how: "assigns_item", cites_protected: true }, status: "confirmed" } }),
  e({ id: "pri-04", sheet: "primos", source: "variant", kind: "key_idea", block: help("key_idea", "Para saber si un número es primo, prueba a dividirlo entre 2, 3, 5 y 7."), need: { dimension: "working_memory_support", note: "recordar el procedimiento" }, label: "criterion_card", why: "Da un método de comprobación; no clasifica ningún número.", expected: { judgment: { class: "legitimate" }, status: "legitimate" } }),
  e({ id: "pri-05", sheet: "primos", source: "variant", kind: "key_idea", block: help("key_idea", "Los números pares mayores que 2 no son primos."), need: { dimension: "background_knowledge_support", note: "activar lo que ya sabe" }, label: "ambiguous", why: "Es un criterio general, pero descarta por sí solo uno de los números de la hoja (218).", expected: { judgment: { class: "hints", how: "other" }, status: "suspected" } }),
];

export const corpusById = (id: string) => CORPUS.find((c) => c.id === id)!;
