import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { fingerprint } from "@/lib/adaptation/fingerprint";
import { applyVisualResolution } from "@/lib/adaptation/visual-policy";
import { resolveMagicVisuals } from "@/lib/materials/visuals/auto/policy";
import { corroboratesTable } from "@/lib/materials/visuals/auto/table";
import { readPage } from "@/lib/materials/visuals/auto/read";
import { buildRenderModel } from "@/lib/render/model";
import { TABLE_CHOICE_DRAFT, TABLE_DATA, TABLE_RUN, tableChoiceCase, tableChoicePdf } from "../support/table-choice-case";
import { printPdf } from "./harness";

describe("tabla de selección única en CLARO y PDF", () => {
  it("imprime tabla completa y pregunta juntas, tres círculos vacíos y ninguna clave", async () => {
    const s = tableChoiceCase(true);
    const original = await tableChoicePdf();
    const { model: page } = await readPage(original, "application/pdf", 1, 100);
    expect(corroboratesTable(page, TABLE_DATA)).toBe(true);
    const resolution = await resolveMagicVisuals({
      readyOriginals: async () => new Set(),
      corroborateTable: async () => ({ method: "pdf_grid_text_v1", sourceSha256: createHash("sha256").update(original).digest("hex"), page: 1, tableSha256: fingerprint(TABLE_DATA) }),
      assistants: { substitute: async () => ({ draft: TABLE_CHOICE_DRAFT, run: TABLE_RUN }), support: async () => ({ draft: null, run: TABLE_RUN }), rewrite: async () => ({ draft: null, run: TABLE_RUN }) },
    }, { ...s, requiredVisuals: ["vis_1"], stage: "primaria" });
    expect(resolution.needs[0]!.resolution.action).toBe("substitute");
    const document = applyVisualResolution(s.document, resolution);
    document.teacher_notes = "NOTA PRIVADA DEL DOCENTE";
    document.answer_key[0]!.value = "CLAVE PRIVADA B";
    const { model, validation } = buildRenderModel(document, { mode: "student", design: "claro", requiredVisuals: ["vis_1"], deferred: [] });
    expect(validation.status).not.toBe("not_renderable");
    const printed = await printPdf("table-choice-substitution", model);
    expect(printed.validation.issues).toEqual([]);
    expect(printed.pages).toHaveLength(1);
    const extracted = printed.pages[0]!.text.replace(/\s*\uE082/g, ")");
    for (const text of [...TABLE_DATA.headers, ...TABLE_DATA.rows.flat(), ...TABLE_CHOICE_DRAFT.choice.options.map((o) => o.text)]) expect(extracted).toContain(text);
    expect(extracted).toContain("Elige una opción");
    expect(printed.print.html.match(/class="ms-box ms-round"/g)).toHaveLength(3);
    expect(printed.print.html).toContain("<table");
    expect(printed.print.html).toContain("<th");
    expect(printed.print.html).not.toMatch(/CLAVE PRIVADA|NOTA PRIVADA|correct_option|checked|aria-checked="true"/);
    expect(extracted).not.toMatch(/CLAVE PRIVADA|NOTA PRIVADA|correcta|solución/i);
    expect(printed.result.blockedRequests).toEqual([]);
  });
});
