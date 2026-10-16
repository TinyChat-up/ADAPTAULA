# Adaptaula 2.0 · etapa 2A · workspace documental

Base: `a6474a7`, PR #39 integrada. Rama: `codex/adaptaula-2-workspace`. PR pendiente de publicación, sin merge. Fecha: 2026-10-16.

## Entrega

El original ocupa el centro de la preparación: una página cada vez, zoom 50–200 % relativo al ancho, ajuste al ancho y navegación independiente. El mismo visor privado acompaña al análisis, a la elección del perfil y a los estados de la adaptación. El panel se oculta sin perder la selección ni interrumpir el seguimiento. «Elegir apoyos» / «Ver estado» enfoca el siguiente paso, también en móvil. En escritorio con altura suficiente, el original permanece a la vista al bajar por el panel.

Subida por arrastre/explorador con nombre, formato, peso, cambio/quitar, límites reales, errores y fases de red comprobables; no porcentaje ficticio. Resumen funcional a partir de `summarizeProfile`; detalles del análisis, datos y opciones secundarias desplegables. El rol de lectura no ofrece modificaciones ni inicia análisis en cola. No hay cambio de permisos en servidor.

Reutiliza la ruta de páginas del original y los componentes de estado. Se retira `OriginalPreview`, sustituido por este visor; no existe un renderer paralelo. CLARO, borradores, descarga PDF, contratos y operaciones del pipeline siguen intactos. El comparador y la reorganización del editor corresponden a **2B**, aún pendiente.

## Evidencia visual

Capturas reales de Chromium, escritorio 1280 × 900 y móvil 390 × 844. Documento original sintético propio de dos páginas (`tests/support/workspace-pdf.ts`), cuentas ficticias y proveedor simulado. El análisis del doble es fijo: sus referencias a una pizza no son una interpretación real del PDF. **Las capturas no validan la calidad pedagógica del generador ni cuentan como revisión docente.**

| Pantalla | Escritorio | Móvil |
| --- | --- | --- |
| Subida | [Ver](desktop-subida.png) | [Ver](mobile-subida.png) |
| Documento y panel | [Ver](desktop-workspace.png) | [Ver](mobile-workspace.png) |
| Elegir apoyos, con foco | [Ver](desktop-apoyos.png) | [Ver](mobile-apoyos.png) |
| Original ampliado, panel oculto | [Ver](desktop-documento.png) | [Ver](mobile-documento.png) |
| Bloqueo explicado | [Ver](desktop-bloqueo.png) | [Ver](mobile-bloqueo.png) |

Solo se oculta el indicador de desarrollo de Next en las capturas, no estados ni controles del producto. Se inspeccionan las imágenes, además de las aserciones de navegador.

## Comprobaciones

- **146/146** pruebas focalizadas en nueve archivos: componentes, límites de importación, estados de adaptación, editor, único renderer, integración PGlite de materiales, cuotas y borradores. Los nueve casos nuevos del visor/estado se incluyen en ese total. Tras los ajustes finales, los 35 checks de componentes/boundaries se repiten sin errores.
- **9/9** pruebas PDF con Chromium real: edición guardada reflejada, tablas/figuras y original conservados, sin claves del docente.
- **40/40 escenarios E2E distintos** en escritorio/móvil, ejecutados en lotes focalizados: 32 de materiales, cuatro nuevos del workspace, dos de estados de adaptación y dos del editor. Recorridos: subida válida/inválida/exceso de páginas; análisis simulado, recarga, reutilización y cuotas/devolución; contexto, borrado y CSRF; perfil, zoom/páginas/panel; error del visor/reintento; estados de trabajo/revisión/bloqueo/resultado; borrador/undo/redo/recuperación/PDF; original comprobado por SHA-256; payload React sin rutas internas del original; 404 entre usuarios y 401 sin sesión; lectura sin comandos/POST. Axe, foco, teclado, reflujo de 320 px/texto 200 %.
- **Typecheck, lint y build: PASS**. Lint mantiene un aviso previo (`_id` sin usar en `tests/unit/analysis-run-auth.test.ts`). Smoke de raster/PDF PASS sobre el artefacto local aislado. El runtime Vercel sigue sin medirse.

Comandos focalizados (sin suite completa):

```sh
pnpm exec vitest run tests/unit/document-workspace.test.ts tests/unit/design-foundations.test.ts tests/unit/boundaries.test.ts tests/unit/adaptation-ui-render.test.ts tests/unit/sheet-editor.test.ts tests/unit/pdf-single-renderer.test.ts tests/db/materials.test.ts tests/db/adaptation-entitlements.test.ts tests/db/sheet-editor.test.ts
pnpm exec vitest run --config vitest.pdf.config.mts tests/pdf/editor.test.ts tests/pdf/export.test.ts
pnpm exec playwright test document-workspace.spec.ts materials.spec.ts adaptation-states.spec.ts sheet-editor.spec.ts
pnpm typecheck
pnpm lint
pnpm build
pnpm smoke:raster
pnpm smoke:pdf
```

En este contenedor se usan los binarios locales equivalentes y una configuración Playwright externa con Chromium del sistema, puertos 3130/54430 y caché de Next aislada para no interferir con otro servidor. STANDARD y PREMIUM se fijan a `mock:default`, imágenes IA desactivadas, Supabase de pruebas en PGlite. El build también se ejecuta contra esa configuración local. No se usan servicios remotos ni APIs pagadas.

## Hallazgos de la verificación

- Pasar la fila completa del archivo a un componente cliente incluía `storage_path` en el payload React, aunque su tipo y el HTML visible no lo usaran. Prueba E2E fallida antes del arreglo; las dos páginas ahora construyen una lista explícita de cuatro campos públicos. La prueba comprueba el HTML/payload completo del material y la adaptación, además de las rutas privadas. No se confunde un tipo TypeScript con un filtro en ejecución.

- La imagen podía llegar antes de hidratar React y dejar «Cargando» con la página ya visible. Reproducido por el recorrido de solo lectura; corregido consultando `complete/naturalWidth` al montar, además de los eventos de carga/error.
- El aviso largo del bloqueo desbordaba con 320 px y texto 200 %. Corregido el mínimo de anchura y el ajuste de palabras en `Alert`; también se permite envolver controles del visor.
- Una fixture antigua de estado listo solo contenía `{schema_version: 1}` y las guardas reales la rechazaban. Se sustituye por un MaterialDocument sintético válido y referencias coherentes. No se debilita el gate del producto.
- Dos carreras del arnés: navegación antes del redirect de onboarding y lectura del contador antes de terminar la petición explícita de reanálisis. Las pruebas esperan esos resultados reales. Se conservan las aserciones de cuota, seguridad y fidelidad.

## Límites y siguiente paso

- La vista del original es raster de 110 ppp con los límites existentes. No añade OCR ni capa de selección de texto: se puede abrir el archivo original. No se fuerza A4 sobre originales con otra proporción.
- Cada cambio de página solicita un raster autorizado; no se ha medido rendimiento de documentos grandes en Vercel. El zoom es relativo al ancho disponible, no una escala física de impresión. El papel y el PDF no reciben efectos de cristal.
- El estado del producto sigue viniendo del servidor. Un bloqueo de Hacer magia simulado sin PDF es un resultado de prueba válido, **no** una adaptación entregada.
- Editor/revisión guardada siguen en sus rutas actuales; comparación y nueva interacción contextual son 2B. Ninguna sincronización entre páginas ni resumen de cambios inventado.
- No se cambian cuotas/planes, Stripe, Supabase remoto, RLS, migraciones, prompts/modelos ni recopilación de correcciones. No es una certificación WCAG completa ni validación del generador real.

Siguiente: revisar esta PR sin merge automático. Tras integrarla, abordar 2B sobre main actualizado reutilizando CLARO y estas superficies.
