import "server-only";
import { failureMessage } from "@/lib/ai/errors";
import type { MaterialDetail } from "./types";

/** What the progress screen reads: state, step and a safe failure message. Shared by the status poll and the run request. */
export function materialStatusPayload({ material, job }: MaterialDetail) {
  return {
    status: material.status,
    step: job?.status === "processing" || job?.status === "queued" ? job.step : null,
    progress: job?.progress ?? 0,
    failure: material.failure_code ? { code: material.failure_code, message: failureMessage(material.failure_code) } : null,
  };
}
