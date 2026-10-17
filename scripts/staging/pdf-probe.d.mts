export function inspectPdf(bytes: Uint8Array, expectedPages: number, markers: string[]): Promise<{
  pages: number;
  bytes: number;
  imageOps: number;
}>;
