import { MaterialDocumentSchema } from "@/lib/schemas/material-document";

/** Synthetic, deterministic editor fixture. No learner data, model or answer in student content. */
export function editorDocument() {
  const trace = { origin: "original", source_refs: [], decision_ids: [] };
  return MaterialDocumentSchema.parse({
    schema_version: 1,
    meta: { title: "Medidas y decisiones", language: "es", stage: "primaria", grade: "5-primaria", subject: "matematicas", topic: "Medidas" },
    presentation: { font_scale: 1, line_spacing: "normal", spacing: "normal", contrast: "normal", decoration: "none", max_tasks_per_page: null, color_independent: true, text_alternatives_for_visuals: false },
    admin_fields: [{ type: "student_name", label: "Nombre" }],
    pages: [{ blocks: [
      { id: "blk_title1", type: "heading", level: 1, text: "Medidas y decisiones", trace },
      { id: "blk_table1", type: "table", caption: "Datos de la actividad", headers: ["Objeto", "Longitud"], rows: [["Cinta", "25 cm"], ["Cordón", "40 cm"]], trace },
      { id: "blk_figure1", type: "image", source: { kind: "figure", provenance: "reconstruction", spec: { spec_version: 1, kind: "fraction_bar", parts: 4, shaded: [0] } }, alt_text: "Una barra dividida en cuatro partes iguales", trace },
      { id: "blk_task1", type: "activity", label: "1", prompt: "Compara 25 cm y 40 cm. Explica tu elección.", resource_block_ids: ["blk_table1", "blk_figure1"], response: { kind: "lines", lines: 3 }, trace },
      { id: "blk_task2", type: "activity", label: "2", prompt: "Elige una medida.", response: { kind: "choice", multiple: false, options: [{ id: "a", text: "25 cm" }, { id: "b", text: "40 cm" }] }, trace },
    ] }],
    answer_key: [{ block_id: "blk_task2", basis: "source", value: "CLAVE_RESERVADA_DOCENTE", correct_option_ids: ["b"] }],
    teacher_notes: "NOTA_RESERVADA_DOCENTE",
  });
}
