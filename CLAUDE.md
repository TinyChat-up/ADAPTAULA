@AGENTS.md

---

# AdaptAula — Fuente de verdad técnica
**Actualizado**: 2026-04-16 | **Sprint**: QA Hardening completado | **Build**: ✅ limpio

Todo el contenido de este documento está verificado directamente en el código del repositorio.
Ninguna afirmación está basada en documentación anterior sin confirmar en código real.

---

## 1. Resumen ejecutivo

AdaptAula es una SPA Next.js 16.2.1 que adapta materiales educativos para alumnos con NEE (TEA, TEL, Dislexia, DI, TDAH, Retraso) usando IA. El flujo principal funciona de extremo a extremo con monetización real: Stripe checkout + webhook + Supabase, proveedor IA diferenciado (Gemini free / GPT-4.1 pro), exportaciones PDF y DOCX, y modales de conversión Pro.

**Estado general**: Producto funcional con monetización activa. No hay funcionalidades críticas rotas.

---

## 2. Stack técnico real

| Capa | Tecnología | Versión |
|------|-----------|---------|
| Framework | Next.js App Router | 16.2.1 |
| UI | React | 19.2.4 |
| Tipos | TypeScript | ^5 |
| Estilos | Tailwind CSS + `@theme` | ^4 |
| Auth + DB | Supabase (`@supabase/ssr` + `supabase-js`) | ssr ^0.6.1, js ^2.100.0 |
| IA free | Google Gemini 2.5 Flash | vía REST API |
| IA pro | OpenAI GPT-4.1 | openai ^6.34.0 |
| Pagos | Stripe | ^22.0.1 |
| Export DOCX | docx | ^9.6.1 |
| Export PDF | pdf-lib | ^1.17.1 |
| PDF parse | unpdf | ^1.4.0 |
| DOCX parse | mammoth | ^1.12.0 |
| Linting | eslint + eslint-config-next | ^9 |
| Dead code | knip | ^6.4.1 |

**Middleware**: `proxy.ts` con export nombrado `proxy` — convención Next.js 16.x.
(`middleware.ts` es la convención deprecada de Next.js ≤15.)

---

## 3. Flujo principal real (SPA máquina de estados)

```
screen: "upload"
  → usuario pega texto o sube PDF/DOCX → /api/extract-text
  → canContinue = true → handleContinue()
    → detectsSecondaryLevel(content) → showSecondaryWarning (opcional)
    → setScreen("configure")

screen: "configure"
  → selecciona perfil NEE, asignatura, apoyo, intereses, nivel educativo
  → handleGenerate() → POST /api/adapt (SSE stream)
    → [402 FREE_TRIAL_EXHAUSTED] → ProGateModal variant="trial-exhausted"
    → [429 RATE_LIMIT]           → toast warning, vuelve a configure
    → [otro error]               → configError, vuelve a configure
    → stream SSE: delta (progress 0-95%), done (result), error
    → setScreen("generating") durante el stream

screen: "generating"
  → GeneratingScreen con barra de progreso real (0-100)
  → al recibir event "done" → setAdaptResult, setScreen("result")

screen: "result"
  → ResultScreen: HTML inyectado, sticky header, banner Pro, notas docente
  → handlePdf():  if (userPlan !== "pro") → ProGateModal "export-locked"
  → handleDocx(): if (userPlan !== "pro") → ProGateModal "export-locked"
                  si pro → POST /api/export/docx
  → onUpgrade → setScreen("subscription")
  → onReset → handleReset() → setScreen("upload")

screen: "subscription"
  → SubscriptionScreen → POST /api/checkout → Stripe Checkout
  → success → /?checkout=success (full page redirect, plan recarga en mount)
  → canceled → /?checkout=canceled

Modales superpuestos (fixed z-[200]):
  ProGateModal variant="trial-exhausted" — encima de ConfigScreen
  ProGateModal variant="export-locked"   — encima de ResultScreen
```

---

## 4. Rutas activas (build output verificado)

```
○ /                    — SPA principal (page.tsx)
○ /admin/feedback      — redirect a /internal/feedback
○ /history             — historial de adaptaciones (filtros, modal iframe)
○ /login               — Supabase email/password
○ /styles              — gestión de estilos docente (CRUD)
○ /_not-found

ƒ /api/adapt           — motor de adaptación (SSE stream)
ƒ /api/arasaac/search  — proxy ARASAAC
ƒ /api/checkout        — crea Stripe Checkout Session
ƒ /api/export/docx     — genera y descarga DOCX
ƒ /api/export/pdf      — genera y descarga PDF (pdf-lib)
ƒ /api/extract-text    — extrae texto de PDF/DOCX subido
ƒ /api/style-analysis  — analiza estilo docente con Gemini
ƒ /api/webhooks/stripe — procesa eventos Stripe

ƒ Proxy (Middleware)   — proxy.ts protege rutas privadas
```

---

## 5. API routes — descripción exacta

### `POST /api/adapt`
- Rate limit antes del stream: 5 req/min anon, 20 req/min auth (in-memory Map)
- Autenticación: Bearer token opcional; sin token = usuario anónimo
- Gating trial:
  - Autenticado: `getUserPlan` + `hasFreeTrialRemaining` (service client, bypassa RLS)
  - Anónimo: cookie `aa-trial` (soft limit, borrable)
- Si trial agotado: 402 `FREE_TRIAL_EXHAUSTED`
- Selecciona `aiProvider = getAIProvider(userPlan)` (Gemini o GPT-4.1)
- `generationTier`: "premium" si pro, "standard" si free
- Pro + styleId: pre-fetch `style_analyses` + inyecta en userPrompt
- Pro: system prompt += `PREMIUM_SYSTEM_SUFFIX`
- Stream SSE: `delta` (progreso), `done` (resultado), `error`
- Guarda en tabla `adaptations` si hay userId
- Headers: `X-RateLimit-Limit/Remaining/Reset`

### `POST /api/checkout`
- Requiere Bearer token válido (401 sin él)
- Guard: si ya es Pro → 409
- Crea Stripe Checkout Session mode=subscription
- metadata.userId para que webhook lo identifique
- Devuelve `{ url }` para redirección

### `POST /api/webhooks/stripe`
- Verifica firma con `STRIPE_WEBHOOK_SECRET` (raw body via `.text()`)
- Eventos manejados: `checkout.session.completed`, `customer.subscription.{created,updated,deleted}`
- Resuelve userId: metadata.userId → fallback por stripe_customer_id en DB
- Upserta tabla `subscriptions` via service-role
- Devuelve 200 siempre (Stripe retryable errors)

### `POST /api/export/docx`
- Requiere Bearer token + plan Pro (403 si free)
- Carga adaptación de DB, parsea HTML a bloques
- Genera DOCX con docx lib, pictogramas embebidos (máx 2/bloque)
- Devuelve `application/vnd.openxmlformats-officedocument.wordprocessingml.document`

### `POST /api/export/pdf`
- Requiere Bearer token + plan Pro (403 si free)
- pdf-lib con fuentes estándar, paginación manual, pictogramas
- Devuelve `application/pdf`

### `POST /api/extract-text`
- Sin auth, límite 10MB
- PDF: unpdf. DOCX: mammoth. Devuelve `{ text }`

### `POST /api/style-analysis`
- Requiere auth
- Gemini T=0.2, `responseMimeType: "application/json"`
- Guarda en tabla `style_analyses`

### `GET /api/arasaac/search`
- Proxy público a ARASAAC, sin auth, sin cache persistente

---

## 6. Modelo de suscripciones

### Tabla `subscriptions` (migración: `supabase/migrations/20260416_subscriptions.sql`)

```sql
CREATE TABLE public.subscriptions (
  id                      uuid        PK DEFAULT gen_random_uuid(),
  user_id                 uuid        NOT NULL → auth.users (CASCADE DELETE),
  plan                    text        CHECK ('free'|'pro') DEFAULT 'free',
  status                  text        CHECK ('active'|'canceled'|'past_due'|
                                            'incomplete'|'trialing'|'paused'),
  stripe_customer_id      text,
  stripe_subscription_id  text        UNIQUE,
  stripe_price_id         text,
  current_period_end      timestamptz,
  created_at / updated_at timestamptz
);
-- RLS: SELECT solo propia fila (auth.uid() = user_id)
-- INSERT/UPDATE/DELETE: exclusivo service-role (webhook)
```

**IMPORTANTE**: RLS en SELECT requiere `auth.uid() = user_id`. El browser client sin sesión en
un API route devolvería vacío. Las funciones de lectura de `subscriptionService.ts` usan
`createServiceClient()` (service role) para bypasear RLS correctamente desde el servidor.

### Flujo Stripe completo

```
Usuario → SubscriptionScreen → POST /api/checkout (Bearer)
  → stripe.checkout.sessions.create(mode: "subscription", metadata: { userId })
  → { url } → window.location.href = url → Stripe hosted checkout

Usuario completa pago → Stripe → POST /api/webhooks/stripe
  → checkout.session.completed → recupera subscription completa
  → upserta tabla subscriptions (plan: "pro", status: "active")
  → getUserPlan(userId) devuelve "pro" desde ese momento
```

---

## 7. Reglas de negocio por tipo de usuario

| Capacidad | Anónimo | Free auth | Pro |
|-----------|---------|-----------|-----|
| Adaptaciones | 1 (cookie) | 1 (DB count) | Ilimitadas |
| Proveedor IA | Gemini 2.5 Flash | Gemini 2.5 Flash | GPT-4.1 |
| Prompt premium | ❌ | ❌ | ✅ PREMIUM_SYSTEM_SUFFIX |
| Estilo docente | ❌ | ❌ | ✅ si styleId existe |
| Export PDF | ❌ modal | ❌ modal | ✅ /api/export/pdf |
| Export DOCX | ❌ modal | ❌ modal | ✅ /api/export/docx |
| Historial | ❌ redirect login | ✅ | ✅ |
| Análisis estilos | ❌ redirect login | ✅ | ✅ |

**Trial anónimo**: cookie `aa-trial=1` seteada client-side tras el SSE `done`. Soft limit
intencionado — borrable por el usuario. El servidor la lee del header `Cookie`.

**Trial autenticado**: count total de adaptations en DB para ese user_id. Si ≥ 1 → 402.
No hay límite mensual — es una sola adaptación de prueba para toda la vida de la cuenta.

**Gating client-side**: `handlePdf` y `handleDocx` en `page.tsx` hacen `if (userPlan !== "pro")`
— esto cubre también `null` (estado loading) para no perder la ventana de print.

---

## 8. Arquitectura IA

### Selección de proveedor

```typescript
// lib/ai/provider.ts
getAIProvider(plan: Plan): AIProvider
  plan === "pro" && OPENAI_API_KEY → OpenAIProvider (GPT-4.1)
  plan === "pro" && !OPENAI_API_KEY → GeminiProvider (fallback silencioso)
  plan === "free" → GeminiProvider
```

### GeminiProvider (`lib/ai/providers/gemini.ts`)
- Modelo: `GEMINI_MODEL` env var || "gemini-2.5-flash"
- `streamGemini()` primario (SSE `alt=sse`), `callGemini()` fallback
- `responseMimeType: "application/json"`, temperature 0.3, maxOutputTokens 16384
- Acumula stream, llama onProgress(chars), devuelve string completo

### OpenAIProvider (`lib/ai/providers/openai.ts`)
- Modelo: `OPENAI_MODEL` env var || "gpt-4.1"
- `response_format: { type: "json_object" }`, temperature 0.3, max_tokens 16384
- Streaming via SDK, acumula, devuelve string

### System prompts (`lib/ai/systemPrompts.ts`)
- 6 perfiles NEE con prompts específicos: TEA, TEL, Dislexia, DI, TDAH, Retraso
- `FALLBACK_SYSTEM_PROMPT` para perfiles desconocidos
- `PREMIUM_SYSTEM_SUFFIX`: bloque adicional para pro (fidelidad, jerarquía, tono, teacherNotes calidad)
- Sufijo de salida JSON (`OUTPUT_RULES`) compartido entre todos → maximiza caching Gemini

### Estilo docente en Pro
```
Si userPlan === "pro" && styleId existe en request:
  → query style_analyses con anon key + Bearer del usuario (respeta RLS)
  → buildStyleContextBlock(row) → bloque ESTILO DOCENTE al final del userPrompt
  → Si error de fetch: silent fallback (genera sin contexto de estilo)
```

### Logging por request
```
[ADAPT] { plan, tier, provider, hasStyleContext, profile }
[ADAPT] JSON_PARSE_ERROR { provider, rawLength, parseErr }  ← solo en error
```

### Robustez JSON
```typescript
const jsonMatch = rawText.match(/\{[\s\S]*\}/);
raw = JSON.parse(jsonMatch ? jsonMatch[0] : rawText);
// Si falla: error descriptivo al usuario, no crash genérico
```

---

## 9. Tablas Supabase (inferidas del código)

### `subscriptions` — CONFIRMADA (migración aplicada)
```
id, user_id, plan, status, stripe_customer_id, stripe_subscription_id,
stripe_price_id, current_period_end, created_at, updated_at
```
RLS: SELECT propio, INSERT/UPDATE/DELETE solo service-role.

### `adaptations` — CONFIRMADA (usada activamente)
```
id, user_id, source_text, result_html, work_type, adaptation_type,
student_profile, with_pictograms, style_id, ai_notes, created_at,
(+ campos legacy: title, version_number, pictogram_data, etc.)
```
Nota: `adapt/route.ts` hace un insert simplificado (8 campos). `adaptationsService.ts`
soporta un schema más rico usado por history y exports.

### `style_analyses` — CONFIRMADA (usada por /api/style-analysis y adapt route Pro)
```
id, style_id, user_id, summary, usual_structure, instruction_style,
tone, key_observations, (+ otros campos de análisis)
```

### `adaptation_feedback` — INFERIDA (dead: servicio existe, sin uso activo)
```
id, adaptation_id, user_id, rating, comment, created_at
```

### `user_styles` — INFERIDA (usada por /styles page via stylesService.ts)
```
id, user_id, name/title, description, ...campos estilo docente
```

---

## 10. Variables de entorno necesarias

```env
# Supabase (requeridas)
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=       # requerida para subscriptionService reads/writes

# IA (requeridas)
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash    # opcional, default en lib/ai/model.ts

# IA Pro (opcional — sin ella, Pro usa Gemini como fallback)
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4.1             # opcional, default gpt-4.1

# Stripe (requeridas para monetización)
STRIPE_SECRET_KEY=               # sk_test_... o sk_live_...
STRIPE_WEBHOOK_SECRET=           # whsec_... de Stripe Dashboard o CLI
STRIPE_PRO_PRICE_ID=             # price_... del plan Pro en Stripe

# App
NEXT_PUBLIC_SITE_URL=https://adaptaula.com   # para success/cancel URLs de Stripe

# Interno
INTERNAL_FEEDBACK_ALLOWED_EMAILS=email@,email2@
```

---

## 11. Componentes y servicios principales

### Screens (`components/screens/`)
| Componente | Estado | Descripción |
|-----------|--------|-------------|
| `UploadScreen.tsx` | ✅ activo | tabs file/paste, drag-drop, /api/extract-text |
| `ConfigScreen.tsx` | ✅ activo | perfil NEE × asignatura × apoyo × intereses × nivel |
| `GeneratingScreen.tsx` | ✅ activo | barra de progreso real (prop) + CSS fallback |
| `ResultScreen.tsx` | ✅ activo | HTML inyectado, sticky header, banner Pro, notas docente |
| `SubscriptionScreen.tsx` | ✅ activo | layout premium 2×2, checkout Stripe conectado |

### UI (`components/ui/`)
| Componente | Estado | Descripción |
|-----------|--------|-------------|
| `ProGateModal.tsx` | ✅ activo | 2 variantes: trial-exhausted, export-locked |
| `PlanBadge.tsx` | ✅ activo | free: pill crema + "Activar Pro →" / pro: pill verde |
| `Toast.tsx` | ✅ activo | Context + useReducer, 4 variantes, auto-dismiss 4s |

### Componentes raíz
| Componente | Estado |
|-----------|--------|
| `BrandLogo.tsx` | ✅ activo |
| `ErrorBoundary.tsx` | ✅ activo, class component con onError prop |
| `AuthNavButton.tsx` | ✅ activo, detecta sesión Supabase, login/logout |

### Servicios (`lib/`)
| Archivo | Estado | Usado por |
|---------|--------|-----------|
| `subscriptionService.ts` | ✅ activo | adapt, checkout, export routes |
| `adaptationRules.ts` | ✅ activo (fuente de verdad pedagógica) | adapt route |
| `pictogramResolver.ts` | ✅ activo | adapt route |
| `buildDocumentCss.ts` | ✅ activo | adapt route (CSS server-side) |
| `rateLimit.ts` | ✅ activo | adapt route |
| `supabaseClient.ts` | ✅ activo | client-side components |
| `stylesService.ts` | ✅ activo | /styles page |
| `adaptationsService.ts` | ⚠️ parcial | history page (getUserAdaptations); createAdaptation y otras 5 funciones sin uso (knip) |
| `arasaac.ts` | ⚠️ parcial | pictogramResolver; 3 funciones sin uso (knip) |
| `extractDocumentText.ts` | ⚠️ parcial | puede ser usado por UploadScreen — confirmar |
| `extractPdfText.ts` | ✅ activo | /api/extract-text |
| `export/adaptationExport.ts` | ✅ activo | export/docx y export/pdf |
| `authService.ts` | ❓ sin verificar uso | wraps Supabase Auth |
| `adaptationFeedbackService.ts` | ❌ dead | knip confirmed, 0 importadores |
| `styleContextService.ts` | ❌ dead | knip confirmed, 0 importadores (estilo inyectado inline en adapt route) |
| `document/` (directorio) | ❌ vacío | no contiene archivos activos |
| `ai/model.ts` | ✅ activo | GeminiProvider |
| `ai/provider.ts` | ✅ activo | adapt route |
| `ai/systemPrompts.ts` | ✅ activo | adapt route |
| `ai/providers/gemini.ts` | ✅ activo | provider factory |
| `ai/providers/openai.ts` | ✅ activo | provider factory |

---

## 12. UX/Conversión implementada

### SubscriptionScreen (`components/screens/SubscriptionScreen.tsx`)
- Badge "Plan Pro · 9,99 €/mes" (pill verde oscuro)
- Título: "Adaptaciones sin límites, calidad profesional"
- Grid 2×2: adaptaciones ilimitadas, PDF/DOCX, IA precisión, estilo docente
- Precio: "9,99 €/mes", "Cancela cuando quieras"
- CTA: "Activar AdaptAula Pro" → `startProCheckout()` → `/api/checkout` → Stripe
- Trust items: "✓ Pago seguro vía Stripe", "✓ Cancela cuando quieras", "✓ Factura disponible"
- Link: "¿Ya eres Pro? Accede a tu cuenta →"
- Error de checkout mostrado inline
- Botón "Volver" → prop `onBack`

### ProGateModal (`components/ui/ProGateModal.tsx`)
- z-[200], backdrop blur, click-outside cierra
- `variant="trial-exhausted"`: icono verde, "Ya has probado AdaptAula", features: ilimitadas/PDF+DOCX/GPT-4.1
- `variant="export-locked"`: icono naranja, badge "Función Pro", "La exportación es una función Pro"
- CTA: "Ver plan Pro · 9,99 €/mes" → onUpgrade
- Secundario: "Volver al inicio" / "Cerrar" → onClose

### ResultScreen banner Pro (`components/screens/ResultScreen.tsx`, líneas 141-177)
- Visible solo cuando `!isPro && onUpgrade`
- Badge naranja "Con Pro obtienes"
- Copy: "IA más precisa, PDF, DOCX y adaptaciones ilimitadas"
- Subtext: "Tu adaptación gratuita ya está lista. Activa Pro para continuar."
- CTA: "Ver plan Pro" + "9,99 €/mes · cancela cuando quieras"

### PlanBadge (`components/ui/PlanBadge.tsx`)
- Usado en sticky header de ResultScreen (hidden en mobile: `hidden sm:block`)
- Free: pill crema "Prueba gratuita" + link "Activar Pro →"
- Pro: pill verde oscuro ★ "Pro activo"
- `userPlan` cargado en mount desde tabla `subscriptions` (query client-side con anon key + RLS)

---

## 13. Seguridad y clients Supabase

### Regla crítica: browser client vs service client
| Contexto | Cliente correcto | Motivo |
|----------|-----------------|--------|
| Componentes React (client-side) | `supabase` de `supabaseClient.ts` (browser) | Lee sesión de cookies del browser |
| API Routes (Node.js server) — **lecturas** | `createServiceClient()` | Sin browser context; RLS de subscriptions requiere `auth.uid()`, que es null sin sesión |
| API Routes — **escrituras** | `createServiceClient()` | Webhook debe bypasear RLS |
| API Routes — **auth del usuario** | `createClient(url, anon_key).auth.getUser(token)` | Valida Bearer token |

**Este bug ya estaba presente y fue corregido en el sprint QA**: `getActiveSubscription` y
`getAdaptationUsage` en `subscriptionService.ts` ahora usan `createServiceClient()`.

### Endpoints sensibles
| Endpoint | Auth | Plan check |
|----------|------|-----------|
| `/api/adapt` | Opcional (anon ok) | Trial: 402 si agotado |
| `/api/checkout` | Bearer requerido | Duplicate guard: 409 si ya Pro |
| `/api/export/docx` | Bearer requerido | Plan Pro: 403 si free |
| `/api/export/pdf` | Bearer requerido | Plan Pro: 403 si free |
| `/api/webhooks/stripe` | Stripe signature | — |
| `/api/style-analysis` | Bearer requerido | — |
| `/api/extract-text` | Sin auth | — |
| `/api/arasaac/search` | Sin auth | — |

### PDF export — nota importante
PDF se genera client-side (iframe + browser print dialog). No hay endpoint de servidor para PDF
desde la UI principal. El gating client-side (`userPlan !== "pro"`) es la única protección.
`/api/export/pdf` existe y tiene gating pero **no es llamado por el flujo actual de la UI**.

---

## 14. Riesgos residuales aceptados

| Riesgo | Severidad | Estado |
|--------|-----------|--------|
| Trial anónimo bypasseable (borrar cookie) | Baja | Aceptado — soft limit intencionado |
| `getAdaptationUsage` falla silenciosa → retorna 0 | Baja | Aceptado — fail-open para errores transitorios |
| Rate limit in-memory se resetea en cold start | Media | Aceptado hasta Redis/Supabase |
| PDF client-side: gating solo en frontend | Baja | Mitigado con `!== "pro"` (cubre null) |
| `/api/export/pdf` existe pero no se llama desde UI | Info | Desconexión entre API y frontend |
| Progreso SSE estimado (`ESTIMATED_CHARS=5000`) | Info | Si respuesta corta: salta de ~50% a 100% |
| Doble `getUser` en adapt route (rate limit + stream) | Info | Redundante pero no bug funcional |

---

## 15. Deuda técnica pendiente

### 🔴 Alta
1. **`/api/export/pdf` no conectado al flujo UI** — existe con plan check pero `handlePdf` en page.tsx usa iframe local. PDF pro debería llamar al API para consistencia y enforcement real.
2. **`adaptationsService.ts` diverge del schema real** — adapt/route.ts inserta directamente con 8 campos simplificados. El servicio tiene schema rico no usado por el flujo principal. Riesgo de inconsistencia si se añade historial avanzado.

### 🟠 Media
3. **Rate limit sin persistencia** — Map in-memory se resetea en cold start. Para producción: Upstash Redis o tabla Supabase.
4. **`lib/adaptationFeedbackService.ts` dead** — knip confirmado. Eliminar cuando se decida definitivamente no implementar feedback.
5. **`lib/styleContextService.ts` dead** — knip confirmado. El estilo docente se resolvió inline en adapt route. Eliminar.
6. **Exports sin uso en `adaptationsService.ts`** — `createAdaptation`, `getAdaptationById`, `getNextVersionNumber`, `getAdaptationChain`, `markAdaptationAsFinal` sin importadores. Knip confirmado.
7. **Exports sin uso en `arasaac.ts`** — `mergePictogramConcepts`, `resolveArasaacPictograms`, `enrichDocumentWithArasaac`. Knip confirmado.

### 🟡 Baja
8. **`POPULAR_INTERESTS` en adaptationRules.ts** — export sin uso. Knip confirmado.
9. **`lib/document/` vacío** — directorio sin archivos. Puede eliminarse.
10. **`lib/authService.ts` no documentado** — wraps Supabase Auth. Confirmar si está en uso.
11. **Cache ARASAAC** — cada request consulta API pública sin cache persistente.
12. **Tests** — cero cobertura.

---

## 16. Próximos sprints recomendados

### Sprint D.1 — Conectar PDF al servidor (Alta prioridad)
Cambiar `handlePdf` en page.tsx para llamar `/api/export/pdf` en lugar del iframe local.
Beneficio: enforcement real server-side para Pro. El API ya existe y funciona.

### Sprint D.2 — Limpiar código muerto (Media prioridad)
```
Eliminar:  lib/adaptationFeedbackService.ts
           lib/styleContextService.ts
           lib/document/ (vacío)
Revisar:   lib/authService.ts (determinar si tiene uso)
Purgar:    exports sin uso en adaptationsService.ts, arasaac.ts, adaptationRules.ts
```
Beneficio: knip queda en 0 findings, reducción de superficie de mantenimiento.

### Sprint D.3 — Portal de facturación Stripe (Media prioridad)
Customer portal para que usuarios Pro puedan ver facturas, cancelar, cambiar método de pago.
Requiere: `/api/billing-portal` → `stripe.billingPortal.sessions.create`.

### Sprint D.4 — Rate limit persistente (Media prioridad)
Migrar `lib/rateLimit.ts` de Map in-memory a Upstash Redis (recomendado) o tabla Supabase.
Impacto: rate limit sobrevive cold starts en Vercel serverless.

### Sprint D.5 — Feedback de adaptaciones (Baja prioridad)
`adaptation_feedback` tabla existe. Añadir widget de rating (👍/👎) en ResultScreen.
`adaptationFeedbackService.ts` tiene la lógica lista — solo falta la UI.

---

## 17. Convenciones de código y notas operativas

### Middleware (Next.js 16.x)
```typescript
// proxy.ts — nombre y export correctos para Next.js 16.2.1
export async function proxy(request: NextRequest) { ... }
export const config = { matcher: [...] }
// ⚠️ NO usar middleware.ts ni default export — es la convención deprecada
```

### Supabase clients — regla de oro
```typescript
// Client-side (React components):
import { supabase } from "@/lib/supabaseClient"; // createBrowserClient

// Server-side reads con RLS:
const db = createServiceClient(); // bypassa RLS, usa SUPABASE_SERVICE_ROLE_KEY

// Server-side auth del usuario (validar token):
const client = createClient(url, anon_key);
const { data: { user } } = await client.auth.getUser(token);
```

### Tokens de color AdaptAula
```css
--aa-cream:      #FAF7F2
--aa-green:      #7BAF7F
--aa-green-dark: #4A7C59
--aa-orange:     #E8834A
--aa-text:       #2C3B2D
--aa-text-muted: #6B7A6C
```

### console.log en producción
`next.config.ts` elimina `console.log` en production, conserva `.error` y `.warn`.
Los `[ADAPT]` logs solo aparecen en desarrollo.

### Webhook Stripe en desarrollo
```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe
# El CLI imprime STRIPE_WEBHOOK_SECRET temporal para .env.local
```

### Knip
```bash
npm run knip
# Objetivo: 0 findings
# Estado actual: 2 unused files, 9 unused exports
```

### Build de referencia
```
✓ Compiled successfully
○ 6 static routes
ƒ 8 dynamic API routes
ƒ Proxy (Middleware) activo
```
