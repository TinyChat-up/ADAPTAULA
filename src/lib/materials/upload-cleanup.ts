import "server-only";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import { SOURCE_BUCKET } from "./config";

const ClaimSchema = z.object({
  materialId: z.uuid(), workspaceId: z.uuid(), token: z.uuid(),
  files: z.array(z.object({ bucket: z.literal(SOURCE_BUCKET), path: z.string().min(1) })),
}).superRefine((claim, ctx) => {
  for (const file of claim.files) {
    const parts = file.path.split("/");
    if (parts[0] !== claim.workspaceId || (parts[1] !== claim.materialId && parts[2] !== claim.materialId) || parts.some((p) => !p || p === "." || p === ".."))
      ctx.addIssue({ code: "custom", message: "invalid_cleanup_path" });
  }
});
export type UploadCleanupClaim = z.infer<typeof ClaimSchema>;
export type CleanupFailure = "storage_failed" | "storage_unconfirmed";
export interface UploadCleanupDeps {
  claim(): Promise<UploadCleanupClaim[]>;
  removeAndConfirm(file: UploadCleanupClaim["files"][number]): Promise<CleanupFailure | null>;
  finish(claim: UploadCleanupClaim, error: CleanupFailure | null): Promise<number>;
}

/** Claims are irreversible; even a late Storage response can only affect an abandoned path. */
export async function runUploadCleanups(deps: UploadCleanupDeps, options: { budgetMs?: number; now?: () => number } = {}) {
  const now = options.now ?? Date.now;
  const started = now();
  const claims = await deps.claim();
  const result = { claimed: claims.length, removed: 0, failed: 0, deferred: 0 };
  for (const claim of claims) {
    if (now() - started >= (options.budgetMs ?? 20_000)) { result.deferred++; continue; }
    let failure: CleanupFailure | null = null;
    try {
      for (const file of claim.files) {
        failure = await deps.removeAndConfirm(file);
        if (failure) break;
      }
    } catch { failure = "storage_failed"; }
    try {
      result.removed += await deps.finish(claim, failure);
      if (failure) result.failed++;
    } catch {
      // The persisted lease/paths survive even if the process cannot write an error or dies here.
      result.failed++;
      logger.warn("upload_cleanup_unacknowledged", { materialId: claim.materialId });
    }
  }
  return result;
}

export function uploadCleanupDeps(): UploadCleanupDeps {
  const admin = createAdminClient();
  return {
    async claim() {
      const { data, error } = await admin.rpc("claim_material_upload_cleanups", { p_limit: 20 });
      if (error) throw new Error("cleanup_claim_failed");
      return z.array(ClaimSchema).parse(data);
    },
    async removeAndConfirm(file) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          (async (): Promise<CleanupFailure | null> => {
            const store = admin.storage.from(file.bucket);
            const { error } = await store.remove([file.path]);
            if (error) return "storage_failed";
            // Empty/partial DELETE results are not proof of absence; verify without downloading content.
            const info = await store.info(file.path);
            const code = info.error && "code" in info.error ? info.error.code : undefined;
            if (info.error && (code === "NoSuchKey" || (code === undefined && info.error.status === 404))) return null;
            return "storage_unconfirmed";
          })(),
          new Promise<CleanupFailure>((resolve) => { timer = setTimeout(() => resolve("storage_failed"), 8000); }),
        ]);
      } finally { clearTimeout(timer); }
    },
    async finish(claim, failure) {
      const { data, error } = await admin.rpc("finish_material_upload_cleanup", {
        p_material: claim.materialId, p_token: claim.token, p_error: failure,
      });
      if (error || !Number.isInteger(data) || data < 0 || data > 1) throw new Error("cleanup_finish_failed");
      return data as number;
    },
  };
}
