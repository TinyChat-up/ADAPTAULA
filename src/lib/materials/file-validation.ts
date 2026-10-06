import { FILE_TYPES, FORMATS_LABEL, type FileFormat, type FileKind, type MaterialLimits } from "./config";

export type ValidationCode =
  | "unsupported_type"
  | "type_mismatch"
  | "empty"
  | "too_large"
  | "corrupt"
  | "encrypted"
  | "too_many_pages";

const MIB = 1024 * 1024;

/** Messages shown to the teacher. Never technical, never a stack trace. */
export function describeValidationError(code: ValidationCode, limits?: MaterialLimits): string {
  switch (code) {
    case "unsupported_type":
      return `Este formato todavía no es compatible. Sube un archivo ${FORMATS_LABEL}.`;
    case "type_mismatch":
      return "El contenido del archivo no coincide con su extensión. Comprueba que sea un PDF o una imagen válidos.";
    case "empty":
      return "El archivo está vacío.";
    case "too_large": {
      const mb = limits ? Math.floor(Math.max(limits.maxPdfBytes, limits.maxImageBytes) / MIB) : null;
      return mb
        ? `El archivo supera el tamaño máximo permitido (${Math.floor(limits!.maxPdfBytes / MIB)} MB para PDF, ${Math.floor(limits!.maxImageBytes / MIB)} MB para imágenes).`
        : "El archivo supera el tamaño máximo permitido.";
    }
    case "corrupt":
      return "No hemos podido leer este archivo. Parece dañado: prueba a exportarlo de nuevo.";
    case "encrypted":
      return "Este PDF está protegido con contraseña. Quita la protección y vuelve a subirlo.";
    case "too_many_pages":
      return limits
        ? `Este PDF tiene más páginas de las permitidas en tu plan (máximo ${limits.maxPages}).`
        : "Este PDF tiene más páginas de las permitidas en tu plan.";
  }
}

const startsWith = (bytes: Uint8Array, signature: readonly number[], offset = 0) =>
  bytes.length >= offset + signature.length && signature.every((b, i) => bytes[offset + i] === b);

/** Identifies the real format from the first bytes, ignoring name and declared MIME. */
export function sniffFormat(bytes: Uint8Array): FileFormat | null {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "pdf"; // %PDF-
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return "webp"; // RIFF....WEBP
  return null;
}

export function formatFromExtension(fileName: string): FileFormat | null {
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
  const entry = (Object.entries(FILE_TYPES) as [FileFormat, (typeof FILE_TYPES)[FileFormat]][]).find(([, t]) =>
    (t.extensions as readonly string[]).includes(extension),
  );
  return entry?.[0] ?? null;
}

function maxBytesFor(kind: FileKind, limits: MaterialLimits): number {
  return kind === "pdf" ? limits.maxPdfBytes : limits.maxImageBytes;
}

export type DeclaredResult = { ok: true; format: FileFormat } | { ok: false; code: ValidationCode };

/**
 * First, cheap gate before a signed upload URL is issued. Everything here is declared by the browser,
 * so it is a UX shortcut only: the content is validated again after the upload.
 */
export function validateDeclaredFile(file: { name: string; size: number; mime: string }, limits: MaterialLimits): DeclaredResult {
  const format = formatFromExtension(file.name);
  if (!format) return { ok: false, code: "unsupported_type" };
  const type = FILE_TYPES[format];
  if (file.mime && file.mime !== type.mime && !(format === "jpeg" && file.mime === "image/jpg")) {
    return { ok: false, code: "unsupported_type" };
  }
  if (!Number.isFinite(file.size) || file.size <= 0) return { ok: false, code: "empty" };
  if (file.size > maxBytesFor(type.kind, limits)) return { ok: false, code: "too_large" };
  return { ok: true, format };
}

export type ContentResult = { ok: true; format: FileFormat; mime: string; extension: string; kind: FileKind } | { ok: false; code: ValidationCode };

/** Authoritative check on the bytes the server actually received. */
export function validateFileContent(bytes: Uint8Array, declaredFormat: FileFormat, limits: MaterialLimits): ContentResult {
  if (bytes.length === 0) return { ok: false, code: "empty" };
  const real = sniffFormat(bytes);
  if (!real) return { ok: false, code: "unsupported_type" };
  if (real !== declaredFormat) return { ok: false, code: "type_mismatch" };
  const type = FILE_TYPES[real];
  if (bytes.length > maxBytesFor(type.kind, limits)) return { ok: false, code: "too_large" };
  return { ok: true, format: real, mime: type.mime, extension: type.extensions[0], kind: type.kind };
}
