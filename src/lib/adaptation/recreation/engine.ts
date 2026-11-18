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
