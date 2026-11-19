import { RecreationLineSchema, RecreationVersionSchema } from "@/lib/recreation/record";
import assets from "./assets.json";
import line from "./line.json";
import version from "./version.json";

/**
 * The stored pond recreation of the demonstration (ADR-051): what a member can read (the line, the version WITHOUT answers and its
 * pictures as base64), imported statically so the build knows exactly which files it uses. No file system access, no path built at
 * run time: nothing here makes the bundler trace the repository. To look at another recorded run use `pnpm demo:recreacion <folder>`.
 */
export const demo = {
  line: RecreationLineSchema.parse(line),
  version: RecreationVersionSchema.parse(version),
  images: Object.fromEntries(Object.entries(assets as Record<string, string>).map(([id, b64]) => [id, `data:image/png;base64,${b64}`])),
};
