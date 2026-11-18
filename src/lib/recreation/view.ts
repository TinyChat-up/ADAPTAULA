import type { MaterialDocument } from "@/lib/schemas/material-document";
import type { RecreationReader, RecreationVersion } from "./record";

/**
 * What the recreation screen shows, read from the stored line and version and nothing else (ADR-051, ADR-052). This module imports
 * no model, provider or pipeline (a test guards it), and it receives a `RecreationReader`, which has no way to read the internal
 * part: opening a recreation — the current version or an older one — switching sections, printing or reloading cannot call an AI
 * nor reach an answer.
 */
export interface RecreationView {
  id: string;
  version: number;
  currentVersion: number;
  versions: Array<{ version: number; createdAt: string; current: boolean }>;
  title: string;
  createdAt: string;
  /** In plain words, never with an answer. `review`: which activities need the teacher's look before use. */
  state: { kind: RecreationVersion["state"]; message: string | null; activities: string[] };
  student: MaterialDocument;
  materials: MaterialDocument | null;
  explanation: RecreationVersion["explanation"];
  assets: RecreationVersion["assets"];
}

/** `version`: an older version to look at (the current one by default). Looking at it changes nothing; restoring is an action. */
export async function loadRecreationView(store: RecreationReader, lineId: string, version?: number): Promise<RecreationView | null> {
  const line = await store.getLine(lineId);
  if (!line) return null;
  const shown = await store.getVersion(lineId, version ?? line.current_version);
  if (!shown) return null;
  const versions = await store.listVersions(lineId);
  return {
    id: line.id,
    version: shown.version,
    currentVersion: line.current_version,
    versions: versions.map((v) => ({ version: v.version, createdAt: v.created_at, current: v.version === line.current_version })).sort((a, b) => b.version - a.version),
    title: shown.title,
    createdAt: shown.created_at,
    state: { kind: shown.state, message: shown.state_message, activities: shown.review_activities },
    // Already stored without answers; emptied again so no future change can leak one through this path.
    student: { ...shown.student, answer_key: [] },
    materials: shown.materials ? { ...shown.materials, answer_key: [] } : null,
    explanation: shown.explanation,
    assets: shown.assets,
  };
}
