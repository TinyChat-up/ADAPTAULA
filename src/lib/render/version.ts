/** Version of the deterministic renderer (`MaterialDocument` → `RenderModel` → screen/print). Not a prompt version: no model is involved. */
/**
 * v5: legible number-line labels, exclusive figure grouping and defensive structural validation.
 * v6 (Fase B, ADR-040): the printed output changes in contract — CLARO by default, squared areas as SVG zones of whole squares,
 * labelled fields with a unit slot, physical-height pagination and figures repeated next to a later activity. Stored documents are
 * read and printed as before (the version is not stored in them, nor used as a cache key: it names what the renderer prints).
 * v7 (Fase C, ADR-041): the CLARO header prints the official Adaptaula symbol (inline vector) instead of the word, and the accent is
 * the brand navy. Content, answer spaces and pagination are those of v6; stored documents read and print as before.
 * v8 (#64): complete teaching units, balanced task groups and short closing pairs. Original content and answer capacity are preserved.
 */
export const MATERIAL_RENDERER_VERSION = "material_renderer@v8";
