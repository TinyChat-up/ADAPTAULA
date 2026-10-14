import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// The legal drafts must not offer a control the backend cannot record, nor turn acceptance into an optional authorization.
const page = (name: string) => readFileSync(path.resolve(import.meta.dirname, `../../src/app/(marketing)/${name}/page.tsx`), "utf8");

describe("legal drafts", () => {
  it.each(["privacidad", "terminos"])("%s has no consent control and keeps unknown facts explicitly pending", (name) => {
    const source = page(name);
    expect(source).not.toMatch(/<input|<form|checkbox|<button/i);
    expect(source).toMatch(/Pendiente: identidad/);
  });

  it("accepting the terms or uploading never authorizes improvement or training", () => {
    expect(page("terminos")).toMatch(/Aceptar estos términos no autoriza a usarlos para evaluar o\s+mejorar Adaptaula ni para entrenar modelos/);
    expect(page("privacidad")).toMatch(/Aceptar estas condiciones o subir\s+un fichero no lo autoriza/);
  });
});
