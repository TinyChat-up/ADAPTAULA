# Adaptaula 2.0 — dirección y entregas

Decisión del usuario, 2026-10-15. El documento es el protagonista: **subir → comprender → elegir apoyos → Hacer magia → revisar → editar → descargar**. Calidad de herramienta creativa, claridad pedagógica y accesibilidad antes que efectos. Se mantiene Next/React/TypeScript/Tailwind, el pipeline y el único renderer CLARO. PR #38 integrada en `7e5ef52` es la base del editor; no se construye otro.

## Entregas verificables, sin merge automático

| Etapa | Alcance | Estado |
| --- | --- | --- |
| 1 | Tokens semánticos, componentes base, superficies, navegación plegable/móvil y preferencias de accesibilidad | Integrada en `a6474a7` mediante PR #39; [evidencia](qa/adaptaula-2-etapa-1/README.md) |
| 2A | Workspace del original, subida, estados reales, apoyos y navegación contextual | Implementado en [PR #40](https://github.com/TinyChat-up/ADAPTAULA/pull/40), desde `a6474a7`; abierta, sin merge. [QA](qa/adaptaula-2-etapa-2a/README.md) |
| 2B | Revisión, experiencia del editor CLARO y comparador original/adaptado | Pendiente; reutilizar renderer y borradores existentes |
| 3 | Mesa docente, biblioteca, perfiles, historial y cuenta | Heredan tokens en etapa 1; reorganización específica pendiente |
| 4 | Landing, cómo funciona, registro, onboarding, precios y migración comercial | Heredan primitivas; rediseño y política nueva pendientes |
| 5 | Consistencia final, responsive, accesibilidad y microinteracciones | Verificación incremental en cada entrega; cierre global pendiente |

Una PR por entrega razonable, desde main actualizado. La siguiente espera la revisión de esta base; no crear ramas paralelas que compitan por el mismo sistema visual. No presentar herencia de tokens como rediseño completo de cada pantalla.

## Sistema visual

Fondo cálido/muy claro, papel blanco, tinta azul profunda y grises fríos. Jerarquía, espaciado, bordes precisos y radios coherentes. Transparencia acotada a navegación/herramientas temporales; superficies de trabajo sólidas. Sin gradientes decorativos, refracción, animación constante ni tarjetas de estadísticas. Iconos acompañados de etiquetas comprensibles, teclado/foco, objetivos táctiles cómodos y alternativas reduced-motion/reduced-transparency/high-contrast.

Modo oscuro solo al mantener contraste y calidad en todas las pantallas afectadas; no invertir el papel ni el PDF. Etapa 1 conserva claro. [Tokens y reglas vigentes](UX.md#sistema-de-diseño--fundamentos-20).

Referencias solicitadas: [Bencho finds](https://bencho.dev/finds), [blocks](https://bencho.dev/blocks), [glass controls](https://bencho.dev/finds/chan-glass-controls), [glass over paint](https://bencho.dev/finds/moiz-glass-paint), [upload](https://bencho.dev/blocks/upload-dropzone), [compare](https://bencho.dev/blocks/image-compare), [toolbar](https://bencho.dev/blocks/toolbar), [reordering](https://bencho.dev/blocks/liq-arrange), [Apple materials](https://developer.apple.com/design/human-interface-guidelines/materials), [Liquid Glass](https://developer.apple.com/documentation/TechnologyOverviews/liquid-glass). Consultadas con Chromium después de resolver el bloqueo inicial del proxy. `/blocks` devuelve 404; el catálogo está en `/` y los ejemplos concretos sí cargan. Guías de Apple leídas, con su contenido dinámico cargado. Ningún código externo copiado; principios y decisiones en la documentación de QA.

## Workspace documental (etapa 2)

**Entrega 2A:** original central con navegación por páginas, zoom relativo al ancho y panel opcional. Subida por arrastre/explorador con tamaño, validación y estados reales; al terminar continúa en el material. La misma composición acompaña la preparación de la adaptación. Resumen determinista del perfil y detalles progresivos, sin dimensiones nuevas. Los estados, acciones, bloqueos, rutas y redirección final siguen siendo los del producto. No se añade una máquina de estados paralela. [Alcance y límites](qa/adaptaula-2-etapa-2a/README.md).

**Pendiente para 2B:** comparación, navegación del documento generado y reorganización contextual de CLARO. El editor, recuperación y PDF existentes permanecen operativos. El original rasterizado conserva su proporción; no se fuerza A4 sobre un original horizontal ni se reconstruye a mano.

Dirección completa:

- Subida por arrastre/selección con nombre, peso y estados, reutilizando validación de bytes, límites y almacenamiento privado. Progreso solo si está medido; en caso contrario, pasos con estados reales y bloqueo explicado.
- Apoyos mediante perfiles funcionales reales; opciones avanzadas progresivas y sin identidad personal enviada a IA.
- Documento A4 central con controles compactos, encajar/ampliar y panel contextual opcional. En móvil, revisión/ajustes básicos con paneles desplegables. Original, propuesta generada y borrador identificados claramente.
- Actividades: solo editar lo que permite CLARO v1 (enunciado, presentación, espacio de respuesta). Mantener aviso/reconocimiento de contenido protegido; no declarar validación automática ni permitir cambios silenciosos de figuras, tablas, opciones o estructura.
- Comparación con el original real y la adaptación real; paralelo en escritorio, alternativa móvil. No inventar correspondencias ni resumen de cambios. Sin sincronizar páginas si la relación no está demostrada.
- Guardar, recuperar y exportar la revisión concreta; ningún PDF con cambios sin guardar, claves del docente o decoración de interfaz. No alterar el original, cuotas ni trazabilidad.

## Política comercial aprobada como objetivo provisional (etapa 4)

**No aplicada por esta entrega.** Los valores efectivos actuales continúan en la base de datos y la interfaz los lee. No anunciar estos nuevos números como activos hasta incluir la migración y sus pruebas en su entrega.

| | Free | Pro | Max |
| --- | --- | --- | --- |
| Precio mensual, IVA incluido | 0 € | 24,90 € | 49,90 € |
| Adaptaciones/mes | 1 | 15 | 30 |
| Análisis/mes, separados | 2 | 30 | 50 |
| Perfiles guardados | 2 | 30 | 100 |
| Páginas máximas/material | 5 | 15 | 25 |
| PDF | Incluido | Incluido | Incluido |
| Imágenes IA | Desactivadas | Desactivadas | Previsión futura hasta 5/mes, desactivadas |

Max se mostrará «En preparación», sin contratación. Sin nuevos precios anuales ni descuentos. Sin diferencias de calidad entre Free/Pro. Precios no validados económicamente. Ningún cobro ni Stripe real.

Los límites permanecen exclusivamente en BD: migración nueva y segura, no solo seed. Antes de aplicar cambios a un entorno, comprobar suscripciones activas y cómo conservar sus condiciones; no se conoce aquí si hay clientes de pago y no se ha consultado Supabase remoto. Probar bloqueo de segunda adaptación/tercer análisis Free, límites Pro/Max, reservas/devoluciones, separación de contadores y límites de perfiles/páginas. La cuenta mostrará plan, consumo, periodo y perfil real, edición básica disponible, cambio seguro de contraseña y salida; no inventar borrado/exportación.

## Condiciones para todas las entregas

Typecheck, lint, build, pruebas focalizadas, permisos/cuotas y E2E con capturas escritorio/móvil, teclado, desbordamientos y preferencias visuales. PDF determinista cuando no requiera modelos de pago. Ensayos sintéticos con proveedor simulado **no validan la calidad real de Hacer magia**.

No APIs de IA pagadas, Supabase remoto sin autorización, cobros/Stripe, entrenamiento/recopilación automática, cambios de prompts/modelos ni código ajeno sin licencia revisada. Conservar RLS, originales, recursos privados, borradores, estados/contratos pedagógicos y trazabilidad.
