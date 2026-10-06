import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MaterialAnalysisSchema } from "@/lib/schemas/material-analysis";
import { MaterialDocumentSchema } from "@/lib/schemas/material-document";

/** Contract guards of the visual locator layer (no AI, no OCR, frozen schemas untouched, nothing client-trusted). */
const read = (p: string) => readFileSync(p, "utf8");
const visualFiles = [
  ...readdirSync("src/lib/materials/visuals").map((f) => path.join("src/lib/materials/visuals", f)),
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
    for (const f of visualFiles) expect(read(f), f).not.toMatch(/createSignedUrl\(|getPublicUrl/);
    expect(read("src/app/api/adaptations/[id]/visuals/[visualId]/route.ts")).toMatch(/private, max-age=300/);
    expect(read("supabase/migrations/20261001001600_material_visuals.sql")).not.toMatch(/signed|public\s*=\s*true/i);
  });
});
