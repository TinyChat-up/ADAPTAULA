# Sistema CLARO · las cinco fichas completas (revisión humana)

> **Estado: identidad aprobada; aplicación a las fichas completas pendiente de revisión.** CLARO sigue siendo una opción del
> renderer (`design: "claro"`). El producto continúa con el diseño actual hasta la autorización final (ver «Activarlo»).

Las mismas cinco fichas de QA de Phase 8 (`tests/visual-qa/fixtures.ts`), completas, sin recortar actividades ni extensiones,
renderizadas por el renderer del producto con Sistema CLARO e impresas por el motor PDF de producción (Chromium).

| Carpeta | Ficha | Páginas |
| --- | --- | --- |
| `A-primaria/` | Fracciones equivalentes · 5.º Primaria | 2 |
| `B-primaria-estructurada/` | El ciclo del agua · 4.º Primaria, apoyo estructurado (3 tareas por página, letra 1,15×, más espacio, menos decoración) | 4 |
| `C-eso/` | La célula · 1.º ESO | 2 |
| `D-bachillerato/` | Comentario de texto: el contrato social · 2.º Bachillerato | 4 |
| `E-visual/` | El clima de Valdeloma · 1.º ESO (recorte del original: climograma) | 2 |

En cada carpeta: `ficha.pdf` (A4 final), `pagina-N.png` (color, 100 ppp), `pagina-N-grises.png` (escala de grises, como una
fotocopiadora) y `pantalla.png` (la misma ficha en pantalla).

Comparación: `../after/` es el mismo contenido (ya corregido) con el diseño actual (`material_renderer@v3`); `../before/` es el
renderer v2 con el contenido original de la primera auditoría.

## Regenerar

Linux, sin IA, unos segundos:

```bash
QA_DESIGN=claro pnpm qa:visual   # esta carpeta (y los pilotos de ../claro-pilots)
pnpm qa:visual                   # ../after: el mismo contenido con el diseño actual
```

## Evaluación (humana sobre el PDF, no «compila»)

PASS / NEEDS WORK, con gravedad cuando queda un defecto.

| Criterio | A Fracciones | B Ciclo del agua | C Célula | D Rousseau | E Valdeloma |
| --- | --- | --- | --- | --- | --- |
| 1. Identidad Adaptaula | PASS | PASS | PASS | PASS | PASS |
| 2. Jerarquía visual | PASS | PASS | PASS | PASS | PASS |
| 3. Legibilidad | PASS | PASS | PASS | PASS | PASS |
| 4. Coherencia didáctica | PASS | PASS | PASS | PASS | PASS |
| 5. Utilidad de apoyos | PASS | PASS | PASS | PASS | PASS |
| 6. Espacios de respuesta | PASS | PASS | PASS | PASS | PASS |
| 7. Continuidad entre páginas | PASS | NEEDS WORK (media) | PASS | NEEDS WORK (baja) | PASS |
| 8. Adecuación a la etapa | PASS | PASS | PASS | PASS | PASS |
| 9. Calidad de impresión | PASS | PASS | PASS | PASS | PASS |
| 10. Aspecto profesional | PASS | PASS | PASS | PASS | NEEDS WORK (baja) |

Defectos que quedan:

- **B · continuidad (media):** la página 2 queda a media altura. El perfil pide como máximo 3 tareas por página y, con letra 1,15×
  y espaciado amplio, la parte 3 y su pregunta no caben en la página 1; la página lógica se cierra antes de la tarea 04. Resolverlo
  bien exige paginar por altura real (motor editorial), no por número de tareas: documentado, no forzado.
- **D · continuidad (baja):** la redacción 03 (150-200 palabras, 19 líneas) continúa sus 3 últimas líneas en la página 3 (el filo
  guía las enlaza); la lista «Antes de entregar» queda sola en la página 4 porque la redacción 04 (200-250 palabras) ocupa la 3.
  No se ha reducido ninguna extensión para evitarlo.
- **E · aspecto (baja):** el gráfico por estaciones conserva el estilo gris del renderer (barras con trama) y su tabla de datos
  (alternativa textual) duplica la información; no tiene todavía un tratamiento CLARO propio.
- **A · notación (baja):** las fracciones dentro de los enunciados siguen en notación lineal (3/5); las fórmulas (bloque `math`)
  sí se componen apiladas.

## Activarlo como diseño por defecto (cuando se autorice)

Un único punto: `src/lib/render/load.ts` (`sheetModel`), que usan la vista de la ficha y la exportación PDF, llama a
`buildRenderModel` sin `design`. Activarlo es pasar `design: "claro"` ahí (o cambiar el valor por defecto en
`src/lib/render/model.ts`), subir `MATERIAL_RENDERER_VERSION` (v4: el aspecto de los PDF cambia) y regenerar las líneas base del
smoke PDF (`UPDATE_PDF_BASELINES=1 pnpm smoke:pdf`). No hay migración ni cambio de contrato.
