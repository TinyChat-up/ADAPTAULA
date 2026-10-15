import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { CorpusEntrySchema } from "@/lib/schemas/improvement-corpus";

/** The example registry of the improvement corpus. Synthetic sheets only; nothing here comes from production. */
export const RegistrySchema = z.object({
  version: z.literal(1),
  note: z.string(),
  entries: z.array(CorpusEntrySchema.extend({ file: z.string().regex(/^samples\/[a-z0-9_]+\.md$/).nullable() })),
});
export type Registry = z.infer<typeof RegistrySchema>;

export const REGISTRY_DIR = path.join(import.meta.dirname);

export function loadRegistry(dir = REGISTRY_DIR): Registry {
  return RegistrySchema.parse(JSON.parse(readFileSync(path.join(dir, "registry.json"), "utf8")));
}
