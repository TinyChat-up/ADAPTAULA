import { BRAND_SYMBOL } from "@/lib/brand/symbol";

const grey = (hex: string) => {
  const v = Math.round(0.2126 * parseInt(hex.slice(1, 3), 16) + 0.7152 * parseInt(hex.slice(3, 5), 16) + 0.0722 * parseInt(hex.slice(5, 7), 16));
  const h = v.toString(16).padStart(2, "0");
  return `#${h}${h}${h}`;
};

/**
 * The official symbol in the sheet header, inline: vector in the preview and in the PDF, with no URL (the print CSP only allows
 * data) and no image to pin. No hooks: the PDF prerenders the sheet outside the app's React (a hook there breaks the export), so the
 * gradient ids come from `idPrefix`, which the sheet derives from what it prints (two different sheets never share them).
 * `greyscale`: the sheet's high-contrast profile prints in one ink; the symbol keeps each gradient's brightness, so its four shapes
 * stay apart (a single flat ink would merge the two leaves on the right into another shape).
 */
export function BrandSymbol({ idPrefix, greyscale = false }: { idPrefix: string; greyscale?: boolean }) {
  const prefix = `ms-brand-${idPrefix.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <svg className="ms-symbol" viewBox={BRAND_SYMBOL.viewBox} role="img" aria-label="Adaptaula" focusable="false">
      <defs>
        {BRAND_SYMBOL.gradients.map((g) => (
          <linearGradient key={g.id} id={`${prefix}-${g.id}`} gradientUnits="userSpaceOnUse" x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2}>
            {g.stops.map(([offset, color]) => <stop key={offset} offset={offset} stopColor={greyscale ? grey(color) : color} />)}
          </linearGradient>
        ))}
      </defs>
      {BRAND_SYMBOL.paths.map((p) => <path key={p.gradient} fill={`url(#${prefix}-${p.gradient})`} d={p.d} />)}
    </svg>
  );
}
