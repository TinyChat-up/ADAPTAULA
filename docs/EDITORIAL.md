# Estándar editorial y espacios de resolución (Fase B)

Estado: **implementado** (`answer_space@v1`, ADR-040). Sin llamadas de IA: todo es determinista y se decide en el servidor. Las evidencias están en [QA de la Fase B](qa/fase-b-editorial/README.md), y el punto de partida en la [validación real de la #55](qa/figuras-originales/VALIDACION-REAL.md).

## 1. Principios

1. **Una identidad visual única de Adaptaula.** El diseño es del producto: Sistema CLARO.
   - La adaptación cambia el contenido y la presentación *funcional*: escala, interlineado, densidad, apoyos y espacio para escribir.
   - Nunca cambia la identidad.
   - Ningún modelo elige estilos, tamaños ni componentes.
2. **El espacio de resolución es una decisión pedagógica.**
   - Su tipo y su cantidad dependen de la actividad, el curso y las necesidades funcionales, nunca de etiquetas diagnósticas.
   - La IA solo puede haber expresado la necesidad en el análisis (tipo de actividad, formato de respuesta, elementos protegidos).
3. **Equilibrio.**
   - Ni dos líneas para un problema con varias operaciones, ni hojas de recuadros vacíos para respuestas cortas.
   - Nunca se reducen la letra ni el espacio útil para ahorrar papel.
   - Si el perfil necesita más páginas, la accesibilidad va primero.

## 2. Identidad: qué comparten todas las fichas

| Componente | Regla | Dónde |
|---|---|---|
| Diseño | CLARO es el **valor por defecto** de `buildRenderModel` y el único que usa el producto (`PRODUCT_DESIGN`). `standard` queda como capa histórica y solo se imprime si se pide explícitamente (pruebas y comparación). | `src/lib/render/model.ts`, `sheet-model.ts` |
| Cabecera | Una sola línea con la materia por su **nombre legible** y el curso («4.º Primaria»), la marca ADAPTAULA discreta a la derecha y Nombre y Fecha a mano. Una clave de catálogo (`conocimiento-medio`) no se imprime nunca. | `sheet.tsx`, `subjectName()` |
| Título, orientación y actividad | Mismo orden siempre: número «01» en la columna guía, consigna, figura o recurso, apoyos y zona de respuesta. | `nodes.tsx`, `material.css` (CLARO) |
| Tokens | Tamaño por etapa (Primaria 12,5 pt), renglón (10 mm en Primaria), **casilla de cuadrícula** (7 mm en Primaria, 6 en ESO, 5 en Bachillerato), márgenes de 18 mm, un acento que se imprime como negro y grises que se ven en escala de grises. | `src/lib/render/tokens.ts` |
| Numeración de páginas | «N / M» física, en el margen inferior. | `material.css` (`@page`) |
| Cabecera ≠ campos | Los campos de respuesta usan `.ms-answer-field…` y la cabecera, `.ms-fields`: nunca se confunden. | `material.css` |

El perfil modula la presentación (`font_scale`, `line_spacing`, `spacing`, `contrast`, `decoration`, `max_tasks_per_page` y, desde `answer_space@v1`, `answer_space`) con valores semánticos validados. El CSS y la identidad no cambian.

## 3. Motor de espacios de resolución (`answer_space@v1`)

`src/lib/adaptation/answer-space.ts`. El ensamblador (`buildDocument`) lo aplica por igual a las actividades literales y a las adaptadas, así que la auditoría de zonas de respuesta compara lo mismo. Se guarda en el `MaterialDocument`.

**Qué tiene que producir el alumno.** Lo deciden los campos estructurados del análisis, nunca solo las palabras:
- **Cálculo escrito:** `response_format = calculate`, o una actividad `calculation`/`problem_solving` en una materia matemática o con una `target_operation` o `formula` protegida.
- **Dibujo:** `drawing` o `draw`.
- **Redacción:** `writing`.
- **Explicación:** `open_question`, `experiment` o `graph_interpretation`.
- **Respuesta corta:** `short_answer`, `reading_comprehension` o `write_number`.
- **Sin cambio:** marcar, elegir, unir, ordenar o completar huecos; también un área desconocida.

**Orden de las reglas:**
1. **Lo que fija el original o una decisión no cambia:**
   - formatos cerrados, ordenar y comparar;
   - una respuesta sobre la figura;
   - un formato de respuesta elegido por el plan.
2. **Campos impresos:** conservan sus etiquetas y su orden.
   - El de operaciones («Operaciones y unidades:») pasa a cuadrícula.
   - Si se pide «de cada oración» numerada, hay un par Sujeto/Predicado por oración.
3. **Cálculo escrito:** cuadrícula.
   - Un problema añade solo las partes que necesita (ver §4).
4. **Escritura:**
   - una línea por resultado pedido («Escribe dos servicios» → 2);
   - una explicación, según el curso (3 líneas en Primaria de 3.º a 6.º; 4 en ESO);
   - una redacción, con la extensión que indica («4-5 líneas», «60-80 palabras») o, si no la indica, con las líneas del original (cuatro o más) y, solo sin ellas, con la del curso;
   - un dibujo, el recuadro grande.
5. **Información insuficiente:** se conserva el área del original.

Nunca se da menos espacio que el original, y nunca se pone una cuadrícula si la tarea pide otra cosa.

**Corrección:** `answer_area: line` con N líneas da N líneas, no una (07: cuatro procesos, cuatro respuestas).

## 4. Cuadrícula: cuándo y de qué tamaño

- **Cuándo:** solo en las tareas de cálculo escrito (§3): sumas y restas con llevadas, multiplicaciones, divisiones, operaciones combinadas, problemas de varios pasos, perímetros y áreas con desarrollo, y fracciones o decimales cuando se opera por escrito. Una recta numérica que se marca, una respuesta oral o una lectura no la reciben.
- **Filas** (`calculationRows`):
  - `operaciones × 4 + 1`, con 6 por operación si es una división (dividendo, cociente y restos);
  - `+2` si una restricción protegida pide mostrar el procedimiento («muestra cómo has dividido la figura»);
  - `+2` si el perfil necesita pasos (`operation_steps` medio o alto);
  - mínimo 5 y máximo 12 en Primaria (un tercio de página), 14 en ESO y Bachillerato.
- **Número de operaciones** (`operationsOf`): el mayor de tres recuentos, más uno si la actividad es difícil:
  - los resultados que pide («Calcula el perímetro y el área» = 2);
  - las expresiones que imprime («36 × 4 y 125 + 98 + 47» = 2);
  - en un problema, sus datos menos uno («6 paquetes de 12; se comen 58» = 2; una fracción es un solo dato).
- **Casilla:** la del token de la etapa (7 mm en Primaria). `roomy` la amplía un quinto y `font_scale` la mitad de su factor. Se redondea a 0,5 mm.
- **Ancho:** la columna de respuesta en **casillas enteras** (`round(down, 100%, var(--ms-cell))`), es decir, 23 columnas de 7 mm en la columna de CLARO (161 mm).
- **Dibujo:** SVG en línea, con líneas vectoriales tenues (`--ms-grid`) y un marco fino. Un patrón de fondo CSS desaparecía en el PDF de Chromium.
- **Problemas:** las tres partes son opcionales.
  - **Datos y razonamiento:** solo si hay algo que organizar (tres datos o más, o un perfil que necesita planificar o sostener datos).
  - **Operaciones:** la cuadrícula.
  - **Respuesta:** en problemas y en cálculos cuyo resultado es una cantidad. Lleva un **hueco vacío para la unidad** cuando hay unidades, nunca la unidad escrita, porque puede ser lo evaluado.
  - Las partes no se separan de sus operaciones al paginar.

## 5. Necesidades funcionales

- **`answer_space: roomy`** (contexto, política 2): con motricidad fina media o alta, letra grande o tamaño de letra alto, los renglones y las casillas son un **20 % más amplios**.
  - En Primaria, el renglón pasa de 10 a 12 mm y la casilla de 7 a 8,5 mm.
  - Solo se escribe cuando cambia algo, y nunca con la política 1, así que los contextos históricos se reproducen byte a byte.
- Planificación, memoria de trabajo o pasos (medio o alto) → «Datos y razonamiento» y más filas para los pasos.
- El límite de tareas por página del perfil se respeta siempre. Si exige más páginas, se imprimen.
- En una adaptación de acceso, el objetivo y la exigencia cognitiva se mantienen: el motor añade espacio y estructura, nunca resuelve ni simplifica la tarea.

## 6. Campos en línea, sin duplicar

`inlineFieldLabels` reconoce como campos una línea formada **solo** por etiquetas separadas por comas o punto y coma:
- letras A–H distintas, con o sin «:»;
- una misma palabra seguida de números consecutivos («Flecha 1, Flecha 2, …»).

Una frase con comas, letras repetidas o números que no siguen no lo son. Cuando forman la zona de respuesta, **salen del contexto**: la consigna se imprime una vez y los campos una vez. El parser de marcas de las figuras (`marks.ts`) reutiliza esta misma estructura.

## 7. Paginación

- Una actividad con su figura y su respuesta va entera cuando cabe. Su ejemplo previo viaja con ella aparte: ya no cuenta para decidir si se mantiene junta. Así un problema no queda partido entre «Datos» y «Operaciones».
- La regla «no cortar después» de las actividades que se responden en una tabla solo se aplica cuando la tabla va **después**. Cuando va dentro, pegaba la actividad a la siguiente y dejaba media página vacía.
- **Figuras a la vista.** Una estimación determinista de la hoja física (alto en mm de cada nodo) detecta cuándo una actividad usa una figura impresa en una hoja anterior. Entonces la vuelve a mostrar junto a ella (03: «Compara A y B» ve las dos), con dos condiciones:
  - solo si la figura es pequeña (hasta un tercio de página) o la actividad compara varias;
  - una sola vez por hoja.
- La altura física de los recortes (`heightMm`) se estima mejor y se pasa del servicio al render.
- Se mide en el PDF:
  - no hay hojas solo con cabecera;
  - en cada hoja, salvo la última, la tinta llega al menos a un tercio de la página;
  - no hay desbordes laterales.

## 8. Compatibilidad

- **Contrato guardado ampliado de forma opcional:** `grid.rows`, el campo `space: "grid"`, `unit` y `lines` hasta 30 en campos. Un documento anterior se sigue validando e imprimiendo (cuadrícula de unos 66 mm en casillas enteras, campos sin unidad).
- **Lo que puede escribir un modelo no cambia:** el esquema del borrador y su orden de variantes son los mismos.
- `Presentation.answer_space` y `AssetSource.heightMm` son opcionales. `ANSWER_SPACE_VERSION` documenta la versión del motor.
- No hay migraciones ni cambios en RLS, cuotas, privacidad, identidad de originales ni trazabilidad.
- La línea base de tinta del *smoke* PDF se ha regenerado porque sus fixtures se imprimen ahora con CLARO (revisado a ojo).

## 9. Criterios de aceptación y estado

| # | Criterio | Estado | Prueba |
|---|---|---|---|
| 1 | Todas las fichas comparten la identidad Adaptaula | sí | `tests/pdf/editorial-gallery.test.ts`: misma cabecera, marca y familia en las 8 |
| 2 | Mismos tokens y reglas | sí | tokens únicos y CLARO por defecto (`student-sheet-design.test.ts`) |
| 3 | Cálculo escrito con cuadrícula suficiente | sí | galería (casillas de 7 mm, 23 columnas enteras, de 5 a 12 filas) y `answer-space.test.ts` |
| 4 | Sin cuadrícula donde no corresponde | sí | Lengua, Ciencias y Sociales sin cuadrícula |
| 5 | Dimensiones adecuadas | sí | renglones ≥ 8 mm (10 en Primaria, 12 en roomy), medidos en Chromium |
| 6 | Lengua mantiene párrafos y estructuras | sí | lectura en párrafos, oraciones numeradas y Sujeto/Predicado por oración |
| 7 | Tablas con celdas utilizables | sí | celda vacía = un renglón (10 mm) |
| 8 | Figuras junto a sus consignas | sí | 03, 06 y 07 reales; repetición para comparar |
| 9 | Los apoyos no reducen el espacio | sí | el espacio sale del motor, no de los apoyos |
| 10 | La paginación no corta actividades, figuras ni zonas | sí, con límite | partes del problema unidas; una redacción muy larga puede seguir en la hoja siguiente (las dos primeras líneas siguen con la consigna) |
| 11 | PDF = vista previa | sí | el mismo modelo y CSS (E2E de vista previa) |
| 12 | Sin respuestas para el alumno | sí | sin clave ni solución en la ficha del alumno; la unidad nunca se escribe |

**Pendiente:**
- tablas de clasificar que el original no imprime como tabla (hoy, el área del original);
- espacio para dibujar sobre una figura;
- una alternativa oral por perfil sin decisión del plan;
- validación con docentes.
