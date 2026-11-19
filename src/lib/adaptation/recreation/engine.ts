/**
 * Which engine produces the sheet of an adaptation (ADR-053). «Hacer magia» (`automatic`) is the only mode that can use the
 * recreation engine; «Revisar antes de crear» keeps the plan review of the original engine. The choice is made ONCE, on the
 * server, when the adaptation is created, and is frozen in `pipeline_versions.engine`: a later change of the switch never alters an
 * adaptation that already exists, and every adaptation created before this change has no `engine` and runs the original engine.
 */
export const RECREATION_ENGINE = "recreation_v1" as const;

export interface MagicEngineConfig {
  HACER_MAGIA_ENGINE?: "off" | "pilot" | "on" | undefined;
  HACER_MAGIA_RECREATION_WORKSPACES?: string | undefined;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True only when the server's switch allows the recreation engine for this workspace. Never decided by the browser. */
export function recreationAllowed(config: MagicEngineConfig, workspaceId: string): boolean {
  switch (config.HACER_MAGIA_ENGINE ?? "off") {
    case "on":
      return true;
    case "pilot":
      return (config.HACER_MAGIA_RECREATION_WORKSPACES ?? "").split(",").map((w) => w.trim()).filter((w) => UUID.test(w)).some((w) => w.toLowerCase() === workspaceId.toLowerCase());
    default:
      return false;
  }
}

export const usesRecreation = (versions: { engine?: string | undefined } | null | undefined): boolean => versions?.engine === RECREATION_ENGINE;

/** The teacher's optional orientation (client-safe: no server module). Never above the student's needs or the curriculum. */
export const RECREATION_APPROACHES = ["auto", "playful", "structured"] as const;
export type RecreationApproach = (typeof RECREATION_APPROACHES)[number];

/** The recreation planner's prompt version for NEW adaptations (frozen in each one; older versions stay published). */
export const RECREATION_PLANNER_PROMPT_VERSION = 6;

/** ADR-054: the planner version from which «Hacer magia» designs new pictures instead of reusing the original's. */
export const NEW_IMAGES_FROM = 5;

/** ADR-056/057: the planner version from which the resource tools adapt to Claude's plan (v5 keeps the rules it was created with). */
export const DESIGNED_FROM = 6;
