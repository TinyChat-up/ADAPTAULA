const ROWS = [["Conejo", "Plantas", "Pradera"], ["León", "Carne", "Sabana"], ["Gorrión", "Semillas", "Bosque"]];
const OPTIONS = ["A) Carne", "B) Plantas", "C) Semillas"];
const QUESTION = "Según la tabla, ¿qué alimentación corresponde a «Conejo»? Elige una opción.";

/** Web-only educational sample: the same data, question and options on both sheets, never a generated result or a solved task. */
export function Demo() {
  return (
    <figure aria-label="Ejemplo de material original y adaptado" className="mx-auto w-full min-w-0 max-w-3xl">
      <div className="sample-pair">
        {[false, true].map((adapted) => (
          <div key={String(adapted)}>
            <p className="eyebrow mb-3 flex items-center justify-between border-b border-border pb-2">
              <span>{adapted ? "Material adaptado" : "Material original"}</span>
              <span aria-hidden className="text-muted-foreground">{adapted ? "02" : "01 →"}</span>
            </p>
            <article aria-label={adapted ? "Ficha adaptada" : "Ficha original"} className={`sample-paper sample-paper--${adapted ? "adapted" : "original"}`}>
              <p className="border-b border-border pb-2 text-[0.625rem] uppercase tracking-wider">Ciencias · 4.º de Primaria</p>
              <h3>Animales y alimentación</h3>
              <p className="text-[0.6875rem]">Nombre: __________________</p>
              <table aria-label={`Animales: ${adapted ? "versión adaptada" : "original"}`}>
                <thead><tr>{["Animal", "Alimentación", "Hábitat"].map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
                <tbody>{ROWS.map((r) => <tr key={r[0]}>{r.map((v, i) => i === 0 ? <th key={v} scope="row" className="!bg-transparent !font-normal">{v}</th> : <td key={v}>{v}</td>)}</tr>)}</tbody>
              </table>
              <p className={adapted ? "font-semibold" : ""}>{QUESTION}</p>
              {adapted ? (
                <ul className="sample-options">{OPTIONS.map((o) => <li key={o}><span aria-hidden className="sample-circle" />{o}</li>)}</ul>
              ) : <p className="mt-3">{OPTIONS.join(" · ")}</p>}
              <p className="mt-auto flex justify-between border-t border-border pt-2 text-[0.625rem] text-muted-foreground"><span>Lectura de tablas</span><span>1 / 1</span></p>
            </article>
          </div>
        ))}
      </div>
      <figcaption className="mt-4 border-l-2 border-primary pl-3 text-xs leading-relaxed text-muted-foreground">
        <strong className="font-medium text-foreground">Demostración preparada por nosotros.</strong> Más espacio y opciones separadas. La misma tabla, la misma pregunta y ninguna respuesta señalada. No es una generación en directo.
      </figcaption>
    </figure>
  );
}
