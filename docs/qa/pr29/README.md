# PR #29 — Comparativa editorial

Sesión 13–14 de octubre de 2026. Rama `claude/variables-expuestas-repo-f2o2et`; antes: `6fa99fc`; después: implementación de ADR-025 en esta misma PR, sin merge.

[Galería HTML](index.html) (abrir localmente) · [Sistema visual](../../UX.md) · [Registro y pruebas](../../DEVELOPMENT_LOG.md).

Capturas Playwright de la app local: escritorio 1440 × 1000 y móvil 390 × 844. Mismo workspace y fixtures antes/después: identidad y perfil ficticios, PDF sintético, análisis/proveedor simulado y estados de adaptación sembrados en PGlite. El título «Fracciones equivalentes» procede del análisis simulado; la ficha final de animales es un fixture inyectado para inspeccionar el renderer existente. **No es evidencia de generación real con IA ni de un despliegue de Vercel.**

| Pantalla | Escritorio | Móvil |
|---|---|---|
| Portada | [Escritorio: antes](before/portada-desktop-hero.png) · [después](after/portada-desktop-hero.png) | [Móvil: antes](before/portada-mobile-hero.png) · [después](after/portada-mobile-hero.png) |
| Inicio | [Escritorio: antes](before/inicio-desktop.png) · [después](after/inicio-desktop.png) | [Móvil: antes](before/inicio-mobile.png) · [después](after/inicio-mobile.png) |
| Materiales | [Escritorio: antes](before/materiales-desktop.png) · [después](after/materiales-desktop.png) | [Móvil: antes](before/materiales-mobile.png) · [después](after/materiales-mobile.png) |
| Perfiles | [Escritorio: antes](before/perfiles-desktop.png) · [después](after/perfiles-desktop.png) | [Móvil: antes](before/perfiles-mobile.png) · [después](after/perfiles-mobile.png) |
| Adaptar material | [Escritorio: antes](before/adaptar-desktop.png) · [después](after/adaptar-desktop.png) | [Móvil: antes](before/adaptar-mobile.png) · [después](after/adaptar-mobile.png) |
| Adaptaciones | [Escritorio: antes](before/adaptaciones-desktop.png) · [después](after/adaptaciones-desktop.png) | [Móvil: antes](before/adaptaciones-mobile.png) · [después](after/adaptaciones-mobile.png) |
| Material y elección de modo | [Escritorio: antes](before/material-desktop.png) · [después](after/material-desktop.png) | [Móvil: antes](before/material-mobile.png) · [después](after/material-mobile.png) |
| Revisión de la adaptación | [Escritorio: antes](before/revision-desktop.png) · [después](after/revision-desktop.png) | [Móvil: antes](before/revision-mobile.png) · [después](after/revision-mobile.png) |
| Resultado con fixture | [Escritorio: antes](before/resultado-desktop.png) · [después](after/resultado-desktop.png) | [Móvil: antes](before/resultado-mobile.png) · [después](after/resultado-mobile.png) |
| Plan y cuenta | [Escritorio: antes](before/cuenta-desktop.png) · [después](after/cuenta-desktop.png) | [Móvil: antes](before/cuenta-mobile.png) · [después](after/cuenta-mobile.png) |

Más detalle de portada: [completa escritorio](after/portada-desktop.png) · [completa móvil](after/portada-mobile.png) · [hojas A4 móvil](after/demo-mobile.png).

## Lectura de la comparación

- Portada: tinta/azul editorial y serif sobre papel, con documentos legibles y demo rotulada. Se conservan datos, pregunta y opciones entre original/adaptado.
- Inicio: acción y trabajos antes que cuota; secciones ordenadas por la tarea del docente. Materiales y perfiles usan filas y metadatos.
- Adaptación: material, perfil, estado y resultado conservan el recorrido. El diseño del documento del alumno no cambia.
- El indicador de desarrollo de Next se oculta **solo en las capturas después**, sin modificar el producto. Las barras fijas aparecen a la altura del viewport original en las imágenes largas.
- La comparación del hero usa el primer viewport; los dos recortes «antes» proceden de las capturas originales tomadas antes de editar. Se omite la captura móvil anterior completa porque Chromium duplicaba teselas a partir de 8192 píxeles. La portada móvil completa «después» se capturó con el mismo viewport CSS de 390 px y densidad 0,75 (293 × 7598 px), evitando ese artefacto del navegador; hero y detalle se entregan a densidad 1.

## Verificaciones

Typecheck y build PASS; lint sin errores (un aviso previo); 62 unitarias focalizadas PASS; 4 Playwright PASS (2 recorridos × 2 tamaños), con axe, teclado, subida, filtros y resultado. Sin desbordamiento en las diez pantallas capturadas, comprobaciones adicionales a 320/768/1280 y biblioteca con texto al 200 % a 320. La suite general, proveedores reales y Vercel no se han validado en este bloque.
