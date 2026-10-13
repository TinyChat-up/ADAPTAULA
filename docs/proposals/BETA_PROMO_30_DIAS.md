# Propuesta: beta privada con 30 días de acceso promocional

**Estado:** propuesta. **No** está implementada en la PR #25 y no se ha creado ninguna migración. Necesita una migración nueva (025) y
cambios en `workspace_plan` y `current_period`, así que va en su propia PR, sin Stripe y sin tocar suscripciones de producción.

## Objetivo

Regalar a docentes concretos 30 días de acceso a funciones de pago para que prueben Adaptaula, con estas condiciones:
- no se pide tarjeta;
- no se cobra nada y no hay renovación automática;
- los límites son claros: adaptaciones, imágenes y un presupuesto máximo en USD por cuenta;
- el coste se sigue en `ai_runs`;
- al terminar, la cuenta vuelve a Free **sin perder nada**.

## Lo que ya existe y se reutiliza (auditoría)

| Pieza | Hoy | Uso en la beta |
| --- | --- | --- |
| `plans` | Free, Pro y Max con `monthly_*` y `features` en JSONB; `active`; precios y `stripe_price_*` opcionales | Un plan nuevo `beta`: no público (`active = false` en el catálogo de `/precios`), precio 0, sin precio de Stripe y con sus cupos |
| `subscriptions` | Una fila por workspace, ligada a Stripe (`stripe_subscription_id not null`) | **No se usa.** Una promo no es una suscripción: así no hay cobros ni renovaciones por construcción |
| `workspace_plan(ws)` | Suscripción vigente, o Free | Orden nuevo: suscripción vigente → **promo vigente** → Free |
| `current_period(ws)` | Ciclo de Stripe, o mes natural (Free) | Con una promo vigente, el periodo es **la ventana de la promo** (inicio → fin): los cupos son para los 30 días enteros |
| `consume_quota` / `refund_quota` / `usage_events` | Cuota atómica e idempotente por tipo y periodo | Sin cambios: leen `workspace_plan` y `current_period` |
| `ai_spend_summary(ws, from, to)` | Gasto real por workspace | Mide el gasto de la promo dentro de su ventana |
| Bajada de plan | «Nunca se borra nada» (`docs/BILLING.md`) | Al expirar, se vuelve a Free con todo el contenido: se bloquea crear por encima del límite, no se borra |
| Ilustraciones | `image_generation`, `monthly_images`, `illustrations_per_adaptation`, `illustration_budget_usd` | El plan `beta` los fija; el techo por adaptación se aplica igual |

## Diseño

### Migración 025 (esbozo)

```sql
-- Plan de beta: no se vende ni se muestra en /precios.
insert into public.plans (slug, name, monthly_price_cents, annual_price_cents, monthly_adaptations, monthly_images, max_profiles, max_classes, features, sort_order, active)
values ('beta', 'Beta', 0, 0, 40, 10, 30, 10, '{ ... como Pro ..., "image_generation": true, "illustrations_per_adaptation": 2,
        "illustration_budget_usd": 0.35, "monthly_analyses": 60, "promo_budget_usd": 8 }', 15, false);

create table public.promo_grants (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  plan_id uuid not null references public.plans (id),
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,                      -- starts_at + 30 días
  budget_usd numeric(8,2) not null check (budget_usd > 0),
  granted_by uuid references auth.users (id),        -- quién la concedió (admin)
  invite_id uuid,                                    -- de qué invitación sale
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at and ends_at <= starts_at + interval '31 days')
);
-- Una promo vigente como mucho por workspace.
create unique index promo_grants_one_active on public.promo_grants (workspace_id) where revoked_at is null;

create table public.promo_invites (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique,                    -- sha-256 del código; el código no se guarda
  email text,                                        -- opcional: la invitación solo vale para ese correo
  days int not null default 30 check (days between 1 and 31),
  budget_usd numeric(8,2) not null default 8,
  expires_at timestamptz not null,                   -- hasta cuándo se puede canjear
  redeemed_by_workspace uuid references public.workspaces (id),
  redeemed_at timestamptz,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);
```

- **RLS:**
  - `promo_grants`: lectura para los miembros de su workspace (para mostrar «tu acceso de prueba acaba el…»), escritura solo con
    `service_role`;
  - `promo_invites`: solo `service_role`;
  - tests de aislamiento entre workspaces, como el resto de tablas.
- **`redeem_promo(code, workspace, user)`** (solo `service_role`, atómica e idempotente):
  - valida el hash, la caducidad, el correo y que la invitación no esté usada;
  - comprueba que el workspace **no tiene suscripción de pago ni otra promo previa**: una promo por workspace y por persona;
  - crea el `promo_grant`.
- **`workspace_plan(ws)`:** `subscription vigente` → `promo_grant` con `revoked_at is null and now() between starts_at and
  ends_at` **y gasto dentro del presupuesto** → Free.
- **`current_period(ws)`:** con una promo vigente devuelve `(starts_at, ends_at)`. El uso de Free de ese mes y el de la promo no
  se mezclan, porque las ventanas son distintas.

### Presupuesto máximo por cuenta

`promo_budget_usd` (o `promo_grants.budget_usd`) se compara con `ai_spend_summary(ws, starts_at, now())`:
- se comprueba en el servidor al admitir una acción con coste, en `checkEntitlement` y en `consume_quota` para `adaptation` e
  `image`;
- al alcanzarlo, la promo deja de dar acceso (`workspace_plan` vuelve a Free) y se muestra un mensaje claro;
- los trabajos ya en curso terminan: el techo por adaptación de las ilustraciones sigue vigente.

**Cifras propuestas** (ver `docs/COSTS.md`; sin decidir):

| Concepto | Valor |
| --- | --- |
| Adaptaciones | 40 |
| Análisis | 60 |
| Ilustraciones en total | 10 |
| Ilustraciones por adaptación | 2 |
| Techo de ilustraciones por adaptación | 0,35 USD |
| Presupuesto de la cuenta | 8 USD |

**Peor caso por invitado:** 8 USD (el presupuesto manda). Lo esperable es mucho menos: unas 15 adaptaciones con 3 ilustraciones
cuestan ≈ 2 USD.

### Experiencia del docente

- Se canjea en `/app/beta?codigo=…` o al registrarse con el enlace de invitación. No se pide tarjeta ni ningún dato de pago.
- Un aviso permanente y discreto dice «Acceso de prueba hasta el 12 de noviembre · te quedan N adaptaciones e ilustraciones». A
  los 25 días se avisa por email de que termina, sin ofrecer renovación automática.
- **Al expirar:**
  - el plan efectivo es Free;
  - todo se conserva: adaptaciones, PDFs, perfiles, materiales e ilustraciones ya generadas;
  - las ilustraciones ya aprobadas se siguen viendo e imprimiendo en sus fichas, porque son de esa adaptación;
  - lo que supere los límites de Free se bloquea para crear, nunca se borra.
- «Hacer magia» con plan Free después de la beta: si una ficha necesita una ilustración nueva, se detiene con el mensaje de esta PR
  («tu plan no incluye ilustraciones»).

### Administración y seguimiento

- **Crear invitaciones:** con un script o una función de admin. Se genera un código aleatorio, se guarda solo su hash y se envía
  por email.
- **Panel interno:** promos activas, días restantes, uso de cupos y gasto real (`ai_spend_summary` y consulta 6 de
  `docs/qa/costes/coste-por-adaptacion.sql`).
- **Revocar:** `revoked_at = now()`, con efecto inmediato y sin borrar nada.

### Riesgos y mitigación

- **Multicuenta:** la invitación queda ligada a un correo, cada workspace tiene una sola promo, y el canje tiene *rate limit*.
- **Coste:** hay presupuesto por cuenta, techo por adaptación, cuota `image` y el `FLAG_AI_IMAGES_ENABLED` global como
  interruptor.
- **Privacidad:** la promo no guarda datos del alumnado. El email de la invitación es del docente: se rige por `docs/PRIVACY.md`
  y se puede borrar al canjear.

## Tests necesarios (en la PR de la beta)

- **Base de datos:**
  - prioridad de plan: suscripción > promo > Free;
  - ventana de la promo y vuelta a Free al expirar o al revocar;
  - cupos dentro de la ventana;
  - presupuesto alcanzado → Free;
  - una promo por workspace;
  - canje idempotente e invitación caducada;
  - RLS y aislamiento.
- **Unidad:** mensajes y fechas en España (Europe/Madrid).
- **E2E:** canjear sin tarjeta → hacer magia con ilustración → expirar → los documentos siguen ahí y Free bloquea crear más.
