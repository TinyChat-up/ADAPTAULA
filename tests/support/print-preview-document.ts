import { editorDocument } from "./editor-document";

/** Ten logical CLARO pages; the long response occupies two physical sheets in the unchanged renderer. */
export function printPreviewDocument() {
  const document = editorDocument();
  const trace = { origin: "original" as const, source_refs: [], decision_ids: [] };
  document.pages.unshift({ blocks: [
    { id: "blk_longtitle", type: "heading", level: 1, text: "Prueba sintética de impresión", trace },
    { id: "blk_longtask", type: "activity", label: "L", prompt: "Escribe una redacción de 150 a 180 palabras.", response: { kind: "lines", lines: 40 }, trace },
  ] });
  for (let i = 3; i <= 10; i++) document.pages.push({ blocks: [
    { id: `blk_final${i}`, type: "heading", level: 1, text: `Hoja lógica ${i} · documento sintético`, trace },
    { id: `blk_text${i}`, type: "paragraph", text: "Revisa esta hoja antes de imprimir.", trace },
  ] });
  return document;
}
