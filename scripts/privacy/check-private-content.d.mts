export interface Fingerprints {
  files: Set<string>;
  units: Set<string>;
}
export function loadFingerprints(file?: string): Fingerprints;
export function inspect(relPath: string, bytes: Buffer | null, fp: Fingerprints): string[];
