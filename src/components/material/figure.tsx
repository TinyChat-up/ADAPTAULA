import type { RenderDesign, RenderMode, RenderNode } from "@/lib/render/model";
import { VisualSpecView } from "./visual-spec";

/**
 * An image node: the original's figure (its crop at the size it had on paper, or its verified reconstruction drawn by our own
 * renderer) or the resource a decision asked for. Same markup on screen, in print and in the PDF.
 */
export function Figure({ node, mode, design }: { node: Extract<RenderNode, { kind: "image" }>; mode: RenderMode; design?: RenderDesign }) {
  if (node.state === "available" && (node.spec || node.src)) {
    return (
      <figure className="ms-figure" data-spec={node.spec?.kind}>
        {design === "claro" ? <p className="ms-cue">Observa</p> : null}
        {node.spec ? (
          <VisualSpecView spec={node.spec} label={node.alt} />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- a private, already-authorised asset URL; sizing is the sheet's
          <img src={node.src} alt={node.alt} {...(node.widthMm ? { "data-physical": "", style: { width: `${node.widthMm}mm` } } : {})} />
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
