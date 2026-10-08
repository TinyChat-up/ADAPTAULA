# Sistema CLARO · las cinco fichas completas (revisión humana)

> **Estado: identidad aprobada; las cinco fichas revisadas. Pendiente: aprobar los PDF corregidos de B (Ciclo del agua) y D
> (Rousseau).** CLARO sigue siendo una opción del renderer (`design: "claro"`). El producto continúa con el diseño actual hasta la
> autorización final (ver «Activarlo»).

Las mismas cinco fichas de QA de Phase 8 (`tests/visual-qa/fixtures.ts`), completas, sin recortar actividades ni extensiones,
renderizadas por el renderer del producto con Sistema CLARO e impresas por el motor PDF de producción (Chromium).

| Carpeta | Ficha | Páginas |
| --- | --- | --- |
| `A-primaria/` | Fracciones equivalentes · 5.º Primaria | 2 |
| `B-primaria-estructurada/` | El ciclo del agua · 4.º Primaria, apoyo estructurado (3 tareas por página, letra 1,15×, más espacio, menos decoración) | 3 |
| `C-eso/` | La célula · 1.º ESO | 2 |
| `D-bachillerato/` | Comentario de texto: el contrato social · 2.º Bachillerato | 3 |
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
QA_DESIGN=claro QA_ONLY=B-primaria-estructurada,D-bachillerato pnpm qa:visual tests/visual-qa/render.qa.test.ts   # solo esas fichas
```

En la revisión final solo se regeneraron B y D. A, C y E no cambian con estas correcciones (no tienen límite de tareas por página
ni organizador). `../after/` y `../claro-pilots/` no se regeneraron: `after/B` conserva el esquema anterior de la actividad 06 y
el piloto de Bachillerato, el organizador a todo el ancho.

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
| 7. Continuidad entre páginas | PASS | PASS | PASS | PASS | PASS |
| 8. Adecuación a la etapa | PASS | PASS | PASS | PASS | PASS |
| 9. Calidad de impresión | PASS | PASS | PASS | PASS | PASS |
| 10. Aspecto profesional | PASS | PASS | PASS | PASS | NEEDS WORK (baja) |

Defectos que quedan:

- **E · aspecto (baja):** el gráfico por estaciones conserva el estilo gris del renderer (barras con trama) y su tabla de datos
  (alternativa textual) duplica la información; no tiene todavía un tratamiento CLARO propio.
- **A · notación (baja):** las fracciones dentro de los enunciados siguen en notación lineal (3/5); las fórmulas (bloque `math`)
  sí se componen apiladas.

## Revisión final de B y D

**B · El ciclo del agua (3 páginas, antes 4).**

- **Actividad 06, error conceptual corregido.** El esquema situaba la condensación después de las nubes. Ahora sigue el orden
  científico, con los estados entre los cambios: agua del mar → [evaporación] → vapor de agua → [condensación] → nubes →
  [precipitación] → el agua vuelve a los ríos y al mar. El recuadro de palabras va desordenado (precipitación, evaporación,
  condensación) para no dar la solución.
- **Comprobación manual de las respuestas.**
  - 06: a = evaporación (el agua del mar pasa a vapor), b = condensación (el vapor se enfría y forma gotas: las nubes),
    c = precipitación (las gotas caen y el agua vuelve a ríos y mar). Cada respuesta coincide con la parte 1, 2 o 3 de la lectura.
  - 04: 2 · 1 · 3 (se evapora, se forman las nubes, llueve).
  - 05: 1-B, 2-C, 3-A.
  - El enunciado de la 07 y la lista final se ajustaron al esquema: el mar, el vapor, las nubes y la lluvia, y en cada flecha el
    nombre de su cambio.
- **Paginación.** La página 2 quedaba casi vacía porque el límite de 3 tareas agrupaba 3 · 3 · 1 y el primer grupo (la lectura
  por partes, con letra 1,15× y espaciado amplio) no cabía en un A4. Con el reparto equilibrado (`taskGroups`) queda 2 · 3 · 2,
  y la parte 3 de la lectura viaja con su pregunta. Ninguna página supera 3 tareas, no se ha compactado nada y no se mide la
  altura.
  - Página 1: partes 1 y 2 con sus preguntas.
  - Página 2: parte 3 y su pregunta, idea clave, ordenar y relacionar.
  - Página 3: esquema, dibujo y «Antes de terminar».

**D · Rousseau (3 páginas, antes 4).** Medida en el Chromium del motor, la actividad 03 (enunciado, requisitos, organizador y 19
líneas para 150-200 palabras) ocupaba 283 mm y el área útil de un A4 son 261 mm: nunca cabía. Por eso partía 3 líneas a la
página 3 y empujaba la lista a la 4. En CLARO (ESO y Bachillerato), los apartados del organizador de hasta dos líneas («Idea
principal», «Conceptos clave») comparten fila. Los largos («Comparación», 3 líneas) mantienen el ancho completo.

- La 03 pasa a 259,7 mm y cabe entera en la página 2: ya no hay líneas de continuación que identificar.
- La página 3 lleva la 04 completa (23 líneas para 200-250 palabras) y la lista «Antes de entregar».
- Extensiones, requisitos y organizador sin cambios.

**Límites que quedan (documentados, no forzados):**

- **El ajuste de D es justo:** quedan 1,3 mm. Un enunciado más largo volvería a partir la 03.
- **Continuación sin número:** una redacción con organizador que no cabe en una página continúa en la siguiente unida por el filo
  de la columna guía, pero sin repetir su número. En Chromium, repetir «03» solo en la página de continuación exigiría paginar por
  altura (un motor editorial), que no se construye.
- **Los PDF reales del producto:** el ensamblador del pipeline (`src/lib/adaptation/document.ts`) ya parte las páginas lógicas
  por `max_tasks_per_page` de forma voraz (3 · 3 · 1). El reparto equilibrado del renderer no cambia esas fichas, porque cada
  página lógica ya trae como máximo el límite. Llevar `taskGroups` al ensamblador es un cambio del pipeline, fuera de esta fase.

## Activarlo como diseño por defecto (cuando se autorice)

Un único punto: `src/lib/render/load.ts` (`sheetModel`), que usan la vista de la ficha y la exportación PDF, llama a
`buildRenderModel` sin `design`. Activarlo es pasar `design: "claro"` ahí (o cambiar el valor por defecto en
`src/lib/render/model.ts`), subir `MATERIAL_RENDERER_VERSION` (v4: el aspecto de los PDF cambia) y regenerar las líneas base del
smoke PDF (`UPDATE_PDF_BASELINES=1 pnpm smoke:pdf`). No hay migración ni cambio de contrato.
