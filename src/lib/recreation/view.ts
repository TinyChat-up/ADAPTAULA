import type { MaterialDocument } from "@/lib/schemas/material-document";
import type { RecreationRecord, RecreationStore } from "./record";

/**
 * What the recreation screen shows, read from the stored record and nothing else (ADR-051). This module imports no model, no
 * provider and no pipeline (a test guards it): opening a recreation, switching tabs, printing or reloading cannot call an AI.
 *
 * Nothing internal leaves it: no plan, no verification state, no provenance, no answer. The student's document travels WITHOUT its
 * `answer_key` (it stays in the record for the server's checks), so not even the page's data carries a solution.
 */
export interface RecreationView {
  id: string;
  version: number;
  title: string;
  createdAt: string;
  state: RecreationRecord["state"];
  student: MaterialDocument;
  materials: MaterialDocument | null;
  explanation: RecreationRecord["explanation"];
  assets: RecreationRecord["assets"];
}

const withoutKey = (doc: MaterialDocument): MaterialDocument => ({ ...doc, answer_key: [] });

export async function loadRecreationView(store: Pick<RecreationStore, "get">, id: string): Promise<RecreationView | null> {
  const record = await store.get(id);
  if (!record) return null;
  return {
    id: record.id,
    version: record.version,
    title: record.title,
    createdAt: record.created_at,
    state: record.state,
    student: withoutKey(record.student),
    materials: record.materials ? withoutKey(record.materials) : null,
    explanation: record.explanation,
    assets: record.assets,
  };
}
