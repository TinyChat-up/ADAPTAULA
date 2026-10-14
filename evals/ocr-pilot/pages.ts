import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { lumaOf, type PageModel, type Rect } from "@/lib/materials/visuals/auto/page-model";
import { pageRgba, renderPage } from "@/lib/materials/visuals/raster";
import { CASES, scanCase, type FixtureCase } from "../visual-location/fixtures";
import type { PilotPage } from "./metrics";

/**
 * Pilot inputs. Every page reaches the OCR as pixels only (`model.texts` is empty); the reference transcription travels apart,
 * for scoring. Synthetic fixtures are NOT real documents: their results never stand for a real corpus.
 */

export const DOC_TYPE: Record<string, string> = {
  cell_labels: "celula_numeros",
  two_similar: "celula_numeros",
  decorative: "celula_numeros",
  big_text: "celula_numeros",
  incomplete: "celula_numeros",
  far_labels: "celula_numeros",
  other_activity: "celula_numeros",
  rotated_noisy: "celula_numeros",
  multi: "barra_y_letras",
  no_figure: "sin_figura",
  answer_leak: "rotulos_palabra",
};

export interface Condition {
  id: string;
  description: string;
  dpi: number;
  scan(c: FixtureCase): FixtureCase["scan"];
  degrade?: boolean;
}

export const CONDITIONS: Condition[] = [
  { id: "limpio_300", description: "300 ppp, sin grano ni giro", dpi: 300, scan: () => ({ noise: false, rotateDeg: 0 }) },
  { id: "escaner_300", description: "300 ppp, grano y sombra de escáner; rotated_noisy girado 1,5°", dpi: 300, scan: (c) => c.scan },
  { id: "escaner_150", description: "150 ppp, grano y sombra de escáner; rotated_noisy girado 1,5°", dpi: 150, scan: (c) => c.scan },
  { id: "girado_200", description: "200 ppp, grano y sombra, todo girado 3° más (rotated_noisy 4,5°)", dpi: 200, scan: (c) => ({ noise: true, rotateDeg: (c.scan.rotateDeg ?? 0) + 3 }) },
  { id: "degradado_200", description: "200 ppp, contraste bajo, grano fuerte y motas; sin giro añadido", dpi: 200, scan: (c) => c.scan, degrade: true },
];

/** Low contrast, heavy grain and dust specks (deterministic): a worn photocopy, not a model of any real scanner. */
function degrade(model: PageModel) {
  let seed = 12345;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const g = model.gray;
  for (let i = 0; i < g.length; i++) g[i] = Math.max(0, Math.min(255, Math.round(255 - (255 - g[i]!) * 0.75 + (rand() - 0.5) * 48)));
  for (let k = 0; k < g.length * 0.0004; k++) {
    const i = Math.floor(rand() * (g.length - model.width - 1));
    for (const j of [i, i + 1, i + model.width, i + model.width + 1]) g[j] = 60;
  }
}

const toPx = (model: PageModel, r: { x: number; y: number; w: number; h: number }): Rect => ({ x0: r.x * model.width, y0: r.y * model.height, x1: (r.x + r.w) * model.width, y1: (r.y + r.h) * model.height });

/** One page at a time (a 300 ppp page is ~9 MB of grey): memory measures the OCR, not a queue of rasters. */
export async function* fixturePages(): AsyncGenerator<PilotPage> {
  for (const condition of CONDITIONS) {
    for (const c of CASES) {
      const s = await scanCase({ ...c, scan: condition.scan(c) }, { dpi: condition.dpi });
      if (condition.degrade) degrade(s.model);
      // The same sheet unrotated: its text layer is the reference in the deskewed frame (rotation is about the page centre).
      const upright = await scanCase({ ...c, scan: { noise: false, rotateDeg: 0 } }, { dpi: condition.dpi });
      yield {
        id: c.id,
        docType: DOC_TYPE[c.id] ?? "otro",
        condition: condition.id,
        dpi: condition.dpi,
        // The vector text layer (transformed like the pixels) is the reference only; the OCR gets an empty text layer.
        model: { ...s.model, texts: [] },
        truth: s.model.texts,
        truthUpright: upright.model.texts,
        sha256: s.sha256,
        activities: c.activities,
        visuals: c.visuals.map((v) => ({ id: v.id, activityId: v.activityId, kind: v.kind, labels: v.labels, truth: v.truth ? toPx(s.model, s.toRegion(v.truth)) : null, acceptable: v.acceptable })),
        distractors: Object.values(c.distractors).map((d) => toPx(s.model, s.toRegion(d))),
      };
    }
  }
}

const Box = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), w: z.number().min(0).max(1), h: z.number().min(0).max(1) });

/** An authorised real corpus, kept OUTSIDE the repository. Boxes are normalised on the page as shown; transcription by a person. */
export const CorpusManifestSchema = z.object({
  pages: z
    .array(
      z.object({
        id: z.string().regex(/^[a-z0-9_-]{1,40}$/),
        file: z.string().min(1),
        page: z.number().int().min(1).default(1),
        docType: z.string().regex(/^[a-z0-9_]{1,40}$/),
        dpi: z.number().int().min(72).max(600),
        activities: z.array(z.object({ id: z.string(), label: z.string().nullable(), instruction: z.string().min(1), expectedAnswer: z.string().nullable() })),
        texts: z.array(Box.extend({ text: z.string().min(1) })),
        visuals: z.array(z.object({ id: z.string().regex(/^vis_[0-9]{1,4}$/), activityId: z.string().regex(/^act_[0-9]{1,4}$/), kind: z.enum(["bar", "number_line", "figure"]), labels: z.array(z.string()), box: Box.nullable(), acceptable: z.boolean() })),
        distractors: z.array(Box).default([]),
      }),
    )
    .min(1),
});

const MIME: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".pdf": "application/pdf" };

export async function* corpusPages(dir: string): AsyncGenerator<PilotPage> {
  const manifest = CorpusManifestSchema.parse(JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8")));
  for (const p of manifest.pages) {
    const bytes = readFileSync(path.join(dir, p.file));
    const mime = MIME[path.extname(p.file).toLowerCase()];
    if (!mime) throw new Error(`Formato no admitido: ${p.file}`);
    // Pixels only: a PDF's own text layer, if any, is never read here.
    const raster = await renderPage(bytes, mime, p.page, { dpi: p.dpi, maxPx: 5000 });
    const gray = lumaOf(pageRgba(raster), raster.width, raster.height);
    // `dpi` is the scan's own resolution: an image is never upsampled; a PDF scan is rendered at that resolution.
    const mmPerPx = raster.box.kind === "image" ? (25.4 / p.dpi) * (raster.box.width_px / raster.width) : 25.4 / p.dpi;
    const model: PageModel = { width: raster.width, height: raster.height, gray, texts: [], mmPerPx };
    const truth = p.texts.map((t) => ({ text: t.text, ...toPx(model, t) }));
    yield {
      id: p.id,
      docType: p.docType,
      condition: "real",
      dpi: p.dpi,
      model,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      truth,
      // A transcription is boxed line by line on the page as shown: for scans within ~1° that is also the deskewed order.
      truthUpright: truth,
      activities: p.activities,
      visuals: p.visuals.map((v) => ({ id: v.id, activityId: v.activityId, kind: v.kind, labels: v.labels, truth: v.box ? toPx(model, v.box) : null, acceptable: v.acceptable })),
      distractors: p.distractors.map((d) => toPx(model, d)),
    };
  }
}
