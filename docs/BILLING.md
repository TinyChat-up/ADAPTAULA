# Facturación, planes y cuotas

## Productos Stripe

| Producto | Precio | Intervalo |
|---|---|---|
| Adaptaula Pro | 9,99 € | mensual |
| Adaptaula Pro | 99 € | anual |
| Adaptaula Max | 17,99 € | mensual |
| Adaptaula Max | 179 € | anual |

Free no tiene suscripción en Stripe. Los IDs de precio se guardan en `plans.stripe_price_*_id` (por entorno, cargados con un script de setup), no en el código.

**IVA:** precios con IVA incluido para consumidores en España (`tax_behavior: inclusive`) y Stripe Tax para el cálculo y las facturas. Facturas con NIF opcional para docentes que lo pidan. *Pendiente de validación fiscal (OSS si hay clientes de otros países de la UE).*

## Flujos

**Checkout** — `POST /api/stripe/create-checkout` `{ plan: "pro"|"max", interval: "month"|"year" }`
1. `requireWorkspace({ roles: ["owner","admin"] })`.
2. Comprobar que el plan está activo (Max requiere `MAX_PLAN_ENABLED`).
3. Obtener o crear el `stripe_customer_id` (`billing_customers`), con `metadata.workspace_id`.
4. Crear la Checkout Session (`mode: subscription`, `client_reference_id = workspace_id`, `automatic_tax`, `allow_promotion_codes`).
5. Redirigir. La página de retorno **no** activa nada: muestra "Activando tu plan…" y hace polling de la suscripción en BD.

**Portal** — `POST /api/stripe/portal`: sesión del Customer Portal (cambio de plan, cancelación, método de pago, facturas).

**Webhook** — `POST /api/stripe/webhook` (runtime Node, cuerpo crudo):
1. Verificar la firma. Si no es válida → 400.
2. Idempotencia: `insert into stripe_events (stripe_event_id) … on conflict do nothing`; si ya existía → 200 sin hacer nada.
3. No confiar en el payload para el estado: **recuperar la suscripción desde la API de Stripe** y hacer un upsert de `subscriptions` (estado, precio → plan, periodo, `cancel_at_period_end`).
4. Eventos: `checkout.session.completed`, `customer.subscription.created|updated|deleted`, `invoice.paid`, `invoice.payment_failed`.
5. Registrar en `audit_logs` y `product_events` (`subscription_started`, `subscription_cancelled`).

Fuente de verdad: **Stripe + webhook**. El retorno del Checkout nunca es una confirmación.

## Resolución del plan efectivo

```
subscription en (active, trialing)              → plan de la suscripción
subscription en past_due                        → plan de la suscripción (gracia mientras Stripe reintenta el cobro)
subscription en (canceled, unpaid, incomplete_expired) o sin fila → free
```

**Bajada de plan con datos por encima del límite** (p. ej. 30 perfiles → Free con 2): nunca se borra nada. Los datos existentes siguen accesibles y editables; se bloquea crear nuevos por encima del límite y se muestra el motivo.

## Entitlements

`checkEntitlement(workspaceId, action)` (servidor) devuelve:

```ts
type EntitlementResult =
  | { allowed: true; remaining: number | null }
  | { allowed: false; reason: "quota_exhausted" | "plan_feature" | "limit_reached" | "role";
      limit: number; used: number; resetsAt: string | null; upgradeTo: "pro" | "max" | null }
```

| Acción | Comprobación |
|---|---|
| `adaptation.generate` | `monthly_adaptations` (unidades = número de perfiles) + `multi_profile` + `max_profiles_per_job` |
| `image.generate` | `monthly_images` + `image_generation` + flag `AI_IMAGES_ENABLED` |
| `analysis.start` | `monthly_analyses` (Free 10 · Pro 100 · Max 250) + *rate limit* + análisis simultáneos. Una reutilización de caché no consume |
| `block.revise` | `monthly_block_revisions` + rate limit |
| `profile.create` | `max_profiles` (perfiles no archivados) |
| `class.create` | `max_classes` |
| `material.upload` | `max_file_mb`, `max_pages_per_material` |

La UI usa el mismo resultado para mostrar el uso y los CTA, pero **el servidor siempre vuelve a comprobarlo** en la acción.

## Cuotas: libro de movimientos

> **Qué consume cuota.** Subir y analizar un material **no** descuenta adaptaciones (el análisis es infraestructura previa y se reutiliza para varios alumnos): tiene **su propia cuota, `monthly_analyses`** (Free 10 · Pro 100 · Max 250; viven en `plans.features` y se cambian sin desplegar). La cuota de adaptaciones se reserva al generar una adaptación (fase 4).
>
> - La unidad de análisis se reserva **al encolar** (atómico con la creación del job, `kind = 'analysis'`, clave `analysis:<job>`) y se **devuelve** si el job termina sin entregar análisis (error técnico, rechazo del proveedor o intentos agotados). Reutilizar un análisis idéntico (caché) no encola ni consume; «Volver a analizar» sí consume (ignora la caché a propósito).
> - Independiente de lo anterior, el análisis tiene *rate limit* y límite de análisis simultáneos (ver `docs/AI_PIPELINE.md`). Su coste real queda en `ai_runs`.
> - Un plan sin la clave `monthly_analyses` no permite analizar (falla cerrado, como `monthly_block_revisions`).

- Periodo: **Free = mes natural en Europe/Madrid** (se reinicia el día 1; fácil de explicar: "se renueva el 1 de cada mes"). **Pago = ciclo de facturación de Stripe** (`period_start`/`period_end`); el plan anual reinicia la cuota cada mes dentro del ciclo anual (de forma mensual, anclada al día de alta).
- Uso del periodo = `sum(units)` de `usage_events` por `kind` dentro del periodo.
- **Reserva al crear el job** (`consume_quota`, atómica con un lock por workspace) → si el job falla sin entregar → **devolución** (`refund_quota`, idempotente por clave).
- Fallo parcial con varios perfiles: solo se devuelven las unidades de los perfiles fallidos.
- Sin cobros extra automáticos en el MVP.

## Experiencia al llegar al límite

Nunca "Error 403 quota exceeded". Ejemplos de copy:

- Free: *"Has utilizado las 5 adaptaciones incluidas este mes."* → CTA **Ver Pro**. *"Se renuevan el 1 de noviembre."*
- Pro: *"Has utilizado las 75 adaptaciones de este periodo. Se renuevan el 14 de noviembre."* → CTA **Ver Max** (si está activo).
- Análisis (Free): *"Has utilizado los 10 análisis incluidos este mes. Se renuevan el 1 de noviembre."* + *"El material queda guardado: podrás analizarlo cuando se renueve tu límite."* → CTA **Ver Pro**. El archivo subido no se pierde: queda en «Subido» y se puede analizar cuando haya cupo.
- Perfiles: *"Tu plan incluye 2 perfiles guardados. Puedes archivar uno o pasar a Pro para guardar hasta 30."*
- Fallo de IA: *"No hemos podido terminar esta adaptación. No se ha descontado de tu límite."*

## `/app/uso`

Plan, adaptaciones `35 / 75`, imágenes `18 / 50` (solo Max) y fecha de reinicio. Sin tokens ni costes. CTA contextual "Mejorar plan".

## `/app/configuracion/facturacion`

Plan, precio, ciclo, próxima renovación o fecha de fin si se cancela, uso, y botones Cambiar plan / Gestionar pago / Cancelar (los tres abren el Customer Portal).

## Tests

- Unit: resolución del plan efectivo, cálculo del periodo (cambios de mes, zona horaria, años bisiestos), `checkEntitlement` por acción y plan.
- Integración: webhooks con eventos de prueba (firma válida/inválida, duplicados, orden invertido de eventos).
- E2E: precios → Checkout de test → webhook (Stripe CLI) → Pro desbloqueado.

## Adaptaciones: reservar, consumir, liberar (migración 014)

**Qué se reutiliza.** El libro `usage_events` (+1 / −1, clave idempotente única), `workspace_plan`, `current_period`, el mismo lock por workspace+tipo que `consume_quota` y `refund_quota`. La cuota de análisis (`consume_quota('analysis')`, `enqueue_analysis_job`, su devolución) no se toca ni cambia su semántica pública. Los límites siguen viviendo en `plans` (`monthly_adaptations`) y se cambian sin desplegar; no hay ningún número ni nombre de plan en el código de dominio (un test lo comprueba).

**Qué se añade (y por qué).** `adaptation_entitlements`: una fila por `adaptation_id` con el estado de su unidad (`reserved → consumed | released`), su clave de reserva, cómo estaba configurado el límite al reservar y las marcas de tiempo. El libro por sí solo no distingue «reservada» de «consumida» ni garantiza una unidad por adaptación. **Sin límite** se expresa con `features.unlimited_adaptations = true` (el entero de `plans` es obligatorio): nunca un número mágico. El límite se resuelve a `finite | unlimited | unavailable`; sin plan o con un valor mal configurado es `unavailable`: no hay saldo, no se reserva y no se devuelve ni cero ni infinito.

**Unidad.** La unidad es la `adaptation_id`: planificar, revisar, fallar, bloquearse, reabrirse, generar varias versiones o recibir ediciones docentes pertenece a una sola unidad. **Una adaptación consume como máximo una unidad**; una adaptación nueva es otra. El coste del proveedor y la cuota son cosas distintas: ni `ai_runs` ni un intento ambiguo influyen en el saldo.

**Reservar** (`reserve_adaptation_entitlement`): dentro de `create_adaptation(p_reserve => true)`, en la misma transacción que la fila: si no hay unidad (`entitlement_exhausted`) o no hay configuración (`entitlement_unavailable`) se revierte también la adaptación (no existen adaptaciones huérfanas) y no hay planner. Idempotente por adaptación y por `request_key`; atómica con lock por workspace; el saldo es el del workspace de la adaptación, nunca el de quien llama. Antes de cada etapa el orquestador comprueba que la adaptación mantiene su unidad (`entitlement_not_reserved`).

**Consumir** (`consume_adaptation_entitlement`): comprueba en la base de datos la entrega (`ready`, `current_version` apuntando a una versión persistida con revisión `approved`/`approved_with_warnings`, `delivered_at`). Se ejecuta **dentro de `finalize_adaptation(ready)`**: la entrega y el consumo ocurren juntos o ninguno (si hay reserva y no se puede consumir, se revierte la entrega): no existe «ready con la cuota sin consumir» ni «cuota consumida sin ready». Idempotente.

**Liberar** (`release_adaptation_entitlement`): solo una reserva nunca entregada de una adaptación cerrada (`cancelled`); se ejecuta **dentro de `transition_adaptation(cancelled)`**. Reutiliza `refund_quota` (devolución fechada en el periodo de la reserva). Idempotente; una unidad consumida nunca se devuelve automáticamente.

**Política por estado.** Mantienen la reserva: `queued`, `planning`, `awaiting_plan_review`, `generation_queued`, `generating`, `reviewing_*`, `blocked` (recuperable: reabrir → revisar → generar), `failed` (reintentable, a la espera de una persona o ambiguo). `ready` la consume una vez. `cancelled` la libera si no se entregó. No se libera por avisos o FAIL del revisor, revisión pendiente, errores transitorios ni `ambiguous_attempt`. **Reservas eternas:** no hay caducidad por antigüedad (no existe una en el producto y no se inventa una): una adaptación abandonada se cierra con una cancelación explícita, que libera la reserva.

**Observabilidad.** `adaptation_entitlement_usage(workspace)`: `availability`, `limit`, `reserved`, `consumed`, `available` (nulo si no es finito) y `ledger_used`, por periodo (una reserva cuenta en el periodo en que se hizo, también si se consume después). `get_adaptation_entitlement(adaptation)`: estado, claves de reserva y de devolución, marcas de tiempo. Solo repositorio/DTO, sin panel.

**Regla para los cambios de plan futuros.** Una reserva existente mantiene su identidad (clave, fila, `limit_at_reserve`) aunque el límite cambie; lo que cambia es lo disponible (`available` se acota a 0 si el nuevo límite es menor que lo ya reservado). Una mejora o bajada de plan nunca invalida ni reasigna unidades ya reservadas o consumidas.
