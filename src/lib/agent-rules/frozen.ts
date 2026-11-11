import { AIError } from "@/lib/ai/errors";

/**
 * The rules an adaptation was CREATED with, or nothing (ADR-046): a package other than the frozen one (updated, replaced, another
 * source) stops the planning stage before any call, exactly like a package that fails its own verification.
 */
export function frozenRules<T extends { version: string; package_sha256: string }>(rules: T, frozen: { version: string; package_sha256: string } | undefined): T {
  if (!frozen || rules.version !== frozen.version || rules.package_sha256 !== frozen.package_sha256) throw new AIError("not_configured", "las reglas disponibles no son las fijadas en la adaptación");
  return rules;
}
