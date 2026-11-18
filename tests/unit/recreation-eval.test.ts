import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveModel } from "@/lib/ai/registry";
import type { ImageProvider } from "@/lib/ai/types";
import { SpendRefused } from "@/lib/ai/spend";
import { createMemoryLedger, imageCeilingUsd, meteredImages, textMeter } from "../../evals/recreation/budget";
import { EVAL_HARD_CAP_USD, parseArgs, realRunBlockers, runEvaluation, selections, worstCaseUsd } from "../../evals/recreation/run-real";

/** The real evaluation is PREPARED, never run here: its locks, its money guard and a free dry run of the whole route. */
const IMAGE = resolveModel("IMAGE_QUALITY", { AI_MODEL_IMAGE_QUALITY: "openai:gpt-image-2" });
const TEXT = resolveModel("STANDARD", { AI_MODEL_STANDARD: "anthropic:claude-sonnet-5-5" });

describe("bloqueos de la ejecución real", () => {
  it("sin autorización expresa, sin límite válido, sin fecha de precios comprobados o sin claves: no se ejecuta, y dice por qué", () => {
    const none = realRunBlockers(parseArgs([]), {}, "2026-11-20");
    expect(none.join(" ")).toMatch(/autorización expresa/);
    expect(none.join(" ")).toMatch(/--max-usd/);
    expect(none.join(" ")).toMatch(/--prices-verified/);
    expect(none.join(" ")).toMatch(/ANTHROPIC_API_KEY/);
    expect(realRunBlockers(parseArgs(["--authorized", "--max-usd", "9", "--prices-verified", "2026-11-20"]), { RECREATION_EVAL_AUTHORIZED: "si", ANTHROPIC_API_KEY: "x", OPENAI_API_KEY: "y" }, "2026-11-20").join(" ")).toMatch(new RegExp(`no superar ${EVAL_HARD_CAP_USD}`));
    expect(realRunBlockers(parseArgs(["--authorized", "--max-usd", "2", "--prices-verified", "2026-12-31"]), { RECREATION_EVAL_AUTHORIZED: "si", ANTHROPIC_API_KEY: "x", OPENAI_API_KEY: "y" }, "2026-11-20").join(" ")).toMatch(/prices-verified/);
    // The flag alone is not enough: the environment must say so too.
    expect(realRunBlockers(parseArgs(["--authorized", "--max-usd", "2", "--prices-verified", "2026-11-20"]), { ANTHROPIC_API_KEY: "x", OPENAI_API_KEY: "y" }, "2026-11-20").join(" ")).toMatch(/autorización expresa/);
  });

  it("un intento real sin todos los bloqueos abiertos no gasta nada y no escribe resultados", async () => {
    const lines: string[] = [];
    const result = await runEvaluation(parseArgs(["--max-usd", "2"]), {}, (l) => lines.push(l));
    expect(result).toMatchObject({ status: "blocked", outDir: null, spentUsd: 0 });
    expect(lines.join("\n")).toMatch(/No se ejecuta la evaluación real/);
  });

  it("los modelos se toman de la configuración por alias y deben tener precio; uno sin precio bloquea", () => {
    expect(selections({ AI_MODEL_STANDARD: "anthropic:claude-sonnet-5-5", AI_MODEL_IMAGE_QUALITY: "openai:gpt-image-2" }).problems).toEqual([]);
    expect(selections({ AI_MODEL_STANDARD: "anthropic:claude-desconocido", AI_MODEL_IMAGE_QUALITY: "openai:imagen-sin-precio" }).problems).toHaveLength(2);
  });

  it("el techo previo se calcula con los precios de la tabla: es un techo, no una promesa", () => {
    const { total, lines } = worstCaseUsd(TEXT, IMAGE, 7);
    expect(total).toBeGreaterThan(0.5);
    expect(lines.at(-1)).toMatch(/techo total/);
  });
});

describe("guarda de gasto: antes de cada llamada, también reparaciones y reintentos", () => {
  const fakeImages = (calls: { n: number }, fail = false): ImageProvider => ({
    name: "openai",
    async generateImage(request) {
      calls.n++;
      if (fail) throw new Error("boom");
      return { image: { data: new Uint8Array([1]), mediaType: "image/png" }, usage: { textInputTokens: 200, imageInputTokens: 0, outputTokens: 1500 }, provider: "openai", model: request.selection.model, latencyMs: 1 };
    },
  });
  const request = { selection: IMAGE, prompt: "x", size: "1536x1024" as const, quality: "medium" as const, timeoutMs: 1000 };

  it("una imagen que no cabe en lo que queda no se envía", async () => {
    const ceiling = imageCeilingUsd(IMAGE.model, "1536x1024", "medium")!;
    const ledger = createMemoryLedger(ceiling * 1.8);
    const calls = { n: 0 };
    const images = meteredImages(fakeImages(calls), ledger);
    await images.generateImage(request); // fits; settles at its real usage (lower than the ceiling)
    const spentAfterOne = ledger.committedUsd();
    expect(spentAfterOne).toBeLessThan(ceiling);
    await images.generateImage(request); // the second still fits because the first settled low
    await expect(images.generateImage(request)).rejects.toBeInstanceOf(SpendRefused);
    expect(calls.n).toBe(2);
    expect(ledger.refusals()).toBe(1);
  });

  it("una llamada que falla cuenta con toda su reserva (conservador)", async () => {
    const ceiling = imageCeilingUsd(IMAGE.model, "1536x1024", "medium")!;
    const ledger = createMemoryLedger(1);
    await expect(meteredImages(fakeImages({ n: 0 }, true), ledger).generateImage(request)).rejects.toThrow("boom");
    expect(ledger.committedUsd()).toBeCloseTo(ceiling, 6);
  });

  it("un modelo de imagen sin precio no se envía nunca", async () => {
    const calls = { n: 0 };
    await expect(meteredImages(fakeImages(calls), createMemoryLedger(3)).generateImage({ ...request, selection: { ...IMAGE, model: "sin-precio" } })).rejects.toBeInstanceOf(SpendRefused);
    expect(calls.n).toBe(0);
  });

  it("el texto usa el medidor del producto sobre el mismo libro: sin sitio, no se admite", async () => {
    const ledger = createMemoryLedger(0.001);
    const meter = textMeter(ledger);
    await expect(meter.admit({ provider: "anthropic", model: TEXT.model, maxOutputTokens: 8000, count: async () => 5000 })).rejects.toBeInstanceOf(SpendRefused);
    expect(ledger.refusals()).toBe(1);
  });
});

describe("ensayo sin coste del recorrido completo", () => {
  it("produce la ficha, los materiales, las imágenes, el registro de llamadas y el informe, con 0 $", async () => {
    const out = mkdtempSync(path.join(tmpdir(), "recreacion-ensayo-"));
    const result = await runEvaluation(parseArgs(["--dry-run", "--skip-pdf", "--out", out]), {}, () => undefined);
    expect(result).toMatchObject({ status: "created", spentUsd: 0 });
    for (const file of ["line.json", "version.json", "internal.json", "calls.json", "report.md"]) expect(existsSync(path.join(out, file))).toBe(true);
    const version = readFileSync(path.join(out, "version.json"), "utf8");
    expect(version).not.toMatch(/30 − 18|Criterios/);
    expect(readFileSync(path.join(out, "internal.json"), "utf8")).toContain("30 − 18 = 12");
    expect(readFileSync(path.join(out, "report.md"), "utf8")).toMatch(/ENSAYO \(simulado, 0 \$\)/);
  });
});
