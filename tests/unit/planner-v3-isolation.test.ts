import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MethodConfirmation } from "@/components/adaptation/method-confirmation";
import { MethodNotes } from "@/components/adaptation/method-notes";
import { OpenAIImageProvider } from "@/lib/ai/providers/openai-images";
import { createImageProvider } from "@/lib/ai/router";
import type { ModelSelection } from "@/lib/ai/types";

/**
 * ADR-047 isolation: V2.2's metering reaches ONLY the authorised workspace, the image providers of every other workspace are
 * exactly what they were, and what the teacher must see (the question, the advisory notes) really renders.
 */
const PILOT = "11111111-1111-4111-8111-111111111111";
const env = { AI_PILOT_BUDGET_USD: 10, AI_PLANNER_V3_PILOT_WORKSPACE_ID: PILOT, AI_PILOT_CAMPAIGN: "piloto-v22-1" } as Record<string, unknown>;
vi.mock("server-only", () => ({}));
vi.mock("@/lib/config/env.server", () => ({ serverEnv: () => env }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/logger", () => ({ logger: { warn: () => undefined } }));

describe("el medidor de gasto solo alcanza al workspace autorizado", () => {
  it("otro workspace, ninguno o sin presupuesto: sin medidor; el autorizado, con él", async () => {
    const { pilotSpendMeter } = await import("@/lib/ai/spend-ledger");
    expect(pilotSpendMeter("22222222-2222-4222-8222-222222222222")).toBeUndefined();
    expect(pilotSpendMeter(null)).toBeUndefined();
    expect(pilotSpendMeter(undefined)).toBeUndefined();
    expect(pilotSpendMeter(PILOT)).toBeDefined();
    const saved = env.AI_PILOT_BUDGET_USD;
    env.AI_PILOT_BUDGET_USD = undefined;
    expect(pilotSpendMeter(PILOT)).toBeUndefined();
    env.AI_PILOT_BUDGET_USD = saved;
    const savedWorkspace = env.AI_PLANNER_V3_PILOT_WORKSPACE_ID;
    env.AI_PLANNER_V3_PILOT_WORKSPACE_ID = undefined;
    expect(pilotSpendMeter(PILOT)).toBeUndefined();
    env.AI_PLANNER_V3_PILOT_WORKSPACE_ID = savedWorkspace;
  });

  it("las imágenes de OpenAI de los demás usuarios se crean igual que antes; solo se rechazan donde hay medidor", async () => {
    const { pilotSpendMeter } = await import("@/lib/ai/spend-ledger");
    const image: ModelSelection = { alias: "IMAGE_QUALITY", provider: "openai", model: "gpt-image-2", effort: "medium" };
    const other = pilotSpendMeter("22222222-2222-4222-8222-222222222222");
    expect(createImageProvider(image, { openaiApiKey: "test", spendMeter: other })).toBeInstanceOf(OpenAIImageProvider);
    expect(createImageProvider(image, { openaiApiKey: "test" })).toBeInstanceOf(OpenAIImageProvider);
    expect(() => createImageProvider(image, { openaiApiKey: "test", spendMeter: pilotSpendMeter(PILOT) })).toThrow(/spend is metered/);
  });
});

describe("lo que ve el docente", () => {
  it("la pregunta de una decisión retenida se muestra con Sí / No / No lo sé", () => {
    const markup = renderToStaticMarkup(createElement(MethodConfirmation, { method: { withheld: true, conditional: true, question: "¿Se evalúa la escritura?", reasons: [] }, value: undefined, onChange: () => undefined, disabled: false }));
    expect(markup).toContain("¿Se evalúa la escritura?");
    for (const label of ["Sí", "No", "No lo sé"]) expect(markup).toContain(`>${label}<`);
    expect(markup).toContain("Solo «Sí» aplica el cambio");
  });

  it("los avisos de la ficha generada se renderizan con su actividad, y sin avisos no hay bloque", () => {
    const notes = [{ check: "answer_space_homogeneity" as const, label: "Espacios de respuesta distintos entre actividades comparables", detail: "x", targets: ["act_1", "act_3"] }];
    const markup = renderToStaticMarkup(createElement(MethodNotes, { notes, targets: { act_1: "Actividad 1", act_3: "Actividad 3" } }));
    expect(markup).toContain("Conviene que compruebes estos puntos");
    expect(markup).toContain("Espacios de respuesta distintos entre actividades comparables");
    expect(markup).toContain("Actividad 1");
    expect(markup).toContain("no bloquean la ficha");
    expect(renderToStaticMarkup(createElement(MethodNotes, { notes: [], targets: {} }))).toBe("");
  });
});
