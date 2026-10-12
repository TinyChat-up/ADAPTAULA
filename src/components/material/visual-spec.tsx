import type { ReactNode } from "react";
import { COMPARISON, LINE, barGeometry, comparisonGeometry, numberLineGeometry, type Fraction, type VisualSpec } from "@/lib/visuals/spec";

/**
 * The deterministic drawing of a `VisualSpec`: React SVG elements from validated numbers only (no markup string, no link, no
 * script, no external resource), sized in millimetres so the screen, the print and the PDF draw the same figure. Black on white
 * with a mid-grey shade (contrast > 4.5:1 against white), readable in black-and-white print.
 */

const SHADE = "#767676";
const STROKE = 0.4;
const FONT = 3.6;
const DIGIT = { fontSize: FONT, textAnchor: "middle" as const, fill: "currentColor" };

/** A fraction as printed in school: numerator over a bar over denominator; an integer stays on one line. */
function Stacked({ value, x, y }: { value: Fraction; x: number; y: number }) {
  if (value.d === 1) {
    return (
      <text x={x} y={y + FONT * 0.35} {...DIGIT}>
        {value.n}
      </text>
    );
  }
  const half = Math.max(String(value.n).length, String(value.d).length) * FONT * 0.32 + 0.6;
  return (
    <g>
      <text x={x} y={y - 0.9} {...DIGIT}>
        {value.n}
      </text>
      <line x1={x - half} x2={x + half} y1={y} y2={y} stroke="currentColor" strokeWidth={0.3} />
      <text x={x} y={y + FONT * 0.95} {...DIGIT}>
        {value.d}
      </text>
    </g>
  );
}

function Frame({ width, height, label, children, kind }: { width: number; height: number; label: string; children: ReactNode; kind: VisualSpec["kind"] }) {
  const m = 1;
  return (
    <svg className="ms-spec" data-spec={kind} role="img" aria-label={label} width={`${width + 2 * m}mm`} height={`${height + 2 * m}mm`} viewBox={`${-m} ${-m} ${width + 2 * m} ${height + 2 * m}`}>
      {children}
    </svg>
  );
}

function Bar({ spec, label }: { spec: Extract<VisualSpec, { kind: "fraction_bar" }>; label: string }) {
  const g = barGeometry(spec);
  return (
    <Frame width={g.width} height={g.height} label={label} kind={spec.kind}>
      {g.parts.map((p, i) => (
        <rect key={i} data-part={i} data-shaded={p.shaded || undefined} x={p.x} y={0} width={p.w} height={g.height} fill={p.shaded ? SHADE : "#ffffff"} stroke="currentColor" strokeWidth={STROKE} />
      ))}
    </Frame>
  );
}

function NumberLine({ spec, label }: { spec: Extract<VisualSpec, { kind: "number_line" }>; label: string }) {
  const g = numberLineGeometry(spec);
  const axisY = LINE.tick + 1;
  const first = g.ticks[0]!.x;
  const last = g.ticks.at(-1)!.x;
  return (
    <Frame width={g.width} height={axisY + LINE.tick + 10} label={label} kind={spec.kind}>
      <line x1={first} x2={last} y1={axisY} y2={axisY} stroke="currentColor" strokeWidth={STROKE} />
      {g.ticks.map((t, i) => (
        <g key={i} data-tick={i}>
          <line x1={t.x} x2={t.x} y1={axisY - LINE.tick} y2={axisY + LINE.tick} stroke="currentColor" strokeWidth={STROKE} />
          {t.label ? <Stacked value={t.label} x={t.x} y={axisY + LINE.tick + 4.6} /> : null}
        </g>
      ))}
    </Frame>
  );
}

function PartWhole({ spec, label }: { spec: Extract<VisualSpec, { kind: "part_whole" }>; label: string }) {
  const shaded = new Set(spec.shaded);
  if (spec.shape === "rectangle") return <Bar spec={{ ...spec, kind: "fraction_bar" }} label={label} />;
  const r = 18;
  const point = (i: number) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / spec.parts;
    return `${(r + r * Math.cos(a)).toFixed(3)} ${(r + r * Math.sin(a)).toFixed(3)}`;
  };
  return (
    <Frame width={2 * r} height={2 * r} label={label} kind={spec.kind}>
      {Array.from({ length: spec.parts }, (_, i) => (
        <path key={i} data-part={i} data-shaded={shaded.has(i) || undefined} d={`M ${r} ${r} L ${point(i)} A ${r} ${r} 0 0 1 ${point(i + 1)} Z`} fill={shaded.has(i) ? SHADE : "#ffffff"} stroke="currentColor" strokeWidth={STROKE} />
      ))}
    </Frame>
  );
}

/** «2/3 ☐ 3/5»: the two numbers and ONE empty box per item. Nothing is ever written in the box. */
function Comparison({ spec, label }: { spec: Extract<VisualSpec, { kind: "comparison" }>; label: string }) {
  const g = comparisonGeometry(spec);
  const h = 14;
  const mid = h / 2;
  return (
    <Frame width={g.width} height={h} label={label} kind={spec.kind}>
      {spec.items.map((item, i) => {
        const at = g.items[i]!;
        return (
          <g key={i} data-item={i}>
            <Stacked value={item.left} x={at.left + COMPARISON.fractionWidth / 2} y={mid} />
            <rect data-answer-box="" x={at.box} y={mid - COMPARISON.box / 2} width={COMPARISON.box} height={COMPARISON.box} fill="#ffffff" stroke="currentColor" strokeWidth={STROKE} />
            <Stacked value={item.right} x={at.right + COMPARISON.fractionWidth / 2} y={mid} />
          </g>
        );
      })}
    </Frame>
  );
}

function Grid({ spec, label }: { spec: Extract<VisualSpec, { kind: "grid" }>; label: string }) {
  const cell = 8;
  const shaded = new Set(spec.shaded);
  return (
    <Frame width={spec.cols * cell} height={spec.rows * cell} label={label} kind={spec.kind}>
      {Array.from({ length: spec.rows * spec.cols }, (_, i) => (
        <rect key={i} data-cell={i} data-shaded={shaded.has(i) || undefined} x={(i % spec.cols) * cell} y={Math.floor(i / spec.cols) * cell} width={cell} height={cell} fill={shaded.has(i) ? SHADE : "#ffffff"} stroke="currentColor" strokeWidth={STROKE} />
      ))}
    </Frame>
  );
}

/** A new support: numbered steps in a row of boxes (text wraps; same markup on screen and in print). */
function Steps({ spec, label }: { spec: Extract<VisualSpec, { kind: "steps" }>; label: string }) {
  return (
    <div className="ms-vsupport" data-spec={spec.kind} role="group" aria-label={label}>
      {spec.title ? <p className="ms-vsupport-title">{spec.title}</p> : null}
      <ol className="ms-vsteps">
        {spec.items.map((item, i) => (
          <li key={i}>
            <span className="ms-vstep-n" aria-hidden>
              {i + 1}
            </span>
            <span>{item}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** A new support: vocabulary cards (a term and a short cue). */
function Cards({ spec, label }: { spec: Extract<VisualSpec, { kind: "cards" }>; label: string }) {
  return (
    <div className="ms-vsupport" data-spec={spec.kind} role="group" aria-label={label}>
      {spec.title ? <p className="ms-vsupport-title">{spec.title}</p> : null}
      <ul className="ms-vcards">
        {spec.items.map((c, i) => (
          <li key={i}>
            <strong>{c.term}</strong>
            <span>{c.hint}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function VisualSpecView({ spec, label }: { spec: VisualSpec; label: string }) {
  switch (spec.kind) {
    case "fraction_bar":
      return <Bar spec={spec} label={label} />;
    case "number_line":
      return <NumberLine spec={spec} label={label} />;
    case "part_whole":
      return <PartWhole spec={spec} label={label} />;
    case "comparison":
      return <Comparison spec={spec} label={label} />;
    case "grid":
      return <Grid spec={spec} label={label} />;
    case "steps":
      return <Steps spec={spec} label={label} />;
    case "cards":
      return <Cards spec={spec} label={label} />;
  }
}
