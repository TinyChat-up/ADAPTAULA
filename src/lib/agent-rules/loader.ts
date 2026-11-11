import { createHash } from "node:crypto";
import { AgentRulesError, PrecedentIndexSchema, type AgentRules, type AgentRulesManifest, type AgentRulesSource, type PrecedentEntry } from "./types";

/**
 * Loads the private rules and checks every byte against the manifest before anything uses them (ADR-045). A missing file, a
 * different hash or an unreadable index stops the load: a planner never runs on rules that are not exactly the published ones.
 * Pure apart from the source it is given; the server-only sources live in `sources.ts`.
 */

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const decoder = new TextDecoder("utf-8", { fatal: true });

export async function readVerified(source: AgentRulesSource, manifest: AgentRulesManifest, path: string): Promise<string> {
  const expected = manifest.files[path];
  if (!expected) throw new AgentRulesError("missing_file", `${path} no figura en el manifiesto ${manifest.version}`);
  const bytes = await source.read(path);
  if (!bytes) throw new AgentRulesError("missing_file", `Falta ${path} en el origen privado (${source.kind})`);
  if (bytes.byteLength !== expected.bytes || sha256(bytes) !== expected.sha256) {
    throw new AgentRulesError("integrity_mismatch", `${path} no coincide con la huella del manifiesto ${manifest.version}`);
  }
  try {
    return decoder.decode(bytes);
  } catch {
    throw new AgentRulesError("integrity_mismatch", `${path} no es UTF-8 válido`);
  }
}

/** The package hash computed the same way as the manifest's; a mismatch means the manifest itself was edited. */
export function packageHash(manifest: AgentRulesManifest): string {
  const lines = Object.keys(manifest.files)
    .sort()
    .map((p) => `${p}:${manifest.files[p]!.sha256}`);
  return createHash("sha256").update(lines.join("\n"), "utf8").digest("hex");
}

export async function loadAgentRules(source: AgentRulesSource, manifest: AgentRulesManifest): Promise<AgentRules> {
  if (packageHash(manifest) !== manifest.package_sha256) throw new AgentRulesError("integrity_mismatch", `El manifiesto ${manifest.version} no es coherente con su huella de paquete`);
  const stable = [];
  for (const path of manifest.stable) stable.push({ path, text: await readVerified(source, manifest, path) });

  let precedents: PrecedentEntry[];
  try {
    const index = PrecedentIndexSchema.parse(JSON.parse(await readVerified(source, manifest, manifest.index)));
    precedents = Object.values(index.ciclos).flatMap((c) => c.casos.map(({ id, tipo, recursos, perfiles, archivo }) => ({ id, tipo, recursos, perfiles, archivo })));
  } catch (error) {
    if (error instanceof AgentRulesError) throw error;
    throw new AgentRulesError("invalid_index", `El índice de precedentes de ${manifest.version} no tiene el formato esperado`);
  }
  for (const p of precedents) {
    if (!manifest.files[`${manifest.cases_dir}${p.id}.md`]) throw new AgentRulesError("invalid_index", `El índice cita ${p.id}, que no figura en el manifiesto`);
  }

  const cache = new Map<string, Promise<string>>();
  return {
    version: manifest.version,
    package_sha256: manifest.package_sha256,
    stable,
    precedents,
    readCase(id: string) {
      if (!precedents.some((p) => p.id === id)) return Promise.reject(new AgentRulesError("unknown_case", `${id} no está en el índice de ${manifest.version}`));
      if (!cache.has(id)) cache.set(id, readVerified(source, manifest, `${manifest.cases_dir}${id}.md`));
      return cache.get(id)!;
    },
  };
}
