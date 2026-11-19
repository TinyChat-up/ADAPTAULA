import type { ReactNode } from "react";
import { pathOf, type DiagramSpec } from "@/lib/visuals/diagram";

/**
 * The drawing of a NEW exact scheme (ADR-059): boxes, arrows and labels from validated data only, as plain markup so the screen, the
 * print and the PDF draw the same thing (checked in a real Chromium PDF: tests/pdf/diagrams.test.ts). Arrows are text glyphs between
 * the boxes, pointing where the next box really is (never colour alone); a relation's short label is printed on its arrow. Boxes
 * never split across lines. Black on white, readable in black-and-white print.
 */

/** A chain that does not fit on one line is drawn top to bottom, so every arrow points at the box that follows it. */
const COLUMN_FROM_CHARS = 70;

function Box({ text }: { text: string }) {
  return <span className="ms-vflow-box ms-vdiagram-box">{text}</span>;
}

function Arrow({ label, glyph }: { label?: string | undefined; glyph: string }) {
  return (
    <span className="ms-vdiagram-arrow">
      {label ? <span className="ms-vdiagram-relation">{label}</span> : null}
      <span className="ms-vdiagram-glyph" aria-hidden>
        {glyph}
      </span>
    </span>
  );
}

function Chain({ spec }: { spec: DiagramSpec }) {
  const text = new Map(spec.nodes.map((n) => [n.id, n.label]));
  const edge = (from: string, to: string) => spec.edges.find((e) => e.from === from && e.to === to)?.label;
  const order = pathOf(spec) ?? spec.nodes.map((n) => n.id);
  const chars = spec.nodes.reduce((n, x) => n + x.label.length, 0) + spec.edges.reduce((n, e) => n + (e.label?.length ?? 0), 0);
  const column = chars > COLUMN_FROM_CHARS || spec.nodes.length > 4;
  const back = spec.layout === "cycle" ? edge(order[order.length - 1]!, order[0]!) : undefined;
  return (
    <ol className="ms-vdiagram-chain" data-direction={column ? "column" : "row"}>
      {order.map((id, i) => {
        const to = order[i + 1];
        return (
          <li key={id}>
            <Box text={text.get(id) ?? ""} />
            {to ? <Arrow label={edge(id, to)} glyph={column ? "↓" : "→"} /> : null}
          </li>
        );
      })}
      {spec.layout === "cycle" ? (
        <li className="ms-vdiagram-return">
          <Arrow label={back} glyph="↺" />
          <span>vuelve a «{text.get(order[0]!)}»</span>
        </li>
      ) : null}
    </ol>
  );
}

function Tree({ spec }: { spec: DiagramSpec }) {
  const text = new Map(spec.nodes.map((n) => [n.id, n.label]));
  const root = spec.nodes.find((n) => !spec.edges.some((e) => e.to === n.id))?.id ?? spec.nodes[0]!.id;
  const subtree = (id: string, depth: number): ReactNode => {
    const children = depth < 3 ? spec.edges.filter((e) => e.from === id) : [];
    return (
      <div className="ms-vdiagram-subtree">
        <Box text={text.get(id) ?? ""} />
        {children.length > 0 ? (
          <div className="ms-vdiagram-children">
            {children.map((e) => (
              <div key={e.to} className="ms-vdiagram-branch">
                <Arrow label={e.label} glyph="↓" />
                {subtree(e.to, depth + 1)}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    );
  };
  return <div className="ms-vdiagram-tree">{subtree(root, 1)}</div>;
}

function Groups({ spec }: { spec: DiagramSpec }) {
  return (
    <ul className="ms-vdiagram-groups" data-columns={spec.groups.length} style={{ gridTemplateColumns: `repeat(${spec.groups.length}, minmax(0, 1fr))` }}>
      {spec.groups.map((g, i) => (
        <li key={i}>
          <span className="ms-vdiagram-head">{g}</span>
          <ul>
            {spec.nodes.filter((n) => n.group === i).map((n) => (
              <li key={n.id}>
                <Box text={n.label} />
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

export function DiagramView({ spec, label }: { spec: DiagramSpec; label: string }) {
  return (
    <div className="ms-vsupport" data-spec={spec.kind} data-layout={spec.layout} role="group" aria-label={label}>
      {spec.title ? <p className="ms-vsupport-title">{spec.title}</p> : null}
      {spec.layout === "groups" ? <Groups spec={spec} /> : spec.layout === "hierarchy" ? <Tree spec={spec} /> : <Chain spec={spec} />}
    </div>
  );
}
