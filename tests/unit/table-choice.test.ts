import { describe, expect, it, vi } from "vitest";
import { fingerprint } from "@/lib/adaptation/fingerprint";
import { tableChoiceViolations, type ChoiceTable, type TableEvidence } from "@/lib/adaptation/table-choice";
import { applyVisualResolution } from "@/lib/adaptation/visual-policy";
import { allBlocks } from "@/lib/schemas/material-document";
import { resolveMagicVisuals, type MagicVisualDeps } from "@/lib/materials/visuals/auto/policy";
import { corroboratesTable } from "@/lib/materials/visuals/auto/table";
import { readPage } from "@/lib/materials/visuals/auto/read";
import type { SubstituteDraft } from "@/lib/materials/visuals/auto/assistants";
import { tableChoiceCase, tableChoicePdf, TABLE_DATA, TABLE_CHOICE_DRAFT, TABLE_RUN } from "../support/table-choice-case";

const evidence = (table: ChoiceTable = TABLE_DATA): TableEvidence => ({ method: "pdf_grid_text_v1", sourceSha256: "a".repeat(64), page: 1, tableSha256: fingerprint(table) });
const assistantsFor = (draft: SubstituteDraft = TABLE_CHOICE_DRAFT) => ({ substitute: vi.fn(async () => ({ draft, run: TABLE_RUN })), support: vi.fn(async () => ({ draft: null, run: TABLE_RUN })), rewrite: vi.fn(async () => ({ draft: null, run: TABLE_RUN })) });

describe("tabla y selección única", () => {
  it.each([true, false])("resuelve la tabla con recorte perdido=%s conservando contenido, opciones, clave e ids", async (asImage) => {
    const s = tableChoiceCase(asImage);
    const assistants = assistantsFor();
    const plan = await resolveMagicVisuals({ readyOriginals: async () => new Set(), corroborateTable: async () => evidence(), assistants }, { ...s, requiredVisuals: ["vis_1"], stage: "primaria" });
    expect(plan.needs[0]!.resolution.action).toBe("substitute");
    expect(plan.needs[0]!.contract?.validation).toBe("source_table_verified");
    const result = applyVisualResolution(s.document, plan);
    expect(result.answer_key).toEqual(s.document.answer_key);
    expect(allBlocks(result).map((b) => b.id)).toEqual(allBlocks(s.document).map((b) => b.id));
    const table = allBlocks(result).find((b) => b.type === "table")!;
    expect(table).toMatchObject({ headers: TABLE_DATA.headers, rows: TABLE_DATA.rows });
    expect(allBlocks(result).find((b) => b.type === "activity")).toMatchObject({ prompt: TABLE_CHOICE_DRAFT.prompt, response: TABLE_CHOICE_DRAFT.choice, resource_block_ids: [table.id], trace: { source_refs: ["act_1", "vis_1"] } });
    expect(applyVisualResolution(result, plan)).toEqual(result);
    expect(assistants.rewrite).not.toHaveBeenCalled();
  });

  it.each([true, false])("una tabla sin corroborar se detiene incluso con un recorte listo=%s", async (ready) => {
    const s = tableChoiceCase();
    const assistants = assistantsFor();
    const plan = await resolveMagicVisuals({ readyOriginals: async () => new Set(ready ? ["vis_1"] : []), assistants }, { ...s, requiredVisuals: ["vis_1"], stage: "primaria" });
    expect(plan.needs[0]?.resolution).toEqual({ action: "unresolved", reason: "table_uncorroborated" });
    expect(assistants.substitute).not.toHaveBeenCalled();
  });

  it.each([true, false])("limita la corrección a dos intentos, segundo válido=%s", async (correct) => {
    const s = tableChoiceCase();
    const invalid = structuredClone(TABLE_CHOICE_DRAFT);
    invalid.table.rows[0]![1] = "Carne";
    const assistants = assistantsFor(invalid);
    if (correct) assistants.substitute.mockResolvedValueOnce({ draft: invalid, run: TABLE_RUN }).mockResolvedValueOnce({ draft: TABLE_CHOICE_DRAFT, run: TABLE_RUN });
    const recordAiRun = vi.fn<NonNullable<MagicVisualDeps["recordAiRun"]>>().mockResolvedValue(undefined);
    const plan = await resolveMagicVisuals({ readyOriginals: async () => new Set(), corroborateTable: async () => evidence(), assistants, recordAiRun }, { ...s, requiredVisuals: ["vis_1"], stage: "primaria" });
    expect(assistants.substitute).toHaveBeenCalledTimes(2);
    expect(assistants.substitute).toHaveBeenNthCalledWith(2, expect.objectContaining({ rejectionCodes: ["table_data_changed"] }));
    expect(JSON.stringify(assistants.substitute.mock.calls)).not.toMatch(/expected_answer|correct_option_ids|"value":"B"/);
    expect(recordAiRun.mock.calls.map(([r]) => r.attempt)).toEqual([1, 2]);
    expect(plan.needs[0]!.resolution.action).toBe(correct ? "substitute" : "unresolved");
  });

  it("rechaza una tabla previamente editada o un enlace ausente", async () => {
    for (const mode of ["cell", "link", "key", "hash"] as const) {
      const s = tableChoiceCase();
      const table = allBlocks(s.document).find((b) => b.type === "table")!;
      const activity = allBlocks(s.document).find((b) => b.type === "activity")!;
      if (mode === "cell" && table.type === "table") table.rows = [["Inventada", "Carne", "Campo"]];
      if (mode === "link" && activity.type === "activity") activity.resource_block_ids = [];
      if (mode === "key") s.document.answer_key[0]!.value = "A";
      const plan = await resolveMagicVisuals({ readyOriginals: async () => new Set(), corroborateTable: async () => ({ ...evidence(), ...(mode === "hash" ? { tableSha256: "0".repeat(64) } : {}) }), assistants: assistantsFor() }, { ...s, requiredVisuals: ["vis_1"], stage: "primaria" });
      expect(plan.needs[0]!.resolution.action).toBe("unresolved");
    }
  });
});

describe("prueba determinista de la relación entre celdas", () => {
  const check = (mutate: (s: ReturnType<typeof tableChoiceCase>, draft: typeof TABLE_CHOICE_DRAFT) => void) => {
    const s = tableChoiceCase();
    const draft = structuredClone(TABLE_CHOICE_DRAFT);
    mutate(s, draft);
    return tableChoiceViolations(s.analysis.activities[0]!, s.analysis.visuals[0]!, draft, evidence(s.analysis.visuals[0]!.table!));
  };
  it("lee una celda en una tabla de varias filas y columnas", () => expect(check(() => {})).toEqual([]));
  it("resuelve otra fila y otra columna conservando su clave original", () => {
    expect(check((s, d) => {
      s.analysis.activities[0]!.instruction = d.prompt = "Según la tabla, ¿qué hábitat corresponde a «León»? Elige una opción.";
      s.analysis.activities[0]!.context = "A) Pradera\nB) Sabana\nC) Bosque";
      d.choice.options = d.choice.options.map((o, i) => ({ ...o, text: ["A) Pradera", "B) Sabana", "C) Bosque"][i]! }));
    })).toEqual([]);
  });
  it.each(["changed", "missing"])("rechaza celda %s", (kind) => expect(check((_s, d) => { if (kind === "changed") d.table.rows[0]![1] = "Carne"; else d.table.rows[0]!.pop(); })).toContain("table_data_changed"));
  it.each(["header", "row", "empty", "unit"])("rechaza ambigüedad o datos no interpretables: %s", (kind) => expect(check((s) => {
    const table = s.analysis.visuals[0]!.table!;
    if (kind === "header") table.headers[1] = table.headers[0]!;
    if (kind === "row") table.rows[1]![0] = table.rows[0]![0]!;
    if (kind === "empty") table.rows[0]![1] = "";
    if (kind === "unit") table.unit = "kg";
  })).toContain("table_source_unverifiable"));
  it("rechaza alternativas ajenas a la columna o equivalencias numéricas", () => {
    expect(check((s) => { s.analysis.activities[0]!.context = "A) Carne\nB) Plantas\nC) Vegetales"; })).toContain("table_reference_unverifiable");
    expect(check((s) => {
      s.analysis.visuals[0]!.table!.rows[0]![1] = "2";
      s.analysis.visuals[0]!.table!.rows[1]![1] = "2.0";
      s.analysis.activities[0]!.context = "A) 2.0\nB) 2\nC) Semillas";
    })).toContain("table_reference_unverifiable");
  });
  it("rechaza inferencia no verificable", () => expect(check((s, d) => { s.analysis.activities[0]!.instruction = d.prompt = "¿Qué animal come más? Elige una opción."; })).toContain("table_reference_unverifiable"));
  it.each(["two", "none"])("rechaza respuestas correctas: %s", (kind) => expect(check((s) => { s.analysis.activities[0]!.context = kind === "two" ? "A) Plantas\nB) Plantas\nC) Semillas" : "A) Carne\nB) Piedras\nC) Semillas"; })).toContain("choice_correct_count"));
  it("rechaza clave original contradictoria", () => expect(check((s) => { s.analysis.activities[0]!.expected_answer.value = "A"; })).toContain("choice_answer_changed"));
  it("exige clave original y no inferida", () => expect(check((s) => { s.analysis.activities[0]!.expected_answer.basis = "inferred"; })).toContain("choice_key_unverifiable"));
  it.each(["prompt", "steps", "options"])("rechaza respuesta revelada en %s", (kind) => expect(check((_s, d) => {
    if (kind === "prompt") d.prompt += " La respuesta es Plantas.";
    if (kind === "steps") d.steps = ["La respuesta es B"];
    if (kind === "options") d.choice.options[1]!.text += " (correcta)";
  }).length).toBeGreaterThan(0));
});

describe("corroboración de tabla contra el PDF", () => {
  it("verifica cuadrícula y posición de todas las celdas; rechaza inventadas, incompletas y fuente sin tabla", async () => {
    const { model } = await readPage(await tableChoicePdf(), "application/pdf", 1, 100);
    expect(corroboratesTable(model, TABLE_DATA)).toBe(true);
    const altered = structuredClone(TABLE_DATA); altered.rows[0]![1] = "Carne";
    expect(corroboratesTable(model, altered)).toBe(false);
    const swapped = structuredClone(TABLE_DATA); swapped.rows[0]!.reverse();
    expect(corroboratesTable(model, swapped)).toBe(false);
    const missing = structuredClone(TABLE_DATA); missing.rows.pop();
    expect(corroboratesTable(model, missing)).toBe(false);
    expect(corroboratesTable({ ...model, texts: [] }, TABLE_DATA)).toBe(false);
    // Remove part of an inner vertical rule: a merged cell is not an ordinary rectangle.
    const merged = { ...model, gray: model.gray.slice() };
    const scale = model.width / 595.28;
    for (let y = Math.ceil((841.89 - 698) * scale); y < (841.89 - 680) * scale; y++) {
      for (let x = Math.floor(213 * scale); x <= Math.ceil(217 * scale); x++) merged.gray[y * model.width + x] = 255;
    }
    expect(corroboratesTable(merged, TABLE_DATA)).toBe(false);
    const blank = await readPage(await tableChoicePdf(TABLE_DATA, true), "application/pdf", 1, 100);
    expect(corroboratesTable(blank.model, TABLE_DATA)).toBe(false);
  });
});
