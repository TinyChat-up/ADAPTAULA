import { describe, expect, it } from "vitest";
import { auditSupports, SUPPORT_AUDIT_VERSION } from "@/lib/adaptation/support-audit";
import { contentStems } from "@/lib/adaptation/support-evidence";
import { allBlocks, type Block } from "@/lib/schemas/material-document";
import { pondCase } from "../support/pond-plan";

/**
 * Bloque 1 (shadow): un apoyo no puede realizar el razonamiento que evalúa la actividad. Caso real del estanque: el glosario de 3a
 * define «cadena alimentaria» justo debajo de «Explica qué indican las flechas del esquema». El aviso es interno: no cambia el
 * documento, no bloquea y no guarda texto del material.
 */

const base = pondCase("v2");
const audit = (mutate?: (doc: typeof base.document, analysis: typeof base.analysis) => void) => {
  const document = structuredClone(base.document);
  const analysis = structuredClone(base.analysis);
  mutate?.(document, analysis);
  return auditSupports({ analysis, plan: base.plan, context: base.context, document });
};
const blockFor = (doc: typeof base.document, ref: string, type: Block["type"]) => allBlocks(doc).find((b) => b.type === type && b.trace.source_refs.includes(ref))!;

describe("support_audit@v1 · estanque", () => {
  it("avisa del glosario que define el concepto que 3a evalúa, y de nada más en esta ficha", () => {
    const result = audit();
    expect(result).toMatchObject({ version: SUPPORT_AUDIT_VERSION, mode: "shadow", cleared: [] });
    expect(result.supports_checked).toBe(6); // 3 listas, 2 ejemplos y el glosario: los apoyos de documento no tienen una actividad
    expect(result.warnings).toEqual([
      { code: "defines_evaluated_concept", evidence: "lexical", action: "warn", block_id: blockFor(base.document, "act_3", "vocabulary").id, activity_id: "act_3", decision_ids: ["dec_6"], low_need_only: true },
    ]);
  });

  it("no es un bloqueo ni cambia la ficha: auditar no toca el documento", () => {
    const before = JSON.stringify(base.document);
    audit();
    expect(JSON.stringify(base.document)).toBe(before);
  });

  it("el registro guarda solo códigos e ids: ni una palabra del material ni de las respuestas", () => {
    const text = JSON.stringify(audit());
    for (const word of ["cadena", "alimentaria", "flechas", "Algas", "estanque", "Orden en el que"]) expect(text).not.toContain(word);
  });

  it("un glosario de OTRA cosa no avisa (ayudar a leer una palabra no es resolver la actividad)", () => {
    const result = audit((doc) => {
      const vocabulary = blockFor(doc, "act_3", "vocabulary");
      if (vocabulary.type === "vocabulary") vocabulary.items = [{ term: "recuadro", definition: "Cuadro que encierra una palabra." }];
    });
    expect(result.warnings).toEqual([]);
  });

  it("el mismo glosario en una actividad que NO pide explicar (cálculo) no avisa por concepto", () => {
    const result = audit((doc, analysis) => {
      analysis.activities.find((a) => a.id === "act_3")!.type = "calculation";
      void doc;
    });
    expect(result.warnings.map((w) => w.code)).not.toContain("defines_evaluated_concept");
  });

  it("una idea clave que repite el concepto evaluado avisa; un recordatorio de método no", () => {
    const withHelp = (variant: "key_idea" | "reminder", text: string) =>
      audit((doc) => {
        const page = doc.pages[1]!;
        page.blocks.push({ id: "blk_help", type: "help_box", variant, text, trace: { origin: "support", source_refs: ["act_3"], decision_ids: ["dec_6"] } });
      }).warnings.filter((w) => w.block_id === "blk_help");
    expect(withHelp("key_idea", "Las flechas de una cadena alimentaria indican quién sirve de alimento a quién.").map((w) => w.code)).toEqual(["defines_evaluated_concept"]);
    expect(withHelp("reminder", "Lee despacio y mira cada recuadro del esquema.")).toEqual([]);
  });

  it("un ejemplo resuelto con los datos de la propia tarea avisa; uno con otros datos (el real) no", () => {
    const withExample = (problem: string) =>
      audit((doc) => {
        const example = blockFor(doc, "act_5", "worked_example");
        if (example.type === "worked_example") example.problem = problem;
      }).warnings.filter((w) => w.code === "example_reuses_data");
    expect(withExample("El agua tenía 30 cm en mayo y 18 cm en junio. ¿Cuánto bajó?")).toHaveLength(1);
    expect(withExample("Un charco tenía 20 cm y bajó a 12 cm. ¿Cuánto bajó?")).toEqual([]);
  });

  it("un apoyo que lleva la respuesta que el análisis da para su actividad avisa", () => {
    const result = audit((doc, analysis) => {
      analysis.activities.find((a) => a.id === "act_5")!.expected_answer = { basis: "inferred", value: "12 centímetros" };
      const example = blockFor(doc, "act_5", "worked_example");
      if (example.type === "worked_example") example.result = "Bajó 12 centímetros.";
    });
    expect(result.warnings.map((w) => w.code)).toContain("example_solves_item");
  });

  it("un apoyo de una necesidad importante se distingue de uno de una necesidad menor", () => {
    const result = auditSupports({ analysis: base.analysis, plan: base.plan, context: { needs: base.context.needs.map((n) => ({ ...n, level: "high" as const })) }, document: base.document });
    expect(result.warnings[0]).toMatchObject({ activity_id: "act_3", low_need_only: false });
  });

  it("contentStems quita palabras de función y de tarea y conflaciona flexiones", () => {
    expect([...contentStems("El significado de las flechas en una cadena alimentaria")].sort()).toEqual(["caden", "alime", "flech"].sort());
    expect(contentStems("alimento")).toEqual(contentStems("alimentaria"));
  });
});
