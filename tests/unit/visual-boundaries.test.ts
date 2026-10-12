import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MaterialAnalysisSchema } from "@/lib/schemas/material-analysis";
import { MaterialDocumentSchema } from "@/lib/schemas/material-document";

/** Contract guards of the visual locator layer (no AI, no OCR, frozen schemas untouched, nothing client-trusted). */
const read = (p: string) => readFileSync(p, "utf8");
const filesIn = (dir: string) => readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => path.join(dir, e.name));
const AUTO = "src/lib/materials/visuals/auto";
const visualFiles = [
  ...filesIn("src/lib/materials/visuals"),
  "src/app/api/materials/[id]/visuals/[visualId]/route.ts",
  "src/app/api/materials/[id]/pages/[page]/route.ts",
  "src/app/api/adaptations/[id]/visuals/[visualId]/route.ts",
  "src/components/materials/visual-locator.tsx",
  "src/components/materials/visual-selection.tsx",
];

describe("visual locator boundaries", () => {
  it("16/29 · no OCR, no computer vision, no provider: the layer never names one", () => {
    const imports = (f: string) => [...read(f).matchAll(/from\s+["']([^"']+)["']|import\(["']([^"']+)["']\)/g)].map((m) => m[1] ?? m[2]).join(" ");
    for (const f of visualFiles) {
      expect(imports(f), f).not.toMatch(/tesseract|ocr|opencv|anthropic|openai|@\/lib\/ai\b/i);
      expect(read(f), f).not.toMatch(/generateStructured|createProvider/);
    }
  });

  it("8.2B.1 · the automatic visuals reach a model ONLY through `src/lib/ai`, in three files; the rest of it is pure", () => {
    const imports = (f: string) => [...read(f).matchAll(/^import\s+(type\s+)?[^;]*?from\s+["']([^"']+)["']/gm)].map((m) => ({ type: Boolean(m[1]), from: m[2]! }));
    for (const f of filesIn(AUTO)) {
      expect(read(f), f).not.toMatch(/tesseract|opencv|\bocr\b/i);
      expect(imports(f).map((i) => i.from).join(" "), f).not.toMatch(/@anthropic-ai|openai/);
      // A model is chosen by alias in `src/lib/ai`, never named here.
      expect(read(f), f).not.toMatch(/claude-|gpt-[0-9]/);
      if (["vision.ts", "assistants.ts", "server.ts"].includes(path.basename(f))) continue;
      const runtimeAi = imports(f).filter((i) => !i.type && /^@\/lib\/ai\b/.test(i.from));
      expect(runtimeAi, f).toEqual([]);
      expect(read(f), f).not.toMatch(/generateStructured|createProvider/);
    }
    expect(read(`${AUTO}/vision.ts`)).toMatch(/@prompts\/visual-locator\/v1/);
  });

  it("27 · MaterialAnalysis v3 is untouched: a visual still has no geometry fields", () => {
    const visual = (MaterialAnalysisSchema as unknown as { shape: { visuals: { element: { shape: Record<string, unknown> } } } }).shape.visuals.element.shape;
    expect(Object.keys(visual).sort()).toEqual(["activity_ids", "chart", "description", "id", "kind", "page", "role", "section_id", "table", "text", "title"]);
  });

  it("28 · MaterialDocument v1 is untouched: same top-level shape, image sources are still `original` (visual_ref) or `requested`", () => {
    expect(Object.keys(MaterialDocumentSchema.shape).sort()).toEqual(["admin_fields", "answer_key", "meta", "pages", "presentation", "schema_version", "teacher_notes"]);
    expect(read("src/lib/schemas/material-document.ts")).not.toMatch(/storage_path|\bassets?\b|\bbbox\b|\bbounds\b|\bsigned\b/i);
  });

  it("39 · the browser sends only a page and a rectangle: no upload of an image, no storage path, no ids it could forge into authority", () => {
    const client = read("src/components/materials/visual-locator.tsx") + read("src/components/materials/visual-selection.tsx");
    expect(client).not.toMatch(/FormData|type="file"|toBlob|toDataURL|storage_path|workspace|analysis_fingerprint|content_hash/);
    const route = read("src/app/api/materials/[id]/visuals/[visualId]/route.ts");
    expect(route).toMatch(/\.strict\(\)/);
    expect(route).toMatch(/mutating: true/);
  });

  it("37 · no signed URL is created or persisted by this layer; crops are streamed by an authorised route", () => {
    for (const f of [...visualFiles, ...filesIn(AUTO), "src/app/api/adaptations/[id]/visuals/auto/route.ts"]) expect(read(f), f).not.toMatch(/createSignedUrl\(|getPublicUrl/);
    expect(read("src/app/api/adaptations/[id]/visuals/[visualId]/route.ts")).toMatch(/private, max-age=300/);
    expect(read("supabase/migrations/20261001001600_material_visuals.sql")).not.toMatch(/signed|public\s*=\s*true/i);
  });
});
