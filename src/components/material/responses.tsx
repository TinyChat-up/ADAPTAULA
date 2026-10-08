import type { RenderResponse } from "@/lib/render/model";

const Lines = ({ count }: { count: number }) => (
  <div className="ms-lines" aria-hidden>
    {Array.from({ length: count }, (_, i) => (
      <div key={i} />
    ))}
  </div>
);

const GRID_MM = 6;
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
      // Whole 6 mm squares: a squared area never ends in a cut row.
      return <div className="ms-grid-area" style={{ height: `${GRID_MM * Math.round(response.rows * 1.1)}mm` }} aria-hidden />;
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
    case "none":
      return null;
  }
}
