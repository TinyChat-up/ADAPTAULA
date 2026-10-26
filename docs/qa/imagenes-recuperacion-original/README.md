# Imágenes: recuperación de originales y validación de ilustraciones

2026-10-26 · base `268b4bf` (#74 integrada) · rama `codex/imagenes-recuperacion-original` · [PR #75](https://github.com/TinyChat-up/ADAPTAULA/pull/75), abierta sin merge.

## Alcance y diagnóstico

Revisión del recorrido completo de imágenes en código: análisis normalizado → asociación actividad/recurso → localización → reconstrucción → ilustración → autorización/cuota/presupuesto → almacenamiento privado → CLARO/PDF. No es una auditoría del resto del producto ni una validación de producción.

La captura aportada muestra tres recursos imprescindibles sin resolver. Dos llegaron a `illustrate:brief_rejected`, antes de pedir imágenes a OpenAI. El tercero no encontró sustitución equivalente. Esto no demuestra un fallo de credenciales ni permite conocer el rechazo concreto del brief antiguo: la política descartaba su detalle. No se ha leído Supabase ni el análisis de esa adaptación.

## Defectos reproducidos antes de corregir

| Caso | Antes | Ahora |
| --- | --- | --- |
| «Partes señaladas con los números 1, 2, 3 y 4» | No se reconocían las marcas sin «flechas», «numeradas» o «pasos» | Reconocimiento de la referencia explícita, también «qué indican los números» |
| Número separado de su línea indicadora | Se perdía el número 3 por superar los 4 mm; figura rechazada a 100 y 200 ppp | Inclusión solo con una línea indicadora visible; no basta aumentar distancia |
| Número duplicado dentro y fuera de la caja | Podía aceptarse el número interior y dejar fuera la otra marca | El recorte completo descubre la duplicidad y se rechaza |
| Dos dibujos A–D e hipótesis de visión favorable a uno | La puntuación permitía elegir uno ambiguo | Para figuras por marcas se exige firma completa y unicidad independiente de la preferencia del modelo |
| Figura truncada en el borde | Podía aceptarse con todas las marcas visibles | Rechazo conservador si la tinta del candidato llega al límite de la página |
| Brief para actividad A–D sin letras, o con C repetida | Aceptado | Exige cada letra explícita exactamente una vez antes de consumir imagen |
| Cuadrícula con coordenadas separadas del borde | Quedaban fuera los números de las filas; rechazo a 100 y 200 ppp | Inclusión de ejes completos alineados con una retícula regular verificada en píxeles |

Regresiones: `tests/unit/original-image-recovery.test.ts`, `tests/unit/illustrations.test.ts`. Los casos positivos y negativos se ejecutan sin proveedores externos.

## Corrección y límites técnicos

- Motor `auto_visuals@v7`: vuelve a calcular decisiones almacenadas bajo motores anteriores. No modifica las migraciones ni necesita SQL remoto.
- Línea indicadora: continuidad de tinta fina dentro del componente, longitud mínima de dos alturas de etiqueta, desplazamiento suave y separación acotada por el tamaño de la letra y 12 mm. Actualmente se comprueban líneas aproximadamente horizontales; no se promete localizar cualquier esquema.
- Ejes: todas las líneas de ambos ejes deben cubrir al menos el 90 % del candidato, con separación regular (dos píxeles de redondeo), una etiqueta por celda en orden A… / 1…, sin etiquetas perdidas o desplazadas. La separación se acota por dos alturas de etiqueta y 12 mm. Se recupera el recorte, no se reconstruyen el mapa ni sus símbolos.
- Enumeraciones literales: letras A–H, listas con comas o conjunción y rangos; referencias a vértices/columnas; números explícitos de filas y de la descripción, incluido «12, 3, 6 y 9». Una lista ordinaria de ejercicios o sumandos no se convierte en etiquetas de una figura.
- Un recorte automático previo no se reutiliza solo por parecerse: debe contener la nueva caja completa y corresponder a la misma página. Una selección persistida insuficiente queda en `auto_not_revalidated`; no se sobrescribe silenciosamente, especialmente si es humana.
- Se conserva `illustrationRejection` en el plan visual nuevo: motivo y códigos fijos de validación del brief. Se excluyen texto libre y descripciones del proveedor. Los artefactos históricos no recuperan información que no guardaron.
- No cambia el análisis/prompt/modelo, el umbral 0,75, el máximo de tres páginas de visión, tres ilustraciones por adaptación ni el presupuesto defensivo. No se generan imágenes para llenar un cupo.

## Revisión de integración

| Área | Resultado y evidencia |
| --- | --- |
| Análisis y relaciones | El normalizador deriva las relaciones inversas; el defecto reproducido está en interpretar marcas, no prueba que el modelo analizase mal el material remoto |
| Identidad/procedencia | Se conservan material, fingerprint del análisis, SHA del original, página y receta; pruebas de cambio de origen, recursos corruptos y selección humana |
| Localización | Casos positivos y adversariales, páginas equivocadas, texto ajeno, soluciones, duplicados, gemelos y bordes |
| Escaneos sin capa de texto | Siguen rechazándose sin evidencia independiente; no se añade OCR |
| Representaciones exactas | VisualSpec y reconstrucción existentes; no se confían medidas, escalas o cantidades a una ilustración |
| Generación y revisión | Puertas del brief y de la revisión conservadas; validación adicional de letras y diagnóstico sin texto libre |
| Cuotas, presupuesto y reintentos | Consentimiento persistido, plan efectivo, flags, aislamiento, reserva/devolución, reutilización aprobada y presupuesto defensivo probados localmente |
| Recursos privados | RLS, hashes y rutas autenticadas comprobados con PGlite/bytes locales; no se expone un enlace público nuevo |
| PDF | Mismo CLARO, recorte original íntegro y mismas dimensiones de imagen incrustada; no hay otro renderer |

## Evidencia local y límites de la conclusión

Se inspeccionó también el cuaderno sintético conservado fuera de Git de la evaluación anterior: `Adaptaula_10_fichas_imprimibles.pdf`, diez páginas, SHA-256 `e597d44aab6aba09d9d3c9383d1284200cad763d0e1b5ef484aa07af6abcff3e`. Su nombre, tamaño y primera página son compatibles con la captura; **no se ha contrastado su hash con el original de producción**.

El diagnóstico geométrico usa las etiquetas e instrucciones de las anotaciones locales, no una nueva llamada de análisis ni el análisis persistido en producción. Sirve para investigar candidatos; no acredita entrega completa, equivalencia pedagógica ni que `vis_1`, `vis_6`, `vis_11` correspondan a esas páginas. El corpus y sus documentos no se publican en esta PR.

La evidencia publicada aquí es exclusivamente de los fixtures nuevos: [PDF CLARO numerado](figura-numerada.pdf), [página rasterizada](figura-numerada.png), [PDF del plano](plano-coordenadas.pdf) y [plano rasterizado](plano-coordenadas.png). Antes, esas figuras no obtenían recorte aceptado; después conservan las marcas, sin redibujar sus píxeles. Son materiales técnicos sintéticos, no fichas revisadas por un docente.

La geometría verifica colocación y presencia de marcas; no certifica la identidad semántica de cualquier dibujo ni la corrección científica. Permanecen fuera de la garantía los esquemas ambiguos, recortes incompletos, escaneos no verificables y representaciones exactas que no puedan recuperarse. Si son imprescindibles, no se entrega una ficha incompleta. La disponibilidad y calidad del modelo de imagen real siguen pendientes de ensayo autorizado.

## Verificación

410 pruebas focalizadas de unidad/BD/boundaries correctas (28 archivos), 18 PDF correctas (6 archivos), typecheck, build y comprobación de secretos correctos; lint sin errores (aviso previo `_id` en `analysis-run-auth.test.ts`). Se omiten expresamente las E2E de ordenador y móvil por petición del fundador; no se presenta esa cobertura como ejecutada. No se repite la suite general de unidad/BD. Sin gasto de IA, conexión a Supabase/Vercel, migración remota, merge ni despliegue.

Comandos reproducibles sobre los binarios ya instalados (el lanzador pnpm del entorno intenta descargar su propia versión):

```bash
node node_modules/vitest/vitest.mjs run tests/unit/original-image-recovery.test.ts tests/unit/marked-figures.test.ts tests/unit/automatic-visuals.test.ts tests/unit/visual-location-adversarial.test.ts tests/unit/visual-provenance.test.ts tests/unit/visual-raster.test.ts tests/unit/visual-resources.test.ts tests/unit/magic-visual-policy.test.ts tests/unit/magic-illustrations.test.ts tests/unit/illustrations.test.ts tests/unit/illustration-consent-gate.test.ts tests/unit/illustration-production-provider.test.ts tests/unit/visual-supports-opt-in.test.ts tests/unit/visual-support-offer.test.ts tests/unit/visual-support-result.test.ts tests/unit/analysis-v3.test.ts tests/unit/analysis-robustness.test.ts tests/unit/boundaries.test.ts tests/unit/visual-boundaries.test.ts tests/db/marked-figures.test.ts tests/db/automatic-visuals.test.ts tests/db/visual-instances.test.ts tests/db/magic-visual-policy.test.ts tests/db/illustrations.test.ts tests/db/visual-supports-consent.test.ts tests/db/visual-locators.test.ts tests/db/visual-render.test.ts tests/db/scan-visuals.test.ts
node node_modules/vitest/vitest.mjs run --config vitest.pdf.config.mts tests/pdf/marked-figures.test.ts tests/pdf/automatic-visuals.test.ts tests/pdf/illustrations.test.ts tests/pdf/visual-supports-opt-in.test.ts tests/pdf/max-visuals.test.ts tests/pdf/scan-visuals.test.ts
node node_modules/next/dist/bin/next typegen
node node_modules/typescript/bin/tsc --noEmit
node node_modules/eslint/bin/eslint.js
node node_modules/next/dist/bin/next build
```

## Aplicación futura

1. Revisar e integrar la PR y desplegar el código por el procedimiento habitual; no hay migración nueva.
2. La versión del motor evita reutilizar automáticamente un rechazo v6. No reabre ni regenera por sí sola una adaptación bloqueada o entregada, ni modifica originales/borradores.
3. El fundador puede hacer un ensayo manual nuevo con «Crear con apoyos visuales» si está disponible y acepta el coste. Resolver un original puede dar cero imágenes nuevas correctamente; pedir apoyos no garantiza una ilustración.
4. Si persiste un bloqueo, consultar el diagnóstico v7 y `illustrationRejection` de esa ejecución. No marcar recursos como aprobados por SQL ni desactivar los controles para obtener un PDF.
