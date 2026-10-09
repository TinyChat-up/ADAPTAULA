import type { ReactNode } from "react";
import type { RenderDesign, RenderMode, RenderNode } from "@/lib/render/model";
import { Chart } from "./chart";
import { Paragraphs, Runs } from "./inline";
import { Response } from "./responses";

type Of<K extends RenderNode["kind"]> = Extract<RenderNode, { kind: K }>;
interface Props<K extends RenderNode["kind"]> {
  node: Of<K>;
  mode: RenderMode;
  design?: RenderDesign;
}

/** Sistema CLARO's guide column numbers activities with two digits (`01`); a non-numeric label (`A`, `4b`) stays as it is. */
const guideLabel = (label: string, design: RenderDesign | undefined) => (design === "claro" && /^\d$/.test(label) ? `0${label}` : label);

const HELP_TITLE = { key_idea: "Idea clave", reminder: "Recuerda", tip: "Consejo", strategy: "Estrategia" } as const;

function Heading({ node }: Props<"heading">) {
  const Tag = node.level === 1 ? "h1" : node.level === 2 ? "h2" : "h3";
  return <Tag className={`ms-h ms-h${node.level}`}>{node.text}</Tag>;
}

function Activity({ node, mode, design }: Props<"activity">) {
  return (
    <section className="ms-activity" data-keep={node.keepTogether || undefined} data-isolate={node.isolate || undefined} data-numbered={node.label ? true : undefined} data-table-answer={node.response.kind === "table_cells" && node.response.inTable ? true : undefined}>
      <div className="ms-activity-head">
        {node.label ? <span className="ms-num">{guideLabel(node.label, design)}</span> : null}
        <div className="ms-prompt">
          <Paragraphs paragraphs={node.prompt} />
          {node.steps.length > 0 ? (
            <ol className="ms-steps">
              {node.steps.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
          ) : null}
          {node.requirements.length > 0 ? (
            <ul className="ms-reqs">
              {node.requirements.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
      {node.supports.length > 0 ? (
        // The activity's own helps, after what to do and before where to answer.
        <div className="ms-activity-supports">
          {node.supports.map((support) => (
            <NodeView key={support.key} node={support} mode={mode} {...(design ? { design } : {})} />
          ))}
        </div>
      ) : null}
      <div className="ms-answer">
        <Response response={node.response} />
      </div>
    </section>
  );
}

function Image({ node, mode, design }: Props<"image">) {
  if (node.state === "available") {
    return (
      <figure className="ms-figure">
        {design === "claro" ? <p className="ms-cue">Observa</p> : null}
        {/* eslint-disable-next-line @next/next/no-img-element -- a private, already-authorised asset URL; sizing is the sheet's */}
        <img src={node.src} alt={node.alt} />
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

function Unknown({ node, mode }: Props<"unknown">) {
  return mode === "teacher_preview" ? (
    <div className="ms-missing" role="alert">
      Bloque que el visor no conoce («{node.type}»): contenido sin mostrar.
    </div>
  ) : null;
}

/** One renderer per node kind. A kind without an entry is a compile error, not a silent gap. */
export const NODE_RENDERERS: { [K in RenderNode["kind"]]: (props: Props<K>) => ReactNode } = {
  heading: Heading,
  paragraph: ({ node }) => (
    <div className="ms-text">
      <Paragraphs paragraphs={node.paragraphs} />
    </div>
  ),
  reading_text: ({ node, design }) => (
    <div className="ms-reading" data-segmented={node.paragraphs.some((p) => p.label) || undefined}>
      {design === "claro" ? <p className="ms-cue">Lee</p> : null}
      {node.title ? <h3 className="ms-h ms-reading-title">{node.title}</h3> : null}
      {node.paragraphs.map((p, i) => (
        <p key={i} className="ms-para">
          {p.label ? <span className="ms-seg">{p.label}</span> : null}
          <Runs runs={p.runs} />
        </p>
      ))}
    </div>
  ),
  instruction: ({ node }) => (
    <div className="ms-instruction">
      <Paragraphs paragraphs={node.paragraphs} />
      {node.steps.length > 0 ? (
        <ol className="ms-steps">
          {node.steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      ) : null}
    </div>
  ),
  activity: Activity,
  list: ({ node }) => {
    const Tag = node.ordered ? "ol" : "ul";
    return (
      <Tag className="ms-list">
        {node.items.map((runs, i) => (
          <li key={i}>
            <Runs runs={runs} />
          </li>
        ))}
      </Tag>
    );
  },
  table: ({ node }) => (
    <figure className="ms-tablewrap">
      {node.caption ? <figcaption className="ms-caption">{node.caption}</figcaption> : null}
      <table className="ms-table" data-wide={node.headers.length > 6 || undefined}>
        {node.unit ? <caption className="ms-sr">Unidad: {node.unit}</caption> : null}
        <thead>
          <tr>
            {node.headers.map((h, i) => (
              <th key={i} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {node.rows.map((r, ri) => (
            <tr key={ri}>
              {r.map((c, ci) => (
                <td key={ci}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {node.unit ? <p className="ms-note">Unidad: {node.unit}</p> : null}
    </figure>
  ),
  chart: ({ node, design }) => <Chart node={node} cue={design === "claro" ? "Observa" : undefined} />,
  image: Image,
  help_box: ({ node }) => (
    <aside className="ms-help" data-variant={node.variant}>
      <p className="ms-help-title">{node.title ?? HELP_TITLE[node.variant]}</p>
      <Paragraphs paragraphs={node.paragraphs} />
    </aside>
  ),
  checklist: ({ node }) => (
    <section className="ms-checklist" data-keep={node.keepTogether || undefined}>
      {node.title ? <p className="ms-help-title">{node.title}</p> : null}
      <ul>
        {node.items.map((it, i) => (
          <li key={i}>
            <span className="ms-box" aria-hidden />
            <span>{it}</span>
          </li>
        ))}
      </ul>
    </section>
  ),
  vocabulary: ({ node }) => (
    <section className="ms-vocab" data-keep>
      {node.title ? <p className="ms-help-title">{node.title}</p> : null}
      <dl>
        {node.items.map((it, i) => (
          <div key={i}>
            <dt>{it.term}</dt>
            <dd>{it.definition}</dd>
          </div>
        ))}
      </dl>
    </section>
  ),
  worked_example: ({ node }) => (
    <section className="ms-example" data-keep>
      <p className="ms-help-title">{node.title ?? "Ejemplo"}</p>
      <Paragraphs paragraphs={node.problem} />
      <ol className="ms-steps">
        {node.steps.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ol>
      <p>
        <strong>{node.result}</strong>
      </p>
    </section>
  ),
  sentence_starters: ({ node }) => (
    <section className="ms-starters">
      <p className="ms-help-title">Puedes empezar así</p>
      <ul>
        {node.items.map((s, i) => (
          <li key={i}>{s} …</li>
        ))}
      </ul>
    </section>
  ),
  planner: ({ node }) => (
    <section className="ms-planner">
      {node.title ? <p className="ms-help-title">{node.title}</p> : null}
      {node.slots.map((slot, i) => (
        <div key={i} className="ms-slot-block" data-keep>
          <p className="ms-slot-label">{slot.label}</p>
          <div className="ms-lines" aria-hidden>
            {Array.from({ length: slot.lines }, (_, l) => (
              <div key={l} />
            ))}
          </div>
        </div>
      ))}
    </section>
  ),
  math: ({ node }) =>
    node.parts ? (
      // Composed: stacked fractions read as such, and the spoken text is the accessible name of the whole formula.
      <p className="ms-math" data-display={node.display} role="math" aria-label={node.spoken}>
        {node.parts.map((part, i) =>
          part.kind === "frac" ? (
            <span key={i} className="ms-frac" aria-hidden>
              <span className="ms-frac-num">{part.num}</span>
              <span className="ms-frac-den">{part.den}</span>
            </span>
          ) : (
            <span key={i} aria-hidden>
              {part.text}
            </span>
          ),
        )}
      </p>
    ) : (
      <p className="ms-math" data-display={node.display}>
        <code aria-label={node.spoken}>{node.latex}</code>
      </p>
    ),
  unknown: Unknown,
};

export function NodeView({ node, mode, design }: { node: RenderNode; mode: RenderMode; design?: RenderDesign }) {
  const render = NODE_RENDERERS[node.kind] as (props: { node: RenderNode; mode: RenderMode; design?: RenderDesign }) => ReactNode;
  return <>{render({ node, mode, ...(design ? { design } : {}) })}</>;
}
