import "server-only";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fingerprint } from "@/lib/adaptation/fingerprint";

/**
 * The files the printed sheet needs besides its markup: `material.css` (the same file the app imports) and the sheet font. They are
 * read from the project tree at run time, never from the network; a deployment must trace them (`outputFileTracingIncludes` of
 * the route that exports, docs/ADAPTATION.md § PDF). Each font face is pinned by its sha-256: a different file is an error, not
 * a silent change of the printed document.
 */

export const SHEET_DIR = "src/components/material";

export const SHEET_FONT = {
  family: "Adaptaula Inter",
  /** Official static WOFF2 of Inter 4.1 (rsms/inter release `Inter-4.1.zip`, `web/`), SIL OFL 1.1: `fonts/LICENSE.txt`. */
  source: "Inter 4.1",
  faces: [
    { file: "Inter-Regular.woff2", weight: 400, sha256: "e06f6b1bc553aaea4e4668023ed0ab0a147129c3107f511bc7d03d361b0ae085" },
    { file: "Inter-SemiBold.woff2", weight: 600, sha256: "5cb7103e4e605989afebc03d989c79201e54b21b5183db33981f70db9178a301" },
    { file: "Inter-Bold.woff2", weight: 700, sha256: "fa888127b6da015b65569f0351f3b5c391ad928904951f1c20e9f8462a8d95ea" },
  ],
} as const;

export type FontFace = (typeof SHEET_FONT.faces)[number] & { bytes: Buffer };

export class SheetAssetError extends Error {
  constructor(readonly code: "font_missing" | "font_mismatch" | "css_missing") {
    super(code);
  }
}

const sha256 = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const sheetPath = (...parts: string[]) => path.join(process.cwd(), SHEET_DIR, ...parts);

/** Deterministic identity of the printed font: family, version and the bytes of every face. */
export const fontFingerprint = (): string => fingerprint(SHEET_FONT);

export function readSheetCss(): string {
  try {
    return readFileSync(sheetPath("material.css"), "utf8");
  } catch {
    throw new SheetAssetError("css_missing");
  }
}

export const cssFingerprint = (css: string): string => sha256(css);

export function loadSheetFonts(): FontFace[] {
  return SHEET_FONT.faces.map((face) => {
    let bytes: Buffer;
    try {
      bytes = readFileSync(sheetPath("fonts", face.file));
    } catch {
      throw new SheetAssetError("font_missing");
    }
    if (sha256(bytes) !== face.sha256) throw new SheetAssetError("font_mismatch");
    return { ...face, bytes };
  });
}
