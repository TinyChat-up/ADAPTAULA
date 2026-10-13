import { describe, expect, it } from "vitest";
import { applyVisualResolution } from "@/lib/adaptation/visual-policy";
import { resolveMagicVisuals } from "@/lib/materials/visuals/auto/policy";
import type { VisualAssistants } from "@/lib/materials/visuals/auto/assistants";
import { buildRenderModel } from "@/lib/render/model";
import { SINGLE_CHOICE_DRAFT, singleChoiceCase } from "../support/single-choice-case";
import { printPdf } from "./harness";

describe("selección única en CLARO y PDF", () => {
  it("imprime pregunta, barra y tres opciones con círculos vacíos en la misma página, sin clave ni notas docentes", async () => {
    const s = singleChoiceCase();
    const run = { purpose: "visual_rewrite" as const, attempt: 1, alias: "STANDARD" as const, provider: "mock" as const, model: "default", effort: "low" as const, promptKey: "visual_substitute", promptVersion: 3, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, cacheCreationInputTokens: 0, estimatedCostUsd: 0, latencyMs: 0, status: "success" as const, errorCode: null };
    const assistants: VisualAssistants = { support: async () => ({ draft: null, run }), rewrite: async () => ({ draft: null, run }), substitute: async () => ({ draft: SINGLE_CHOICE_DRAFT, run }) };
    const resolution = await resolveMagicVisuals({ readyOriginals: async () => new Set(), assistants }, { analysis: s.analysis, document: s.document, requiredVisuals: ["vis_1"], stage: "primaria" });
    expect(resolution.needs[0]!.resolution.action).toBe("substitute");
    const document = applyVisualResolution(s.document, resolution);
    document.teacher_notes = "NOTA PRIVADA DEL DOCENTE";
    document.answer_key[0]!.value = "CLAVE PRIVADA B";
    const { model, validation } = buildRenderModel(document, { mode: "student", design: "claro", requiredVisuals: ["vis_1"], deferred: [] });
    expect(validation.status).not.toBe("not_renderable");
    const printed = await printPdf("single-choice-substitution", model);
    expect(printed.validation.issues).toEqual([]);
    expect(printed.pages).toHaveLength(1);
    expect(printed.pages[0]!.text).toContain("Elige una opción");
    // Inter's alternate parenthesis is mapped to U+E082 by Chromium/pdf.js; its visible glyph is still ')'.
    const extracted = printed.pages[0]!.text.replace(/\s*\uE082/g, ")");
    for (const option of SINGLE_CHOICE_DRAFT.choice.options) {
      expect(printed.print.html).toContain(option.text);
      expect(extracted).toContain(option.text);
    }
    expect(printed.print.html.match(/class="ms-box ms-round"/g)).toHaveLength(3);
    expect(printed.print.html).toContain("<svg");
    expect(printed.print.html).not.toMatch(/CLAVE PRIVADA|NOTA PRIVADA|correct_option|checked|aria-checked="true"/);
    expect(printed.pages[0]!.text).not.toMatch(/CLAVE PRIVADA|NOTA PRIVADA|correcta|solución/i);
    expect(printed.result.blockedRequests).toEqual([]);
  });
});
