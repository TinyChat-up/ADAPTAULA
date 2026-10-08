import type { Presentation } from "@/lib/schemas/adaptation-context";

/**
 * Design tokens of the printed sheet. They live here, not in `MaterialDocument` (which only carries semantic presentation
 * settings) and not in the app's design system: the sheet is its own surface, neutral and printable. The document says
 * "font_scale 1.3"; this file says what that means in points.
 */
export interface RenderTokens {
  page: { widthMm: number; heightMm: number; marginMm: number };
  /** Base text size in pt (print) after the document's `font_scale`. */
  fontPt: number;
  lineHeight: number;
  /** Vertical gap between blocks, in em. */
  gapEm: number;
  /** Distance between writing lines, in mm: room to write by hand. */
  answerLineMm: number;
  /** Height of one checkbox / numbering box, in mm. */
  boxMm: number;
  contrast: Presentation["contrast"];
  decoration: Presentation["decoration"];
  maxTasksPerPage: number | null;
}

const LINE_HEIGHT: Record<Presentation["line_spacing"], number> = { normal: 1.5, relaxed: 1.7, loose: 1.9 };
const GAP: Record<Presentation["spacing"], number> = { normal: 1.1, wide: 1.6 };

/** A prudent modulation by stage: a little more room for the youngest, tighter for Bachillerato. No change of look. */
const STAGE: Record<string, { basePt: number; lineMm: number }> = {
  primaria: { basePt: 12, lineMm: 10 },
  eso: { basePt: 11, lineMm: 9 },
  bachillerato: { basePt: 11, lineMm: 8.5 },
};
const DEFAULT_STAGE = { basePt: 11.5, lineMm: 9 };

/**
 * Sistema CLARO: the editorial scale by stage (Primaria 12.5 pt, ESO 11.75 pt, Bachillerato 11.25 pt), before the profile's
 * `font_scale`. The stage sets the tone; the functional profile still enlarges whatever it needs, at any stage.
 */
const CLARO_STAGE: Record<string, { basePt: number; lineMm: number }> = {
  primaria: { basePt: 12.5, lineMm: 10 },
  eso: { basePt: 11.75, lineMm: 9 },
  bachillerato: { basePt: 11.25, lineMm: 8.5 },
};

export function renderTokens(presentation: Presentation, stage: string, design: "standard" | "claro" = "standard"): RenderTokens {
  const s = (design === "claro" ? CLARO_STAGE[stage] : STAGE[stage]) ?? DEFAULT_STAGE;
  const scale = presentation.font_scale;
  return {
    page: { widthMm: 210, heightMm: 297, marginMm: 18 },
    fontPt: Math.round(s.basePt * scale * 10) / 10,
    lineHeight: LINE_HEIGHT[presentation.line_spacing],
    gapEm: GAP[presentation.spacing],
    answerLineMm: Math.round(s.lineMm * (1 + (scale - 1) / 2) * 10) / 10,
    boxMm: Math.round(5.5 * (1 + (scale - 1) / 2) * 10) / 10,
    contrast: presentation.contrast,
    decoration: presentation.decoration,
    maxTasksPerPage: presentation.max_tasks_per_page,
  };
}

/** CSS custom properties for the sheet (`material.css` reads them). Values only: no layout decisions are made here. */
export function tokenStyle(t: RenderTokens): Record<string, string> {
  return {
    "--ms-page-w": `${t.page.widthMm}mm`,
    "--ms-page-h": `${t.page.heightMm}mm`,
    "--ms-margin": `${t.page.marginMm}mm`,
    "--ms-font": `${t.fontPt}pt`,
    "--ms-leading": String(t.lineHeight),
    "--ms-gap": `${t.gapEm}em`,
    "--ms-line": `${t.answerLineMm}mm`,
    "--ms-box": `${t.boxMm}mm`,
    "--ms-ink": t.contrast === "high" ? "#000000" : "#1a1a1a",
    "--ms-rule": t.contrast === "high" ? "#000000" : "#4a4a4a",
    "--ms-soft": t.contrast === "high" ? "#000000" : "#5f6670",
    // One accent, dark enough to read as black when printed in greyscale: it helps find things, it never carries meaning alone.
    "--ms-accent": t.contrast === "high" ? "#000000" : "#23426b",
    // Surfaces of helps and instructions: a tint that photocopies as a very light grey (never needed to understand anything).
    "--ms-tint": t.contrast === "high" ? "#ffffff" : "#eef1f5",
    "--ms-rule-soft": t.contrast === "high" ? "#000000" : "#c3c8d0",
    // Writing lines and squares: visible on paper, lighter than the text.
    "--ms-write": t.contrast === "high" ? "#000000" : "#8b919a",
    "--ms-grid": t.contrast === "high" ? "#555555" : "#c9ced6",
    // Sistema CLARO palette (used only under [data-design="claro"]): Azul Adaptaula is --ms-accent; petroleum green marks helps
    // only; fog blue is the orientation surface. All of them print as distinct greys and none carries meaning on its own.
    "--ms-petrol": t.contrast === "high" ? "#000000" : "#227e81",
    "--ms-fog": t.contrast === "high" ? "#ffffff" : "#eff3f7",
  };
}
