import { NodeView } from "./nodes";
import { tokenStyle } from "@/lib/render/tokens";
import type { RenderModel } from "@/lib/render/model";
import "./material.css";

/**
 * The printable sheet: A4 pages of the RenderModel. Server-rendered, no client code. The same markup is what the browser prints;
 * everything that is not the sheet (app chrome, teacher panel, controls) lives outside `.ms-sheet` and is hidden in print.
 */
export function MaterialSheet({ model }: { model: RenderModel }) {
  const { header } = model;
  const meta = [header.subject, header.grade].filter(Boolean).join(" · ");
  return (
    <div className="ms-root" style={tokenStyle(model.tokens) as React.CSSProperties} data-decoration={model.tokens.decoration} data-contrast={model.tokens.contrast} data-stage={model.stage ?? undefined} data-design={model.design === "claro" ? "claro" : undefined} lang={model.language}>
      {model.pages.map((page, index) => (
        <article key={page.number} className="ms-sheet" aria-label={`Página ${page.number} de ${model.pages.length}`} data-page={page.number}>
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
              <NodeView key={node.key} node={node} mode={model.mode} design={model.design} />
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
