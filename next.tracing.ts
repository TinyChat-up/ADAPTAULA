import { existsSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

/**
 * Globs for `outputFileTracingIncludes` that point at a package's PHYSICAL directory.
 *
 * Why: with pnpm, `node_modules/<pkg>` is a symlink into the virtual store (`node_modules/.pnpm/...`). A glob written as
 * `./node_modules/<pkg>/...` puts files reached through that symlinked directory into the Function, next to the same files at
 * their real path (the tracer follows real paths): duplicates, and Vercel rejects the package ("files in symlinked directories").
 * Resolving the real directory works the same with pnpm and with a flat npm `node_modules` (where it is already physical).
 */

/**
 * The real directory of an installed package, located the way Node looks it up (the `node_modules` chain from the project), so
 * it works even when the package does not export its `package.json`. Never a hard-coded store path or version.
 */
export function packageRoot(name: string, projectDir: string = process.cwd()): string {
  const require = createRequire(path.join(projectDir, "package.json"));
  for (const base of require.resolve.paths(name) ?? []) {
    const candidate = path.join(base, name);
    if (existsSync(path.join(candidate, "package.json"))) return realpathSync(candidate);
  }
  throw new Error(`No se encuentra el paquete instalado ${name}`);
}

/** `./<physical package dir relative to the project>/<file glob>`, with POSIX separators (what the tracer expects). */
export function packageFiles(name: string, files: readonly string[], projectDir: string = process.cwd()): string[] {
  const rel = path.relative(realpathSync(projectDir), packageRoot(name, projectDir)).split(path.sep).join("/");
  return files.map((f) => `./${rel}/${f}`);
}
