# Etapa 4A — política comercial y cuotas

PR de esta entrega: [#44](https://github.com/TinyChat-up/ADAPTAULA/pull/44), abierta y sin merge.

Base: `main` después de integrar #43 (`5867d30`). No incluye 4B.

## Alcance

Migración 026 y seed coherentes: Free 1 adaptación / 2 análisis / 2 perfiles / 5 páginas; Pro 15 / 30 / 30 / 15; Max 30 / 50 / 100 / 25. Precios mensuales con IVA: 0 / 24,90 / 49,90 €. Son provisionales, sin validación económica. Imágenes nuevas: cero y desactivadas.

Precios y cuenta leen `plans`/`workspace_usage`; `/precios` es dinámica para evitar una página comercial desactualizada tras una migración. Catálogo con tres planes, registro solo en Free; Pro sin contratación y Max «En preparación». No se presentan precios anuales ni checkout. Aviso de última adaptación y agotamiento en cuenta, con fecha real de renovación. Corrección de reflow a 200 % en precios y su cabecera pública.

## Aplicación futura de la migración (no ejecutada remotamente)

1. Revisar en un entorno autorizado las filas de `plans`, las referencias de `subscriptions`, sus estados, intervalos, precios y periodos. Este trabajo NO ha comprobado si existen clientes de pago en producción.
2. Hacer copia de seguridad y ensayar las migraciones pendientes en staging. Aplicar `20261001002600_commercial_policy.sql` con el procedimiento habitual de despliegue; no reemplazarlo por ejecutar seed.
3. La migración toma un bloqueo de escritura sobre catálogo/suscripciones. Programar una ventana corta sin modificaciones comerciales. El bloque DO es atómico e idempotente por `features.commercial_policy`.
4. Una fila anterior referenciada por **cualquier** suscripción, incluso cancelada, o que tenga precios Stripe configurados se conserva con su ID, precios, cuotas y features. Solo se renombra a `<slug>-legacy-<uuid>` y se retira del catálogo público (`active=false`). Se crea una fila canónica nueva, sin IDs de Stripe. `workspace_plan()` sigue resolviendo el plan histórico por ID para `active`, `trialing` y `past_due`; `canceled` vuelve a Free, como antes.
5. Las filas no contratadas se actualizan en su sitio. No se cambian suscripciones, clientes, periodos, reservas ni eventos. Si Free ya ha gastado más que su nuevo límite, se conserva el consumo y se bloquean nuevas solicitudes hasta renovación o liberación legítima de una reserva.
6. Comprobar catálogo, `workspace_usage` de cuentas autorizadas y resolución de planes históricos. No trasladar automáticamente suscripciones a las filas nuevas. Revisar las condiciones comerciales anteriores y acordar cualquier transición antes de configurar precios o webhooks.
7. No hay reversión comercial automática: conservar la copia y preparar un cambio compensatorio revisado si fuese necesario. No borrar filas históricas con referencias.

## Semántica conservada

Adaptaciones: reserva al crear, entrega consume, cancelación sin entrega libera; bloqueo, revisión o fallo reintentable mantienen la misma reserva. Análisis: reserva al encolar; entrega mantiene consumo; fallo definitivo devuelve una vez. Caché de análisis no consume. Reintentos idempotentes; cuotas independientes. Free renueva por mes natural en Europe/Madrid; suscripciones usan los periodos existentes y sus segmentos mensuales. No se modifica calidad, alias de modelos ni prompts.

## Stripe pendiente

Existen tablas de clientes/suscripciones, IDs de precios y variables opcionales de secretos; no hay checkout, portal ni webhook operativo en `src/`. En el futuro habrá que crear precios mensuales explícitos para Pro y, solo cuando proceda, Max; mapear los nuevos IDs sin reciclar los antiguos, verificar firma e idempotencia de webhooks, probar transiciones con Stripe de prueba y decidir condiciones de clientes históricos. No se crean productos ni enlaces ni se activa contratación en esta PR. La presencia del catálogo Max no habilita imágenes ni cambia flags.

## Verificación

- **134 pruebas focalizadas unitarias/PGlite superadas** en ocho archivos: `commercial-policy`, `free-plan-adaptations`, `schema`, `materials`, `adaptation-entitlements`, `materials-core`, `entitlements` y `pricing-truth`. Se ejecutaron por grupos; no se repitió la suite completa.
- **14 casos E2E distintos superados**, en escritorio y móvil: Free permite una adaptación/bloquea la segunda; precios/cuenta; regresión de perfiles/cuenta; PDF que excede Free y cuota de análisis con caché/reanálisis/agotamiento. En el primer pase falló reflow de precios al 200 %; se corrigió y el pase posterior de precios/materiales pasó 6/6.
- Cuotas Pro/Max y perfiles 30/100 comprobados en SQL; máximos 15/25 páginas comprobados desde features reales hacia `effectiveLimits`. El rechazo por bytes del PDF se ejercitó en navegador con Free; no se subieron PDFs largos de Pro/Max en E2E.
- Migración con contrato activo/anual y referencias trialing/past_due/canceled/paused, fila con precio Stripe pero sin suscripción, ID Free conservado, marcador de ilimitado retirado en catálogo nuevo, consumo histórico intacto y segunda ejecución sin cambios. No se altera consumo al superar el nuevo límite.
- Typecheck y build superados. Lint sin errores, con un aviso anterior en `analysis-run-auth.test.ts` (`_id` no usado). Escáner de secretos superado. `git diff --check` limpio.
- Axe sin infracciones WCAG 2 A/AA y 2.2 AA en precios/cuenta, foco de teclado, texto 200 % en 320 px, movimiento reducido y colores forzados. Esto no equivale a certificar toda la aplicación. Se mantienen las alternativas de transparencia del sistema visual existente.

Capturas de Chromium inspeccionadas visualmente, con datos ficticios:

| Pantalla | Escritorio | Móvil |
|---|---|---|
| Precios | [Captura](precios-desktop.png) | [Captura](precios-mobile.png) |
| Plan y cuenta | [Captura](cuenta-desktop.png) | [Captura](cuenta-mobile.png) |

En capturas de página completa, las barras fijas aparecen en el primer viewport. Todas las pruebas usan datos sintéticos y PGlite local; no acreditan calidad pedagógica de modelos reales ni equivalencia completa de PGlite con Supabase remoto. No se ejecutaron APIs de pago ni se cambió una base remota. Recomendación: integrar 4A tras revisión; aplicar la migración remota por separado, después de revisar condiciones anteriores. Después, 4B desde main actualizado.
