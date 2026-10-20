# Auditoría transversal de Adaptaula — 20 de octubre de 2026

Base: `main` en `8a7e327` (#48 integrada). Rama: `codex/auditoria-limpieza-documentos`. [PR #49](https://github.com/TinyChat-up/ADAPTAULA/pull/49), abierta sin merge.

**Conclusión:** el producto conserva una arquitectura coherente, un único renderer y un recorrido local funcional hasta el PDF. La limpieza de esta entrega es integrable; no acredita que el MVP esté preparado para publicar en producción. Quedan riesgos operativos, una carrera en la limpieza de subidas y validación pedagógica real pendiente. La apariencia del documento puede mejorarse dentro de CLARO, sin sustituir su motor.

## Alcance y método

- Revisión transversal de arquitectura, entradas y permisos de API, Auth, RLS, Storage, cuotas, pipeline, edición, PDF, privacidad, dependencias y despliegue. Lectura de los módulos críticos; no se afirma revisión manual exhaustiva de cada línea.
- Grafo estático de imports/exportaciones y `import()` literales de los archivos TS/JS versionados, con resolución de TypeScript. Entradas de producción: `src/app/**` y `src/proxy.ts`. Contraste con pruebas, scripts, evals y búsquedas globales antes de borrar. El grafo no prueba ausencia de consumidores externos ni sustituye el análisis de llamadas dinámicas.
- Pruebas locales con PGlite, cuentas ficticias y proveedores simulados; Chromium real para imprimir. No se repitieron las 1803 pruebas de la entrega anterior.
- Capturas nuevas de escritorio (1280 × 900) y móvil (390 × 844), inspeccionadas en esta sesión. No se reutilizan capturas antiguas como evidencia.
- Sin conexión a Supabase/Vercel, migraciones remotas, datos de alumnado, llamadas de IA pagadas ni cambios comerciales. GitHub y el registro público de dependencias sí se consultaron.
- El skill `product-design:audit` orientó la revisión visual; su navegador y algunos recursos auxiliares no estaban expuestos. La evidencia visual procede del Playwright local del proyecto, no de una sesión de ese navegador ni del producto desplegado.

## Hallazgos priorizados

| ID | Prioridad | Evidencia y consecuencia | Estado / siguiente acción |
| --- | --- | --- | --- |
| A1 | Alta | `src/app/api/cron/materials/route.ts` selecciona subidas antiguas, borra Storage y solo después borra la fila condicionada a `status=uploading`. Si `completeUpload()` termina entre la selección y el borrado de Storage, puede conservarse un material completado cuyo original ya se ha borrado. | Riesgo demostrado por la secuencia del código; no se ha ejecutado la carrera contra un servicio real ni se afirma que haya ocurrido. Preparar una operación duradera con reclamación atómica compartida entre finalización y limpieza, y pruebas de concurrencia/recuperación. Una segunda lectura del estado no cierra la carrera. No se altera apresuradamente este flujo destructivo en una PR de limpieza. |
| A2 | Alta para lanzamiento | El PDF, Auth/correo, RLS y Storage del despliegue no están verificados en staging. La captura aportada anteriormente por el usuario mostraba un proyecto marcado PRODUCTION con señales de 025–028 ausentes; no se ha vuelto a consultar. | Bloquea afirmar preparación de producción. Usar el procedimiento de #47, previa autorización de staging. El historial ausente no equivale a esquema vacío; inspeccionar objetos efectivos. |
| A3 | Alta para calidad pedagógica | En `tests/pdf/illustrations.test.ts`, la ficha pide partes numeradas 1–3 y el dibujo de `MockImageProvider` carece de esos números. El PDF pasa sus controles técnicos. | Inconsistencia comprobada visualmente en un fixture, no un fallo observado del proveedor real. Los tests de impresión no verifican identidad, exactitud científica ni correspondencia de etiquetas. Conservar el mock como prueba técnica y añadir evaluación separada antes de activar imágenes. |
| A4 | Media | `docs/SECURITY.md` presentaba como implementados CSP global, cookies HttpOnly, Google/magic link, KaTeX, webhooks y panel admin; el código no permite acreditar esas afirmaciones. | Corregido el documento y aclarado el mapa conceptual en ARCHITECTURE. Las cabeceras globales requieren implementación compatible con los visores privados; el CSP de impresión sí existe. |
| A5 | Media | La API PDF permite sucesivas renderizaciones autenticadas sin límite de frecuencia propio; cada descarga lanza Chromium. El artefacto local traza 116,6 MB. | Riesgo de capacidad/coste de CPU, no acceso anónimo. Definir un límite medido y control de concurrencia/caché privada antes de escalar; no inventar cuotas comerciales de descarga. |
| A6 | Media | El motor admite 30 s por etapa, pero la ruta PDF declara 60 s en total. El caso lento puede superar el tiempo de la función. | Falta un presupuesto total y una prueba de cancelación/limpieza ante lentitud. Los tiempos locales rápidos no prueban el peor caso ni el runtime de Vercel. |
| A7 | Media | La vista utiliza páginas lógicas; Chromium pagina físicamente. El fixture de diez páginas lógicas imprime once. | Comportamiento existente y anunciado en UI. Antes de imprimir convendría ofrecer la vista del PDF definitivo y su número real de hojas, reutilizando la exportación. No forzar contenido ni reducir letra para igualar páginas. |
| A8 | Media | `pnpm audit` comunica `GHSA-vfj7-8cjw-p6xm` en `braces@3.0.3`, por ESLint/Next, severidad alta y sin parche publicado. | Solo desarrollo según el informe; no hay avisos en el árbol `--prod` consultado. No se fuerza una versión inexistente ni se elimina ESLint. Revisar cuando el upstream publique una corrección. |
| A9 | Media | No hay `.github/workflows` ni configuración Dependabot/Renovate. Vercel build no ejecuta por sí mismo las pruebas PGlite/PDF del repositorio. | Falta automatizar una puerta de integración y comprobar protecciones de rama; no se inspeccionó la configuración privada de GitHub. |
| A10 | Media | La baja registra una solicitud; no elimina Auth ni Storage. La exportación excluye espacios compartidos y ciertos recursos; la interfaz lo indica. | No declarar ciclo de vida completo ni cumplimiento jurídico final. Falta procesador recuperable y política de conservación revisada. No eliminar tablas, documentos o cuentas en esta limpieza. |
| A11 | Baja / UX | En escritorio, el inspector abierto y la navegación reducen el ancho del papel; en móvil los controles y el panel hacen el editor largo. | Priorizar un modo de revisión con más superficie de papel y herramientas junto a la selección. Capturas de editor abajo. Mantener zoom, foco y funciones actuales. |

### Reproducción de la carrera A1 por intercalación

1. Existe una subida `uploading` de más de 60 minutos. Su URL de subida puede durar 7200 segundos (`materials/config.ts`).
2. El cron selecciona su ID como candidato a limpieza.
3. La finalización valida los bytes y actualiza el material a `uploaded` o lo deja en cola.
4. El cron elimina el objeto de Storage usando el candidato anterior.
5. El `DELETE ... status=uploading` no elimina la fila, pero el original ya falta. Además, la ruta incrementa `removed` sin comprobar el resultado del DELETE.

No hay un lock o reclamación persistente común a ambas operaciones en el código revisado. La corrección exige probar también fallos de Storage y recuperación, para no cambiar pérdida de originales por archivos huérfanos sin trazabilidad.

## Limpieza realizada

| Retirado | Motivo comprobado | Se conserva |
| --- | --- | --- |
| `src/lib/adaptation/corrections.ts` | Prototipo sin consumidores de producto, scripts o evals; solo su bloque de tests. Permitía operaciones distintas del editor operativo y documentaba capacidades no disponibles. | `src/lib/editor/**`, borradores 025, sus pruebas de permisos, integridad, conflictos y PDF. |
| `src/lib/visuals/contracts.ts` | Contrato reservado anterior a ilustraciones; solo su test lo importaba y afirmaba que la generación no existía. | `visuals/illustration.ts` y servicio actual `materials/visuals/illustrate/**`; prompts y pruebas activas. |
| `ImageBriefSchema` / `ImageBrief` de `schemas/ai-contracts.ts` | Esquema antiguo cuyo único consumidor era una comprobación de objeto vacío en tests. | `BriefDraft` / `IllustrationBrief` y validación vigente en `visuals/illustration.ts`. |
| Pruebas exclusivas de esos prototipos | Verificaban código que ningún flujo del producto ejecutaba. | Regresiones del editor real, de ilustraciones, de seguridad y del pipeline. La disminución de esos tests no se presenta como aumento de calidad. |

**No se han eliminado dependencias:** las declaradas tienen usos en producto, pruebas o evals. Tesseract es de desarrollo; no se activa en Hacer magia. Se conservan prompts publicados, migraciones, fixtures adversariales útiles, corpus sintético y módulos internos de costes/corpus con consumidores de pruebas o evals. La tabla `exports` y RPC heredadas necesitan decisiones de compatibilidad y migraciones separadas, no un DROP genérico. La PR histórica #20 sigue abierta; no se cierra ni fusiona por inferencia.

## Salud por área

| Área | Evidencia local | Límite |
| --- | --- | --- |
| Arquitectura | Un renderer `MaterialSheet`, proyección `RenderModel` y CSS compartidos para pantalla/PDF; edición separada de generación. | Árbol inicial de arquitectura contiene módulos propuestos; aclarado. |
| Auth y permisos | Guards por petición, origen en mutaciones, cliente de usuario y RLS; pruebas de acceso de otro usuario y lector. | Email real, sesiones del despliegue y permisos remotos no comprobados. |
| Cuotas y planes | PGlite comprueba Free, Pro, Max, perfiles, páginas, reservas y compatibilidad comercial. | Los valores desplegados dependen de las migraciones reales. |
| Hacer magia | Contratos validados, versiones, trazas y bloqueos conservadores. No se cambia modelo/prompt. | La calidad semántica de una salida real no queda acreditada por los mocks. |
| Originales y visuales | Lectura privada, hashes y referencias fijadas; escaneos no verificados bloqueados. | Carrera A1; sin aceptar localización automática en escaneos por confianza numérica. |
| Editor | Guardado, recuperación, undo/redo, conflicto entre pestañas y PDF de revisión concreta comprobados. | No edita estructura/tablas/figuras; aviso docente no es validación automática. |
| PDF | A4, fuentes incrustadas, texto, visuales, ausencia de claves y aislamiento sin red cubiertos localmente. | No certifica PDF/UA, todas las etiquetas científicas ni ejecución Vercel. |
| Privacidad | Exportación acotada y baja protegida por servidor; tests PGlite y de API. | Sin borrado físico, política de conservación final ni revisión jurídica concluida. |
| Dependencias | 0 avisos en producción, 1 alto de desarrollo sin parche publicado en la consulta actual. | Una auditoría de advisories no prueba ausencia de vulnerabilidades propias. |

## Recorrido visual observado

1. **Entrada pública — buena:** el ejemplo está identificado como sintético, el registro es accesible y los planes sin contratación no simulan pagos. [Escritorio](capturas/landing-desktop.png), [móvil](capturas/landing-mobile.png).
2. **Registro/onboarding/subida — funcional localmente:** el recorrido termina en análisis simulado; teclado, reflujo 320 px y texto al 200 % pasan en las superficies públicas probadas. No acredita correo real.
3. **Comparación — buena:** originales y adaptaciones tienen navegación independiente; móvil muestra un documento cada vez. [Escritorio](capturas/comparador-desktop.png), [móvil](capturas/comparador-mobile.png).
4. **Edición — funcional, mejorable en espacio:** acciones y versión guardada claras, con advertencia pedagógica explícita; el panel compite con el papel. [Escritorio](capturas/editor-desktop.png), [móvil](capturas/editor-mobile.png).
5. **Privacidad — funcional en local:** exportación y solicitud de baja con dos identidades ficticias, contraseñas correctas/incorrectas y límite de intentos. No ejecuta eliminación física ni confirma servicios reales.
6. **Descarga — correcta técnicamente en local:** descarga de la revisión 1, original intacto y documento generado intacto comprobados por E2E. [Tabla](capturas/pdf-tabla.png); [célula mock con la carencia de numeración descrita](capturas/pdf-celula-mock.png).

Las capturas muestran la superficie local de esta sesión. Axe y pruebas de teclado/reflujo acotadas no equivalen a una auditoría WCAG completa ni a validación pedagógica docente.

## Skills, conectores y mejoras de documento

| Recurso | Disponibilidad | Aportación concreta y límite |
| --- | --- | --- |
| `product-design:ideate` | Skill disponible | Explorar variantes de jerarquía, espacios, tablas y apoyos sobre fichas sintéticas. Sus imágenes sirven de referencias visuales; no de ficha académica final ni de fuente científica. Generar alternativas puede consumir herramientas externas; no se ha ejecutado. |
| `product-design:image-to-code` | Skill disponible | Traducir una dirección elegida a componentes/tokens existentes de CLARO, con responsive y pruebas. No crear otro renderer ni convertir el contenido en una imagen. |
| `product-design:audit` | Skill disponible; navegador propio no expuesto en esta sesión | Comparar legibilidad, editor y flujo de revisión con evidencia visual. No evalúa por sí solo corrección curricular. Aquí se usó Playwright local para las capturas. |
| Skill propio «Maquetación y revisión CLARO» | Propuesta, no instalado | Checklist de carga de lectura, separación de consignas, agrupación de figura/actividad, espacio de escritura, edad, etiquetas y ausencia de respuestas. Debe producir observaciones y cambios de presentación compatibles con los contratos; nunca aprobar automáticamente el contenido. |
| Google Drive, Dropbox o Box | Plugins recomendados, no disponibles como conectores activos aquí | Facilitar selección y devolución de materiales autorizados. No mejoran la pedagogía ni la composición por sí mismos. Requerirían integración, autorización y revisión de tratamiento de datos. No se instala nada. |
| Catálogo de pictogramas/diagramas con licencia | Integración nueva, no disponible actualmente | Apoyos consistentes con procedencia y licencia verificadas. Revisar condiciones, atribución y adecuación antes de integrar; no extraer imágenes arbitrarias de la web. |

Para el documento final, la mayor mejora vendrá de **CLARO y recursos deterministas**, no de añadir conectores: figuras exactas para matemáticas, etiquetas legibles y ancladas, jerarquía tipográfica, espacios de respuesta y agrupación del contenido. Una imagen generada puede apoyar una explicación, pero no sustituye la evidencia de una figura imprescindible ni debe adelantar soluciones.

### Tres mejoras de mayor impacto, por orden

1. **Integridad de recursos:** corregir A1; después definir fixtures pedagógicamente coherentes que comparen consigna, figura y etiquetas. Mantener la parada cuando falte evidencia, sin activar imágenes.
2. **Vista previa del PDF definitivo:** mostrar paginación física y comprobar cortes/etiquetas antes de imprimir. Reutilizar la exportación autenticada de CLARO y la revisión guardada; no construir otro renderer.
3. **Biblioteca pequeña de apoyos didácticos deterministas:** ampliar solo formatos verificables (diagramas/esquemas/tablas/guías), con reglas de edad y carga visual. Diseñarlos con el skill de ideación y trasladarlos a CLARO con pruebas visuales y de ausencia de respuestas.

## Verificación reproducible

| Comprobación ejecutada | Resultado |
| --- | --- |
| Pipeline, localizador, editor, guards y secretos: 8 archivos focalizados | 98/98 PASS |
| Cuotas, perfiles, páginas, bajas, borradores, exportación, esquema y Auth: 11 archivos focalizados | 97/97 PASS |
| Contratos tras la limpieza, ilustraciones, visuales y pipeline: 4 archivos focalizados (incluye repeticiones de regresión) | 78/78 PASS |
| `node scripts/smoke-pdf.mjs` | 39/39 PASS; traza 343 archivos / 116,6 MB; carga con archivos trazados PASS |
| Playwright: `public-stage4b.spec.ts` y `document-review.spec.ts`, escritorio/móvil | 12/12 PASS |
| Playwright: `account-privacy-stage5a.spec.ts`, escritorio/móvil | 4/4 PASS; contraseña, RPC, idempotencia, exportación y límite de intentos |
| Typecheck y build | PASS |
| ESLint | 0 errores; 1 aviso preexistente en `analysis-run-auth.test.ts` |
| Audit dependencias | Producción: 0 advisories; desarrollo: 1 alto sin parche, documentado arriba |

Los tres recuentos de tests focalizados se solapan: no sumarlos como pruebas únicas. Para repetir las áreas: `vitest run tests/unit/{adaptation-pipeline,automatic-visuals,sheet-editor,editor-save-route,boundaries,visual-boundaries,adaptation-web-boundaries,secrets}.test.ts`; el segundo lote añade `tests/db/{commercial-policy,free-plan-adaptations,account-deletion-request,sheet-editor,pdf-export,materials,staging-schema-preflight}.test.ts` y `tests/unit/{account-export,auth,pdf-download,pdf-single-renderer}.test.ts`.

Los E2E usaron `fake-supabase.mjs` y Next local con `AI_MODEL_STANDARD=mock:default`. El navegador estándar no pudo descargarse (403 del dominio); se utilizó el Chromium 153 ya instalado de `@sparticuz/chromium`, con aislamiento web habilitado y sin `--single-process`, mediante configuración temporal fuera de Git. El primer intento con argumentos serverless incompatibles se descartó tras diagnosticar ausencia de Origin; el pase 12/12 corresponde a la configuración corregida. No se relajó la comprobación CSRF del producto.

En los 21 fixtures medidos del smoke local, máximo de render observado 1126 ms y pico RSS muestreado de descendientes Chromium 168 MB. No son máximos garantizados ni medidas de Vercel. [Mediciones](pdf-mediciones-locales.json).

Informes de dependencias: [árbol completo](adaptaula-dependency-audit.json), [solo producción](adaptaula-dependency-audit-prod.json).

**Recomendación:** MERGE de la limpieza tras revisión y checks de su PR; NO considerar este resultado una autorización de lanzamiento. Resolver A1 y validar la infraestructura/PDF en staging antes de decidir la publicación general. No se hace merge automático.
