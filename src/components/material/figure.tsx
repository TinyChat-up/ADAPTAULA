import type { RenderDesign, RenderMode, RenderNode } from "@/lib/render/model";
import { VisualSpecView } from "./visual-spec";

/**
 * An image node: the original's figure (its crop at the size it had on paper, or its verified reconstruction drawn by our own
 * renderer) or the resource a decision asked for. Same markup on screen, in print and in the PDF.
 */
// Match the existing CSS ceiling; scale BOTH dimensions before CSS applies its width constraint.
const MAX_IMAGE_HEIGHT_MM = (297 - 2 * 18) * 0.6;

export function Figure({ node, mode, design }: { node: Extract<RenderNode, { kind: "image" }>; mode: RenderMode; design?: RenderDesign }) {
  if (node.state === "available" && (node.spec || node.src)) {
    const widthMm = node.widthMm && node.heightMm
      ? Math.min(node.widthMm, node.widthMm * MAX_IMAGE_HEIGHT_MM / node.heightMm)
      : node.widthMm;
    return (
      <figure className="ms-figure" data-spec={node.spec?.kind}>
        {design === "claro" ? <p className="ms-cue">Observa</p> : null}
        {node.spec ? (
          <VisualSpecView spec={node.spec} label={node.alt} />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- a private, already-authorised asset URL; sizing is the sheet's
          <img src={node.src} alt={node.alt} {...(widthMm ? { "data-physical": "", style: { width: `${widthMm}mm` } } : {})} />
        )}
        {node.caption ? <figcaption className="ms-caption">{node.caption}</figcaption> : null}
      </figure>
    );
  }
  // Student sheet: never a stand-in image and never a pretence that it exists. The teacher view marks the gap. A visual the teacher
  // decided to go without leaves no trace on the sheet.
  if (mode !== "teacher_preview" || node.state === "omitted") return null;
  return (
    <div className="ms-missing" role="note">
      {node.state === "pending"
        ? node.essential
          ? "Falta un recurso visual imprescindible (no está en el original)"
          : "Apoyo visual opcional sin recurso"
        : node.essential
          ? "Falta una imagen necesaria del material original"
          : "Falta una imagen del material original"}
      {node.caption ? ` · ${node.caption}` : ""}
    </div>
  );
}
