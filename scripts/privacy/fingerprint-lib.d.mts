export const MIN_CHARS: number;
export const MIN_WORDS: number;
export function normalize(text: string): string;
export function units(text: string): Set<string>;
export function unitHash(normalized: string): string;
export function fileHash(bytes: Uint8Array): string;
export function isText(bytes: Buffer): boolean;
export const FORBIDDEN_PATHS: ReadonlyArray<{ re: RegExp; why: string }>;
export function forbiddenPath(path: string): string | null;
