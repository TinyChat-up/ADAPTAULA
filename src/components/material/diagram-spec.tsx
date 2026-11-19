import { levelsOf, pathOf, type DiagramSpec } from "@/lib/visuals/diagram";

/**
 * The drawing of a NEW exact scheme (ADR-059): boxes, arrows and labels from validated data only, as plain markup so the screen, the
 * print and the PDF draw the same thing. Arrows are text glyphs next to the boxes (never colour alone); a relation's short label is
 * printed on its arrow. Black on white, readable in black-and-white print.
 */

function Box({ text }: { text: string }) {
  return <span className="ms-vflow-box">{text}</span>;
}

function Arrow({ label, glyph = "→" }: { label?: string | undefined; glyph?: string }) {
  return (
    <span className="ms-vdiagram-arrow">
      {label ? <span className="ms-vdiagram-relation">{label}</span> : null}
      <span aria-hidden>{glyph}</span>
    </span>
  );
}

export function DiagramView({ spec, label }: { spec: DiagramSpec; label: string }) {
  const text = new Map(spec.nodes.map((n) => [n.id, n.label]));
  const edge = (from: string, to: string) => spec.edges.find((e) => e.from === from && e.to === to)?.label;
  const body = (() => {
    if (spec.layout === "groups") {
      return (
        <ul className="ms-vdiagram-groups" style={{ gridTemplateColumns: `repeat(${spec.groups.length}, 1fr)` }}>
          {spec.groups.map((g, i) => (
            <li key={i}>
              <span className="ms-sortboard-head">{g}</span>
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
    if (spec.layout === "hierarchy") {
      const levels = levelsOf(spec) ?? [spec.nodes.map((n) => n.id)];
      const parentOf = (id: string) => spec.edges.find((e) => e.to === id);
      return (
        <ol className="ms-vdiagram-tree">
          {levels.map((level, depth) => (
            <li key={depth}>
              {level.map((id) => {
                const up = depth > 0 ? parentOf(id) : undefined;
                return (
                  <span key={id} className="ms-vdiagram-node">
                    {up ? <Arrow label={up.label} glyph={`↓ ${text.get(up.from)}`} /> : null}
                    <Box text={text.get(id) ?? ""} />
                  </span>
                );
              })}
            </li>
          ))}
        </ol>
      );
    }
    const order = pathOf(spec) ?? spec.nodes.map((n) => n.id);
    return (
      <ol className="ms-vflow">
        {order.map((id, i) => {
          const to = order[i + 1];
          return (
            <li key={id}>
              <Box text={text.get(id) ?? ""} />
              {to ? <Arrow label={edge(id, to)} /> : null}
            </li>
          );
        })}
        {spec.layout === "cycle" ? (
          <li>
            <Arrow label={edge(order[order.length - 1]!, order[0]!)} glyph={`↺ ${text.get(order[0]!)}`} />
          </li>
        ) : null}
      </ol>
    );
  })();
  return (
    <div className="ms-vsupport" data-spec={spec.kind} data-layout={spec.layout} role="group" aria-label={label}>
      {spec.title ? <p className="ms-vsupport-title">{spec.title}</p> : null}
      {body}
    </div>
  );
}
