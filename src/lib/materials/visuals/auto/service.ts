import "server-only";
import { fingerprint } from "@/lib/adaptation/fingerprint";
import type { AIRunRecord } from "@/lib/ai/types";
import type { VisualResolution } from "@/lib/render/visual-assets";
import type { AnalysisVisual, MaterialAnalysis } from "@/lib/schemas/material-analysis";
import type { VisualSpec } from "@/lib/visuals/spec";
import { RasterError, encodePng, toPdfRect, type PageBox } from "../raster";
import { loadSource, produceVisualAsset, type LocatorRow, type VisualDeps } from "../service";
import { SPEC_EXTRACTOR_VERSION, extractSpec } from "./extract";
import { locateVisuals, type Evidence, type Located, type VisualShape, type VisualTarget } from "./locate";
import type { PageModel } from "./page-model";
import { readPage } from "./read";
import type { VisionLocator } from "./vision";

/**
 * «Hacer magia» with the original's figures, without a person drawing rectangles:
 *
 *   claim the run of (material, analysis, original, engine) → per page: read geometry → locate deterministically → only if
 *   something is left, ONE vision call for that page (a hypothesis) → validate again → save an `auto` locator (never over an
 *   active one) → produce its crop with the SAME recipe as a person's → for a simple mathematical figure, extract and verify its
 *   VisualSpec → record per visual the choice (A/B/C/D), its confidence and its signals, without content.
 *
 * Idempotent: a key is run once (a concurrent or repeated call does nothing and costs nothing); a later download of the PDF
 * never re-analyses anything. Never consumes an adaptation unit. A failure here never fails a generation: the sheet then waits
 * for the essential visuals it lacks, honestly, as before.
 */

export const AUTO_ENGINE_VERSION = "auto_visuals@v1";
export const LOCATE_DPI = 100;
/** Pages of one material that may get a vision call (each call is one page): the cost is bounded per material version. */
export const MAX_VISION_PAGES = 3;

export interface VisualOutcome {
  choice: VisualResolution;
  reason: string;
  confidence: number | null;
  method: "human" | "auto" | null;
  spec: { kind: VisualSpec["kind"]; sha256: string } | null;
  spec_reason?: string;
  signals?: Omit<Evidence, "reason">;
}

export interface AutoRunResult {
  engine: string;
  visuals: Record<string, VisualOutcome>;
  vision_pages: number;
  reason?: string;
}

export type AutoRunSummary = { status: "nothing_to_locate" } | { status: "cached" | "busy"; result: AutoRunResult | null } | { status: "completed"; result: AutoRunResult } | { status: "failed"; reason: string };

export interface AutoRunDeps {
  admin: VisualDeps["admin"];
  runs: {
    claim(key: { workspaceId: string; materialId: string; analysisFingerprint: string; sourceSha256: string; engine: string }): Promise<{ id: string; claimed: boolean; status: "running" | "completed" | "failed"; result: unknown }>;
    complete(id: string, status: "completed" | "failed", result: AutoRunResult, visionCalls: number): Promise<void>;
  };
  specs: {
    exists(locatorId: string, extractor: string): Promise<boolean>;
    insert(row: { workspace_id: string; material_id: string; locator_id: string; visual_id: string; spec_version: 1; extractor_version: string; kind: VisualSpec["kind"]; spec: VisualSpec; spec_sha256: string; checks: Record<string, number | boolean> }): Promise<void>;
  };
  /** Absent → geometry only (no AI configured, or tests). */
  vision?: VisionLocator | null;
  recordAiRun?(run: AIRunRecord, ids: { workspaceId: string; materialId: string; adaptationId: string | null }): Promise<void>;
}

export interface AutoRunInput {
  workspaceId: string;
  materialId: string;
  analysis: MaterialAnalysis;
  analysisFingerprint: string;
  sourceSha256: string | null;
  adaptationId?: string | null;
}

const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/** What kind of figure the analysis says it is, from its kind and its own words (never from the task). */
export function shapeOf(v: Pick<AnalysisVisual, "kind" | "title" | "description" | "text">): VisualShape {
  if (v.kind === "number_line") return "number_line";
  const words = normalize(`${v.title ?? ""} ${v.description} ${v.text ?? ""}`);
  if (/\brecta (numerica|numerada)\b/.test(words)) return "number_line";
  if (/\b(barra|tira)\b/.test(words) || (/\brectangulo\b/.test(words) && /\bpartes\b/.test(words))) return "bar";
  return "figure";
}

/**
 * The visuals the automatic locator looks for: the ones the sheet needs or that inform (never a decoration presented as a
 * support), and only those drawn as an image (a table or a chart is rebuilt from its data, it is not cropped).
 */
export function autoTargets(analysis: MaterialAnalysis): Array<VisualTarget & { page: number; visual: AnalysisVisual }> {
  return analysis.visuals
    .filter((v) => (v.role === "required" || v.role === "informative") && v.kind !== "decorative" && !(v.table && v.table.rows.length > 0) && !v.chart)
    .map((v) => ({ id: v.id, page: v.page, shape: shapeOf(v), activityIds: v.activity_ids, visual: v }));
}

const signalsOf = (e: Evidence): Omit<Evidence, "reason"> => ({ shape: e.shape, signature: e.signature, placement: e.placement, unique: e.unique, clean: e.clean, anchor: e.anchor, vision: e.vision });

export async function prepareVisuals(deps: AutoRunDeps, input: AutoRunInput): Promise<AutoRunSummary> {
  const targets = autoTargets(input.analysis);
  if (targets.length === 0 || !input.sourceSha256) return { status: "nothing_to_locate" };
  const claim = await deps.runs.claim({ workspaceId: input.workspaceId, materialId: input.materialId, analysisFingerprint: input.analysisFingerprint, sourceSha256: input.sourceSha256, engine: AUTO_ENGINE_VERSION });
  if (!claim.claimed) return { status: claim.status === "running" ? "busy" : "cached", result: (claim.result as AutoRunResult | null) ?? null };

  let visionCalls = 0;
  const result: AutoRunResult = { engine: AUTO_ENGINE_VERSION, visuals: {}, vision_pages: 0 };
  try {
    const source = await loadSource(deps, input.materialId, input.sourceSha256);
    if (!source) {
      await deps.runs.complete(claim.id, "failed", { ...result, reason: "source_missing" }, 0);
      return { status: "failed", reason: "source_missing" };
    }
    const hiRes = new Map<number, Promise<PageModel>>();
    const pageAt200 = (page: number) => {
      if (!hiRes.has(page)) hiRes.set(page, readPage(source.bytes, source.mime, page, 200).then((r) => r.model));
      return hiRes.get(page)!;
    };
    const shapes = new Map(targets.map((t) => [t.id, t.shape]));

    const finish = async (row: LocatorRow, located?: Located): Promise<VisualOutcome> => {
      if (row.method === "human") return { choice: "A", reason: "kept_human", confidence: null, method: "human", spec: null };
      const base = { confidence: typeof row.confidence === "number" ? row.confidence : (located?.confidence ?? null), method: "auto" as const, ...(located ? { signals: signalsOf(located.evidence) } : {}) };
      const produced = await produceVisualAsset(deps, row.id, source);
      if (!produced.ok) return { ...base, choice: "D", reason: produced.failure, spec: null };
      const shape = shapes.get(row.visual_id) ?? "figure";
      if (shape === "figure") return { ...base, choice: "B", reason: located ? "accepted" : "kept_auto", spec: null };
      const extracted = extractSpec(await pageAt200(row.page), { x: row.x, y: row.y, w: row.w, h: row.h }, shape);
      if (!extracted.ok) return { ...base, choice: "B", reason: located ? "accepted" : "kept_auto", spec: null, spec_reason: extracted.reason };
      const sha256 = fingerprint(extracted.spec);
      if (!(await deps.specs.exists(row.id, SPEC_EXTRACTOR_VERSION))) {
        await deps.specs.insert({ workspace_id: row.workspace_id, material_id: row.material_id, locator_id: row.id, visual_id: row.visual_id, spec_version: 1, extractor_version: SPEC_EXTRACTOR_VERSION, kind: extracted.spec.kind, spec: extracted.spec, spec_sha256: sha256, checks: extracted.checks });
      }
      return { ...base, choice: "C", reason: located ? "accepted" : "kept_auto", spec: { kind: extracted.spec.kind, sha256 } };
    };

    for (const page of [...new Set(targets.map((t) => t.page))].sort((a, b) => a - b)) {
      const pending: typeof targets = [];
      for (const target of targets.filter((t) => t.page === page)) {
        // A visual that already has an active locator (a person's, or an earlier automatic one) keeps it.
        const active = await deps.admin.activeLocator(input.materialId, input.analysisFingerprint, target.id);
        if (active && active.source_sha256 === input.sourceSha256) result.visuals[target.id] = await finish(active);
        else pending.push(target);
      }
      if (pending.length === 0) continue;

      let read: Awaited<ReturnType<typeof readPage>>;
      try {
        read = await readPage(source.bytes, source.mime, page, LOCATE_DPI);
      } catch (error) {
        const reason = error instanceof RasterError ? error.code : "extraction_failed";
        for (const t of pending) result.visuals[t.id] = { choice: "D", reason, confidence: null, method: null, spec: null };
        continue;
      }
      const activities = input.analysis.activities.filter((a) => a.page === page).map((a) => ({ id: a.id, label: a.label, instruction: a.instruction }));
      let located = locateVisuals(read.model, pending, activities);
      const unresolved = located.filter((l) => !l.accepted);
      if (unresolved.length > 0 && deps.vision && visionCalls < MAX_VISION_PAGES) {
        visionCalls += 1;
        const figures = unresolved.map((l) => {
          const t = pending.find((p) => p.id === l.visualId)!;
          const activity = input.analysis.activities.find((a) => a.id === t.activityIds[0]);
          return { id: t.id, kind: t.visual.kind, description: (t.visual.title ? `${t.visual.title}. ` : "") + t.visual.description, activity: activity ? `${activity.label ? `${activity.label}. ` : ""}${activity.instruction.slice(0, 160)}` : null };
        });
        const { hypotheses, run } = await deps.vision.locate({ pagePng: await encodePng(read.raster), figures });
        await deps.recordAiRun?.(run, { workspaceId: input.workspaceId, materialId: input.materialId, adaptationId: input.adaptationId ?? null });
        // The second reading adds agreement for the unresolved ones; the accepted ones score exactly as before.
        if (hypotheses.size > 0) located = locateVisuals(read.model, pending, activities, hypotheses);
      }
      for (const l of located) {
        if (!l.accepted || !l.bounds) {
          result.visuals[l.visualId] = { choice: "D", reason: l.evidence.reason, confidence: l.confidence, method: null, spec: null, signals: signalsOf(l.evidence) };
          continue;
        }
        const evidence = { engine: AUTO_ENGINE_VERSION, ...signalsOf(l.evidence), page_dpi: LOCATE_DPI, pdf_rect: toPdfRect(l.bounds, read.box) };
        const created = await deps.admin.createLocator({ workspaceId: input.workspaceId, materialId: input.materialId, analysisFingerprint: input.analysisFingerprint, visualId: l.visualId, sourceSha256: input.sourceSha256, page, bounds: l.bounds, pageBox: read.box as PageBox, userId: null, method: "auto", confidence: l.confidence, evidence });
        const row = await deps.admin.locator(created.id);
        result.visuals[l.visualId] = row ? await finish(row, created.created === false ? undefined : l) : { choice: "D", reason: "geometry_missing", confidence: l.confidence, method: null, spec: null };
      }
    }
    result.vision_pages = visionCalls;
    await deps.runs.complete(claim.id, "completed", result, visionCalls);
    return { status: "completed", result };
  } catch (error) {
    const reason = error instanceof RasterError ? error.code : error instanceof Error ? error.name : "unknown";
    await deps.runs.complete(claim.id, "failed", { ...result, vision_pages: visionCalls, reason }, visionCalls).catch(() => undefined);
    return { status: "failed", reason };
  }
}
