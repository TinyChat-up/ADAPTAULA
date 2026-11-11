import { z } from "zod";

/**
 * Contracts of the private pedagogical rules (ADR-045). The rules are trusted instructions written by the project, but private:
 * the repository holds only their manifest (paths and SHA-256). Their text never reaches logs, `ai_runs`, analytics or the client.
 */

export interface AgentRulesManifest {
  id: "agent_rules";
  version: string;
  /** sha256 of the sorted "path:sha256" lines: identifies the whole package in records. */
  package_sha256: string;
  files: Record<string, { sha256: string; bytes: number }>;
  /** Files sent to the planner on every request, in order. */
  stable: readonly string[];
  /** The precedent index (JSON). */
  index: string;
  /** Folder of the precedent cases, one Markdown file per case id. */
  cases_dir: string;
}

/** Where the private files are read from. `null` = the file is not there. Never logs what it reads. */
export interface AgentRulesSource {
  readonly kind: "storage" | "directory" | "memory";
  read(path: string): Promise<Uint8Array | null>;
}

export const AGENT_RULES_ERROR_CODES = ["not_configured", "missing_file", "integrity_mismatch", "invalid_index", "unknown_case"] as const;
export type AgentRulesErrorCode = (typeof AGENT_RULES_ERROR_CODES)[number];

/** Fails closed. The message names the file and the reason, never its content. */
export class AgentRulesError extends Error {
  readonly code: AgentRulesErrorCode;
  constructor(code: AgentRulesErrorCode, message: string) {
    super(message);
    this.name = "AgentRulesError";
    this.code = code;
  }
}

export const CASE_TYPES = ["decision_aceptada", "error_corregido", "alternativa_rechazada", "pendiente"] as const;
export const CaseIdSchema = z.string().regex(/^D[0-9]{3}-[AEPR][0-9]{2}$/, "Precedente no válido");

/** Only the fields the platform uses; the rest of the index travels to the model as text. */
export const PrecedentEntrySchema = z.object({
  id: CaseIdSchema,
  tipo: z.enum(CASE_TYPES),
  recursos: z.array(z.string().min(1).max(60)).max(20),
  perfiles: z.array(z.string().min(1).max(4)).max(6),
  archivo: z.string().min(1).max(120),
});
export type PrecedentEntry = z.infer<typeof PrecedentEntrySchema>;

export const PrecedentIndexSchema = z.object({
  version: z.string().max(20),
  ciclos: z.record(z.string().max(20), z.object({ casos: z.array(PrecedentEntrySchema.passthrough()).max(200) }).passthrough()),
});

export interface AgentRules {
  version: string;
  package_sha256: string;
  /** The stable rule files, verified, in manifest order. */
  stable: ReadonlyArray<{ path: string; text: string }>;
  precedents: readonly PrecedentEntry[];
  /** Reads one case, verified against the manifest. */
  readCase(id: string): Promise<string>;
}
