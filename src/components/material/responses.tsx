import type { RenderResponse } from "@/lib/render/model";

const Lines = ({ count }: { count: number }) => (
  <div className="ms-lines" aria-hidden>
    {Array.from({ length: count }, (_, i) => (
      <div key={i} />
    ))}
  </div>
);

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
      return <div className="ms-grid-area" style={{ height: `calc(var(--ms-line) * ${response.rows * 0.7})` }} aria-hidden />;
    case "table_cells":
      return <div className="ms-box-area" style={{ height: `calc(var(--ms-line) * ${response.rows})` }} aria-hidden />;
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
            <ul className="ms-wordbank">
              {response.wordBank.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          ) : null}
        </div>
      );
    case "match":
      return (
        <div className="ms-match">
          <ol>
            {response.left.map((l, i) => (
              <li key={i}>
                <span>{l}</span>
                <span className="ms-slot" aria-hidden />
              </li>
            ))}
          </ol>
          <ol className="ms-alpha">
            {response.right.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ol>
        </div>
      );
    case "order":
      return (
        <ul className="ms-options">
          {response.items.map((o, i) => (
            <li key={i}>
              <span className="ms-box" aria-hidden />
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
