export interface Fingerprints {
  files: Set<string>;
  units: Set<string>;
}
export function loadFingerprints(file?: string): Fingerprints;
export function inspect(relPath: string, bytes: Buffer | null, fp: Fingerprints): string[];
export function loadAllowed(file?: string): Set<string>;
export function explain(bytes: Buffer, fp: Fingerprints): Array<{ line: number; words: number; unit_sha256_64: string }>;
