import { NodeView, type ActivitySelection } from "./nodes";
import { tokenStyle } from "@/lib/render/tokens";
import type { RenderModel } from "@/lib/render/model";
import "./material.css";

/**
 * Shared A4 markup, without state. Screen callers may select a logical page/activity;
 * the PDF supplies only `model`, rendering every page without interaction attributes.
 */
export function MaterialSheet({ model, visiblePage, selection }: { model: RenderModel; visiblePage?: number | undefined; selection?: ActivitySelection | undefined }) {
  const { header } = model;
  const meta = [header.subject, header.grade].filter(Boolean).join(" · ");
  return (
    <div className="ms-root" style={tokenStyle(model.tokens) as React.CSSProperties} data-decoration={model.tokens.decoration} data-contrast={model.tokens.contrast} data-stage={model.stage ?? undefined} data-design={model.design === "claro" ? "claro" : undefined} lang={model.language}>
      {model.pages.map((page, index) => (
        <article key={page.number} className="ms-sheet" hidden={visiblePage !== undefined && page.number !== visiblePage} aria-label={`Página ${page.number} de ${model.pages.length}`} data-page={page.number}>
          {index === 0 && (meta || header.fields.length > 0) ? (
            <header className="ms-header">
              {model.design === "claro" ? (
                // Sistema CLARO: subject and course on the left, the Adaptaula mark on the right, very discreet. Nothing else.
                <div className="ms-masthead">
                  {meta ? <p className="ms-meta">{meta}</p> : <span />}
                  <p className="ms-brand">Adaptaula</p>
                </div>
              ) : meta ? (
                <p className="ms-meta">{meta}</p>
              ) : null}
              {header.fields.length > 0 ? (
                <div className="ms-fields">
                  {header.fields.map((f, i) => (
                    <span key={i} className="ms-field">
                      {f}: <span className="ms-field-line" aria-hidden />
                    </span>
                  ))}
                </div>
              ) : null}
            </header>
          ) : null}
          <div className="ms-flow">
            {page.nodes.map((node) => (
              <NodeView key={node.key} node={node} mode={model.mode} design={model.design} selection={selection} />
            ))}
          </div>
          <footer className="ms-footer">
            {page.number} / {model.pages.length}
          </footer>
        </article>
      ))}
    </div>
  );
}
