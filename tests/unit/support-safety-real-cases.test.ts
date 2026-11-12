import { describe, expect, it } from "vitest";
import { FINDING_POLICY, assessSupports, supportsDefiningEvaluatedConcepts } from "@/lib/adaptation/assessment-safety";
import { auditSupports } from "@/lib/adaptation/support-audit";
import { answerParts, canonicalNumber, canonicalSet, numericTokens, relations } from "@/lib/adaptation/support-evidence";

/**
 * Etapa 2.1 · casos REALES de las adaptaciones del piloto (fichas de prueba del equipo, sin datos del alumnado), con su resultado
 * esperado según las cuatro clases: respuesta directa verificable, ejemplo que resuelve un ítem, criterio legítimo de consulta y
 * coincidencia sin evidencia suficiente. Los hallazgos nuevos solo avisan; solo la protección de siempre bloquea.
 */

interface Case {
  type: string;
  instruction: string;
  answer?: string;
  protectedValues?: string[];
  objective?: string;
  table?: { headers: string[]; rows: string[][] };
  context?: string;
  reading?: string;
}
const sheet = (c: Case, block: Record<string, unknown>) => {
  const analysis = {
    activities: [{ id: "act_1", type: c.type, instruction: c.instruction, context: c.context ?? null, objective_ids: ["obj_1"], resource_ids: [...(c.table ? ["vis_1"] : []), ...(c.reading ? ["ctt_1"] : [])], expected_answer: c.answer ? { basis: "inferred", value: c.answer } : { basis: "not_inferable", value: null } }],
    protected_elements: (c.protectedValues ?? []).map((v, i) => ({ id: `prt_${i}`, type: "concept", importance: "essential", value: v, activity_ids: ["act_1"], resource_ids: [] })),
    pedagogical_intent: { objectives: [{ id: "obj_1", text: c.objective ?? "Objetivo" }] },
    visuals: c.table ? [{ id: "vis_1", kind: "table", table: { ...c.table, unit: null }, chart: null }] : [],
    texts: c.reading ? [{ id: "ctt_1", kind: "reading_text", text: c.reading }] : [],
  };
  const document = { pages: [{ blocks: [{ id: "blk_s", ...block, trace: { origin: "support", source_refs: ["act_1"], decision_ids: ["dec_1"] } }] }] };
  return { analysis: analysis as never, document: document as never };
};
const run = (c: Case, block: Record<string, unknown>) => {
  const s = sheet(c, block);
  const result = assessSupports(s.analysis, s.document);
  return { codes: result.findings.map((f) => f.code), cleared: result.cleared.map((x) => x.class), result };
};
const example = (problem: string, result: string, steps: string[] = ["Observo los datos."]) => ({ type: "worked_example", problem, result, steps });
const reminder = (text: string, variant = "reminder") => ({ type: "help_box", variant, text });
const vocabulary = (...items: Array<[string, string]>) => ({ type: "vocabulary", items: items.map(([term, definition]) => ({ term, definition })) });

const CELL: Case = {
  type: "short_answer",
  instruction: "Escribe la estructura celular que corresponde a cada pista.",
  answer: "a) Núcleo; b) Membrana plasmática; c) Citoplasma; d) Mitocondria",
  protectedValues: ["Identificar la estructura celular a partir de su función"],
  objective: "Identificar estructuras celulares a partir de su función",
  table: { headers: ["Pista", "Estructura"], rows: [["a) Contiene el ADN.", ""], ["b) Regula el paso de sustancias entre la célula y el exterior.", ""], ["c) Es el medio interno donde se encuentran los orgánulos.", ""], ["d) Participa en la obtención de energía a partir de nutrientes.", ""]] },
  reading: "Todas las células tienen una membrana plasmática y citoplasma. En las células animales y vegetales, el núcleo contiene el ADN.",
};
const POND_EXPLAIN: Case = {
  type: "short_answer",
  instruction: "Explica qué indican las flechas del esquema.",
  protectedValues: ["Significado de las flechas como relación alimentaria"],
  objective: "Interpretar una cadena alimentaria y predecir efectos de cambios en ella",
};
const POND_CLASSIFY: Case = {
  type: "classification",
  instruction: "Clasifica estos componentes del estanque.",
  answer: "Seres vivos: algas, larvas de insectos, garzas. No vivos: agua, luz solar, temperatura.",
  protectedValues: ["Clasificar los seis componentes en seres vivos y elementos no vivos"],
  objective: "Clasificar componentes como seres vivos o elementos no vivos",
  context: "Algas · Agua · Larvas de insectos · Luz solar · Garzas · Temperatura",
  table: { headers: ["SERES VIVOS", "ELEMENTOS NO VIVOS"], rows: [["", ""]] },
};
const FRACTIONS: Case = {
  type: "short_answer",
  instruction: "Compara las fracciones. Escribe >, < o = en cada recuadro.",
  answer: "2/3 > 3/5; 4/8 = 1/2",
  protectedValues: ["Fracciones equivalentes (1/2 = 4/8)"],
  objective: "Comparar fracciones con distinto denominador usando >, < o =",
  context: "2/3 [ ] 3/5   4/8 [ ] 1/2",
};

describe("respuesta directa verificable: un ejercicio con varios apartados", () => {
  it("célula · el ejemplo «Pista… → Núcleo» resuelve el ítem a): aviso verificable (antes no se veía: la respuesta completa nunca estaba entera)", () => {
    const { result } = run(CELL, example("Pista: «Contiene la información que dirige la actividad de la célula». ¿Qué estructura es?", "Núcleo.", ["Lee la pista y localiza la función que describe."]));
    expect(result.findings).toEqual([expect.objectContaining({ code: "example_solves_item", evidence: "verifiable", action: "warn", activity_id: "act_1" })]);
  });

  it("cualquier otro apoyo que lleve una parte de la respuesta avisa como respuesta directa", () => {
    expect(run(CELL, reminder("Recuerda: la membrana plasmática rodea la célula.")).codes).toEqual(["direct_answer_part"]);
    expect(run(CELL, { type: "list", style: "bullet", items: ["Lee la pista.", "El citoplasma es el medio interno."] }).codes).toEqual(["direct_answer_part"]);
  });

  it("una parte que la hoja YA muestra no es evidencia (nombrar lo que el alumno ve no entrega nada)", () => {
    const matching: Case = { ...CELL, instruction: "Relaciona las letras A-D con: núcleo, mitocondria, membrana plasmática y citoplasma.", answer: "A: núcleo; B: citoplasma" };
    expect(run(matching, { type: "list", style: "bullet", items: ["Lee las cuatro estructuras: núcleo, mitocondria, membrana plasmática y citoplasma."] }).codes).toEqual([]);
  });

  it("una parte que no identifica nada (una cifra, una letra) nunca es evidencia", () => {
    expect(answerParts({ expected_answer: { basis: "inferred", value: "V; 3; F; 12" } })).toEqual([]);
    expect(run({ ...CELL, answer: "12" }, reminder("Resta 20 − 12 y escribe el resultado.")).codes).toEqual([]);
  });

  it("las partes de «a) … b) … c)» y de «etiqueta: valor» se separan", () => {
    expect(answerParts({ expected_answer: { basis: "inferred", value: "a) Núcleo; b) Membrana plasmática; c) Citoplasma" } })).toEqual(["Núcleo", "Membrana plasmática", "Citoplasma"]);
    expect(answerParts({ expected_answer: { basis: "inferred", value: "Membrana plasmática: animal y vegetal; Núcleo: animal y vegetal" } })).toContain("animal y vegetal");
  });
});

describe("ejemplo que realmente resuelve un ítem · números y fracciones completos", () => {
  it("fracciones · «2/4 = 1/2» demuestra la misma equivalencia que «4/8 = 1/2»: aviso estructural, no por dígitos", () => {
    const { result } = run(FRACTIONS, example("Compara 1/3 [ ] 2/5 y 2/4 [ ] 1/2. Escribe >, < o =.", "1/3 < 2/5 y 2/4 = 1/2", ["Mira cuántas partes tiene cada fracción."]));
    expect(result.findings).toEqual([expect.objectContaining({ code: "example_near_item", evidence: "structural", action: "warn" })]);
  });

  it("los dígitos sueltos ya no cuentan: las fracciones 1/3, 2/5, 2/4 y 1/2 comparten con la tarea solo «1/2» (una coincidencia)", () => {
    expect(canonicalSet(numericTokens("1/3 2/5 2/4 1/2"))).toEqual(new Set(["1/3", "2/5", "1/2"]));
    const { codes, cleared } = run({ ...FRACTIONS, answer: undefined, protectedValues: [] }, example("Compara 1/3 [ ] 2/5 y 2/4 [ ] 1/2.", "1/3 < 2/5"));
    expect(codes).not.toContain("example_reuses_data");
    expect(cleared).toEqual(["lexical_coincidence"]);
  });

  it("un ejemplo con otros números y otras fracciones es legítimo (restar fracciones, m.c.m., sumar 9, el charco)", () => {
    const restar: Case = { type: "problem_solving", instruction: "¿Cuánta agua quedó? Escribe la operación y la respuesta con unidad.", answer: "3/4 - 1/4 = 2/4 (=1/2) de litro", protectedValues: ["Restar fracciones de igual denominador (3/4 - 1/4)"], context: "Había 3/4 de litro y se gastó 1/4 de litro." };
    expect(run(restar, example("En una botella había 5/6 de litro de zumo. Se bebieron 2/6 de litro. ¿Cuánto zumo quedó?", "Quedaron 3/6 de litro de zumo.", ["Resto los numeradores y dejo el mismo denominador.", "5/6 - 2/6 = 3/6"])).codes).toEqual([]);
    const mcm: Case = { type: "calculation", instruction: "Halla el mínimo común múltiplo de: a) 24 y 36 b) 18, 15 y 30 c) 100 y 1.000 d) 180 y 90", protectedValues: ["Cálculo de m.c.d. y m.c.m."] };
    expect(run(mcm, example("Halla el mínimo común múltiplo de 20 y 30.", "m.c.m. (20, 30) = 60", ["Descomponemos: 20 = 2² · 5 y 30 = 2 · 3 · 5."])).codes).toEqual([]);
    const sumar: Case = { type: "calculation", instruction: "Pregunta las operaciones de la serie SUMAS + 9 a tu compañero/a.", answer: "31, 66, 81, 82, 21, 76, 22, 102, 45, 30" };
    expect(run(sumar, example("Un autobús lleva 35 pasajeros y en la parada suben 9 más. ¿Cuántos pasajeros hay ahora?", "35 + 9 = 44", ["Sumar 9 es sumar 10 y quitar 1."])).codes).toEqual([]);
    const charco: Case = { type: "calculation", instruction: "¿Cuántos centímetros descendió el nivel del agua? Escribe la operación.", answer: "30 - 18 = 12 cm", table: { headers: ["MAYO", "JUNIO"], rows: [["30 cm de profundidad", "18 cm de profundidad"]] } };
    expect(run(charco, example("Un charco tenía 25 cm de profundidad el lunes y 10 cm el martes. ¿Cuántos centímetros descendió?", "Descendió 15 cm.", ["Escribo la operación: 25 − 10 = 15."])).codes).toEqual([]);
  });

  it("el ejemplo con los datos de la propia tarea (dos números completos y la mayoría de los suyos) avisa; dos coincidencias entre muchos números, no", () => {
    const charco: Case = { type: "calculation", instruction: "¿Cuántos centímetros descendió el nivel del agua?", table: { headers: ["MAYO", "JUNIO"], rows: [["30 cm", "18 cm"]] } };
    expect(run(charco, example("El agua tenía 30 cm en mayo y 18 cm en junio.", "Bajó.")).codes).toEqual(["example_reuses_data"]);
    expect(run(charco, example("Un pozo medía 30 cm, 18 cm, 41 cm, 52 cm y 63 cm.", "Bajó.")).codes).toEqual([]);
  });

  it("canonicalización: 4/8 = 1/2, 1.000 = 1000, 17,5 = 17.5; una relación se compara por su forma reducida", () => {
    expect([canonicalNumber("4/8"), canonicalNumber("1.000"), canonicalNumber("17,5")]).toEqual(["1/2", "1000", "17.5"]);
    expect(relations("2/4 = 1/2")[0]!.key).toBe(relations("4/8 = 1/2")[0]!.key);
    expect(relations("5/6 - 2/6 = 3/6")).toEqual([]);
  });
});

describe("criterio legítimo de consulta: aplicar el conocimiento, no recibirlo hecho", () => {
  it("números primos · la tarjeta del criterio sobre «Rodea los primos» es legítima (clasificar sigue siendo del alumno)", () => {
    const primes: Case = { type: "classification", instruction: "Rodea los números que sean primos: 131, 243, 218, 143.", objective: "Reconocer números primos y descomponer números en factores primos" };
    const { codes, cleared } = run(primes, reminder("Un número primo solo es divisible entre 1 y entre sí mismo."));
    expect(codes).toEqual([]);
    expect(cleared).toEqual(["criterion_card"]);
  });

  it("seres vivos · la definición del criterio sobre «Clasifica estos componentes» es legítima mientras no clasifique ninguno de los componentes", () => {
    const { codes, cleared } = run(POND_CLASSIFY, vocabulary(["Ser vivo", "Ser que nace, crece, se alimenta y puede reproducirse."], ["Elemento no vivo", "Parte del ecosistema que no tiene vida."]));
    expect(codes).toEqual([]);
    expect(cleared).toEqual(["criterion_card"]);
  });

  it("…pero deja de serlo cuando asigna un componente a su categoría (la clasificación hecha)", () => {
    const { result } = run(POND_CLASSIFY, vocabulary(["Seres vivos", "Las algas y las garzas."], ["Elementos no vivos", "El agua."]));
    expect(result.findings.map((f) => f.code)).toContain("assigns_item_to_category");
    expect(result.findings.every((f) => f.action === "warn")).toBe(true);
  });

  it("estanque 3a · explicar qué indican las flechas con una definición que ya lo explica NO es válido (aviso léxico)", () => {
    const { result } = run(POND_EXPLAIN, vocabulary(["cadena alimentaria", "Serie de seres vivos en la que cada uno sirve de alimento al siguiente."]));
    expect(result.findings).toEqual([expect.objectContaining({ code: "defines_evaluated_concept", evidence: "lexical", action: "warn" })]);
    expect(result.cleared).toEqual([]);
  });

  it("explicar con el vocabulario de OTRA cosa, o una idea clave que solo repite un requisito, no avisa", () => {
    expect(run(POND_EXPLAIN, vocabulary(["recuadro", "Cuadro que encierra una palabra."])).codes).toEqual([]);
    const table: Case = { type: "short_answer", instruction: "Justifica tu respuesta.", protectedValues: ["Justificar la respuesta usando la tabla"], objective: "Relacionar orgánulos con su función a partir de la tabla" };
    expect(run(table, reminder("Tu justificación debe apoyarse en la información de la tabla.", "key_idea")).codes).toEqual([]);
  });
});

describe("analogía de la membrana plasmática: coincidencia sin evidencia pedagógica suficiente", () => {
  const house = example("Pista: «Es la parte de una casa que protege y separa el interior del exterior». Escribe qué parte de la casa es.", "Respuesta del ejemplo: la pared.", ["Lee la pista y subraya la palabra clave: protege y separa."]);

  it("comparte con la pista b) una sola raíz («exterior»): léxicamente no hay evidencia, así que NO avisa (queda para el revisor semántico, etapa 2.3)", () => {
    expect(run(CELL, house).codes).toEqual([]);
  });

  it("otros ejemplos de otro ámbito (el corazón) tampoco avisan", () => {
    expect(run(CELL, example("Pista: «Bombea la sangre por todo el cuerpo». ¿Qué órgano corresponde?", "El corazón.", ["Leo la pista y subrayo la función."])).codes).toEqual([]);
  });
});

describe("protecciones actuales intactas y ningún hallazgo nuevo bloquea", () => {
  const grammar = {
    activities: [{ id: "act_1", type: "classification", instruction: "Clasifica cada palabra como determinante, sustantivo, adjetivo o verbo.", context: null, objective_ids: [], resource_ids: [], expected_answer: { basis: "not_inferable", value: null } }],
    protected_elements: [], pedagogical_intent: { objectives: [] }, visuals: [], texts: [],
  };
  const glossary = { pages: [{ blocks: [{ id: "blk_g", type: "vocabulary", items: [{ term: "determinante", definition: "Acompaña al nombre." }, { term: "sustantivo", definition: "Nombra seres y cosas." }], trace: { origin: "support", source_refs: ["act_1"], decision_ids: ["dec_1"] } }] }] };

  it("definir las categorías que la consigna lista sigue bloqueando (la regla de siempre, misma función)", () => {
    expect(supportsDefiningEvaluatedConcepts(glossary as never, grammar.activities as never)).toHaveLength(1);
    const { findings } = assessSupports(grammar as never, glossary as never);
    expect(findings).toEqual([expect.objectContaining({ code: "defines_listed_categories", evidence: "verifiable", action: "block", block_id: "blk_g" })]);
  });

  it("solo la protección de siempre puede bloquear; todo lo nuevo avisa mientras su precisión no esté medida", () => {
    expect(Object.entries(FINDING_POLICY).filter(([, p]) => p.action === "block").map(([code]) => code)).toEqual(["defines_listed_categories"]);
  });

  it("el registro interno recoge los hallazgos con su necesidad y lo legítimo como «cleared», sin una palabra del material", () => {
    const s = sheet(POND_EXPLAIN, vocabulary(["cadena alimentaria", "Serie de seres vivos en la que cada uno sirve de alimento al siguiente."]));
    const audit = auditSupports({ ...s, plan: { decisions: [{ id: "dec_1", dimensions: ["vocabulary_support"] }] } as never, context: { needs: [{ dimension: "vocabulary_support", level: "low" }] } as never });
    expect(audit).toMatchObject({ version: "support_audit@v2", mode: "shadow", supports_checked: 1 });
    expect(audit.warnings).toEqual([expect.objectContaining({ code: "defines_evaluated_concept", low_need_only: true })]);
    expect(JSON.stringify(audit)).not.toMatch(/cadena|alimento|flechas/i);
  });
});
