# CLARO: coherencia verificable y legibilidad en papel

20-10-2026. Base `3e9dfd2`, PR #49, #50 y #51 confirmadas integradas en GitHub. Rama `codex/claro-coherencia-visual`. [PR #52](https://github.com/TinyChat-up/ADAPTAULA/pull/52) abierta, sin merge. Entrega local sin llamadas IA, migraciones, Supabase remoto ni cambios comerciales. **Las pruebas automáticas no sustituyen la revisión pedagógica humana.**

## Defectos demostrados y alcance de la corrección

| Caso | Antes, reproducido con fallo | Ahora |
| --- | --- | --- |
| Recta densa 100–124, 24 intervalos | Chromium detecta diez pares de cajas de texto solapadas; el PDF era técnicamente válido. | Rótulos de 4,2 mm (~11,9 pt), por encima/debajo del eje cuando se necesita separación. Cero colisiones en el caso. Mismas 25 etiquetas, mismas posiciones horizontales, intervalo y divisiones. No se eliminan rótulos ni se reduce la letra. |
| Figura exclusiva y título/texto intermedios | La figura no se incorporaba a la actividad. El adversario de impresión dejaba el recurso en la hoja 1 y la consigna en la 2. | Agrupación por `resource_block_ids`, solo recursos anteriores de uso exclusivo dentro de la misma página lógica. Ambos quedan en la hoja 2 del adversario; el texto intermedio se conserva. Sin duplicar recursos compartidos ni cruzar páginas lógicas. |
| Rótulo `0/0` en cero | `VisualSpecSchema` lo aceptaba porque la igualdad cruzada da cero en ambos lados. | Denominador cero rechazado antes de comparar valores; alcanza los consumidores del contrato existente. |
| Reconstrucción resuelta con celda fuera de rango | La proyección aceptaba `rows=2, cols=2, shaded=[4]` y la dibujaba ignorando esa celda. | Validación defensiva de la especificación efectiva antes de dibujar; error estructural y `not_renderable`. Es endurecimiento de la frontera del renderer: los loaders ya validaban sus entradas; **no demuestra un bypass remoto**. |
| Célula simulada sin 1–3 | Brief y revisión simulada aprobaban; el test PDF pasaba. La captura sigue mostrando que no hay números. | Se conserva como caso negativo técnico y se comprueba el aviso `visual_semantics_unverified`. No se arregla el mock para fingir que el proveedor real está validado. La semántica de sus píxeles sigue sin verificar. |

Las tres pruebas unitarias iniciales fallaron antes del arreglo. Los dos fallos de composición/legibilidad se reprodujeron también contra el checkout limpio `3e9dfd2` con Chromium. El evaluador de referencias es una comprobación nueva, no un defecto previo del producto que hubiera estado prometido.

## Qué se aplica realmente en el producto

- Único `MaterialSheet`, mismos componentes y CSS para pantalla, editor, comparación y PDF. Versión de presentación `material_renderer@v5`, sin versión nueva de prompt ni de contrato persistido.
- Validación intrínseca existente de divisiones, índices y marcas, reforzada contra denominadores cero y frente a especificaciones resueltas inválidas. El PDF conserva su parada mediante `readinessOf`.
- Agrupación acotada por referencias explícitas y mejora de las rectas numéricas. Barras, cuadrículas y círculos se conservan: los casos revisados no demostraron un defecto que justificase redibujarlos.
- Aviso docente para imágenes de píxeles disponibles: imprimirlas no verifica sus etiquetas ni su identidad. No se imprime el aviso dentro de la ficha del alumno.
- **No se modifica la aceptación de ilustraciones generadas**, ni su política/revisor, ni se activa generación. Una imagen ya admitida por el contrato anterior puede seguir imprimiéndose con ese aviso; esta PR no certifica ni revoca retrospectivamente su semántica.

## Qué se comprueba solo contra las referencias del corpus

`evals/claro-quality/check.ts` contrasta con referencias escritas a mano: consigna exacta, vínculos, espacio mínimo, especificación completa (partición, sombreado, posiciones), etiquetas esperadas, celdas y unidad literal de tabla, datos conservados y respuestas concretas ausentes del texto visible. Las pruebas PDF comprueban también el relato íntegro y las consignas completas en el archivo final.

**No hay nuevas referencias fiables persistidas para todos los materiales de usuarios.** Por eso estas comprobaciones contra un oráculo manual no se presentan como un validador universal de Hacer magia. Una descripción de IA, alt o brief no sirve como oráculo. Una respuesta expresada con otras palabras o dentro de una imagen puede escapar a las comparaciones textuales; no se afirma detección universal de soluciones.

Los adversarios cubren: marcador 3 ausente, duplicado, partición incorrecta, sombreado diferente, etiqueta en otra marca, celda fuera de rango, unidad incompatible, referencia inexistente, respuesta visible, paginación separada y PNG opaco con metadatos aprobados. No se añaden heurísticas globales por palabras clave. Los casos que el contrato ya rechazaba se mantienen como regresiones, no como nuevos fallos corregidos.

## Ocho fichas originales

Autoría manual en código, sin generador ni documentos privados. Referencias en [corpus.ts](../../../evals/claro-quality/corpus.ts). Congeladas en `017fe9e` antes de corregir el renderer. Desarrollo: 01, 03, 05, 06. Reserva: 02, 04, 07, 08. La implementación se fijó en `b203e69` antes de ejecutar la reserva; no se ajustaron reglas con ella. No constituyen una muestra representativa de materiales escolares ni una validación educativa independiente por docentes.

| Ficha y curso | Comprobado y resultado | Defecto / cambio | Sin verificar y revisión docente |
| --- | --- | --- | --- |
| [01 · Fracciones, 3.º](ejemplos/despues/01-fracciones.pdf) | 8 partes, 3 sombreadas en posiciones fijadas; 2 consignas y 8 líneas. 1 A4. | Figura separada por título: ahora acompaña a la consigna. | Adecuación de la justificación de la mitad y suficiencia de espacio. |
| [02 · Problemas, 4.º · reserva](ejemplos/despues/02-problemas.pdf) | Cantidades, kg/L, consignas y 11 líneas intactas. 1 A4. | Sin defecto reproducido ni cambio específico. | Demanda de razonamiento, dificultad y claridad para el alumnado. |
| [03 · Rectas, 5.º](ejemplos/despues/03-rectas.pdf) | 25 rótulos, 24 intervalos, escala 100–124; sin solapes; 8 líneas. 1 A4. | Diez solapes antes, cero después; letra mayor. | Interpretación de la escala alternada y conveniencia de una recta tan densa. |
| [04 · Lectura, 3.º · reserva](ejemplos/despues/04-lectura.pdf) | Tres párrafos completos, preguntas literales y de inferencia, 8 líneas. 1 A4. | Sin defecto reproducido ni cambio específico. | Riqueza de la inferencia, nivel lingüístico y extensión de respuesta. |
| [05 · Clasificación, 5.º](ejemplos/despues/05-clasificacion.pdf) | Palabras originales, tres categorías, nueve celdas vacías y 5 líneas. 1 A4. | Sin defecto de tabla reproducido; no se reduce su letra. | Adecuación de categorías y tamaño de las celdas para escritura manual. |
| [06 · Planta, 3.º](ejemplos/despues/06-planta.pdf) | PNG original sintético embebido, consigna con 1–3, 8 líneas y sin nombres de solución en el texto. 1 A4. | Se explicita el límite semántico; no se declara el PNG correcto por su alt. | **Marcadores, destinos y exactitud botánica SIN VERIFICAR automáticamente.** Requiere inspección docente. |
| [07 · Información, 4.º · reserva](ejemplos/despues/07-informacion.pdf) | Tres destinos, distancias, unidad m, condición de 700 m y 8 líneas. 1 A4. | Sin defecto reproducido ni cambio específico. | Comprensión de la condición y justificación de la elección. |
| [08 · Cuadrícula, 6.º · reserva](ejemplos/despues/08-cuadricula.pdf) | 4×6 celdas, 6 sombreadas; círculo de cuatro partes con una sombreada; 2 m²/celda y 9 líneas. 1 A4. | Representaciones existentes conservadas, sin rediseño artificial. | Razonamiento de equivalencia/áreas, adecuación curricular y carga de la tarea. |

Todas mantienen el hash del documento fuente tras proyectar/imprimir. La clave docente no forma parte del modelo del alumno. Los ocho PDFs finales son fichas sintéticas para evaluación humana; no salidas de una llamada real a Hacer magia. [Resultados técnicos y hashes](resultados.json).

## Comparación visual

| Evidencia | Antes | Después |
| --- | --- | --- |
| Recta | [Captura](capturas/03-rectas-antes.png) · [PDF](ejemplos/antes/03-rectas.pdf) | [Captura](capturas/03-rectas-despues.png) · [PDF](ejemplos/despues/03-rectas.pdf) |
| Barra y consigna | [Captura](capturas/01-fracciones-antes.png) · [PDF](ejemplos/antes/01-fracciones.pdf) | [Captura](capturas/01-fracciones-despues.png) · [PDF](ejemplos/despues/01-fracciones.pdf) |
| Adversario de salto físico | [PDF, figura en hoja 1](ejemplos/antes/09-adversario-paginacion.pdf) | [PDF, figura y consigna en hoja 2](ejemplos/despues/09-adversario-paginacion.pdf) |

[Vista de escritorio](capturas/desktop-ficha.png) · [Editor móvil](capturas/mobile-editor.png) · [Cuadrícula y círculo](capturas/08-cuadricula-despues.png) · [Tabla](capturas/05-clasificacion-despues.png) · [Caso negativo de célula mock](capturas/celula-mock-no-validada.png).

Capturas de Chromium y rasterizado de los PDF reales, sin retoque. Cuentas ficticias locales. Los límites comerciales visibles en los E2E pueden estar ampliados por el arnés local; no representan cambios de planes del producto. El adversario 09 es una prueba de estrés, no una novena ficha escolar. La célula negativa no se incluye entre las fichas finales utilizables.

## Reproducción y pruebas

```sh
# Cuatro casos de desarrollo + adversarios; ningún servicio externo
pnpm exec vitest run tests/unit/claro-coherence.test.ts tests/unit/claro-reference.test.ts
pnpm exec vitest run --config vitest.pdf.config.mts tests/pdf/claro-quality.test.ts
# Reserva: ejecutar cuando las reglas estén fijadas
CLARO_INCLUDE_RESERVE=1 pnpm exec vitest run --config vitest.pdf.config.mts tests/pdf/claro-quality.test.ts
```

El test geométrico usa Chromium completo instalado en `/usr/bin/chromium`; los PDFs usan el motor real de `@sparticuz/chromium` de CLARO. Los resultados quedan en `.pdf-smoke/quality-after-*`. No descargar otro browser ni consumir IA. Para otro entorno, configurar la ruta del navegador de prueba según su instalación.

| Verificación local ejecutada | Resultado |
| --- | --- |
| Renderer, contratos visuales, Hacer magia, HTML y PGlite: 12 archivos focalizados | 185/185 PASS |
| Nuevas regresiones, fronteras y recursos visuales PGlite: 5 archivos | 51/51 PASS (se solapa con el lote anterior) |
| PDF real: corpus, ilustraciones, visuales automáticos, exportación y editor | 21/21 PASS |
| Repetición del corpus tras aislar el navegador auxiliar de la medición RSS | 10/10 PASS; mismas reglas y datos |
| E2E: ficha nueva, renderer y comparación/editor, escritorio y móvil | 10/10 PASS; incluye acceso ajeno/lector, conflictos y descarga real |
| Typecheck | PASS |
| ESLint completo | 0 errores; un aviso preexistente `_id` en `analysis-run-auth.test.ts` |
| Build de producción local | PASS |
| Escáner de secretos y `git diff --check` | PASS |

La medición de memoria muestrea procesos descendientes durante la impresión local; no es un máximo garantizado ni una medida de Vercel. El navegador auxiliar de geometría se abre después de imprimir el corpus para no contaminar esa medida. Los informes de antes son comparativas visuales, no una referencia de rendimiento.

## Límites y siguiente mejora

Sin pruebas pagadas, ni activación de OCR/imágenes, ni cambios de prompts, cuotas, Stripe, RLS o servicios remotos. La semántica de imágenes externas, la equivalencia pedagógica general, respuestas parafraseadas, exactitud científica y adecuación individual permanecen fuera de la aprobación automática. La agrupación no resuelve recursos compartidos, posteriores o de otra página lógica; figuras o consignas mayores que una hoja requieren revisión del PDF final.

Siguiente prioridad: revisión de estas ocho fichas por docentes de Primaria y PT, especialmente escala alternada, escritura manual e identidad del esquema. Después, diseñar una forma de registrar referencias verificadas por el docente vinculadas a versión y recurso, antes de ampliar los chequeos consigna–figura a materiales reales. No recopilar correcciones automáticamente.
