import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OriginalDocument } from "@/components/workspace/original-document";
import { StatusBadge } from "@/components/materials/status-badge";

const file = { mime_type: "application/pdf", size_bytes: 2048, page_count: 20, original_name: "Ficha.pdf" };
describe("original privado en el workspace", () => {
  it("solo solicita la página visible, conserva enlaces autorizados y no reconstruye texto", () => {
    const html = renderToStaticMarkup(createElement(OriginalDocument, { materialId: "material", file }));
    expect(html.match(/<img /g)).toHaveLength(1);
    expect(html).toContain('/api/materials/material/pages/1');
    expect(html).not.toContain('/pages/2');
    expect(html).toContain('/api/materials/material/file?download=1');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('Sin modificar');
    expect(html).not.toMatch(/<iframe|<canvas|storage_path|supabase/);
  });
  it("no inventa un número total cuando la metadata no lo confirma", () => {
    const html = renderToStaticMarkup(createElement(OriginalDocument, { materialId: "m", file: { ...file, page_count: null } }));
    expect(html).toContain('total sin confirmar');
    expect(html).not.toContain('<select');
  });
  it("una imagen se muestra en una sola página sin deformar su proporción", () => {
    const html = renderToStaticMarkup(createElement(OriginalDocument, { materialId: "m", file: { ...file, mime_type: "image/png", page_count: null } }));
    expect(html).toContain('Página 1 de 1');
    expect(html).not.toContain('<select');
  });
});
describe("estado honesto sin actividad ficticia", () => {
  it.each(["uploaded", "queued", "failed", "analyzed"] as const)("%s no muestra animación de trabajo", (status) => {
    expect(renderToStaticMarkup(createElement(StatusBadge, { status }))).not.toContain('animate-spin');
  });
  it.each(["uploading", "analyzing"] as const)("%s conserva señal de trabajo con reduced-motion", (status) => {
    expect(renderToStaticMarkup(createElement(StatusBadge, { status }))).toContain('motion-safe:animate-spin');
  });
});
