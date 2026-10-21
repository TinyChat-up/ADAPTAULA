import { describe, expect, it } from "vitest";
import { activityStructure, readingParagraphs, structuralLines } from "@/lib/adaptation/structure";
import { pruneRedundantSupports, restates } from "@/lib/adaptation/support-policy";
import { parseParagraphs } from "@/lib/render/inline";
import type { Block } from "@/lib/schemas/material-document";

/** Structure of the original kept from the analysis's own words («Hacer magia» 2.0): never invented, never lost. */

const act = (instruction: string, context: string | null, type = "short_answer") => ({ instruction, context, type: type as never, answer_area: { type: "lines" as const, lines: null } });

describe("líneas estructurales", () => {
  it("una lista de oraciones conserva cada salto; un salto a mitad de frase (ajuste del PDF) se une", () => {
    expect(structuralLines("1. Los niños juegan.\n2. Mi abuela cocina.\n3. El perro duerme.")).toHaveLength(3);
    expect(structuralLines("El grupo fue al río y\nvio una garza.")).toEqual(["El grupo fue al río y vio una garza."]);
    expect(structuralLines("Lee esto:\n— Hola.\n— Adiós.")).toEqual(["Lee esto:", "— Hola.", "— Adiós."]);
  });

  it("los párrafos de una lectura sin líneas en blanco: uno por oración cerrada, el diálogo aparte", () => {
    expect(readingParagraphs("Primero.\n\nSegundo.")).toEqual(["Primero.", "Segundo."]);
    expect(readingParagraphs("Salieron pronto.\n—¿Vamos? —dijo Hugo.\nY se fueron\njuntos.")).toEqual(["Salieron pronto.", "—¿Vamos? —dijo Hugo.", "Y se fueron juntos."]);
  });

  it("el render conserva el salto como <br> (run de corte), sin inventar párrafos", () => {
    const [para] = parseParagraphs("1. Uno.\n2. Dos.");
    expect(para!.filter((r) => r.break)).toHaveLength(1);
  });
});

describe("campos de respuesta y ordenación", () => {
  it("Operaciones y unidades → caja; Respuesta → líneas; varios campos en una línea", () => {
    expect(activityStructure(act("Resuelve.", "Operaciones y unidades:\nRespuesta:")).fields).toEqual([{ label: "Operaciones y unidades", space: "box", lines: 5 }, { label: "Respuesta", space: "lines", lines: 2 }]);
    expect(activityStructure(act("Escribe dónde trabajan.", "Escuela: ____ Hospital: ____ Mercado: ____")).fields?.map((f) => f.label)).toEqual(["Escuela", "Hospital", "Mercado"]);
  });

  it("los elementos de ordenación, uno por línea o separados por « / », en su orden impreso", () => {
    expect(activityStructure(act("Ordena las frases.", "Se levantó.\nDesayunó.\nSalió.", "sequencing")).sequence).toEqual(["Se levantó.", "Desayunó.", "Salió."]);
    expect(activityStructure(act("Numera en orden del 1 al 3.", "Se levantó. / Desayunó. / Salió.")).sequence).toEqual(["Se levantó.", "Desayunó.", "Salió."]);
  });

  it("sin evidencia no se inventa estructura: una consigna normal queda igual", () => {
    expect(activityStructure(act("Explica por qué llueve.", null))).toEqual({ instruction: "Explica por qué llueve.", context: null, fields: null, sequence: null });
    expect(activityStructure(act("Lee el texto.", "Era un día de lluvia y nadie salió de casa."))).toMatchObject({ fields: null, sequence: null });
  });
});

describe("apoyos sin sobrecarga", () => {
  const trace = (decision: string, refs: string[] = []) => ({ origin: "support" as const, source_refs: refs, decision_ids: [decision] });
  const sheet: Block = { id: "blk_a", type: "checklist", items: ["Lee la consigna dos veces antes de empezar.", "Revisa tu respuesta al terminar la tarea."], trace: trace("dec_1") };
  const same: Block = { id: "blk_b", type: "checklist", items: ["Revisa tu respuesta al terminar la tarea."], trace: trace("dec_2", ["act_1"]) };
  const other: Block = { id: "blk_c", type: "help_box", variant: "tip", text: "Dibuja un esquema con los datos del problema.", trace: trace("dec_3", ["act_1"]) };

  it("solo se poda lo que repite íntegramente otro apoyo; sus decisiones pasan al que queda", () => {
    expect(restates(same, sheet)).toBe(true);
    expect(restates(other, sheet)).toBe(false);
    const { head, after, pruned } = pruneRedundantSupports([sheet], new Map([["act_1", [same, other]]]));
    expect(pruned).toEqual([{ dropped: "blk_b", keptIn: "blk_a", decisionIds: ["dec_2"] }]);
    expect(head[0]!.trace.decision_ids).toEqual(["dec_1", "dec_2"]);
    expect(after.get("act_1")!.map((b) => b.id)).toEqual(["blk_c"]);
  });

  it("los bloques del original y las actividades nunca se podan", () => {
    const original: Block = { ...same, id: "blk_o", trace: { origin: "original", source_refs: ["act_1"], decision_ids: [] } };
    expect(pruneRedundantSupports([sheet], new Map([["act_1", [original]]])).pruned).toEqual([]);
  });
});
