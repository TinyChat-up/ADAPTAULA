import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { fingerprint } from "@/lib/adaptation/fingerprint";
import { resolveMagicVisuals } from "@/lib/materials/visuals/auto/policy";
import { AUTO_ENGINE_VERSION, prepareVisuals, type AutoRunInput } from "@/lib/materials/visuals/auto/service";
import { resolveVisuals } from "@/lib/materials/visuals/service";
import { normalizeAnalysis } from "@/lib/analysis/normalize";
import { MaterialAnalysisDraftSchema, type MaterialAnalysis } from "@/lib/schemas/material-analysis";
import { buildDocument, sequentialIds } from "@/lib/adaptation/document";
import { normalizePlan } from "@/lib/adaptation/plan";
import { buildAdaptationContext } from "@/lib/adaptation/context";
import { EXECUTIVE_EXPERIMENT_PROFILE } from "../../evals/adaptation/planner-lib";
import { ARROWS_INSTRUCTION, LETTERS_INSTRUCTION, POLYGON_INSTRUCTION, SECOND_INSTRUCTION, VISUALS, arrowsSheet, lettersSheet, polygonSheet } from "../support/marked-figures";
import { as, createTestDb, createUser } from "./harness";
import { seedMaterial, type User } from "./orchestration-harness";
import { attachSource, autoHarness, visualHarness } from "./visual-harness";

/**
 * Original figures located by their marks (auto_visuals@v6) over the real migrations (PGlite): the locator, its crop with the
 * person's recipe, the three verifications, the original's identity over time, RLS, and «Hacer magia» using the original WITHOUT
 * an illustration. Synthetic original sheets (tests/support/marked-figures.ts): not the real ones. 0 model calls.
 */

let db: PGlite;
beforeAll(async () => {
  db = await createTestDb();
}, 120_000);

type Kind = "polygon" | "letters" | "arrows";
const SHEETS: Record<Kind, { pdf: () => Promise<Uint8Array>; instruction: string; context?: string }> = {
  polygon: { pdf: () => polygonSheet(), instruction: POLYGON_INSTRUCTION },
  letters: { pdf: () => lettersSheet(), instruction: LETTERS_INSTRUCTION, context: "A:\nB:\nC:\nD:" },
  arrows: { pdf: () => arrowsSheet(), instruction: ARROWS_INSTRUCTION, context: "Flecha 1: ______ Flecha 2: ______\nFlecha 3: ______ Flecha 4: ______" },
};

function analysisOf(kind: Kind): MaterialAnalysis {
  const s = SHEETS[kind];
  const v = VISUALS[kind];
  const draft = MaterialAnalysisDraftSchema.parse({
    identification: { title: "Ficha de prueba", language: "es", stage: "primaria", grade: "4-primaria", subject: "Ciencias", topic: "Figuras", confidence: { stage: 0.9, grade: 0.9, subject: 0.9, topic: 0.9 } },
    intent: { purpose: "Interpretar una figura.", objectives: [{ id: "o1", text: "Interpretar una figura" }], knowledge: [], prerequisites: [], difficulty: "medium" },
    sections: [], texts: [],
    visuals: [{ id: "v1", kind: "diagram", page: 1, role: "required", ...(v.title ? { title: v.title } : {}), description: v.description }],
    admin: [{ type: "student_name", label: "Nombre", page: 1 }],
    activities: [
      { id: "a1", label: "1", page: 1, type: "short_answer", instruction: s.instruction, ...(s.context ? { context: s.context } : {}), resources: ["v1"], objectives: ["o1"], response: "write_text", answer_area: "lines", answer_lines: 2, difficulty: "medium", confidence: 0.9 },
      { id: "a2", label: "2", page: 1, type: "open_question", instruction: SECOND_INSTRUCTION, objectives: ["o1"], response: "write_text", answer_area: "lines", answer_lines: 2, difficulty: "medium", confidence: 0.9 },
    ],
    protected: [{ type: "necessary_visual", importance: "essential", value: "La figura con sus marcas", activities: ["a1"], resources: ["v1"] }],
    uncertainties: [], quality: { confidence: 0.9, readability: "good" },
  });
  return normalizeAnalysis(draft, { pageCount: 1 }).analysis;
}

let n = 0;
async function world(kind: Kind, bytes?: Uint8Array) {
  const user = await createUser(db, `marked-${++n}-${Math.random().toString(36).slice(2, 7)}@example.com`);
  const analysis = analysisOf(kind);
  const materialId = await seedMaterial(db, user, analysis);
  const visuals = visualHarness(db, user);
  const sourceSha256 = await attachSource(db, visuals, materialId, "application/pdf", bytes ?? (await SHEETS[kind].pdf()));
  const auto = autoHarness(db, visuals);
  const input: AutoRunInput = { workspaceId: user.workspaceId, materialId, analysis, analysisFingerprint: fingerprint(analysis), sourceSha256, adaptationId: null };
  const resolve = (sha = sourceSha256) => resolveVisuals(visuals.deps, { materialId, analysisFingerprint: input.analysisFingerprint, sourceSha256: sha, visualIds: ["vis_1"] });
  return { user, analysis, materialId, visuals, auto, input, resolve };
}
const q = <T>(sql: string, params: unknown[] = []) => db.query<T>(sql, params).then((r) => r.rows);

describe("las tres figuras se recuperan del original, sin dibujarlas", () => {
  for (const kind of ["polygon", "letters", "arrows"] as const) {
    it(`${kind}: localizador «auto» v6 con sus marcas, recorte con la receta de una persona, identidad y fidelidad verificadas, pedagogía NO`, async () => {
      const w = await world(kind);
      const summary = await prepareVisuals(w.auto.deps, w.input);
      expect(summary).toMatchObject({ status: "completed", result: { engine: AUTO_ENGINE_VERSION, vision_pages: 0, visuals: { vis_1: { choice: "B", method: "auto", verification: { identity: "verified", fidelity: "verified", pedagogy: "unverified" } } } } });
      const [locator] = await q<{ method: string; confidence: number; evidence: Record<string, unknown> }>("select method, confidence, evidence from public.material_visual_locators where material_id = $1", [w.materialId]);
      expect(locator).toMatchObject({ method: "auto", evidence: { engine: "auto_visuals@v6", signature: true, placement: true, clean: true, marks: { legible: true } } });
      expect(locator!.confidence).toBeGreaterThanOrEqual(0.75);
      // Signals, marks and coordinates only: no sentence of the material.
      expect(JSON.stringify(locator!.evidence)).not.toMatch(/Escribe|Deduce|planta|Vapor|Nubes/);
      const resolved = await w.resolve();
      expect(resolved.states.vis_1).toMatchObject({ status: "ready", resolution: "B", provenance: { method: "auto" } });
      const assets = await q<{ sha256: string; storage_path: string }>("select sha256, storage_path from public.material_visual_assets where material_id = $1", [w.materialId]);
      expect(assets).toHaveLength(1);
      // Private, workspace-scoped object named after its bytes: never a public URL.
      expect(assets[0]!.storage_path.startsWith(`${w.user.workspaceId}/${w.materialId}/`)).toBe(true);
      expect(assets[0]!.storage_path).toContain(assets[0]!.sha256);
    });
  }
});

describe("identidad del original a lo largo del tiempo", () => {
  it("original modificado después de guardar el localizador: el recurso de la versión anterior no se usa", async () => {
    const w = await world("letters");
    await prepareVisuals(w.auto.deps, w.input);
    expect((await w.resolve()).states.vis_1?.status).toBe("ready");
    const changed = await lettersSheet({ omit: "B" });
    const newSha = await attachSource(db, w.visuals, w.materialId, "application/pdf", changed);
    expect(newSha).not.toBe(w.input.sourceSha256);
    expect((await w.resolve(newSha)).states.vis_1?.status).not.toBe("ready");
    // And this engine does not accept the changed sheet (B is gone): no locator for the new version.
    const again = await prepareVisuals(w.auto.deps, { ...w.input, sourceSha256: newSha });
    expect(again).toMatchObject({ status: "completed", result: { visuals: { vis_1: { choice: "D", reason: "marks_incomplete" } } } });
  });

  it("recorte antiguo ya no verificable (su evidencia dice marcas ilegibles): no se usa", async () => {
    const w = await world("letters");
    await prepareVisuals(w.auto.deps, w.input);
    await db.query("alter table public.material_visual_locators disable trigger material_visual_locators_immutable");
    await db.query("update public.material_visual_locators set evidence = jsonb_set(evidence, '{marks,legible}', 'false') where material_id = $1", [w.materialId]);
    await db.query("alter table public.material_visual_locators enable trigger material_visual_locators_immutable");
    expect((await w.resolve()).states.vis_1?.status).not.toBe("ready");
  });
});

describe("aislamiento (RLS) y privacidad", () => {
  it("otro espacio de trabajo no lee el localizador ni el recurso; el navegador no crea localizadores automáticos", async () => {
    const w = await world("arrows");
    await prepareVisuals(w.auto.deps, w.input);
    const read = (u: User, table: string) => as(db, "authenticated", u.id, () => db.query(`select id from public.${table} where material_id = $1`, [w.materialId])).then((r) => r.rows.length);
    expect(await read(w.user, "material_visual_locators")).toBe(1);
    const other = await createUser(db, `marked-other-${Math.random().toString(36).slice(2, 7)}@example.com`);
    expect(await read(other, "material_visual_locators")).toBe(0);
    expect(await read(other, "material_visual_assets")).toBe(0);
    const box = JSON.stringify({ kind: "pdf", width_pt: 595.28, height_pt: 841.89, rotation: 0, view: [0, 0, 595.28, 841.89] });
    await expect(as(db, "authenticated", w.user.id, () => db.query("select public.create_visual_locator($1, $2, $3, 'vis_1', $4, 'auto', 1, 0.1, 0.1, 0.5, 0.3, $5, null, 0.9, '{}')", [w.user.workspaceId, w.materialId, w.input.analysisFingerprint, w.input.sourceSha256, box]))).rejects.toThrow();
  });
});

describe("«Hacer magia» usa el original recuperado y no pide una ilustración", () => {
  it("la necesidad visual queda resuelta con la figura original; el generador de imágenes no se llama", async () => {
    const w = await world("letters");
    const summary = await prepareVisuals(w.auto.deps, w.input);
    const accepted = summary.status === "completed" ? summary.result.visuals : {};
    const context = buildAdaptationContext({ profile: EXECUTIVE_EXPERIMENT_PROFILE, education: { stage: "primaria", grade: "4-primaria", subject: "ciencias-naturaleza" }, analysis: w.analysis, adaptationType: "accessibility", policy: 2 }).context;
    const document = buildDocument({ analysis: w.analysis, plan: normalizePlan({ decisions: [], summary: [] }, w.analysis, context), context, generated: null, newBlockId: sequentialIds("m") });
    const asked: string[] = [];
    const plan = await resolveMagicVisuals(
      {
        readyOriginals: async (ids) => {
          const resolved = await resolveVisuals(w.visuals.deps, { materialId: w.materialId, analysisFingerprint: w.input.analysisFingerprint, sourceSha256: w.input.sourceSha256, visualIds: ids });
          return new Set(ids.filter((id) => resolved.states[id]?.status === "ready" && ["B", "C"].includes(accepted[id]?.choice ?? "")));
        },
        corroborate: async () => null,
        illustrate: async (r) => (asked.push(r.needKey), { ok: false as const, reason: "image_failed" as const, detail: [] }),
      },
      { analysis: w.analysis, document, requiredVisuals: ["vis_1"], stage: "primaria" },
    );
    expect(plan.needs.find((n) => n.key === "vis_1")).toMatchObject({ category: "exact_original_visual", resolution: { action: "located" } });
    expect(asked).toEqual([]);
  });
});
