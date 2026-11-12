import { createCanvas } from "@napi-rs/canvas";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { buildReadiness, fold, unavailableReadiness } from "@/lib/analysis/readiness";
import { pickReusableAnalysis } from "@/lib/materials/cache";
import { computeReadiness } from "@/lib/materials/readiness";
import { AnalysisReadinessSchema, FINDING_CODES } from "@/lib/schemas/analysis-readiness";
import { AnalysisMetaSchema, type MaterialAnalysis } from "@/lib/schemas/material-analysis";
import { fractionsAnalysis } from "../../evals/adaptation/fixtures";

/**
 * The analysis readiness report (shadow mode): deterministic, from the analysis and the original alone, with real PDFs (digital,
 * scanned, mixed), schemes, tables, missing references and protected data. It is a set of facts and hints, never a verdict.
 */

const clone = <T,>(value: T): T => structuredClone(value);

/** The pond-like sheet: one text, a scheme of boxes and arrows, a table and four activities, all printable. */
function sheet(): MaterialAnalysis {
  const a = clone(fractionsAnalysis());
  a.texts = [{ ...a.texts[0]!, id: "ctt_1", page: 1, kind: "reading_text", text: "En el estanque viven algas, larvas de insectos, ranas y garzas.", activity_ids: ["act_1"] }];
  a.visuals = [
    { id: "vis_1", section_id: null, page: 1, kind: "diagram", role: "required", title: "Relación alimentaria", description: "Esquema de cuatro recuadros unidos por flechas: Algas → Larvas de insectos → Ranas → Garzas.", text: "ALGAS → LARVAS DE INSECTOS → RANAS → GARZAS", table: null, chart: null, activity_ids: ["act_2"] },
    { id: "vis_2", section_id: null, page: 1, kind: "table", role: "required", title: null, description: "Tabla del nivel del agua", text: null, table: { headers: ["MAYO", "JUNIO"], rows: [["30 cm de profundidad", "18 cm de profundidad"]], unit: null }, chart: null, activity_ids: ["act_3"] },
  ] as MaterialAnalysis["visuals"];
  const base = a.activities[0]!;
  const act = (id: string, instruction: string, resources: string[], over: Partial<MaterialAnalysis["activities"][number]> = {}) => ({ ...base, id, page: 1, label: id.slice(4), instruction, context: null, resource_ids: resources, objective_ids: [], answer_area: { type: "lines" as const, lines: 3 }, expected_answer: { basis: "not_inferable" as const, value: null }, ...over });
  a.activities = [
    act("act_1", "Escribe qué seres vivos viven en el estanque.", ["ctt_1"]),
    act("act_2", "Explica qué indican las flechas del esquema.", ["vis_1"]),
    act("act_3", "¿Cuántos centímetros descendió el nivel del agua?", ["vis_2"]),
    act("act_4", "Valora la afirmación y justifica tu respuesta con 2 argumentos.", []),
  ];
  a.protected_elements = [{ id: "prt_1", type: "required_data", importance: "essential", value: "30 cm y 18 cm", activity_ids: ["act_3"], resource_ids: ["vis_2"], page: null } as MaterialAnalysis["protected_elements"][number]];
  return a;
}
const PRINTED = [
  "En el estanque viven algas, larvas de insectos, ranas y garzas.",
  "Relación alimentaria",
  "ALGAS", "->", "LARVAS DE", "INSECTOS", "->", "RANAS", "->", "GARZAS",
  "Escribe qué seres vivos viven en el estanque.",
  "Explica qué indican las flechas del esquema.",
  "MAYO", "JUNIO", "30 cm de profundidad", "18 cm de profundidad",
  "¿Cuántos centímetros descendió el nivel del agua?",
  "Valora la afirmación y justifica tu respuesta con 2 argumentos.",
];

async function digitalPdf(pages: string[][] = [PRINTED]) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const lines of pages) {
    const page = pdf.addPage([595.28, 841.89]);
    lines.forEach((line, i) => page.drawText(line, { x: 50, y: 780 - i * 22, size: 11, font }));
  }
  return pdf.save();
}
/** A page that is only a picture (a scan): no text layer at all. */
async function scannedPdf(pages = 1, scannedFrom = 0, printed: string[] = PRINTED) {
  const canvas = createCanvas(300, 400);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, 300, 400);
  ctx.fillStyle = "#222222";
  ctx.fillRect(30, 40, 240, 6);
  const image = await canvas.encode("png");
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const embedded = await pdf.embedPng(image);
  for (let n = 0; n < pages; n++) {
    const page = pdf.addPage([595.28, 841.89]);
    if (n >= scannedFrom) page.drawImage(embedded, { x: 40, y: 200, width: 400, height: 520 });
    else printed.forEach((line, i) => page.drawText(line, { x: 50, y: 780 - i * 22, size: 11, font }));
  }
  return pdf.save();
}
const run = async (analysis: MaterialAnalysis, bytes: Uint8Array) => (await computeReadiness(analysis, { bytes, mime: "application/pdf", pages: 1 }))!;
const codes = (r: { findings: Array<{ code: string; target?: string }> }) => r.findings.map((f) => `${f.code}${f.target ? `:${f.target}` : ""}`);

describe("PDF digital: el análisis se contrasta con lo que el original imprime", () => {
  it("un análisis fiel no produce hallazgos de fidelidad; el esquema, la tabla y los datos protegidos se comprueban", async () => {
    const r = await run(sheet(), await digitalPdf());
    expect(r).toMatchObject({ status: "computed", source: { kind: "pdf", text_layer: "present", pages_without_text: 0 }, fidelity: { status: "ok" } });
    expect(r.fidelity.checked.texts).toBe(1);
    expect(r.fidelity.checked.activities).toBe(4);
    expect(r.fidelity.checked.cells).toBe(4);
    expect(r.fidelity.checked.labels).toBe(4);
    expect(r.fidelity.checked.numbers).toBeGreaterThanOrEqual(3);
    expect(codes(r).filter((c) => c.endsWith("_in_source") || c.startsWith("number_not"))).toEqual([]);
  });

  it("una transcripción errónea se detecta, con su actividad: texto cambiado y un número distinto del impreso", async () => {
    const a = sheet();
    a.activities[0]!.instruction = "Escribe qué animales cazan en la laguna.";
    a.activities[2]!.instruction = "¿Cuántos centímetros descendió el nivel del agua entre 130 cm y 18 cm?";
    const r = await run(a, await digitalPdf());
    expect(r.fidelity.status).toBe("review");
    expect(codes(r)).toEqual(expect.arrayContaining(["activity_not_in_source:act_1", "number_not_in_source:act_3"]));
    expect(r.findings.find((f) => f.code === "number_not_in_source")?.count).toBe(1);
  });

  it("una celda de tabla y una etiqueta del esquema que el original no imprime se señalan", async () => {
    const a = sheet();
    a.visuals[1]!.table!.rows = [["30 cm de profundidad", "15 cm de profundidad"]];
    a.visuals[0]!.text = "ALGAS → LARVAS DE INSECTOS → SAPOS → GARZAS";
    const r = await run(a, await digitalPdf());
    expect(codes(r)).toEqual(expect.arrayContaining(["table_cell_not_in_source:vis_2", "visual_label_not_in_source:vis_1"]));
  });

  it("un enunciado que la ficha reparte en dos sitios (una cita en medio) y el análisis une no es un falso aviso", () => {
    const a = sheet();
    a.activities[3]!.instruction = "Valora esta afirmación y justifica tu respuesta. ¿Estás de acuerdo? Usa información del texto para defender tu respuesta.";
    const strings = [[...PRINTED.slice(0, -1), "5. Valora esta afirmación y justifica tu respuesta.", "«Si disminuye el agua, todos se ven afectados de la misma", "manera».", "¿Estás de acuerdo? Usa información del texto para defender tu respuesta."]];
    const r = buildReadiness(a, { kind: "pdf", pages: 1, strings });
    expect(codes(r).filter((c) => c.endsWith("_in_source"))).toEqual([]);
    expect(r.fidelity.status).toBe("ok");
  });

  it("la comparación tolera mayúsculas, acentos, ligaduras, signos y guiones: no inventa avisos", () => {
    expect(fold("Fíjate en «LA GRÁFICA» (ﬁgura 3)")).toBe(fold("fijate en la grafica, figura 3"));
    expect(fold("des-\ncribe")).toBe(fold("describe"));
  });
});

describe("PDF escaneado o mixto: un hecho, no un veredicto de inviabilidad", () => {
  it("un PDF sin capa de texto no se puede contrastar y no genera ningún aviso de revisión", async () => {
    const r = await run(sheet(), await scannedPdf(2, 0));
    expect(r).toMatchObject({ status: "computed", source: { text_layer: "absent", pages_without_text: 2 }, fidelity: { status: "not_applicable", reason: "no_text_layer" } });
    expect(codes(r)).toContain("source_no_text_layer");
    // Scanned is information: no finding of the scan asks for review, and the report has no field that could say «not viable».
    expect(r.findings.filter((f) => f.code === "source_no_text_layer").every((f) => f.severity === "info")).toBe(true);
    expect(JSON.stringify(r)).not.toMatch(/viable|blocked|invalid/i);
  });

  it("un PDF con una página escaneada compara solo las páginas con texto", async () => {
    const a = sheet();
    // Everything of the analysis sits on page 2 (the scanned one) except the reading text on page 1.
    for (const x of [...a.activities, ...a.visuals]) x.page = 2;
    const r = await run(a, await scannedPdf(2, 1, ["En el estanque viven algas, larvas de insectos, ranas y garzas."]));
    expect(r.source).toMatchObject({ text_layer: "partial", pages_without_text: 1 });
    expect(r.fidelity.checked.texts).toBe(1);
    expect(r.fidelity.checked.activities).toBe(0);
    expect(codes(r).filter((c) => c.endsWith("_in_source"))).toEqual([]);
    expect(codes(r)).toContain("source_partial_text_layer");
  });

  it("una imagen subida no tiene capa de texto: no aplica, sin aviso de fidelidad", async () => {
    const r = (await computeReadiness(sheet(), { bytes: new Uint8Array([1, 2, 3]), mime: "image/png", pages: 1 }))!;
    expect(r).toMatchObject({ status: "computed", source: { kind: "image", text_layer: "not_applicable" }, fidelity: { status: "not_applicable", reason: "image_source" } });
  });
});

describe("referencias dentro del análisis y pistas de recuperación visual", () => {
  const without = (a: MaterialAnalysis) => buildReadiness(a, { kind: "pdf", pages: 1, strings: [PRINTED] });

  it("una actividad que remite a «el esquema» sin recurso ni figura en su página se señala", () => {
    const a = sheet();
    a.visuals = [];
    for (const act of a.activities) act.resource_ids = act.resource_ids.filter((id) => id.startsWith("ctt"));
    const r = without(a);
    expect(codes(r)).toContain("picture_reference_without_resource:act_2");
    expect(r.references.picture_references_without_resource).toBe(1);
  });

  it("con la figura enlazada, o presente en su página, no hay aviso; una figura requerida que nadie usa es información", () => {
    expect(codes(without(sheet())).filter((c) => c.startsWith("picture_reference"))).toEqual([]);
    const a = sheet();
    a.activities[1]!.resource_ids = [];
    a.visuals[0]!.activity_ids = [];
    expect(codes(without(a))).toEqual(expect.arrayContaining(["required_visual_unused:vis_1"]));
    expect(codes(without(a)).filter((c) => c.startsWith("picture_reference"))).toEqual([]);
  });

  it("pistas por figura: tabla con datos, esquema con cadena de etiquetas, figura que necesita el original, decorativa", () => {
    const a = sheet();
    a.visuals.push({ id: "vis_3", section_id: null, page: 1, kind: "image", role: "required", title: null, description: "Una foto del estanque", text: null, table: null, chart: null, activity_ids: [] } as MaterialAnalysis["visuals"][number]);
    a.visuals.push({ id: "vis_4", section_id: null, page: 1, kind: "decorative", role: "decorative", title: null, description: "Adorno", text: null, table: null, chart: null, activity_ids: [] } as MaterialAnalysis["visuals"][number]);
    const hints = Object.fromEntries(without(a).visuals.map((v) => [v.id, v.hint]));
    expect(hints).toEqual({ vis_1: "flow_claim", vis_2: "data_in_analysis", vis_3: "needs_original", vis_4: "not_needed" });
    // A hint is a hint: «needs_original» is not a verdict, and nothing in the report says a document cannot be adapted.
    expect(JSON.stringify(without(a))).not.toMatch(/viable|unrecoverable|blocked/i);
  });

  it("recursos protegidos: un dato requerido que el original no imprime se señala sobre su actividad", () => {
    const a = sheet();
    a.protected_elements[0]!.value = "30 cm y 180 cm";
    const r = without(a);
    expect(codes(r)).toContain("number_not_in_source:act_3");
  });

  it("las fórmulas (LaTeX) no se comparan con el texto impreso: se cuentan aparte", () => {
    const a = sheet();
    a.activities[2]!.instruction = "Calcula $\\frac{2}{5}+\\frac{1}{5}$ y simplifica.";
    const r = without(a);
    expect(r.fidelity.skipped_math).toBe(1);
    expect(codes(r).filter((c) => c === "activity_not_in_source:act_3")).toEqual([]);
  });
});

describe("el informe es pequeño, cerrado y privado", () => {
  it("el esquema es estricto: ningún campo de texto libre cabe, y los códigos son un vocabulario cerrado", async () => {
    const r = await run(sheet(), await digitalPdf());
    expect(AnalysisReadinessSchema.safeParse(r).success).toBe(true);
    expect(AnalysisReadinessSchema.safeParse({ ...r, note: "Texto de la ficha" }).success).toBe(false);
    expect(AnalysisReadinessSchema.safeParse({ ...r, findings: [{ code: "text_not_in_source", severity: "review", detail: "texto" }] }).success).toBe(false);
    expect(AnalysisReadinessSchema.safeParse({ ...r, findings: [{ code: "algo", severity: "review" }] }).success).toBe(false);
    expect(AnalysisReadinessSchema.safeParse({ ...r, findings: [{ code: "text_not_in_source", severity: "review", target: "Un texto cualquiera" }] }).success).toBe(false);
    expect(FINDING_CODES.length).toBeLessThan(15);
  });

  it("ninguna palabra del material aparece en el informe, ni siquiera cuando hay hallazgos", async () => {
    const a = sheet();
    a.activities[0]!.instruction = "Escribe qué animales cazan en la laguna secreta.";
    const json = JSON.stringify(await run(a, await digitalPdf()));
    for (const word of ["estanque", "laguna", "secreta", "algas", "ranas", "garzas", "profundidad", "MAYO", "Relación"]) expect(json.toLowerCase()).not.toContain(word.toLowerCase());
    expect(json.length).toBeLessThan(2500);
  });

  it("con muchos hallazgos el informe se acota y conserva primero los que piden revisión", () => {
    const a = sheet();
    const base = a.activities[0]!;
    a.activities = Array.from({ length: 60 }, (_, i) => ({ ...base, id: `act_${i + 1}`, instruction: `Instrucción inventada número ${i + 1} sin relación con el original`, answer_area: { type: "unknown" as const, lines: null }, resource_ids: [] }));
    a.texts[0]!.activity_ids = [];
    a.visuals.forEach((v) => (v.activity_ids = []));
    const r = buildReadiness(a, { kind: "pdf", pages: 1, strings: [PRINTED] });
    expect(r.findings.length).toBeLessThanOrEqual(30);
    expect(r.findings[0]!.severity).toBe("review");
    expect(JSON.stringify(r).length).toBeLessThan(5000);
  });

  it("sin poder leer el original, el informe lo dice y conserva lo que solo depende del análisis", () => {
    const r = unavailableReadiness(sheet(), { kind: "pdf", pages: 1 }, "extraction_failed");
    expect(r).toMatchObject({ status: "unavailable", reason: "extraction_failed", fidelity: { status: "not_applicable", reason: "unavailable" } });
    expect(r.references.activities).toBe(4);
    expect(r.visuals.length).toBe(2);
  });
});

describe("el cálculo nunca rompe un análisis (modo sombra)", () => {
  it("un PDF ilegible, un presupuesto agotado o un MIME desconocido dan «no disponible» o nada; jamás una excepción", async () => {
    const garbage = new Uint8Array([37, 80, 68, 70, 45, 1, 2, 3]);
    expect((await computeReadiness(sheet(), { bytes: garbage, mime: "application/pdf", pages: 1 }))?.status).toBe("unavailable");
    expect((await computeReadiness(sheet(), { bytes: await digitalPdf(), mime: "application/pdf", pages: 1 }, 10))?.reason).toBe("timeout");
    await expect(computeReadiness(sheet(), { bytes: garbage, mime: "text/plain", pages: 1 })).resolves.not.toThrow();
  });

  it("es determinista: el mismo análisis y el mismo PDF dan exactamente el mismo informe", async () => {
    const bytes = await digitalPdf();
    expect(await run(sheet(), bytes)).toEqual(await run(sheet(), bytes));
  });
});

describe("compatibilidad de analysis_meta: la ampliación no rompe consumidores, cachés ni validaciones", () => {
  const meta = {
    schema_version: 3, prompt_key: "material_analyzer", prompt_version: 3, source: "model", cache_hit: false, forced_reanalysis: false, model_alias: "STANDARD", provider: "anthropic", model: "m", effort: "medium",
    analyzed_at: "2026-11-11T10:00:00.000Z", attempts: 1, cost_usd: 0.05, warnings: [], reused_from_material_id: null,
  };

  it("un meta anterior (sin informe) sigue siendo válido: el informe es opcional", () => {
    const parsed = AnalysisMetaSchema.parse(meta);
    expect(parsed.readiness).toBeUndefined();
  });

  it("un meta con informe lo conserva intacto y cabe en el contrato de siempre", async () => {
    const readiness = await run(sheet(), await digitalPdf());
    const parsed = AnalysisMetaSchema.parse({ ...meta, readiness });
    expect(parsed.readiness).toEqual(readiness);
    // Stored as JSON and read back (what the column does): the same value.
    expect(AnalysisMetaSchema.parse(JSON.parse(JSON.stringify({ ...meta, readiness }))).readiness).toEqual(readiness);
  });

  it("un informe que esta versión no entiende NO invalida el meta (la caché y la ficha del material lo necesitan): se lee como «ninguno»", () => {
    for (const bad of [{ version: 2 }, { version: 1, engine: 5 }, "texto", 7, { ...{}, findings: "x" }]) {
      const parsed = AnalysisMetaSchema.safeParse({ ...meta, readiness: bad });
      expect(parsed.success).toBe(true);
      expect(parsed.success && parsed.data.readiness).toBeUndefined();
    }
  });

  it("la caché de análisis sigue reutilizando y se lleva el informe consigo (mismo archivo, mismo análisis)", async () => {
    const readiness = await run(sheet(), await digitalPdf());
    const analysis = fractionsAnalysis();
    const candidate = { id: "m1", status: "analyzed", analysis_prompt_version: "material_analyzer@v3", analysis, analysis_meta: { ...meta, readiness } };
    const reused = pickReusableAnalysis([candidate], { promptVersion: "material_analyzer@v3", schemaVersion: 3 });
    expect(reused?.meta.readiness).toEqual(readiness);
    // A cached meta without the report is reused exactly as before.
    expect(pickReusableAnalysis([{ ...candidate, analysis_meta: meta }], { promptVersion: "material_analyzer@v3", schemaVersion: 3 })?.meta.readiness).toBeUndefined();
  });
});
