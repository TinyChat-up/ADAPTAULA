# Adaptaula 2.0 — etapa 1

Base `origin/main` / `7e5ef52` (PR #38, editor CLARO, integrada). Rama nueva `codex/adaptaula-2-fundamentos`. La API confirmó #38 MERGED y solo #20 abierta antes de esta entrega. Entrega publicada en [PR #39](https://github.com/TinyChat-up/ADAPTAULA/pull/39), abierta y sin merge. Sin cambios en esa otra rama.

## Entrega funcional

- Tokens de color semánticos, tipografía, espacio, radios, superficies, sombras, movimiento y capas en CSS. Primitivas existentes renovadas, sin dependencias nuevas.
- Barra lateral plegable **con etiquetas**, 240 → 112 px; preferencia de presentación conservada en cookie y leída en SSR. Mismas rutas, permisos, identidad/consumo reales y cierre de sesión.
- Ubicación por sección/ruta; navegación móvil flotante con texto, áreas táctiles y safe area. Más opciones en diálogo nativo, Escape/retorno de foco y cierre al cambiar a escritorio.
- Cabecera pública y barra de acciones del editor existente adoptan los componentes; paneles y documentos siguen sólidos. CLARO y su PDF conservan renderer, contenido, fuentes y estilos propios.
- Foco visible, salto real al contenido, campos con errores asociados, estados vacíos y confirmaciones. Translucidez con fallback sólido y preferencias de movimiento, transparencia y contraste; forced-colors con colores del sistema.

## Capturas reales

Solo datos sintéticos generados para estos ensayos. Las cuentas, perfiles y documentos son ficticios. Las fichas entregadas se siembran como fixtures, y el análisis/plan usa `mock:default`; **no validan el generador real**. Captura con Playwright, ocultando únicamente el indicador de desarrollo de Next.js durante la foto.

| Pantalla | Escritorio | Móvil |
| --- | --- | --- |
| Mesa de trabajo, estados reales del fixture | [Ver](desktop-mesa-de-trabajo.png) | [Ver](mobile-mesa-de-trabajo.png) |
| Biblioteca y controles | [Ver](desktop-biblioteca.png) | [Ver](mobile-biblioteca.png) |
| Editor CLARO existente | [Ver](desktop-editor.png) | [Ver](mobile-editor.png) |
| Navegación | [Barra plegada](desktop-compacta.png) | [Más opciones](mobile-menu.png) |

PDFs de los borradores sintéticos: `/workspace/artifacts/adaptaula-2/desktop-borrador-sintetico.pdf` y `mobile-borrador-sintetico.pdf` (artefactos locales, no corpus de usuarios).

## Verificación

| Comprobación | Resultado |
| --- | --- |
| 8 archivos focalizados de Vitest, incluidos permisos, cuotas y borradores PGlite | 129/129 PASS |
| Componentes/contraste/navegación nuevos | Incluidos: 17 pruebas; repetidas tras ajuste de lint |
| PDF de revisión concreta y exportación existente, Chromium real | 9/9 PASS |
| E2E, cuatro recorridos × escritorio/móvil | 8/8 PASS |
| Typecheck | PASS |
| Lint | PASS, solo aviso previo `_id` en `analysis-run-auth.test.ts` |
| Build de producción | PASS; Google Fonts no bloquea esta ejecución |
| Diff/contratos | Sin cambios en `src/lib`, prompts, migraciones, seed, renderer o CSS de CLARO |

Pruebas nuevas de navegación: plegar/ampliar con teclado, conservar preferencia al recargar, rutas activas y contexto; panel móvil, Escape, retorno del foco y cierre al pasar a escritorio. Preferencias reduced-motion/reduced-transparency/high-contrast/forced-colors en Chromium; contraste de tokens y axe. Reflujo a 320 px con texto al 200 %, desbordamiento y foco móvil por encima de la barra inferior. No certifica toda WCAG ni sustituye revisión con lectores de pantalla/Safari real.

Regresión E2E: registro y onboarding, perfil funcional, subida y error de formato, análisis/plan simulados, estados y filtros, cuenta, ficha, edición, undo/redo, guardado, recuperación, recarga y descarga de PDF real de un fixture. Original intacto; tablas/figuras/claves protegidas conservadas. Los 129 tests incluyen RLS entre cuentas, viewer sin escritura, límites y reservas/devoluciones actuales y separación de análisis/adaptaciones. **La política nueva de etapa 4 todavía no está aplicada.**

Comandos (equivalentes binarios locales de los scripts pnpm; el wrapper del entorno intentaba otra instalación):

```sh
node_modules/.bin/vitest run tests/unit/design-foundations.test.ts tests/unit/boundaries.test.ts tests/unit/sheet-editor.test.ts tests/unit/pdf-single-renderer.test.ts tests/db/sheet-editor.test.ts tests/db/adaptation-entitlements.test.ts tests/db/materials.test.ts tests/db/schema.test.ts
node_modules/.bin/vitest run --config vitest.pdf.config.mts tests/pdf/editor.test.ts tests/pdf/export.test.ts
node_modules/.bin/playwright test --config /workspace/adaptaula-setup/foundations.playwright.config.mts design-foundations.spec.ts editorial-interface.spec.ts sheet-editor.spec.ts
node_modules/.bin/next typegen
node_modules/.bin/tsc --noEmit
node_modules/.bin/eslint
node_modules/.bin/next build
git diff --check
```

El override E2E, fuera del repo, deriva de `playwright.config.ts`: PGlite en 54429, Next en 3129, `/usr/bin/chromium`, dist aislado `.next-e2e-foundations`, STANDARD/PREMIUM simulados e imágenes desactivadas. No se detienen servicios ajenos. Tras E2E se retiran solo los includes generados por ese dist y se mueve su caché fuera del checkout antes de typecheck/lint/build para evitar tipos en escritura y escaneo de artefactos. Sin override, el comando habitual del repo usa sus puertos/Chrome configurados.

Incidencias corregidas durante verificación: visibilidad del resumen en la barra plegada (prioridad CSS); etiqueta ARIA del enlace Perfiles coincidía con un selector de prueba demasiado amplio (se conserva nombre accesible con texto sr-only, sin cambiar el selector ni quitar aserciones); el indicador de Next interceptaba el clic del test en la esquina inferior (se verifica el botón también con teclado). Typecheck se repite con los tipos de dev estabilizados; lint corrige dos llamadas a createElement en los tests. Sin suite completa ni servicios remotos.

## Referencias y decisiones

Consultadas en Chromium el 2026-10-15, después de habilitar los dominios en el entorno. No se importó código, assets ni dependencias de las referencias; no hay licencia de terceros nueva que incorporar.

| Referencia | Observación | Aplicación / límite |
| --- | --- | --- |
| [Apple Materials](https://developer.apple.com/design/human-interface-guidelines/materials) | Material como separación de capas; Liquid Glass para controles/navegación y uso moderado, fuera del contenido | Navegación y ActionBar translúcidas; CLARO/paneles sólidos; mayor opacidad y fallback para legibilidad |
| [Apple Liquid Glass](https://developer.apple.com/documentation/TechnologyOverviews/liquid-glass) | Adoptar sobre el producto existente, contenido prioritario, consistencia y acciones previsibles | Evolución incremental, sin segundo renderer ni nueva biblioteca de animación |
| [Bencho finds](https://bencho.dev/finds), [catálogo](https://bencho.dev/) | Detalles de selección, carga y controles; ejemplos interactivos | Movimiento solo como respuesta/estado, sin animación ornamental. `/blocks` devolvió 404; la portada contiene el catálogo |
| [Glass controls](https://bencho.dev/finds/chan-glass-controls), [Glass over paint](https://bencho.dev/finds/moiz-glass-paint) | Profundidad y refracción visual marcada | Se toma separación óptica, se descartan deformación del texto y refracción sobre papel |
| [Upload](https://bencho.dev/blocks/upload-dropzone) | Zona clara y respuesta al archivo/tamaño | Referencia para etapa 2; controles/errores actuales conservados, ningún progreso ficticio |
| [Image compare](https://bencho.dev/blocks/image-compare) | Dos estados visuales identificados y control directo de división | Comparación documental pendiente; no asumir equivalencia de páginas ni tapar consignas |
| [Toolbar](https://bencho.dev/blocks/toolbar) | Grupo compacto, herramienta seleccionada y memoria de elección | ActionBar agrupada con etiquetas; sidebar conserva elección. Sin herramientas de dibujo ficticias |
| [Reordering](https://bencho.dev/blocks/liq-arrange) | Vecinos responden al arrastre con deformación | No se introduce reordenación ni movimiento elástico: CLARO no ofrece esta edición |

Se cargó el contenido dinámico de las dos guías de Apple. Fuentes auxiliares/analítica de las referencias pueden estar bloqueadas; no impidieron leer su contenido y ver los ejemplos. Capturas de investigación quedan fuera del Git del producto.

## Límites y siguiente entrega

Esta es la base funcional de la etapa 1, no el rediseño completo. Modo oscuro, comparación real, inspector documental, subida renovada, reorganización específica del dashboard/cuenta/landing y migración de precios/cuotas quedan en [la dirección integral](../../ADAPTAULA_2.md). La ubicación del shell es contexto de sección, no un estado inferido del pipeline. Los borradores continúan con las capacidades y límites de #38.

Siguiente paso: revisar e integrar esta PR por decisión humana; continuar etapa 2 desde main actualizado, centrando A4 y herramientas contextuales sobre el editor actual. No activar modelos pagados para validar presentación.
