import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";
import { packageFiles, packageRoot } from "../../next.tracing";

/**
 * Tracing includes point at a package's physical directory: never through a symlinked `node_modules/<pkg>` (pnpm), which made
 * Vercel reject the Function ("files in symlinked directories") and duplicated every file. Intention, not pnpm's layout: no test
 * here depends on a `.pnpm` path or a version.
 */

/** Every directory on the way to the first glob character must be a real directory, never a symlink. */
function crossesSymlink(glob: string, projectDir = process.cwd()): string | null {
  const fixed = glob.replace(/^\.\//, "").split("/");
  let dir = realpathSync(projectDir);
  for (const part of fixed.slice(0, -1)) {
    if (/[*?[{]/.test(part)) break;
    dir = path.join(dir, part);
    if (lstatSync(dir).isSymbolicLink()) return dir;
  }
  return null;
}

function fakeInstall(layout: "flat" | "symlinked") {
  const project = realpathSync(mkdtempSync(path.join(tmpdir(), "tracing-")));
  writeFileSync(path.join(project, "package.json"), JSON.stringify({ name: "app", private: true }));
  const real = layout === "flat" ? path.join(project, "node_modules", "@scope", "pkg") : path.join(project, "node_modules", ".store", "pkg@9.9.9", "node_modules", "@scope", "pkg");
  mkdirSync(path.join(real, "bin"), { recursive: true });
  writeFileSync(path.join(real, "package.json"), JSON.stringify({ name: "@scope/pkg", version: "9.9.9", exports: { ".": "./index.js" } }));
  writeFileSync(path.join(real, "bin", "asset.bin"), "x");
  if (layout === "symlinked") {
    mkdirSync(path.join(project, "node_modules", "@scope"), { recursive: true });
    symlinkSync(real, path.join(project, "node_modules", "@scope", "pkg"), "dir");
  }
  return { project, real };
}

describe("packageRoot / packageFiles", () => {
  it("resolves the installed package to its physical directory (pdf.js, the rasteriser's runtime files)", () => {
    const root = packageRoot("pdfjs-dist");
    expect(existsSync(path.join(root, "legacy/build/pdf.worker.mjs"))).toBe(true);
    expect((JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as { name: string }).name).toBe("pdfjs-dist");
    expect(lstatSync(root).isSymbolicLink()).toBe(false);
    expect(realpathSync(root)).toBe(root);
  });

  it("works for a package that does not export its package.json (the serverless Chromium)", () => {
    const root = packageRoot("@sparticuz/chromium");
    expect(existsSync(path.join(root, "bin"))).toBe(true);
    expect(lstatSync(root).isSymbolicLink()).toBe(false);
  });

  it("a symlinked install (pnpm-like) resolves to the real directory; a flat install (npm-like) stays where it is", () => {
    const linked = fakeInstall("symlinked");
    expect(packageRoot("@scope/pkg", linked.project)).toBe(linked.real);
    const [glob] = packageFiles("@scope/pkg", ["bin/*"], linked.project);
    expect(glob!.startsWith("./node_modules/@scope/pkg/")).toBe(false);
    expect(crossesSymlink(glob!, linked.project)).toBeNull();

    const flat = fakeInstall("flat");
    expect(packageFiles("@scope/pkg", ["bin/*"], flat.project)).toEqual(["./node_modules/@scope/pkg/bin/*"]);
    expect(crossesSymlink("./node_modules/@scope/pkg/bin/*", flat.project)).toBeNull();
    expect(() => packageRoot("@scope/missing", flat.project)).toThrow();
  });
});

describe("next.config tracing includes", () => {
  const includes = nextConfig.outputFileTracingIncludes ?? {};
  const globs = Object.values(includes).flat();

  it("the rasteriser routes still carry exactly pdf.js's package.json, legacy worker and standard fonts", () => {
    for (const route of ["/api/materials/*/pages/*", "/api/materials/*/visuals/*"]) {
      const list = includes[route]!;
      expect(list.map((g) => g.slice(g.lastIndexOf("pdfjs-dist/") + "pdfjs-dist/".length))).toEqual(["package.json", "legacy/build/pdf.worker.mjs", "standard_fonts/**/*"]);
      for (const g of list) expect(existsSync(path.join(packageRoot("pdfjs-dist"), g.slice(g.lastIndexOf("pdfjs-dist/") + 11).replace(/\/\*\*\/\*$/, "")))).toBe(true);
    }
  });

  it("no include goes through a symlinked directory, and none is written against node_modules/<pkg> or a store version", () => {
    for (const g of globs) expect(crossesSymlink(g), g).toBeNull();
    const source = readFileSync("next.config.ts", "utf8");
    expect(source).not.toMatch(/["']\.\/node_modules\//);
    expect(source).not.toMatch(/\.pnpm|@\d+\.\d+\.\d+/);
  });
});
