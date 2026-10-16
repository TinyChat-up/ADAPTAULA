import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PRIMARY_NAV, SECONDARY_NAV, isItemActive, locationOf } from "@/components/app/nav-items";
import { Button } from "@/components/ui/button";
import { TextareaField } from "@/components/ui/fields";
import { ActionBar } from "@/components/ui/action-bar";

describe("navegación del espacio docente", () => {
  it.each([
    ["/app", "/app", undefined],
    ["/app/materiales/123", "/app/materiales", "Material"],
    ["/app/materiales/123/visuales/456", "/app/materiales", "Revisar figura"],
    ["/app/alumnos/nuevo", "/app/alumnos", "Crear perfil"],
    ["/app/adaptaciones/123", "/app/historial", "Preparar ficha"],
    ["/app/adaptaciones/123/editar", "/app/historial", "Editar ficha"],
    ["/app/adaptaciones/123/comparar", "/app/historial", "Comparar documentos"],
    ["/app/adaptaciones/123/vista", "/app/historial", "Ficha adaptada"],
    ["/app/uso", "/app/uso", undefined],
  ])("%s tiene una sola sección activa y contexto sin inventar un estado", (path, parent, detail) => {
    const active = [...PRIMARY_NAV, ...SECONDARY_NAV].filter((item) => isItemActive(path, item));
    expect(active).toHaveLength(1);
    expect(active[0]!.href).toBe(parent);
    expect(locationOf(path)).toMatchObject({ href: parent });
    expect(locationOf(path).detail).toBe(detail);
  });
  it("no confunde prefijos de rutas ni expone IDs como contexto", () => {
    expect(PRIMARY_NAV.some((item) => isItemActive("/app/materiales-ajenos", item))).toBe(false);
    expect(locationOf("/app/desconocida/identidad-privada")).toEqual({ href: "/app", label: "Mi espacio" });
  });
});

describe("contratos de componentes compartidos", () => {
  it("el botón conserva desactivación nativa, nombre y descripción accesibles", () => {
    const html = renderToStaticMarkup(createElement(Button, { disabled: true, "aria-describedby": "motivo" }, "Guardar borrador"));
    expect(html).toContain('disabled=""');
    expect(html).toContain('aria-describedby="motivo"');
    expect(html).toContain('type="button"');
    expect(html).toContain("Guardar borrador");
  });
  it("el campo conecta etiqueta, ayuda y error incluso con el nuevo estilo", () => {
    const html = renderToStaticMarkup(createElement(TextareaField, { id: "consigna", label: "Enunciado", hint: "Conserva los datos.", error: "No puede quedar vacío." }));
    expect(html).toContain('for="consigna"');
    expect(html).toContain('aria-describedby="consigna-hint consigna-error"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('id="consigna-error"');
  });
  it("agrupa acciones sin prometer la navegación de teclado de una toolbar ARIA", () => {
    const html = renderToStaticMarkup(ActionBar({ label: "Edición", children: createElement(Button, null, "Deshacer") }));
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="Edición"');
    expect(html).not.toContain('role="toolbar"');
  });
});

const css = readFileSync(new URL("../../src/styles/tokens.css", import.meta.url), "utf8");
const theme = css.match(/@theme\s*\{([^}]+)\}/)![1]!;
const colors = new Map([...theme.matchAll(/--color-([\w-]+):\s*(#[0-9a-f]{6})/g)].map((match) => [match[1], match[2]!]));
function luminance(hex: string) {
  const rgb = [1, 3, 5].map((offset) => {
    const c = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4;
  });
  return rgb[0]! * .2126 + rgb[1]! * .7152 + rgb[2]! * .0722;
}
function contrast(a: string, b: string) {
  const values = [luminance(colors.get(a)!), luminance(colors.get(b)!)].sort((x, y) => y - x);
  return (values[0]! + .05) / (values[1]! + .05);
}

describe("contraste del sistema de color (no sustituye revisión de pantallas)", () => {
  it.each(["surface", "background", "surface-muted", "primary-soft"])("texto legible sobre %s", (surface) => {
    for (const ink of ["foreground", "muted-foreground", "primary"]) expect(contrast(ink, surface), `${ink}/${surface}`).toBeGreaterThanOrEqual(4.5);
  });
  it("acciones, foco y contornos identificables", () => {
    expect(contrast("primary-foreground", "primary-strong")).toBeGreaterThanOrEqual(4.5);
    for (const surface of ["surface", "background"]) {
      expect(contrast("control-border", surface)).toBeGreaterThanOrEqual(3);
      expect(contrast("focus", surface)).toBeGreaterThanOrEqual(3);
    }
  });
});
