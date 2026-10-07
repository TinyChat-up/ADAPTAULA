import "server-only";
import { createHash } from "node:crypto";
import type { RenderModel } from "@/lib/render/model";

/**
 * A visual asset fixed for one export: the exact physical instance (asset id + sha-256), never "the newest crop of that visual".
 * The `RenderModel` of an export carries only the reference `asset:<assetId>@<sha256>` (stable, small, part of its fingerprint);
 * the bytes travel apart and become a data URI only inside `renderPrintHtml`, after their checksum is verified. Who reads the
 * bytes (Storage, `readAssetInstance`) is the caller's business.
 */
export interface PinnedAsset {
  assetId: string;
  sha256: string;
  mime: "image/png";
  bytes: Uint8Array;
}

export class PinnedAssetError extends Error {
  constructor(
    readonly code: "invalid_pin" | "asset_corrupt" | "asset_unsupported" | "asset_unpinned",
    readonly assetId?: string,
  ) {
    super(code);
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HEX64 = /^[a-f0-9]{64}$/;
const REF = /^asset:([0-9a-f-]{36})@([a-f0-9]{64})$/;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function assetRef(pin: { assetId: string; sha256: string }): string {
  if (!UUID.test(pin.assetId) || !HEX64.test(pin.sha256)) throw new PinnedAssetError("invalid_pin", pin.assetId);
  return `asset:${pin.assetId}@${pin.sha256}`;
}

export function parseAssetRef(src: string): { assetId: string; sha256: string } | null {
  const m = REF.exec(src);
  return m && UUID.test(m[1]!) ? { assetId: m[1]!, sha256: m[2]! } : null;
}

/** The bytes are what the pin says they are (checksum and PNG signature), or the export cannot use them. */
export function verifyPinnedAsset(asset: PinnedAsset): void {
  assetRef(asset);
  if (asset.mime !== "image/png" || !PNG_SIGNATURE.every((b, i) => asset.bytes[i] === b)) throw new PinnedAssetError("asset_unsupported", asset.assetId);
  if (createHash("sha256").update(asset.bytes).digest("hex") !== asset.sha256) throw new PinnedAssetError("asset_corrupt", asset.assetId);
}

/** Every image source of a print model must be a pin reference: no URL, path or route ever reaches the printed sheet. */
export function modelAssetRefs(model: RenderModel): string[] {
  const refs = new Set<string>();
  for (const node of model.pages.flatMap((p) => p.nodes)) {
    if (node.kind !== "image" || node.state !== "available") continue;
    const pin = node.src ? parseAssetRef(node.src) : null;
    if (!pin) throw new PinnedAssetError("asset_unpinned");
    refs.add(assetRef(pin));
  }
  return [...refs].sort();
}
