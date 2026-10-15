import { createHash } from "node:crypto";
import { constants, closeSync, existsSync, fstatSync, openSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { isLabel, lumaOf, type PageModel, type Rect } from "@/lib/materials/visuals/auto/page-model";
import { pageBox, pageCount, pageRgba, renderPage } from "@/lib/materials/visuals/raster";
import { CASES, scanCase, type FixtureCase } from "../visual-location/fixtures";
import type { PilotPage } from "./metrics";
import { OCR_LIMITS } from "./engine";

export const CORPUS_LIMITS = { manifestBytes: 2_000_000, fileBytes: 20_000_000, pages: 150, documentPages: 30, dimension: 6000, rasterSide: 4000 } as const;
const REPO = realpathSync(path.resolve(import.meta.dirname, "../.."));
const within = (root: string, file: string) => file === root || (!path.relative(root, file).startsWith(`..${path.sep}`) && path.relative(root, file) !== ".." && !path.isAbsolute(path.relative(root, file)));

export function corpusRoot(dir: string): string {
  const root = realpathSync(dir);
  if (!statSync(root).isDirectory() || within(REPO, root)) throw new Error("corpus_must_be_outside_repository");
  for (let parent = root; ; parent = path.dirname(parent)) {
    const git = path.join(parent, ".git");
    if (existsSync(path.join(git, "HEAD")) || existsSync(git) && statSync(git).isFile()) throw new Error("corpus_must_be_outside_repository");
    if (parent === path.dirname(parent)) break;
  }
  return root;
}

export function corpusFile(root: string, relative: string): string {
  if (!RelativePath.safeParse(relative).success) throw new Error("corpus_path_invalid");
  const resolved = realpathSync(path.join(root, relative));
  if (!within(root, resolved) || within(REPO, resolved)) throw new Error("corpus_path_escape");
  return resolved;
}

function boundedRead(file: string, limit: number): Buffer {
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const s = fstatSync(fd);
    if (!s.isFile() || s.size < 1 || s.size > limit) throw new Error("corpus_file_limit");
    const bytes = readFileSync(fd);
    if (bytes.length > limit) throw new Error("corpus_file_limit");
    return bytes;
  } finally { closeSync(fd); }
}

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
export function degrade(model: PageModel) {
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
        scanRotationDeg: condition.scan(c).rotateDeg ?? 0,
        sha256: s.sha256,
        activities: c.activities,
        visuals: c.visuals.map((v) => ({ id: v.id, activityId: v.activityId, kind: v.kind, labels: v.labels, truth: v.truth ? toPx(s.model, s.toRegion(v.truth)) : null, acceptable: v.acceptable })),
        distractors: Object.values(c.distractors).map((d) => toPx(s.model, s.toRegion(d))),
      };
    }
  }
}

const RelativePath = z.string().min(1).max(240).refine((s) => !s.includes("\\") && !s.includes(":") && !s.includes("\0") && !path.posix.isAbsolute(s) && !s.split("/").some((v) => v === ".." || v === "." || v === ""));
const Box = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), w: z.number().positive().max(1), h: z.number().positive().max(1) })
  .refine((b) => b.x + b.w <= 1 && b.y + b.h <= 1);

/** An authorised real corpus, kept OUTSIDE the repository. Boxes are normalised on the page as shown; transcription by a person. */
export const CorpusManifestSchema = z.object({
  pages: z
    .array(
      z.object({
        id: z.string().regex(/^[a-z0-9_-]{1,40}$/),
        file: RelativePath,
        page: z.number().int().min(1).max(CORPUS_LIMITS.documentPages).default(1),
        docType: z.string().regex(/^[a-z0-9_]{1,40}$/),
        dpi: z.number().int().min(72).max(600),
        activities: z.array(z.object({ id: z.string().regex(/^act_[0-9]{1,4}$/), anchorTextIndex: z.number().int().min(0), instructionTextIndices: z.array(z.number().int().min(0)).min(1).max(40), label: z.string().max(20).nullable(), instruction: z.string().min(1).max(2000), expectedAnswer: z.string().max(2000).nullable() })).max(40),
        texts: z.array(Box.safeExtend({ text: z.string().min(1).max(2000) })).max(2000),
        visuals: z.array(z.object({ id: z.string().regex(/^vis_[0-9]{1,4}$/), activityId: z.string().regex(/^act_[0-9]{1,4}$/), kind: z.enum(["bar", "number_line", "figure"]), labels: z.array(z.string().max(20)).max(20), box: Box.nullable(), acceptable: z.boolean() })).max(40),
        distractors: z.array(Box).max(80).default([]),
      }),
    )
    .min(1).max(CORPUS_LIMITS.pages),
}).superRefine((m, ctx) => {
  if (new Set(m.pages.map((p) => p.id)).size !== m.pages.length) ctx.addIssue({ code: "custom", message: "duplicate_page_id" });
  for (const p of m.pages) {
    const ids = new Set(p.activities.map((a) => a.id));
    if (ids.size !== p.activities.length || new Set(p.visuals.map((v) => v.id)).size !== p.visuals.length || p.visuals.some((v) => !ids.has(v.activityId)) || p.activities.some((a) => a.anchorTextIndex >= p.texts.length || !a.instructionTextIndices.includes(a.anchorTextIndex) || a.instructionTextIndices.some((i) => i >= p.texts.length) || new Set(a.instructionTextIndices).size !== a.instructionTextIndices.length)) ctx.addIssue({ code: "custom", message: "invalid_references" });
    if (p.texts.reduce((n, t) => n + [...t.text].length, 0) > 10_000) ctx.addIssue({ code: "custom", message: "corpus_text_limit" });
  }
});

const MIME: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".pdf": "application/pdf" };

function imageDimensions(b: Buffer, mime: string) {
  if (mime === "image/png" && b.length >= 24 && b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && b.toString("ascii", 12, 16) === "IHDR")
    return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  if (mime === "image/jpeg" && b[0] === 255 && b[1] === 216) {
    for (let i = 2; i + 8 < b.length;) {
      if (b[i++] !== 255) break;
      while (b[i] === 255) i++;
      const marker = b[i++]!;
      if (marker === 217 || marker === 218) break;
      if (marker === 1 || marker >= 208 && marker <= 215) continue;
      if (i + 2 > b.length) break;
      const n = b.readUInt16BE(i);
      if (n < 2 || i + n > b.length) break;
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) return { width: b.readUInt16BE(i + 5), height: b.readUInt16BE(i + 3) };
      i += n;
    }
  }
  throw new Error("corpus_image_invalid");
}

export function validateDimensions(width: number, height: number) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > CORPUS_LIMITS.dimension || height > CORPUS_LIMITS.dimension || width * height > OCR_LIMITS.pixels) throw new Error("corpus_dimension_limit");
}

export async function* corpusPages(dir: string): AsyncGenerator<PilotPage> {
  const root = corpusRoot(dir);
  let manifest: z.infer<typeof CorpusManifestSchema>;
  try { manifest = CorpusManifestSchema.parse(JSON.parse(boundedRead(corpusFile(root, "manifest.json"), CORPUS_LIMITS.manifestBytes).toString("utf8"))); }
  catch { throw new Error("corpus_manifest_invalid"); }
  for (const p of manifest.pages) {
    const bytes = boundedRead(corpusFile(root, p.file), CORPUS_LIMITS.fileBytes);
    const mime = MIME[path.extname(p.file).toLowerCase()];
    if (!mime) throw new Error("corpus_format_invalid");
    const count = await pageCount(bytes, mime);
    if (count > CORPUS_LIMITS.documentPages || p.page > count) throw new Error("corpus_page_limit");
    if (mime !== "application/pdf") { const d = imageDimensions(bytes, mime); validateDimensions(d.width, d.height); }
    else {
      if (!bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))) throw new Error("corpus_pdf_invalid");
      const box = await pageBox(bytes, mime, p.page);
      if (box.kind !== "pdf" || box.width_pt <= 0 || box.height_pt <= 0 || box.width_pt > 14400 || box.height_pt > 14400) throw new Error("corpus_dimension_limit");
      const scale = Math.min(p.dpi / 72, CORPUS_LIMITS.rasterSide / Math.max(box.width_pt, box.height_pt));
      validateDimensions(Math.round(box.width_pt * scale), Math.round(box.height_pt * scale));
    }
    // Pixels only: a PDF's own text layer, if any, is never read here.
    const raster = await renderPage(bytes, mime, p.page, { dpi: p.dpi, maxPx: CORPUS_LIMITS.rasterSide });
    const gray = lumaOf(pageRgba(raster), raster.width, raster.height);
    // `dpi` is the scan's own resolution: an image is never upsampled; a PDF scan is rendered at that resolution.
    const mmPerPx = raster.box.kind === "image" ? (25.4 / p.dpi) * (raster.box.width_px / raster.width) : raster.box.width_pt * 25.4 / 72 / raster.width;
    const model: PageModel = { width: raster.width, height: raster.height, gray, texts: [], mmPerPx };
    const truth = p.texts.map((t) => ({ text: t.text, ...toPx(model, t) }));
    // A blank reference region is an annotation error, not an OCR miss. Ink presence does not establish glyph identity.
    let checked = 0;
    for (const t of truth.filter((t) => isLabel(t.text))) {
      let ink = false;
      for (let y = Math.floor(t.y0); y < Math.ceil(t.y1) && !ink; y++) for (let x = Math.floor(t.x0); x < Math.ceil(t.x1); x++) {
        if (++checked > OCR_LIMITS.pixels * 2) throw new Error("corpus_annotation_limit");
        if (gray[y * model.width + x]! < 230) { ink = true; break; }
      }
      if (!ink) throw new Error("corpus_reference_blank");
    }
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
      anchorTruth: Object.fromEntries(p.activities.map((a) => [a.id, truth[a.anchorTextIndex]!])),
      instructionTruth: Object.fromEntries(p.activities.map((a) => [a.id, a.instructionTextIndices.map((i) => truth[i]!)])),
      visuals: p.visuals.map((v) => ({ id: v.id, activityId: v.activityId, kind: v.kind, labels: v.labels, truth: v.box ? toPx(model, v.box) : null, acceptable: v.acceptable })),
      distractors: p.distractors.map((d) => toPx(model, d)),
    };
  }
}
