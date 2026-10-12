/**
 * image_render v1 — the text an image model receives for one educational illustration, built deterministically from a validated
 * brief (`image_brief@v1`). The style is fixed (Sistema CLARO: printed worksheet, black and white friendly) and is not the model's
 * choice; the brief only says WHAT must be seen. Corrections from a rejected review are appended on the second attempt.
 * Nothing about the learner travels: the brief carries no learner data by construction.
 */

export interface RenderBrief {
  kind: string;
  concept: string;
  composition: string;
  detail_level: "minimal" | "simple" | "moderate";
  required_elements: ReadonlyArray<{ name: string; marker: number | null; label: string | null }>;
  prohibited_elements: readonly string[];
  conceptual_constraints: readonly string[];
}

const DETAIL: Record<RenderBrief["detail_level"], string> = {
  minimal: "Detalle mínimo: solo los elementos imprescindibles, formas simples, mucho espacio en blanco alrededor.",
  simple: "Detalle sencillo: los elementos imprescindibles y lo justo para reconocerlos.",
  moderate: "Detalle moderado: los elementos imprescindibles bien diferenciados, sin elementos accesorios.",
};

const AGE: Record<string, string> = {
  primaria: "Público: alumnado de Primaria. Estilo claro y amable, sin infantilizar ni añadir personajes.",
  eso: "Público: alumnado de ESO. Estilo sobrio de libro de texto de secundaria, proporciones realistas, nada infantil.",
  bachillerato: "Público: alumnado de Bachillerato. Estilo sobrio y técnico de libro de texto, proporciones realistas.",
};

export const IMAGE_RENDER_V1 = {
  key: "image_render",
  version: 1,
  build(brief: RenderBrief, options: { stage: string | null; corrections?: readonly string[] }): string {
    const markers = brief.required_elements.filter((e) => e.marker !== null).sort((a, b) => a.marker! - b.marker!);
    const labels = brief.required_elements.filter((e) => e.label);
    const lines = [
      "Ilustración educativa para una ficha escolar impresa.",
      "Estilo obligatorio: dibujo vectorial plano, contornos negros uniformes, fondo blanco liso, rellenos en grises claros (debe verse bien impreso en blanco y negro), sin degradados, sin sombras, sin texturas, sin marcos, sin adornos, sin personajes ni elementos decorativos, sin marcas de agua.",
      AGE[options.stage ?? ""] ?? "Público: alumnado de educación obligatoria. Estilo sobrio y claro, sin infantilizar.",
      DETAIL[brief.detail_level],
      `Tema: ${brief.concept}.`,
      `Composición: ${brief.composition}.`,
      `Debe verse con claridad: ${brief.required_elements.map((e) => e.name).join("; ")}.`,
    ];
    if (markers.length > 0) {
      lines.push(`Marcadores: un círculo blanco con borde negro y el número dentro, con una línea guía fina que toque exactamente el elemento: ${markers.map((e) => `${e.marker} → ${e.name}`).join("; ")}. No escribas el nombre de esos elementos.`);
    }
    if (labels.length > 0) {
      lines.push(`Etiquetas: escribe exactamente estos textos, en español, en letra de imprenta clara y grande, cada uno unido a su elemento con una línea guía: ${labels.map((e) => `«${e.label}» → ${e.name}`).join("; ")}.`);
    }
    if (markers.length === 0 && labels.length === 0) lines.push("No escribas ningún texto, número ni letra en la imagen.");
    else lines.push("Ningún otro texto, número ni letra aparte de los indicados.");
    if (brief.conceptual_constraints.length > 0) lines.push(`Respeta: ${brief.conceptual_constraints.join("; ")}.`);
    if (brief.prohibited_elements.length > 0) lines.push(`No incluyas: ${brief.prohibited_elements.join("; ")}.`);
    if (options.corrections && options.corrections.length > 0) lines.push(`Corrige respecto al intento anterior: ${options.corrections.join("; ")}.`);
    return lines.join("\n");
  },
} as const;
