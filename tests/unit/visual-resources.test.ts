import { createCanvas } from "@napi-rs/canvas";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { VisualNeedsPanel } from "@/components/material/visual-needs-panel";
import { classifyDecisionExecution } from "@/lib/adaptation/execution";
import type { VisualNeed } from "@/lib/adaptation/presentation/visual-needs";
import { imageKind, normaliseTeacherImage } from "@/lib/adaptation/resources/image";
import { visualTreatment } from "@/lib/adaptation/visual-needs";
import { buildRenderModel } from "@/lib/render/model";
import type { Decision } from "@/lib/schemas/adaptation-plan";
import { MaterialDocumentSchema, type MaterialDocument } from "@/lib/schemas/material-document";
import { fractionsAnalysis } from "../../evals/adaptation/fixtures";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));

const analysis = fractionsAnalysis();
const context = { limits: { max_instruction_words: 40 }, presentation: { font_scale: 1, line_spacing: "normal", spacing: "normal", contrast: "normal", decoration: "standard", max_tasks_per_page: null, color_independent: true, text_alternatives_for_visuals: true } } as never;
const decision = (over: Partial<Decision>): Decision => ({ id: "dec_7", target: "act_4", action: "add_support", strategies: ["visual_support"], dimensions: [], intensity: "light", preserves: [], supports: [], flags: [], ...over }) as Decision;

describe("the five kinds of visual need, told apart without any image model", () => {
  it("1/2 · a visual of the original (located or not) is kept by the assembler: deterministic, never an AI image", () => {
    const d = decision({ target: "act_1", visual: { mode: "reuse_original", source_visual: "vis_1", purpose: "Figura junto a la actividad", essential: true } });
    expect(visualTreatment(d, analysis)).toEqual({ kind: "original", visualId: "vis_1", structured: false, requestedTransform: false });
    expect(classifyDecisionExecution(d, analysis, context).route).toBe("deterministic");
  });

  it("3 · a transformation of a visual is not pretended: the original is kept (rebuilt from data if it has them) and the report says so", () => {
    const d = decision({ target: "act_2", visual: { mode: "transform_original", source_visual: "vis_2", purpose: "Otra forma", essential: true } });
    expect(classifyDecisionExecution(d, analysis, context).reason).toMatch(/la transformación no se hace/);
  });

  it("4 · an essential visual the original does not have: its place is reserved for the teacher", () => {
    const d = decision({ visual: { mode: "new_representation", source_visual: null, purpose: "Recta numérica", essential: true } });
    expect(visualTreatment(d, analysis)).toEqual({ kind: "requested", essential: true, purpose: "Recta numérica", style: "diagram" });
    expect(classifyDecisionExecution(d, analysis, context).route).toBe("deterministic");
  });

  it("5 · an optional support (or a plain visual cue) never becomes essential", () => {
    expect(visualTreatment(decision({ visual: { mode: "optional_support", source_visual: null, purpose: "Pictograma", essential: true } }), analysis)).toMatchObject({ kind: "requested", essential: false, style: "icon" });
    expect(visualTreatment(decision({ supports: [{ kind: "visual_cue", uses_task_data: false }] }), analysis)).toMatchObject({ kind: "requested", essential: false });
  });

  it("a rewrite with a visual request still needs its rewrite: no silent partial execution", () => {
    const d = decision({ action: "rephrase", target: "act_3", visual: { mode: "new_representation", source_visual: null, purpose: "Esquema", essential: false } });
    expect(classifyDecisionExecution(d, analysis, context).route).not.toBe("deterministic");
  });
});

/** A JPEG with an EXIF segment carrying a fake location: the stored PNG must not keep it. */
async function jpegWithExif(width: number, height: number) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#227e81";
  ctx.fillRect(0, 0, width, height);
  const jpeg = new Uint8Array(await canvas.encode("jpeg"));
  const payload = new TextEncoder().encode("Exif\0\0GPSLatitude=40.4168;Author=Docente");
  const segment = new Uint8Array([0xff, 0xe1, (payload.length + 2) >> 8, (payload.length + 2) & 0xff, ...payload]);
  return new Uint8Array([...jpeg.slice(0, 2), ...segment, ...jpeg.slice(2)]);
}

describe("a teacher's image is validated on its bytes and normalised before it is stored", () => {
  it("drops every metadata of the file (EXIF location, author), keeps the proportions and reduces a large photo", async () => {
    const source = await jpegWithExif(4000, 3000);
    expect(new TextDecoder().decode(source)).toContain("GPSLatitude");
    const out = await normaliseTeacherImage(source);
    if (!out.ok) throw new Error(out.reason);
    expect(imageKind(out.png)).toBe("png");
    expect(new TextDecoder("latin1").decode(out.png)).not.toMatch(/GPSLatitude|Author|Exif|eXIf|tEXt/);
    expect([out.width, out.height]).toEqual([2400, 1800]);
  });

  it("refuses what is not an image whatever its name, and images too small to print", async () => {
    expect(await normaliseTeacherImage(new TextEncoder().encode("%PDF-1.7 not an image"))).toEqual({ ok: false, reason: "unsupported_type" });
    expect(await normaliseTeacherImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]))).toEqual({ ok: false, reason: "unreadable" });
    const tiny = createCanvas(10, 10);
    expect(await normaliseTeacherImage(new Uint8Array(await tiny.encode("png")))).toEqual({ ok: false, reason: "too_small" });
  });
});

const sheetWith = (essential: boolean): MaterialDocument =>
  MaterialDocumentSchema.parse({
    schema_version: 1,
    meta: { title: "Ficha", language: "es", stage: "primaria", grade: "5-primaria", subject: "matematicas", topic: "Fracciones" },
    presentation: { font_scale: 1, line_spacing: "normal", spacing: "normal", contrast: "normal", decoration: "standard", max_tasks_per_page: null, color_independent: true, text_alternatives_for_visuals: true },
    admin_fields: [],
    pages: [
      {
        blocks: [
          { id: "blk_0001", type: "image", source: { kind: "requested", decision_id: "dec_7", purpose: "Recta numérica", style: "diagram", essential }, alt_text: "Recurso visual de la actividad", trace: { origin: "adapted", source_refs: ["act_4"], decision_ids: ["dec_7"] } },
          { id: "blk_0002", type: "activity", label: "4", prompt: "Ordena de menor a mayor.", resource_block_ids: ["blk_0001"], response: { kind: "lines", lines: 1 }, trace: { origin: "original", source_refs: ["act_4"], decision_ids: [] } },
        ],
      },
    ],
    answer_key: [],
  });
const imageNode = (m: ReturnType<typeof buildRenderModel>["model"]) => m.pages[0]!.nodes.find((x) => x.kind === "image");

describe("the renderer and a visual a decision asked for", () => {
  it("essential and pending: not renderable, in plain words; optional and pending: a warning, never shown to the student", () => {
    const essential = buildRenderModel(sheetWith(true), { mode: "student" });
    expect(essential.validation.status).toBe("not_renderable");
    expect(essential.validation.issues.find((i) => i.code === "image_pending")?.message).toMatch(/imprescindible que no está en el material original/);
    const optional = buildRenderModel(sheetWith(false), { mode: "student" });
    expect(optional.validation.status).toBe("renderable_with_warnings");
  });

  it("provided: printed with a neutral accessible name (the purpose is the teacher's, not the student's); omitted: leaves no trace", () => {
    const provided = buildRenderModel(sheetWith(true), { mode: "student", resources: { dec_7: { src: "/api/adaptations/x/resources/dec_7" } } });
    expect(provided.validation.status).toBe("renderable");
    expect(imageNode(provided.model)).toMatchObject({ state: "available", alt: "Recurso visual de la actividad", essential: true, origin: "requested" });
    const omitted = buildRenderModel(sheetWith(true), { mode: "student", resources: { dec_7: { omitted: true } } });
    expect(omitted.validation.status).toBe("renderable");
    expect(imageNode(omitted.model)).toMatchObject({ state: "omitted" });
  });
});

describe("what the teacher reads and may do", () => {
  const needs: VisualNeed[] = [
    { key: "vis_1", origin: "original", essential: true, status: "to_select", label: "Figura 1", activity: "Actividad 1", message: "Esta actividad necesita una imagen del documento original.", omittable: false },
    { key: "dec_7", origin: "requested", essential: true, status: "to_provide", label: "Recta numérica", activity: "Actividad 4", message: "Esta actividad necesita un recurso visual que no está en el documento original. No tiene alternativa en la ficha: añádelo para poder imprimirla.", omittable: false },
    { key: "dec_8", origin: "requested", essential: false, status: "to_provide", label: "Pictograma", activity: "Actividad 3", message: "Apoyo visual opcional: la ficha se puede imprimir sin él.", omittable: true },
  ];
  const panel = (canWrite: boolean) => renderToStaticMarkup(createElement(VisualNeedsPanel, { needs, adaptationId: "a1", canWrite, locateHref: (v: string) => `/app/materiales/m/visuales/${v}` }));

  it("plain messages and only the safe actions; no technical state ever", () => {
    const out = panel(true);
    for (const text of ["Seleccionar imagen", "Añadir recurso", "Faltan 2 imágenes para poder imprimir la ficha", "Esta actividad necesita una imagen del documento original.", "No tiene alternativa en la ficha"]) expect(out).toContain(text);
    // Only the optional support can be left out: one «Continuar sin esta imagen», never for an essential without alternative.
    expect(out.match(/>Continuar sin esta imagen</g)).toHaveLength(1);
    expect(out).toContain("Es un apoyo opcional");
    expect(out).not.toMatch(/visual_crop|asset_missing|render_unresolved|missing_locator|not_renderable|dec_\d|vis_\d<|sha256|storage/);
  });

  it("read-only members see the state, never an action", () => {
    const out = panel(false);
    expect(out).toContain("solo lectura");
    expect(out).not.toMatch(/Seleccionar imagen|Añadir recurso|Continuar sin esta imagen|<button|<form/);
  });
});
