# Estándar editorial y espacio de resolución (Fase B: requisitos y contraste con CLARO)

Estado: **requisitos, sin implementar**. Se desarrollará en una PR independiente después de decidir sobre la PR #55. Este documento no cambia el renderer, la maquetación ni las zonas de respuesta. Evidencia de partida: [validación real de la #55](qa/figuras-originales/VALIDACION-REAL.md) (fichas 03, 06 y 07).

## 1. Principios

1. **Una identidad visual única de Adaptaula.**
   - El diseño es del producto, no de la adaptación ni de la IA.
   - La adaptación cambia el contenido y la presentación *necesaria* (escala, interlineado, densidad, apoyos), nunca la identidad.
   - Ocho materias producen ocho fichas distintas, todas reconocibles como Adaptaula.
2. **El espacio de resolución es una decisión pedagógica.**
   - Tipo y cantidad de espacio según la actividad, el curso y las necesidades funcionales del perfil, nunca según etiquetas diagnósticas.
   - Lo decide el servidor con reglas deterministas. La IA puede recomendar la *necesidad* («requiere cálculo escrito en varios pasos»), pero nunca tamaños CSS, componentes ni distribuciones.
3. **Equilibrio.**
   - Ni dos líneas para un problema con varias operaciones, ni seis hojas de recuadros vacíos para respuestas cortas.
   - Nunca se reduce el tamaño de letra ni el espacio útil solo para ahorrar páginas.

## 2. Base visual (requisitos)

La base es:
- blanca y limpia, minimalista sin quedar vacía;
- adecuada para Primaria;
- imprimible en blanco y negro y accesible (WCAG 2.2 AA);
- con jerarquía tipográfica clara, márgenes constantes y separación regular entre actividades;
- sin decoración innecesaria.

**Componentes comunes:**
- **Cabecera:** identidad discreta, título, nombre, fecha y curso cuando proceda. Nunca comparte clases CSS con los campos de respuesta.
- **Actividad:** número, consigna, contenido o recurso, apoyos y zona de respuesta, siempre en ese orden y con la misma composición.
- **Recursos:** figuras, tablas, esquemas, lecturas, ejemplos y recordatorios.
- **Zona de respuesta:** un espacio específico y suficiente para la tarea.

## 3. Lo que ya existe en CLARO

| Requisito | Estado actual | Dónde |
|---|---|---|
| Un único diseño de producto | **Sí.** Toda ficha del producto se construye con `PRODUCT_DESIGN = "claro"`; la IA no elige estética. Queda un diseño `standard` heredado, que se usa por defecto en `buildRenderModel` si no se indica otro. | `src/lib/render/sheet-model.ts`, `model.ts` |
| Tokens editoriales | **Sí.** Tamaño por etapa (Primaria 12,5 pt), interlineado, separación, renglón de escritura (10 mm en Primaria), casilla, márgenes de 18 mm, un acento que se imprime como negro y tintes que se fotocopian como gris claro. | `src/lib/render/tokens.ts` |
| Presentación modulada por el perfil, sin estilos arbitrarios | **Sí.** `font_scale`, `line_spacing`, `spacing`, `contrast`, `decoration` y `max_tasks_per_page` son valores semánticos validados. No hay CSS libre. | `adaptation-context`, `tokens.ts` |
| Cabecera separada de los campos | **Sí.** Desde la PR #54, la cabecera usa `.ms-fields` y los campos de respuesta `.ms-answer-field…`. | `material.css` |
| Actividad con número, consigna, pasos, requisitos y respuesta | **Sí.** Con `keepTogether`/`isolate` y numeración «01» en CLARO. | `model.ts`, `nodes.tsx` |
| Recursos | **Sí:** figura original o reconstruida, tabla, gráfico, lectura, lista, vocabulario, ejemplo resuelto, recordatorio o idea clave, *checklist*, inicios de frase y planificador. | `model.ts` |
| Tipos de respuesta | **Sí:** líneas, recuadro (pequeño/medio/grande), cuadrícula, celdas de tabla, opción, huecos, unir, ordenar, verdadero/falso, campos etiquetados, secuencia, comparación, oral o alternativa, ninguna. | `material-document.ts` (`ResponseSpec`) |
| Longitud esperada | **Parcial.** Las líneas crecen si los requisitos dicen «150-180 palabras». | `expectedLines` en `model.ts` |
| Figuras junto a su consigna | **Sí,** en el ensamblado y la paginación. Validado con 03, 06 y 07. | `figure-order.ts`, `document.ts` |
| PDF igual a la vista previa | **Sí:** mismo modelo y CSS con Chromium, y pruebas PDF. | `src/lib/render/print` |
| Sin respuestas para el alumno | **Sí:** la vista del alumno no incluye la clave y hay comprobaciones de fuga de lo evaluado. | ADR-038 |

## 4. Lo que falta

### 4.1 Identidad editorial

- **Retirar o aislar el diseño `standard`.** El valor por defecto de `buildRenderModel` debería ser CLARO, y `standard` solo una compatibilidad documentada.
- **Cabecera:**
  - mostrar el **curso** de forma fiable y el nombre visible de la materia (nunca su *slug*);
  - definir cuándo aparece el curso.
- **Composición fija** de la actividad y de los recursos documentada como contrato: márgenes, bordes, espaciado y orden. Una prueba visual por componente.
- **Comparación visual entre materias.** Matemáticas, Lengua, Naturales, Sociales e Inglés, con el mismo perfil: la misma identidad y una demanda distinta.

### 4.2 Espacio de resolución (lo observado en la validación real)

- **`answer_area: line` con `lines: N` produce 1 línea** (`document.ts`). La actividad 1 de la ficha 07 pide 4 procesos y recibe una sola línea.
- **Campos en línea no reconocidos.** «A:, B:, C:, D:» y «Flecha 1, Flecha 2, …» se imprimen como texto, y en la ficha 06 van seguidos de un recuadro vacío. Deberían ser campos etiquetados (`labelled_fields`) vinculados a la figura (`activityStructure`).
- **Cálculo sin cuadrícula.** En la ficha 03, perímetro y área tienen 2 líneas, y «muestra cómo has dividido la figura» no tiene espacio para dibujar. La cuadrícula existe, pero:
  - no se elige por tipo de tarea;
  - tiene un tamaño fijo (`GRID_ROWS = 10`, celda de 6 mm).
- **Sin estructura de problema.** Falta una opción, no obligatoria, para datos y razonamiento, operaciones y respuesta final con unidades. `planner` sirve de base.
- **Paginación.**
  - Una ficha de una hoja sale en 3 o 4 hojas con mucho blanco cuando el perfil limita las tareas visibles. Hay que equilibrar el límite por perfil con la economía de papel, sin reducir el espacio útil.
  - Una actividad que usa dos figuras (actividad 5 de la 03) no las tiene a la vista.

### 4.3 Representación propuesta (conceptos, no diez tipos nuevos)

| Concepto funcional | Reutiliza o amplía | Qué falta |
|---|---|---|
| `short_answer` | `lines` 1–2 | regla por tipo de actividad |
| `lined_answer` | `lines` | líneas según la extensión pedida y el curso |
| `extended_writing` | `lines` grandes o `box: large` | párrafos y renglones por curso |
| `calculation_grid` | `grid` | filas y columnas según la complejidad (cifras, operaciones, pasos); celda adecuada a la mano y al perfil; nunca con operaciones resueltas |
| `free_drawing` | `box` | elegir el recuadro por tarea (representar, dividir una figura) |
| `table_completion` | `table_cells` | celdas utilizables (alto mínimo) |
| `labelled_fields` | `fields` | campos en línea; vínculo con las marcas de la figura |
| `ordering` | `sequence` / `order` | — |
| `diagram_completion` | figura + `fields` | campos asociados a letras o números de la figura |
| `oral_or_alternative` | `oral_or_alternative` | solo cuando esté pedagógicamente justificado por el perfil |

**Cálculo en servidor.** Una función determinista y versionada (por ejemplo `answerSpace@v1`) que, a partir de la actividad, decida el tipo y la cantidad de espacio. Recibe:
- tipo, objetivo y formato de respuesta;
- complejidad (operaciones, cifras, pasos, extensión);
- datos del original (su área de respuesta);
- curso, necesidades funcionales y espacio disponible en la página.

Reglas del cambio:
- se guarda en el `MaterialDocument` con su versión;
- las adaptaciones ya guardadas se siguen leyendo igual;
- la IA solo aporta una necesidad (enum), validada con Zod.

### 4.4 Adaptación a las necesidades funcionales

Hay que conectar las dimensiones del perfil con el espacio:
- más espacio de escritura;
- cuadrícula más amplia;
- menos densidad por página;
- instrucciones más separadas;
- campos más diferenciados;
- alternativas de respuesta justificadas;
- menos carga visual.

Siempre desde dimensiones y preferencias registradas, nunca desde una etiqueta. En una adaptación de acceso se mantienen el objetivo y la exigencia cognitiva.

## 5. Criterios de aceptación de la futura PR

1. Todas las fichas comparten la identidad Adaptaula: prueba visual con varias materias.
2. Los componentes usan los mismos tokens y reglas.
3. Los problemas con cálculo escrito tienen cuadrícula suficiente.
4. Las actividades que no la necesitan no la reciben.
5. Los espacios tienen dimensiones adecuadas: medidos en mm en el PDF.
6. Lengua conserva sus párrafos y estructuras.
7. Las tablas tienen celdas utilizables.
8. Las figuras quedan junto a sus consignas.
9. Los apoyos no reducen el espacio para responder.
10. La paginación no corta actividades, figuras ni zonas de respuesta.
11. El PDF descargado coincide con la vista previa física.
12. La adaptación no da respuestas al alumno.
