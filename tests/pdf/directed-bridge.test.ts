import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { directedSheet } from "@/lib/adaptation/directed/bridge";
import { ADAPTATION, WORKSPACE, appAdaptation } from "../support/directed-bridge";
import { analyzePdf } from "./analyze";
import { engine, OUT_DIR } from "./harness";

describe("puente aplicación → director → PDF", () => {
  it("con datos guardados como los de la aplicación imprime la ficha del director sin ningún modelo y la deja pendiente de revisión", async () => {
    const { deps } = await appAdaptation(engine);
    const result = await directedSheet(deps, WORKSPACE, ADAPTATION);
    if (result.status === "blocked") throw new Error(JSON.stringify(result.issues));
    expect(result.checks).toMatchObject({ links: "passed", fabrication: "passed", pdf: "passed", semantic: "pending" });
    const pages = await analyzePdf(result.pdf);
    const dir = path.join(OUT_DIR, "directed-bridge");
    mkdirSync(dir, { recursive: true });
    for (const page of pages) writeFileSync(path.join(dir, `page-${page.number}.png`), page.png);
    const text = pages.map(({ body }) => body).join(" ");
    for (const token of ["Justifica el procedimiento", "con dos argumentos", "Hay 150 plazas", "Visitas a la biblioteca"]) expect(text).toContain(token);
    expect(text).not.toMatch(/Solución|Clave de respuestas|Orientación/iu);
    expect(result.trace.map(({ original_id }) => original_id)).toEqual(["act_1", "act_2", "act_3", "act_4", "act_5"]);
  });
});
