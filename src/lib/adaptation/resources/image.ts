import "server-only";
import { createCanvas, loadImage } from "@napi-rs/canvas";

/**
 * A teacher's image, validated on its BYTES (never its name or declared type) and normalised before it is stored: decoded and
 * redrawn as a PNG, so no EXIF, location, author or other metadata of the original file survives. Proportions are kept; a large
 * photo is reduced so that its longest side fits a printed A4 sheet with room to spare. Nothing is generated or retouched.
 */

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const MIN_SIDE = 32;
const MAX_INPUT_SIDE = 12_000;
/** Longest side of the stored image (≈ 20 cm at 300 ppp): sharp in print, small enough for the sheet. */
export const MAX_STORED_SIDE = 2400;

export type ImageRejection = "too_large" | "unsupported_type" | "unreadable" | "too_small" | "too_big_dimensions";

const startsWith = (bytes: Uint8Array, signature: readonly number[], offset = 0) => signature.every((b, i) => bytes[offset + i] === b);

export function imageKind(bytes: Uint8Array): "png" | "jpeg" | "webp" | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "jpeg";
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return "webp";
  return null;
}

export async function normaliseTeacherImage(bytes: Uint8Array): Promise<{ ok: true; png: Uint8Array; width: number; height: number } | { ok: false; reason: ImageRejection }> {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_UPLOAD_BYTES) return { ok: false, reason: "too_large" };
  if (!imageKind(bytes)) return { ok: false, reason: "unsupported_type" };
  let image: Awaited<ReturnType<typeof loadImage>>;
  try {
    image = await loadImage(Buffer.from(bytes));
  } catch {
    return { ok: false, reason: "unreadable" };
  }
  const { width, height } = image;
  if (!width || !height) return { ok: false, reason: "unreadable" };
  if (width < MIN_SIDE || height < MIN_SIDE) return { ok: false, reason: "too_small" };
  if (width > MAX_INPUT_SIDE || height > MAX_INPUT_SIDE) return { ok: false, reason: "too_big_dimensions" };
  const scale = Math.min(1, MAX_STORED_SIDE / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  // A transparent image prints on white paper: flatten it on white so it looks the same on screen and in the PDF.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(image, 0, 0, w, h);
  const png = await canvas.encode("png");
  return { ok: true, png: new Uint8Array(png), width: w, height: h };
}

/** What the teacher reads when an image is refused: plain words, never a technical code. */
export const IMAGE_REJECTION_COPY: Record<ImageRejection, string> = {
  too_large: "La imagen pesa demasiado. Usa una de 8 MB como máximo.",
  unsupported_type: "Ese archivo no es una imagen PNG, JPG o WebP.",
  unreadable: "No hemos podido abrir esa imagen. Prueba con otra.",
  too_small: "La imagen es demasiado pequeña para imprimirse con claridad.",
  too_big_dimensions: "La imagen es demasiado grande. Prueba con una de menor resolución.",
};
