import { chartPlottable, seriesAmbiguous, type RenderNode } from "@/lib/render/model";

type Chart = Extract<RenderNode, { kind: "chart" }>;

const fmt = (n: number) => new Intl.NumberFormat("es-ES", { maximumFractionDigits: 2 }).format(n);
/** Only verified names: an unnamed series gets the axis label (or a neutral "Valor"), never an invented name. */
const seriesName = (c: Chart, i: number) => c.series[i]?.label ?? c.yLabel ?? "Valor";

/** Deterministic, data-only chart: nothing is drawn that the structured data does not say; the table below is always shown. */
export function Chart({ node }: { node: Chart }) {
  const plot = chartPlottable(node);
  const max = Math.max(1, ...node.series.flatMap((s) => s.values));
  const n = node.categories.length;
  const showLegend = node.series.length > 1 && !seriesAmbiguous(node) && plot;
  return (
    <figure className="ms-chart">
      {node.title ? <figcaption className="ms-caption">{node.title}</figcaption> : null}
      {plot && node.chartType === "pie" ? <Pie node={node} /> : null}
      {plot && node.chartType !== "pie" && node.chartType !== "other" ? (
        <div className="ms-plot-wrap">
          {node.yLabel || node.unit ? <p className="ms-axis">{[node.yLabel, node.unit ? `(${node.unit})` : null].filter(Boolean).join(" ")}</p> : null}
          <div className="ms-plot" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
            {node.chartType === "line" ? (
              <svg className="ms-line-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
                {node.series.map((s, si) => (
                  <polyline key={si} className={`ms-s${si % 4}`} fill="none" points={s.values.map((v, i) => `${((i + 0.5) / n) * 100},${100 - (v / max) * 92}`).join(" ")} vectorEffect="non-scaling-stroke" />
                ))}
              </svg>
            ) : null}
            {node.categories.map((c, i) => (
              <div key={i} className="ms-col">
                <div className="ms-bars">
                  {node.series.map((s, si) => (
                    <div key={si} className="ms-bar-slot">
                      <span className="ms-val">{fmt(s.values[i] ?? 0)}</span>
                      {node.chartType === "bar" ? <div className={`ms-bar ms-s${si % 4}`} style={{ height: `${((s.values[i] ?? 0) / max) * 100}%` }} /> : <div className="ms-dot" style={{ bottom: `${((s.values[i] ?? 0) / max) * 92}%` }} />}
                    </div>
                  ))}
                </div>
                <span className="ms-cat">{c}</span>
              </div>
            ))}
          </div>
          {node.xLabel ? <p className="ms-axis ms-axis-x">{node.xLabel}</p> : null}
        </div>
      ) : null}
      {showLegend ? (
        <ul className="ms-legend">
          {node.series.map((_, i) => (
            <li key={i}>
              <span className={`ms-swatch ms-s${i % 4}`} aria-hidden /> {seriesName(node, i)}
            </li>
          ))}
        </ul>
      ) : null}
      <table className="ms-table ms-data">
        <caption className="ms-sr">Datos del gráfico{node.unit ? ` (${node.unit})` : ""}</caption>
        <thead>
          <tr>
            <th scope="col">{node.xLabel ?? ""}</th>
            {node.series.map((_, i) => (
              <th key={i} scope="col">
                {seriesName(node, i)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {node.categories.map((c, i) => (
            <tr key={i}>
              <th scope="row">{c}</th>
              {node.series.map((s, si) => (
                <td key={si}>{fmt(s.values[i] ?? 0)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

function Pie({ node }: { node: Chart }) {
  const values = node.series[0]!.values;
  const total = values.reduce((a, b) => a + b, 0) || 1;
  let angle = -Math.PI / 2;
  const slices = values.map((v, i) => {
    const a0 = angle;
    angle += (v / total) * 2 * Math.PI;
    const large = angle - a0 > Math.PI ? 1 : 0;
    const p = (a: number) => `${50 + 45 * Math.cos(a)},${50 + 45 * Math.sin(a)}`;
    return { d: values.length === 1 ? "" : `M50,50 L${p(a0)} A45,45 0 ${large} 1 ${p(angle)} Z`, i };
  });
  return (
    <div className="ms-pie">
      <svg viewBox="0 0 100 100" aria-hidden>
        {values.length === 1 ? <circle cx="50" cy="50" r="45" className="ms-s0" /> : slices.map((s) => <path key={s.i} d={s.d} className={`ms-s${s.i % 4}`} />)}
      </svg>
      <ul className="ms-legend">
        {node.categories.map((c, i) => (
          <li key={i}>
            <span className={`ms-swatch ms-s${i % 4}`} aria-hidden /> {c}: {fmt(values[i] ?? 0)} ({fmt(((values[i] ?? 0) / total) * 100)} %)
          </li>
        ))}
      </ul>
    </div>
  );
}
