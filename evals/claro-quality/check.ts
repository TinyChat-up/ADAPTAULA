import { isDeepStrictEqual } from "node:util";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MaterialSheet } from "@/components/material/sheet";
import { buildRenderModel } from "@/lib/render/model";
import { MaterialDocumentSchema, type MaterialDocument } from "@/lib/schemas/material-document";
import { VisualSpecSchema } from "@/lib/visuals/spec";
import type { QualityCase } from "./corpus";

export interface Finding { property: string; status: "pass" | "fail" | "unverified"; detail: string }
/** Independent, hand-written fixture references only. Never used to approve a generated image or an adaptation in production. */
export function checkReference(document: MaterialDocument, reference: QualityCase["reference"]): Finding[] {
  const out: Finding[] = [];
  const check = (property: string, condition: boolean, detail: string) => out.push({ property, status: condition ? "pass" : "fail", detail });
  const schema = MaterialDocumentSchema.safeParse(document);
  check("schema", schema.success, "Contrato de datos y referencias existentes; no juicio pedagógico.");
  if (!schema.success) return out;
  const blocks = document.pages.flatMap(p => p.blocks);
  for (const expected of reference.tasks) {
    const actual = blocks.find(b => b.id === expected.id);
    check(`${expected.id}:instruction`, actual?.type === "activity" && actual.prompt === expected.instruction, "Consigna literal de la referencia manual.");
    check(`${expected.id}:resources`, actual?.type === "activity" && isDeepStrictEqual(actual.resource_block_ids ?? [], expected.resources), "Vínculos explícitos con los recursos, sin inferirlos por palabras clave.");
    check(`${expected.id}:space`, actual?.type === "activity" && (expected.lines === 0 ? actual.response.kind === "table_cells" : actual.response.kind === "lines" && (actual.response.lines ?? 0) >= expected.lines), "Espacio mínimo fijado para este caso; suficiencia didáctica pendiente de docente.");
  }
  for (const expected of reference.figures) {
    const actual = blocks.find(b => b.id === expected.id);
    check(`${expected.id}:exists`, actual?.type === "image", "Figura referenciada existente.");
    if (actual?.type !== "image") continue;
    if (actual.source.kind !== "figure") {
      out.push({ property: `${expected.id}:pixels`, status: "unverified", detail: "Ni el brief, ni el alt, ni una revisión simulada demuestran los marcadores o la identidad de los píxeles." });
      continue;
    }
    const spec = actual.source.spec;
    check(`${expected.id}:structure`, VisualSpecSchema.safeParse(spec).success, "Rangos, unicidad y valores de marcas.");
    if (expected.spec) check(`${expected.id}:reference`, isDeepStrictEqual(spec, expected.spec), "Mismas divisiones, valores, posiciones y sombreado que la referencia manual; no equivalencia inferida.");
    if (expected.markers) {
      if (spec.kind === "number_line") check(`${expected.id}:markers`, isDeepStrictEqual(spec.labels.map(l => l.text).sort(), [...expected.markers].sort()), "Marcadores explícitos de la referencia y rótulos realmente dibujados.");
      else out.push({ property: `${expected.id}:markers`, status: "unverified", detail: "Esta familia no expresa marcadores semánticos; no inferirlos de su descripción." });
    }
  }
  for (const expected of reference.tables) {
    const actual = blocks.find(b => b.id === expected.id);
    check(`${expected.id}:table`, actual?.type === "table" && isDeepStrictEqual(actual.headers, expected.headers) && isDeepStrictEqual(actual.rows, expected.rows), "Celdas y cabeceras literales conservadas, incluidas celdas de respuesta vacías.");
    check(`${expected.id}:unit`, actual?.type === "table" && actual.unit === expected.unit, "Unidad exacta declarada en la referencia; no conversión supuesta.");
  }
  const { model } = buildRenderModel(document, { mode: "student", design: "claro", deferred: [] });
  const markup = renderToStaticMarkup(createElement(MaterialSheet, { model }));
  const text = markup.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
  for (const value of reference.preserved) check(`preserve:${value}`, text.includes(value), "Dato requerido de la referencia manual.");
  for (const value of reference.forbidden) check(`hidden:${value}`, !text.includes(value), "Respuesta concreta del caso ausente del texto visible. No prueba ausencia de paráfrasis ni respuestas en píxeles.");
  out.push({ property: "pedagogy", status: "unverified", detail: reference.humanReview });
  return out;
}
