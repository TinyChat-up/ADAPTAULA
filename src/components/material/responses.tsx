import type { RenderResponse } from "@/lib/render/model";
import { describeSpec } from "@/lib/visuals/spec";
import { VisualSpecView } from "./visual-spec";

const Lines = ({ count }: { count: number }) => (
  <div className="ms-lines" aria-hidden>
    {Array.from({ length: count }, (_, i) => (
      <div key={i} />
    ))}
  </div>
);

/** Height of a grid stored before answer_space@v1 (no rows): the 66 mm it always had, in whole squares of the sheet. */
const LEGACY_GRID_MM = 66;
const PX_PER_MM = 96 / 25.4;

/**
 * A squared area: `rows` × `columns` WHOLE squares of `cellMm` (the columns that fit the answer column), so a digit always has a
 * whole square and the grid never ends in a cut row or column. Real vector lines inside its own box: they print crisp and faint in
 * any PDF viewer and in greyscale (Chromium's PDF output dropped both a CSS background pattern and an SVG `<pattern>`).
 */
function Grid({ rows, cellMm, columns }: { rows: number | null; cellMm: number; columns: number }) {
  const n = rows ?? Math.max(3, Math.floor(LEGACY_GRID_MM / cellMm));
  const cell = cellMm * PX_PER_MM;
  const [w, h] = [columns * cell, n * cell];
  const d = [...Array.from({ length: n + 1 }, (_, i) => `M0 ${i * cell}H${w}`), ...Array.from({ length: columns + 1 }, (_, i) => `M${i * cell} 0V${h}`)].join("");
  return (
    <svg className="ms-grid-area" data-rows={n} data-columns={columns} data-cell-mm={cellMm} viewBox={`0 0 ${w} ${h}`} style={{ width: `${columns * cellMm}mm`, height: `${n * cellMm}mm` }} aria-hidden focusable="false">
      <path d={d} className="ms-grid-line" />
    </svg>
  );
}
const LETTERS = "ABCDEFGHIJ";

const MODE_LABEL = { oral: "Respuesta oral", keyboard: "Respuesta con teclado", other: "Respuesta alternativa" } as const;

/**
 * The answer area of an activity, one renderer per response kind of the schema (exhaustive: `RenderResponse` is a closed union).
 * These are real writing/marking spaces; the key never gets here (the model has none).
 */
export function Response({ response }: { response: RenderResponse }) {
  switch (response.kind) {
    case "lines":
      return <Lines count={response.lines} />;
    case "box":
      return <div className="ms-box-area" style={{ height: `calc(var(--ms-line) * ${response.rows})` }} aria-hidden />;
    case "grid":
      return <Grid rows={response.rows} cellMm={response.cellMm} columns={response.columns} />;
    case "table_cells":
      // The table of the sheet the activity points at is where the student writes: a second, empty box would only compete with it.
      return response.inTable ? null : <div className="ms-box-area" style={{ height: `calc(var(--ms-line) * ${response.rows})` }} aria-hidden />;
    case "choice":
      return (
        <ul className="ms-options">
          {response.options.map((o, i) => (
            <li key={i}>
              <span className={response.multiple ? "ms-box" : "ms-box ms-round"} aria-hidden />
              <span>{o}</span>
            </li>
          ))}
        </ul>
      );
    case "fill_blank":
      return (
        <div className="ms-fill">
          <p>
            {response.parts.map((p, i) => ("blank" in p ? <span key={i} className="ms-blank" role="img" aria-label="espacio en blanco" /> : <span key={i}>{p.text}</span>))}
          </p>
          {response.wordBank.length > 0 ? (
            <div className="ms-wordbank">
              <p className="ms-wordbank-label">Puedes usar:</p>
              <ul>
                {response.wordBank.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      );
    case "match":
      return (
        // The two columns are told apart by their markers (numbers on the left, letters on the right): the student writes a letter
        // in each box. The markers are text, so they print and read the same everywhere.
        <div className="ms-match">
          <ul>
            {response.left.map((l, i) => (
              <li key={i}>
                <span className="ms-mark">{i + 1}.</span>
                <span className="ms-match-item">{l}</span>
                <span className="ms-box ms-box-write" aria-hidden />
              </li>
            ))}
          </ul>
          <ul>
            {response.right.map((r, i) => (
              <li key={i}>
                <span className="ms-mark">{LETTERS[i]}.</span>
                <span className="ms-match-item">{r}</span>
              </li>
            ))}
          </ul>
        </div>
      );
    case "order":
      return (
        <ul className="ms-options">
          {response.items.map((o, i) => (
            <li key={i}>
              <span className="ms-box ms-box-write" aria-hidden />
              <span>{o}</span>
            </li>
          ))}
        </ul>
      );
    case "sequence":
      // The printed items, in their printed order, each with an empty box for the number the student writes.
      return (
        <ol className="ms-options ms-sequence">
          {response.items.map((o, i) => (
            <li key={i}>
              <span className="ms-box ms-box-write" aria-hidden />
              <span>{o}</span>
            </li>
          ))}
        </ol>
      );
    case "fields":
      // Every labelled field keeps its label and its own space: lines to write, a box or squares to calculate in. The answer of a
      // quantity has an EMPTY slot for its unit (never the unit: it may be what is evaluated).
      return (
        <div className="ms-answer-fields">
          {response.fields.map((f, i) => (
            <div key={i} className={f.space === "grid" ? "ms-answer-field ms-answer-field-grid" : f.space === "box" ? "ms-answer-field ms-answer-field-box" : f.lines > 1 ? "ms-answer-field ms-answer-field-lines" : "ms-answer-field ms-answer-field-line"} data-unit={f.unit || undefined}>
              <p className="ms-answer-field-label">{f.label}:</p>
              {f.space === "grid" ? <Grid rows={f.lines} cellMm={response.cellMm} columns={response.columns} /> : f.space === "box" ? <div className="ms-box-area" style={{ height: `calc(var(--ms-line) * ${f.lines})` }} aria-hidden /> : <Lines count={f.lines} />}
              {f.unit ? (
                <span className="ms-unit">
                  <span className="ms-unit-label">Unidad:</span>
                  <span className="ms-unit-line" aria-hidden />
                </span>
              ) : null}
            </div>
          ))}
        </div>
      );
    case "true_false":
      return (
        <ul className="ms-options">
          {response.statements.map((s, i) => (
            <li key={i}>
              <span className="ms-tf" aria-hidden>
                <span className="ms-box" /> V <span className="ms-box" /> F
              </span>
              <span>{s}</span>
            </li>
          ))}
        </ul>
      );
    case "oral":
      return (
        <div>
          <p className="ms-note">{MODE_LABEL[response.mode]}</p>
          {response.lines > 0 ? <Lines count={response.lines} /> : null}
        </div>
      );
    case "comparison":
      // The printed pairs with one empty box each, where the student writes the sign.
      return (
        <div className="ms-comparison">
          <VisualSpecView spec={response.spec} label={describeSpec(response.spec)} />
        </div>
      );
    case "none":
      return null;
  }
}
