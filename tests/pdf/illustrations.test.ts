import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { applyVisualResolution, type VisualResolutionPlan } from "@/lib/adaptation/visual-policy";
import { MockImageProvider } from "@/lib/ai/providers/mock-images";
import { resolveModel } from "@/lib/ai/registry";
import { generatedWidthMm } from "@/lib/render/generated";
import { buildRenderModel } from "@/lib/render/model";
import { assetRef } from "@/lib/render/print/pinned-assets";
import { cellCaseDocument } from "../support/cell-case";
import { printPdf } from "./harness";

/**
 * Case B printed by the production engine (Chromium, offline): the approved illustration of the cell, pinned by its sha-256, is
 * embedded in the PDF next to activity 1, with no network request and no script. The image bytes are the local mock drawing:
 * what is tested is the sheet, not a model. 0 model calls.
 */
describe("case B · the cell sheet with its generated illustration, printed", () => {
  it("the illustration is in the PDF, on the page of «Observa el esquema…», from the pinned bytes; nothing is fetched", async () => {
    const selection = resolveModel("IMAGE_QUALITY", { AI_MODEL_IMAGE_QUALITY: "mock:dibujo" });
    const image = (await new MockImageProvider().generateImage({ selection, prompt: "x", size: "1536x1024", quality: "medium", timeoutMs: 1000 })).image;
    const sha256 = createHash("sha256").update(image.data).digest("hex");
    const assetId = "11111111-2222-4333-8444-555555555555";
    const { document } = cellCaseDocument();
    const plan: VisualResolutionPlan = { policy_version: 2, needs: [{ key: "vis_1", origin: "original", essential: true, activityIds: ["act_1"], category: "generated_illustration", resolution: { action: "illustration", asset: { id: assetId, sha256, width: 1536, height: 1024 }, alt: "Esquema de una célula animal con tres partes señaladas con los números 1, 2 y 3." }, attempts: ["locate", "reconstruct", "generate", "illustrate"] }] };
    const sheet = applyVisualResolution(document, plan);
    const { model, validation } = buildRenderModel(sheet, { mode: "student", design: "claro", requiredVisuals: ["vis_1"], deferred: [], generated: { [assetId]: { src: assetRef({ assetId, sha256 }), widthMm: generatedWidthMm(1536, 1024) } } });
    expect(validation.status).not.toBe("not_renderable");
    const printed = await printPdf("illustrations-cell", model, [{ assetId, sha256, mime: "image/png", bytes: image.data }], 1);
    expect(printed.validation.issues).toEqual([]);
    expect(printed.result.blockedRequests).toEqual([]);
    expect(printed.print.html).not.toMatch(/<script|https?:\/\//);
    const page = printed.pages.findIndex((p) => p.text.includes("Observa el esquema"));
    expect(page).toBeGreaterThanOrEqual(0);
    // The drawing's ink is on that page (the outline and the nucleus of the cell), not on a page of its own.
    expect(printed.pages[page]!.png.byteLength).toBeGreaterThan(10_000);
    expect(printed.pages).toHaveLength(1);
  });
});
