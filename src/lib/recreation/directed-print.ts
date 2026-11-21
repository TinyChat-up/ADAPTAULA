import "server-only";
import { fingerprint } from "@/lib/adaptation/fingerprint";
import { sheetModel } from "@/lib/render/sheet-model";
import type { PdfEngine } from "@/lib/render/print/engine";
import { renderPrintHtml } from "@/lib/render/print/html";
import { modelAssetRefs } from "@/lib/render/print/pinned-assets";
import { validatePdf, type PdfValidation } from "@/lib/render/print/validation";
import type { DirectedPilotResult } from "./directed-pilot";

type Draft = Extract<DirectedPilotResult, { status: "review_pending" }>;

export async function printDirectedRecreation(draft: Draft, engine: PdfEngine): Promise<
  | { status: "blocked"; issues: string[] }
  | { status: "review_pending"; pdf: Uint8Array; validation: PdfValidation; checks: Omit<Draft["checks"], "pdf"> & { pdf: "passed" } }
> {
  const { provenance } = draft;
  if (fingerprint(draft.direction) !== provenance.direction || fingerprint(draft.document) !== provenance.document ||
      fingerprint(draft.assets) !== provenance.assets || fingerprint(draft.trace) !== provenance.trace) {
    return { status: "blocked", issues: ["stale_fabrication"] };
  }
  const requiredVisuals = [...new Set(draft.direction.activities.flatMap((row) => row.obligations
    .filter(({ kind, value }) => kind === "resource" && value?.startsWith("vis_")).map(({ value }) => value!)))];
  const { model, validation: render } = sheetModel({ document: draft.document, assets: draft.assets, requiredVisuals, deferred: [], subjectName: null }, "student");
  if (render.status === "not_renderable") return { status: "blocked", issues: render.issues.map(({ code }) => code) };
  try {
    const html = await renderPrintHtml(model, draft.pins);
    const result = await engine.render(html.html, { fontFamily: html.fontFamily, fontWeights: html.fontWeights });
    if (result.blockedRequests.length > 0 || result.readiness.brokenImages > 0) return { status: "blocked", issues: ["print_resource_unavailable"] };
    const validation = await validatePdf(result.pdf, { fontPrefix: "Inter", minImages: modelAssetRefs(model).length, minPages: model.pages.length });
    if (!validation.ok) return { status: "blocked", issues: validation.issues };
    return { status: "review_pending", pdf: result.pdf, validation, checks: { ...draft.checks, pdf: "passed" } };
  } catch {
    return { status: "blocked", issues: ["print_failed"] };
  }
}
