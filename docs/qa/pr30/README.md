# Auditoría independiente de PR #30 — 2026-10-14

Rama `claude/fase-8-2b6-escaneos`; código auditado `ccfbf3e`, base `1929849`. La rama remota y `refs/pull/30/head` se comprobaron iguales antes de editar. Sin merge. Solo fixtures sintéticos, PGlite local y proveedores simulados.

## 1. Fallos demostrados

**P1 — La geometría se confunde con identidad pedagógica.** Los diez casos siguientes se aceptaban a **0,75**, todos sin firma ni ancla de actividad. Nueve incluyen una región equivocada, contaminación o pérdida de información; H comprueba robustez y falta de evidencia, no demuestra por sí solo una figura equivocada. El dato «un único visual requerido» procede del análisis: no es una prueba independiente. El caso I prueba que solo cambiar `activityIds` no verifica la pertenencia del dibujo.

| Fixture reproducible | Qué demuestra | Antes | Después |
|---|---|---|---|
| [A](A.png): mayúscula aislada | Texto grande aceptado como figura | Aceptado 0,75 | Rechazado |
| [B](B.png): signo + | Símbolo aislado aceptado como esquema | Aceptado 0,75 | Rechazado |
| [C](C.png): logotipo floral | Decoración única aceptada como célula; se confirma también en integración PDF → Storage | Aceptado 0,75 | Rechazado |
| [D](D.png): dibujo y consigna unidos | La conectividad absorbe texto ajeno | Aceptado 0,75 | Rechazado |
| [E](E.png): dos gráficos unidos | Un trazo accidental oculta que son dos regiones | Aceptado 0,75 | Rechazado |
| [F](F.png): figura cortada y logo interior | Se descarta el borde y se elige la otra región | Aceptado 0,75 | Rechazado |
| [G](G.png): formulario cuadriculado | Un marco con suficiente tinta interior parece dibujo | Aceptado 0,75 | Rechazado |
| [H](H.png): inclinación 1,5°, sombra y grano | Una imagen plausible sigue careciendo de identidad/asociación verificadas | Aceptado 0,75 | Rechazado |
| [I](I.png): figura de la actividad 2 | Se entrega para la actividad 1 indicada por el análisis | Aceptado 0,75 | Rechazado |
| [J](J.png): etiquetas distantes | Se acepta el dibujo sin todas sus etiquetas imprescindibles | Aceptado 0,75 | Rechazado |

[Resultados originales y corregidos, con coordenadas y señales](results.json). El programa del fixture establece la verdad conocida; no se usa IA para evaluarlo. Antes de la corrección fallan las 10 aserciones de rechazo. No se afirma que los 10 sean errores semánticos distintos.

**P1 — Un activo antiguo puede saltarse la nueva decisión.** La lectura de visuales, la lectura por pin y el productor no consultaban la evidencia del localizador. Un recorte `scan_single_region@v1` ya almacenado seguía `ready` aunque la nueva localización lo rechazase; cambiar la versión de caché no protegía la lectura directa. Reproducido con una fila de procedencia antigua y bytes/hash consistentes. El fixture modifica metadatos inmutables solo como superusuario en PGlite para representar el estado que dejó el motor anterior; no se cambia esa inmutabilidad en producción.

**P1 — Fuente precargada sin verificar contra la revisión efectiva.** `produceVisualAsset(..., preloaded)` omitía comparar el SHA-256 con el localizador. Este puede ser una revisión anterior devuelta por `create_visual_locator`, que nunca reemplaza una selección activa automáticamente. Se reproducía un `ok: true` con bytes de otro original del mismo tamaño de página. Un hash correcto del PNG no subsana una procedencia falsa.

Las tres aserciones de integración se reprodujeron fallando contra el código previo, antes de validar las correcciones.

## 2. Correcciones

- Se elimina el criterio de aceptación de `scan.ts`; `scan_identity_gate@v2` devuelve `scan_identity_unverified`, sin rectángulo ni confianza semántica inventada. No se sube el umbral.
- `auto_visuals@v4` impide reutilizar el resultado cacheado de v3. Las páginas sin texto tampoco pueden entrar por el localizador anterior con hipótesis de visión ni por la corroboración de `VisualSpec`. No se añade OCR, modelo, pipeline ni soporte de varias figuras.
- Los localizadores automáticos con evidencia `scan` quedan excluidos de producción/reintento, listado, vista, bytes y pin. Se conservan filas y activos para trazabilidad; una selección humana crea una revisión nueva. El pin antiguo sigue bloqueado tras corregirla.
- Lectura de `evidence` y del localizador de cada pin con el mismo cliente/RLS. Sin migraciones, borrados ni SQL remoto.
- SHA-256 de la fuente precargada comprobado antes de cualquier reutilización o rasterizado.
- Se elimina el análisis de componentes a resolución completa, con agrupaciones potencialmente cuadráticas. El rechazo no accede a `gray`. Los modelos de 200 ppp se retienen únicamente durante su página.

## 3. Riesgos y límites que continúan

- **La localización automática de una figura escaneada no queda resuelta.** No existe en el contrato actual evidencia independiente suficiente de identidad, pertenencia, integridad y etiquetas. Incluso el escaneo correcto de la célula se rechaza automáticamente. La fase queda bloqueada como funcionalidad, no completada por hacer pasar las pruebas.
- La selección humana depende de que el docente identifique y abarque la figura completa. La prueba de núcleo/etiquetas demuestra el fixture, no certifica cualquier selección.
- La vía anterior con capa de texto conserva sus comprobaciones; una capa OCR falsa, páginas híbridas y la fiabilidad de visión no se certifican en esta auditoría. No se promete ausencia universal de falsos positivos.
- El rasterizador sigue limitado a 4096 px por lado; fuente y páginas siguen consumiendo memoria/CPU. Se reduce la retención por página y se elimina la ruta costosa de componentes, pero no se ha medido carga máxima en Vercel ni escaneos reales.
- No se ha consultado producción. No sabemos si existen activos v3 desplegados ni se recuperan ficheros ya descargados. El código corregido bloquea nuevas lecturas de los activos identificados como scan.

## 4. Casos aceptados y rechazados

| Vía | Resultado |
|---|---|
| Escaneo sin capa de texto, PNG o PDF; uno o varios candidatos; incluso aparentemente correcto | Rechazo automático |
| Escaneo con hipótesis de visión o apariencia de barra/recta | Rechazo: no puede evitar el control de identidad |
| Selección humana explícita sobre el original correcto | Se conserva la vía A, con geometría, rasterizado, hash y permisos existentes |
| Localización anterior con capa de texto | Se mantienen sus criterios; fracciones, tablas y regresiones focalizadas pasan |
| Recorte automático previo con evidencia scan | No se entrega ni se reintenta; trazabilidad conservada |
| Fuente precargada con SHA diferente | No se produce activo |
| Figura imprescindible sin resolver en Hacer magia | `blocked`, sin entrega ni descarga; cuota reservada, no consumida |

## 5. Verificación

- **154 pruebas focalizadas PASS en 13 archivos**: 57 de adversarios, contrato de escaneo, integración y política; 97 de localizador anterior, raster, fronteras, RLS, instancias y exportación. Las 3 de caché se repiten tras ampliar las aserciones de lectura rápida, bytes y corrección manual; no se suman dos veces.
- **4 PDF Chromium PASS**: célula escaneada con selección manual, fracciones automáticas, selección tabular e ilustración simulada. Inspección visual de célula: esquema y etiquetas 1/2/3 completos, junto a actividad 1 y antes de las líneas de respuesta. Renderer sin modificaciones.
- Typecheck PASS; lint sin errores, un aviso previo en `analysis-run-auth.test.ts`; diff sin errores de espacios.
- No suite completa ni build innecesario; no IA de pago, SQL remoto, migraciones, Stripe ni cambios comerciales.

## 6. Recomendación

**NO MERGE como implementación terminada de la Fase 8.2B.6.** Los fallos de entrega detectados están corregidos de forma conservadora, pero la capacidad anunciada queda retirada por falta de evidencia. La PR puede revisarse como endurecimiento y restricción de alcance; no debe integrarse con la descripción o los criterios de aceptación originales de «localización automática de la figura única». No se hace merge desde esta auditoría.
