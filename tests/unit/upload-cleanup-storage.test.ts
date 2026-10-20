import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ remove: vi.fn(), info: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  rpc: mocks.rpc, storage: { from: () => ({ remove: mocks.remove, info: mocks.info }) },
}) }));
const { runUploadCleanups, uploadCleanupDeps } = await import("@/lib/materials/upload-cleanup");
const materialId = "11111111-1111-4111-8111-111111111111";
const workspaceId = "22222222-2222-4222-8222-222222222222";
const token = "33333333-3333-4333-8333-333333333333";
const file = { bucket: "source-materials", path: `${workspaceId}/user/${materialId}/file.pdf` };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.remove.mockResolvedValue({ data: [], error: null });
  mocks.info.mockResolvedValue({ data: null, error: { status: 404, code: "NoSuchKey" } });
  mocks.rpc.mockImplementation(async (name, args) => name === "claim_material_upload_cleanups"
    ? { data: [{ materialId, workspaceId, token, files: [file] }], error: null }
    : { data: args.p_error ? 0 : 1, error: null });
});
afterEach(() => { vi.useRealTimers(); });

describe("Storage deletion requires confirmed absence, never just a successful HTTP status", () => {
  it("accepts an already absent object and acknowledges the material once", async () => {
    expect(await runUploadCleanups(uploadCleanupDeps())).toMatchObject({ removed: 1, failed: 0 });
    expect(mocks.info).toHaveBeenCalledWith(file.path);
    expect(mocks.rpc).toHaveBeenLastCalledWith("finish_material_upload_cleanup", { p_material: materialId, p_token: token, p_error: null });
  });
  it("does not interpret an empty or partial remove response as absence", async () => {
    mocks.info.mockResolvedValue({ data: { name: "file.pdf" }, error: null });
    expect(await runUploadCleanups(uploadCleanupDeps())).toMatchObject({ removed: 0, failed: 1 });
    expect(mocks.rpc).toHaveBeenLastCalledWith("finish_material_upload_cleanup", { p_material: materialId, p_token: token, p_error: "storage_unconfirmed" });
  });
  it("persists the failure and keeps metadata if Storage refuses to delete", async () => {
    mocks.remove.mockResolvedValue({ data: null, error: { status: 503 } });
    expect(await runUploadCleanups(uploadCleanupDeps())).toMatchObject({ removed: 0, failed: 1 });
    expect(mocks.info).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenLastCalledWith("finish_material_upload_cleanup", { p_material: materialId, p_token: token, p_error: "storage_failed" });
  });
  it("does not turn a missing bucket or permission error into a confirmed object deletion", async () => {
    for (const error of [{ status: 404, code: "NoSuchBucket" }, { status: 403 }, { status: 503 }]) {
      mocks.info.mockResolvedValue({ data: null, error });
      expect(await runUploadCleanups(uploadCleanupDeps())).toMatchObject({ removed: 0, failed: 1 });
    }
  });
  it("does not count an unacknowledged DB deletion as confirmed", async () => {
    mocks.rpc.mockImplementation(async (name) => name === "claim_material_upload_cleanups"
      ? { data: [{ materialId, workspaceId, token, files: [file] }], error: null }
      : { data: null, error: { message: "database unavailable" } });
    expect(await runUploadCleanups(uploadCleanupDeps())).toMatchObject({ removed: 0, failed: 1 });
  });
  it("bounded network waiting leaves a recoverable failure without real sleeps", async () => {
    vi.useFakeTimers();
    mocks.remove.mockImplementation(() => new Promise(() => {}));
    const job = runUploadCleanups(uploadCleanupDeps());
    await vi.advanceTimersByTimeAsync(8000);
    expect(await job).toMatchObject({ removed: 0, failed: 1 });
  });
  it("a claim failure never falls back to an unguarded Storage delete", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "function missing" } });
    await expect(runUploadCleanups(uploadCleanupDeps())).rejects.toThrow("cleanup_claim_failed");
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it("rejects corrupt or foreign paths before touching Storage", async () => {
    mocks.rpc.mockResolvedValue({ data: [{ materialId, workspaceId, token, files: [{ ...file, path: "other-workspace/user/material/file.pdf" }] }], error: null });
    await expect(runUploadCleanups(uploadCleanupDeps())).rejects.toThrow();
    expect(mocks.remove).not.toHaveBeenCalled();
  });
});
