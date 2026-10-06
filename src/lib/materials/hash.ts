import { createHash } from "node:crypto";

/** Hash of the exact bytes received. Identical files give identical hashes; it is never shown to users. */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
