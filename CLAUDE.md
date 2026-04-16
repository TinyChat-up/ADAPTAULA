@AGENTS.md

---

# AUDITORÍA TÉCNICA — AdaptAula
**Fecha**: 2026-04-16 | **Sprint**: C.2 completado | **Build**: ✅ limpio | **Fuente**: inspección directa del código

---

## 1. RESUMEN EJECUTIVO

AdaptAula es una SPA Next.js 16.2.1 con 5 pantallas en máquina de estados, motor de adaptación pedagógica con proveedor IA seleccionable (Gemini free / GPT-4.1 pro) con streaming SSE, integración ARASAAC para pictogramas, y auth/DB en Supabase. El flujo principal funciona de extremo a extremo.

**Estado tras Sprint A.1 + A.2 + B.1 + B.2 + C.1**:
- ✅ Middleware de rutas activo (`proxy.ts` es la convención correcta en Next.js 16.2.1)
- ✅ `/api/export/pdf` y `/api/export/docx` protegidos con auth + plan check
- ✅ `GEMINI_MODEL` centralizado en `lib/ai/model.ts`
- ✅ Código legacy eliminado (8 archivos + src/)
- ✅ Infraestructura Stripe real: tabla subscriptions, checkout, webhook, subscriptionService
- ✅ SubscriptionScreen conectado a Stripe Checkout (botón Pro funcional)
- ✅ Gating free trial (1 adaptación): 402 en adapt, 403 en export para free/anónimo
- ✅ Multi-provider IA: `lib/ai/provider.ts` + providers/gemini.ts + providers/openai.ts
- ✅ Generación premium diferenciada: PREMIUM_SYSTEM_SUFFIX + estilo docente inyectado en Pro

---

## 2. STACK REAL

| Capa | Tecnología | Notas |
|------|-----------|-------|
| Framework | Next.js 16.2.1 App Router | `proxy.ts` = middleware (convención 16.x) |
| UI | React 19 + TypeScript 5 strict | sin `any` innecesarios |
| Estilos | Tailwind CSS 4 + `@theme` | CSS variables `--aa-*` |
| Auth + DB | Supabase (SSR + browser client) | email/password, confirmación |
| IA | Gemini 2.5 Flash (free) / GPT-4.1 (pro) | `AIProvider` interface, factory `getAIProvider(plan)` |
| Pictogramas | ARASAAC API pública | batching 5 en 5, blacklist matemática |
| Export | docx (DOCX) + pdf-lib (PDF) | DOCX requiere auth, PDF requiere auth |
| Rate limit | In-memory Map (lib/rateLimit.ts) | 5 anon / 20 auth / 60s (se pierde en cold start) |

---

## 3. MAPA DE ARQUITECTURA REAL

```
app/
├── page.tsx                ← SPA principal (493 líneas, máquina de estados)
│   ├── UploadScreen        ← tab file/paste, drag-drop, /api/extract-text
│   ├── ConfigScreen        ← perfil NEE × asignatura × apoyo × intereses
│   ├── GeneratingScreen    ← SSE stream progress (0-100%)
│   ├── ResultScreen        ← HTML inyectado, PDF/DOCX export
│   └── SubscriptionScreen  ← MOCKUP UI, sin Stripe, sin backend
│
├── login/page.tsx          ← Supabase email/password, Suspense boundary
├── history/page.tsx        ← tabla adaptations, filtros perfil+fecha, modal iframe
├── history/error.tsx       ← error boundary específico
├── error.tsx               ← error boundary raíz
├── styles/page.tsx         ← IMPLEMENTADO (~600 líneas), stylesService CRUD completo
├── admin/feedback/page.tsx ← redirect a /internal/feedback
└── internal/feedback/page.tsx ← SSR, requiere INTERNAL_FEEDBACK_ALLOWED_EMAILS

api/
├── adapt/route.ts          ← MOTOR: SSE stream + fallback, rate limit, CSS server-side
├── extract-text/route.ts   ← PDF (unpdf) + DOCX (mammoth), sin auth, 10MB límite
├── style-analysis/route.ts ← Gemini T=0.2, requiere auth, timeout 45s
├── export/docx/route.ts    ← docx lib, pictogramas incrustados, requiere auth
├── export/pdf/route.ts     ← pdf-lib, paginación manual, requiere auth (Sprint A.1)
└── arasaac/search/route.ts ← proxy API pública, sin auth, sin cache persistente

components/
├── screens/                ← 5 pantallas SPA
│   ├── ConfigScreen.tsx    ← a11y completa (role=radiogroup, aria-checked)
│   ├── GeneratingScreen.tsx← progress prop controlado + animación CSS fallback
│   ├── ResultScreen.tsx
│   ├── SubscriptionScreen.tsx ← MOCKUP
│   └── UploadScreen.tsx
├── ui/Toast.tsx            ← Context + useReducer, 4 variantes, auto-dismiss 4s
├── ErrorBoundary.tsx       ← class component, onError prop para toast
├── AuthNavButton.tsx       ← detecta sesión, login/logout
└── BrandLogo.tsx

lib/
├── ai/
│   ├── model.ts            ← GEMINI_MODEL = env || "gemini-2.5-flash"
│   ├── provider.ts         ← AIProvider interface + getAIProvider(plan) factory
│   ├── systemPrompts.ts    ← 6 system prompts por perfil NEE
│   └── providers/
│       ├── gemini.ts       ← GeminiProvider (streaming SSE + fallback)
│       └── openai.ts       ← OpenAIProvider (GPT-4.1, json_object mode)
├── adaptationRules.ts      ← tipos + reglas pedagógicas (fuente de verdad)
├── adaptationsService.ts   ← CRUD tabla adaptations
├── arasaac.ts              ← utilidades ARASAAC avanzadas
├── authService.ts          ← wrapper Supabase Auth
├── buildDocumentCss.ts     ← CSS dinámico server-side (−550 tokens)
├── export/adaptationExport.ts ← parseo + serialización para export
├── extractDocumentText.ts  ← wrapper extract-text API
├── extractPdfText.ts       ← unpdf directo (usado en api/extract-text)
├── pictogramResolver.ts    ← ARASAAC batching, blacklist matemática
├── rateLimit.ts            ← Map in-memory, ventana 60s
├── stylesService.ts        ← CRUD tabla user_styles + análisis
├── supabaseClient.ts       ← createBrowserClient
│
│   ── Reservados (sin importadores activos, Sprint B/C) ──
├── adaptationFeedbackService.ts ← ratings tabla adaptation_feedback (Sprint B UI)
└── styleContextService.ts  ← resolveStyleContext (conectar a adapt route, Sprint B)

proxy.ts                    ← middleware activo en Next.js 16.2.1
                               (convención: named export `proxy`, NO default)
                               Protege: /, /workspace, /styles, /history, /internal, /admin
```

---

## 4. TABLA DE ESTADO REAL (post Sprint A.2)

| Feature | Estado | Notas |
|---------|--------|-------|
| SPA Upload→Config→Generate→Result | **✅ IMPLEMENTADO** | Flujo completo |
| Streaming SSE Gemini | **✅ IMPLEMENTADO** | `streamGenerateContent?alt=sse` + fallback |
| Progreso barra generación | **✅ IMPLEMENTADO** | 0-95% chars, 100% al finalizar |
| Rate limiting /api/adapt | **✅ IMPLEMENTADO** | 5 anon / 20 auth / 60s, in-memory |
| Metadata SEO | **✅ IMPLEMENTADO** | title, og, twitter, lang="es" |
| Error boundaries | **✅ IMPLEMENTADO** | raíz + /history + screens |
| Toast system | **✅ IMPLEMENTADO** | 4 variantes, Context, auto-dismiss |
| Accesibilidad ConfigScreen | **✅ IMPLEMENTADO** | role=radiogroup, aria-checked, labels |
| Export PDF | **✅ IMPLEMENTADO** | pdf-lib, requiere auth (Sprint A.1) |
| Export DOCX | **✅ IMPLEMENTADO** | docx lib, pictogramas, requiere auth |
| Auth email/password | **✅ IMPLEMENTADO** | Supabase, confirmation email |
| Historial /history | **✅ IMPLEMENTADO** | filtros, modal iframe, empty state SVG |
| Gestión estilos /styles | **✅ IMPLEMENTADO** | ~600 líneas, stylesService CRUD |
| Análisis estilo docente | **✅ IMPLEMENTADO** | Gemini T=0.2, guarda en style_analyses |
| Middleware protección rutas | **✅ ACTIVO** | proxy.ts es la convención correcta en Next.js 16.2.1 |
| GEMINI_MODEL centralizado | **✅ IMPLEMENTADO** | lib/ai/model.ts, sin duplicados en route.ts |
| Código legacy eliminado | **✅ LIMPIO** | 8 archivos + src/ eliminados en Sprint A.2 |
| **Infraestructura Stripe** | **✅ IMPLEMENTADO** | checkout + webhook + subscriptionService + tabla subscriptions |
| **SubscriptionScreen checkout** | **✅ CONECTADO** | Botón Pro → /api/checkout → Stripe Checkout |
| **Gating por plan** | **✅ IMPLEMENTADO** | adapt 402 si free≥1 (trial); docx/pdf 403 si free |
| **Multi-provider IA** | **✅ IMPLEMENTADO** | free=Gemini, pro=GPT-4.1 via AIProvider interface |
| Rate limit sin persistencia | **⚠️ PARCIAL** | Map en memoria, se pierde en cold start |
| Estilo en adapt route | **⚠️ NO CONECTADO** | styleContextService.ts existe pero adapt route no lo usa |
| Feedback de adaptaciones | **⚠️ RESERVADO** | adaptationFeedbackService.ts sin UI (Sprint B) |
| Pictogramas cache persistente | **❌ NO IMPLEMENTADO** | Cada request consulta ARASAAC |
| Tests (unit / e2e) | **❌ NO IMPLEMENTADO** | Cero cobertura |
| Stripe / pago real | **❌ NO IMPLEMENTADO** | Solo UI mockup |

---

## 5. RUTAS ACTIVAS (build post Sprint A.2)

```
○ /                    (SPA principal, máquina de estados)
○ /admin/feedback      (redirect a /internal/feedback)
ƒ /api/adapt           (streaming SSE, rate limit, CSS server-side)
ƒ /api/arasaac/search  (proxy público)
ƒ /api/export/docx     (requiere auth + plan)
ƒ /api/export/pdf      (requiere auth — añadido Sprint A.1)
ƒ /api/extract-text    (sin auth, 10MB)
ƒ /api/style-analysis  (requiere auth, Gemini T=0.2)
○ /history             (filtros, modal, empty state)
ƒ /internal/feedback   (INTERNAL_FEEDBACK_ALLOWED_EMAILS)
○ /login               (Supabase email/password)
○ /styles              (CRUD estilos docente)
ƒ Proxy (Middleware)   ← proxy.ts activo, protege rutas privadas
```

---

## 6. PROXY / MIDDLEWARE EN NEXT.JS 16.2.1

En esta versión de Next.js, la convención es `proxy.ts` con export nombrado (NO `middleware.ts`):

```typescript
// proxy.ts — convención Next.js 16.2.1
export async function proxy(request: NextRequest) { ... }
export const config = { matcher: [...] }
```

- `middleware.ts` es la convención DEPRECADA (Next.js ≤15)
- El build muestra `ƒ Proxy (Middleware)` cuando está activo
- Protege: `/`, `/workspace`, `/styles`, `/history`, `/internal`, `/admin`, `/login`
- Lógica: cookie-based Supabase SSR, redirect a `/login?next=...` si no hay sesión

---

## 7. STREAMING SSE (adapt/route.ts)

```
POST /api/adapt
  → checkRateLimit(ip, userId) — 401/429 antes del stream
  → getUserPlan(userId) — resuelve plan UNA vez (reusado para getAIProvider)
  → hasFreeTrialRemaining() / cookie check — 402 FREE_TRIAL_EXHAUSTED si agotado
  → getAIProvider(plan) — GeminiProvider (free) o OpenAIProvider (pro)
  → Promise.all([getUser, resolvePictograms])
  → aiProvider.stream() → ReadableStream text/event-stream
      data: {"type":"delta","progress":N}\n\n    ← 0-95%
      data: {"type":"done","result":{...}}\n\n    ← 100%
      data: {"type":"error","message":"..."}\n\n  ← error
  → injectCssIntoHtml() — CSS server-side (−550 tokens)
```

SSE events: `delta` (progreso), `done` (resultado completo), `error`

---

## 8. ESTADO DE EXPORT (post Sprint A.1)

| Endpoint | Auth | Plan check | Notas |
|----------|------|-----------|-------|
| `/api/export/pdf` | ✅ Bearer token | ❌ (Sprint B) | pdf-lib, paginación manual |
| `/api/export/docx` | ✅ Bearer token | ❌ (Sprint B) | docx lib, pictogramas incrustados |

Ambos usan `loadAdaptationForExport()` de `lib/export/adaptationExport.ts`.

---

## 9. RATE LIMITING

```typescript
// lib/rateLimit.ts
// Ventana deslizante 60s, Map in-memory
checkRateLimit(ip, userId?) → { allowed, limit, remaining, resetInSeconds }
// Límites: 5 req/min anon, 20 req/min auth
// ⚠️ Se resetea en cada cold start (Vercel serverless)
// Para producción real: migrar a Upstash Redis o tabla Supabase
```

Headers en respuestas: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`

---

## 10. ARQUITECTURA DE SUSCRIPCIONES (Sprint B.1)

### Flujo completo

```
Usuario pulsa "Suscribirse ahora"
  → SubscriptionScreen llama POST /api/checkout { plan: "pro" }
  → checkout/route.ts verifica auth (Bearer) + plan actual
  → Crea Stripe Checkout Session con metadata.userId
  → Devuelve { url } → window.location.href = url
  → Usuario completa pago en Stripe
  → Stripe llama POST /api/webhooks/stripe (signature verificada)
  → webhook upserta tabla `subscriptions` vía service-role
  → getUserPlan(userId) devuelve 'pro' desde ese momento
```

### Tabla subscriptions (Supabase)

```sql
-- Migración: supabase/migrations/20260416_subscriptions.sql
-- Aplicar en: Supabase Dashboard > SQL Editor
CREATE TABLE public.subscriptions (
  id                      uuid    PK DEFAULT gen_random_uuid(),
  user_id                 uuid    NOT NULL → auth.users,
  plan                    text    CHECK ('free'|'pro')  DEFAULT 'free',
  status                  text    CHECK ('active'|'canceled'|'past_due'|
                                         'incomplete'|'trialing'|'paused'),
  stripe_customer_id      text,
  stripe_subscription_id  text    UNIQUE,
  stripe_price_id         text,
  current_period_end      timestamptz,
  created_at / updated_at timestamptz
);
-- RLS: SELECT solo el propio usuario; INSERT/UPDATE/DELETE solo service-role
```

### lib/subscriptionService.ts

| Función | Descripción |
|---------|-------------|
| `getUserPlan(userId)` | Devuelve `'free'` \| `'pro'` (default free) |
| `getActiveSubscription(userId)` | Row completo o null si vencida/inactiva |
| `upsertSubscription(input)` | Escribe desde webhook (service-role) |
| `getUserIdByCustomer(customerId)` | Lookup fallback para eventos sin metadata |
| `createServiceClient()` | Cliente Supabase con `SUPABASE_SERVICE_ROLE_KEY` |

### app/api/checkout/route.ts

- `POST` requiere auth Bearer
- Verifica si el usuario ya tiene plan Pro (→ 409 si sí)
- Crea Stripe Checkout Session en modo `subscription`
- Devuelve `{ url: string }` → SubscriptionScreen redirige

### app/api/webhooks/stripe/route.ts

- Verifica firma con `STRIPE_WEBHOOK_SECRET` (raw body via `request.text()`)
- Eventos manejados: `checkout.session.completed`, `customer.subscription.{created,updated,deleted}`
- Resuelve `userId` desde `metadata.userId` o fallback por `stripe_customer_id`
- Upsert en `subscriptions` vía service-role (RLS bypass)

### Variables de entorno necesarias (Sprint B.1)

```env
STRIPE_SECRET_KEY=sk_live_...           # o sk_test_... en dev
STRIPE_WEBHOOK_SECRET=whsec_...         # de Stripe Dashboard > Webhooks
STRIPE_PRO_PRICE_ID=price_...           # ID del precio Pro en Stripe
SUPABASE_SERVICE_ROLE_KEY=eyJ...        # de Supabase > Settings > API
NEXT_PUBLIC_SITE_URL=https://adaptaula.com   # para success/cancel URLs
```

### SubscriptionScreen (estado post B.1)

- Botón "Suscribirse ahora" → llama `/api/checkout` → redirige a Stripe
- Estado de carga (`checkoutBusy`) y error (`checkoutError`) mínimos
- Sin rehacer el diseño visual
- Gating real (bloquear adapt/export según plan) → **Sprint B.2**

### Configurar webhook en desarrollo

```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe
# El CLI imprime el STRIPE_WEBHOOK_SECRET temporal para .env.local
```

### Reglas free vs pro (Sprint B.2)

| Regla | Anónimo | Free autenticado | Pro |
|-------|---------|-----------------|-----|
| Adaptaciones | 1 prueba (cookie) | 1 prueba (DB count) | Ilimitadas |
| Export PDF | ❌ 401 | ❌ 403 | ✅ |
| Export DOCX | ❌ 401 | ❌ 403 | ✅ |

**Límite de prueba gratuita:**
- Autenticado free: `getAdaptationUsage(userId)` total desde DB. Si ≥ 1 → 402.
- Anónimo: cookie `aa-trial=1` (set client-side tras `done` SSE). Si cookie presente → 402.
  - Limitación documentada: cookie borrable por el usuario (soft limit intencionado).

**Dónde se aplican:**

| Endpoint | Check | Respuesta |
|----------|-------|-----------|
| `POST /api/adapt` | `hasFreeTrialRemaining` / cookie | 402 `FREE_TRIAL_EXHAUSTED` |
| `POST /api/export/pdf` | `getUserPlan !== 'pro'` | 403 `SUBSCRIPTION_REQUIRED` |
| `POST /api/export/docx` | `getUserPlan !== 'pro'` | 403 `SUBSCRIPTION_REQUIRED` |

**UI:** 402 `FREE_TRIAL_EXHAUSTED` → toast warning + navega a SubscriptionScreen.

**Constantes en subscriptionService.ts:**
- `PLAN_LIMITS` — fuente de verdad de límites por plan
- `FREE_TRIAL_COOKIE = "aa-trial"` — nombre de cookie compartido entre server y client

### Qué falta todavía

1. Portal de facturación Stripe (ver facturas, cancelar)
2. Badge de plan actual en UI
3. Conectar `/history` a plan (solo pro puede ver historial)

---

## 11. KNIP (post Sprint A.2)

### Antes (Sprint A.2 inicio):
```
Unused files (9):
  components/workspace/DocumentCanvas.tsx
  components/workspace/GenerationCompanion.tsx
  lib/adaptationFeedbackService.ts
  lib/approvedExamplesService.ts
  lib/document-format.ts
  lib/document-structure.ts
  lib/documentTemplatesService.ts
  lib/mock-data.ts
  lib/styleContextService.ts

Unused exports (9):
  POPULAR_INTERESTS         lib/adaptationRules.ts
  createAdaptation          lib/adaptationsService.ts
  getAdaptationById         lib/adaptationsService.ts
  getNextVersionNumber      lib/adaptationsService.ts
  getAdaptationChain        lib/adaptationsService.ts
  markAdaptationAsFinal     lib/adaptationsService.ts
  mergePictogramConcepts    lib/arasaac.ts
  resolveArasaacPictograms  lib/arasaac.ts
  enrichDocumentWithArasaac lib/arasaac.ts
```

### Después (Sprint A.2 fin):
```
Unused files (2) — CONSERVADOS INTENCIONALMENTE:
  lib/adaptationFeedbackService.ts   ← Sprint B: UI feedback en ResultScreen
  lib/styleContextService.ts         ← Sprint B: conectar a adapt route

Unused exports (9) — EN ARCHIVOS ACTIVOS, aplazados:
  (mismos que antes — en adaptationRules, adaptationsService, arasaac)
  Riesgo: en archivos activos del flujo principal, no eliminar sin revisión
```

**Eliminados en Sprint A.2**: 7 archivos (`mock-data.ts`, `document-format.ts`, `document-structure.ts`, `approvedExamplesService.ts`, `documentTemplatesService.ts`, `DocumentCanvas.tsx`, `GenerationCompanion.tsx`) + directorio `src/`

---

## 12. TABLAS SUPABASE INFERIDAS DEL CÓDIGO

```
adaptations
  id, user_id, title, source_text, result_html, work_type, adaptation_type,
  student_profile, with_pictograms, visual_support_level, style_id, ai_notes,
  status, version_number, parent_adaptation_id, is_final, pictogram_concepts,
  pictogram_data, adapted_content, result_text, prompt_used, style_snapshot,
  created_at, updated_at

user_styles
  id, user_id, name/title, description, structure, ...campos estilo docente

style_analyses
  id, style_id, user_id, summary, usual_structure, instruction_style, tone,
  simplification_level, pictogram_usage_level, strengths, key_observations,
  analysis_json, source_excerpt, strengths[], improvement_points[],
  visual_metrics, show_improvements, created_at

adaptation_feedback                ← tabla lista, sin UI aún
  id, adaptation_id, user_id, rating (useful|partial|not_useful), comment, created_at

-- FALTA (Sprint B):
subscriptions
  id, user_id, plan (free|pro|teams), status (active|canceled|past_due),
  stripe_subscription_id, stripe_customer_id, current_period_end, created_at
```

---

## 13. BACKLOG SPRINTS B — SUSCRIPCIONES

### Sprint B.1 — COMPLETADO ✅

Infraestructura base: tabla `subscriptions`, `subscriptionService.ts`, `/api/checkout`, `/api/webhooks/stripe`, SubscriptionScreen conectado.

### Sprint B.2 — PENDIENTE

**Objetivo**: Aplicar gating real en endpoints. Free tier limitado, Pro ilimitado.

**Modelo mínimo viable**:

| Feature | Free | Pro (9,99€/mes) |
|---------|------|-----------------|
| Adaptaciones/mes | 3 | Ilimitadas |
| Export PDF | ✅ | ✅ |
| Export DOCX | ❌ | ✅ |
| Pictogramas ARASAAC | ❌ | ✅ |
| Historial | ❌ | ✅ |
| Análisis de estilo | ❌ | ✅ |

**Archivos a crear/tocar**:
```
lib/subscriptionService.ts          NUEVO — checkUserPlan(userId), getUserPlan()
app/api/webhooks/stripe/route.ts    NUEVO — webhook Stripe → update subscriptions
app/api/checkout/route.ts           NUEVO — crear Stripe Checkout Session
app/api/adapt/route.ts              añadir checkUserPlan() antes del stream
app/api/export/docx/route.ts        añadir checkUserPlan()
app/api/export/pdf/route.ts         añadir checkUserPlan() (free: PDF ok)
components/screens/SubscriptionScreen.tsx  conectar botón a /api/checkout
supabase/migrations/                tabla subscriptions
.env.local                          STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET,
                                    STRIPE_PRO_PRICE_ID, NEXT_PUBLIC_STRIPE_PK
package.json                        añadir stripe sdk
```

**Lógica de gating central**:
```typescript
// lib/subscriptionService.ts
async function getUserPlan(userId: string): Promise<'free' | 'pro'> {
  const { data } = await supabase
    .from('subscriptions')
    .select('plan, status, current_period_end')
    .eq('user_id', userId).eq('status', 'active').maybeSingle();
  if (!data || new Date(data.current_period_end) < new Date()) return 'free';
  return data.plan as 'free' | 'pro';
}
```

**KPIs de éxito Sprint B**:
- Botón "Suscribirse" abre Stripe Checkout
- Webhook actualiza tabla subscriptions
- /api/adapt devuelve 402 tras 3 adaptaciones/mes si plan=free
- DOCX export devuelve 403 si plan=free

---

## 14. SPRINT C.1 — PROVEEDOR IA PREMIUM ✅ COMPLETADO

**Objetivo**: free → Gemini 2.5 Flash; pro → GPT-4.1. Sin reescribir el flujo de route.ts.

**Archivos creados**:
```
lib/ai/provider.ts              AIProvider interface + getAIProvider(plan) factory
lib/ai/providers/gemini.ts      GeminiProvider (streaming SSE + fallback non-streaming)
lib/ai/providers/openai.ts      OpenAIProvider (GPT-4.1, json_object, streaming)
```

**Cambios en adapt/route.ts (v6)**:
- Eliminados `callGemini()` y `streamGemini()` (extraídos a providers/gemini.ts)
- `getUserPlan()` resuelve el plan una sola vez antes del stream
- `getAIProvider(userPlan)` selecciona proveedor en ese momento
- Dentro del stream: `aiProvider.stream(systemPrompt, userPrompt, onProgress)` → string → JSON.parse

**Interfaz**:
```typescript
export interface AIProvider {
  stream(systemPrompt: string, userPrompt: string, onProgress: (chars: number) => void): Promise<string>;
}
export function getAIProvider(plan: Plan): AIProvider
// free → GeminiProvider; pro + OPENAI_API_KEY → OpenAIProvider; pro sin key → Gemini fallback
```

**Variable de entorno nueva**: `OPENAI_API_KEY` (opcional; sin ella, pro también usa Gemini)

---

## 15. SPRINT C.2 — CALIDAD PREMIUM DIFERENCIADA ✅ COMPLETADO

### Diferencia real entre free y pro

| Aspecto | Free (standard) | Pro (premium) |
|---------|----------------|---------------|
| Modelo IA | Gemini 2.5 Flash | GPT-4.1 (si OPENAI_API_KEY) |
| System prompt | Perfil NEE base | Perfil NEE + PREMIUM_SYSTEM_SUFFIX |
| Estilo docente | No se usa | Inyectado en userPrompt si styleId existe |
| teacherNotes | Genéricas | Mínimo 3 observaciones específicas y accionables |
| Fidelidad al original | Estándar | Reforzada (no omitir secciones, conservar orden) |
| Calidad consignas | Estándar | Instrucciones autónomas, verbo concreto al inicio |

### Cómo funciona el tier premium

```
adapt/route.ts:
  generationTier = userPlan === "pro" ? "premium" : "standard"

  // System prompt:
  systemPrompt = baseSystemPrompt
  if (generationTier === "premium") systemPrompt += PREMIUM_SYSTEM_SUFFIX

  // User prompt (style context):
  if (generationTier === "premium" && styleId && style_analyses row exists):
    userPrompt = basePrompt + styleContextBlock
```

### PREMIUM_SYSTEM_SUFFIX (lib/ai/systemPrompts.ts)
Bloque adicional añadido al final del system prompt para pro. Instrucciones sobre:
- Fidelidad al original (no omitir, no reordenar)
- Jerarquía visual consistente
- Instrucciones de actividad autónomas
- Tono digno sin infantilizar
- Consistencia interna (vocabulario, formatos, pictogramas)
- teacherNotes de calidad (≥3 observaciones accionables)

### Estilo docente en Pro (style_analyses)
Si `styleId` viene en el request y el usuario es Pro:
1. Pre-fetch de `style_analyses` con anon client + Bearer token (respeta RLS)
2. Campos: `summary`, `usual_structure`, `instruction_style`, `tone`, `key_observations`
3. Se inyecta como bloque `ESTILO DOCENTE` al final del userPrompt
4. Si no hay análisis guardado: prompt normal sin bloque (silent fallback)

### Logging por request
```
[ADAPT] { plan, tier, provider, hasStyleContext, profile }
[ADAPT] JSON_PARSE_ERROR { provider, rawLength, parseErr }  // solo en error
```

### Robustez JSON (task 4)
JSON.parse envuelto en try/catch explícito. Si falla: error descriptivo al usuario en lugar de crash genérico. El regex `/\{[\s\S]*\}/` ya filtraba markdown; el catch añade mensaje claro.

---

## 15. VARIABLES DE ENTORNO

```env
# Requeridas hoy
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=         # ← NUEVO Sprint B.1 (webhook escribe subscriptions)
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash      # opcional, default en lib/ai/model.ts

# Sprint B.1 (suscripciones) — NUEVAS
STRIPE_SECRET_KEY=                 # sk_test_... o sk_live_...
STRIPE_WEBHOOK_SECRET=             # whsec_... de Stripe Dashboard o CLI
STRIPE_PRO_PRICE_ID=               # price_... del plan Pro en Stripe

# Sprint C.1 (multi-IA) — OPENAI_API_KEY activa GPT-4.1 para usuarios Pro
OPENAI_API_KEY=                    # opcional; sin ella, pro usa Gemini como fallback
OPENAI_MODEL=gpt-4.1              # opcional, default gpt-4.1

# Interno
NEXT_PUBLIC_SITE_URL=https://adaptaula.com
INTERNAL_FEEDBACK_ALLOWED_EMAILS=email1@,email2@
```

---

## 16. DEUDA TÉCNICA PENDIENTE

### 🟠 ALTA
1. **Rate limit sin persistencia** — Map in-memory se resetea en cold start. Para producción: Upstash Redis o tabla Supabase.
2. **styleContextService sin conectar** — `resolveStyleContext()` existe y está bien hecho, pero adapt route no lo llama. El estilo del docente no influye en la adaptación.
3. **Exports sin use en archivos activos** — 9 exports de adaptationsService/arasaac/adaptationRules marcados por knip. En archivos del flujo principal → no eliminar sin revisión.

### 🟡 MEDIA
4. **Progreso SSE estimado** — `ESTIMATED_CHARS=5000`. Si respuesta <2500 chars el progreso llega a ~50% y salta a 100%. Funcionar pero UX inconsistente.
5. **adaptationFeedbackService sin UI** — La lógica de feedback está completa (upsert rating + comment), falta el widget en ResultScreen.
6. **pdf-lib en package.json** — Instalado y usado en export/pdf (correcto). Verificar que tree-shaking funciona en bundle cliente.

### 🟢 BAJA
7. **Cache ARASAAC** — Cada request consulta la API pública desde cero.
8. **Tests** — Cero cobertura.

---

## 17. SPRINT QA — HARDENING MONETIZACIÓN ✅ COMPLETADO

### Bugs encontrados y corregidos

#### Bug 1 — CRÍTICO: subscriptionService usaba browser client para reads en servidor
**Archivo**: `lib/subscriptionService.ts`
**Problema**: `getActiveSubscription` y `getAdaptationUsage` usaban `supabase` (createBrowserClient)
importado de `supabaseClient.ts`. Desde un API route (server Node.js) no hay browser context,
`auth.uid()` es null. Si RLS requiere `auth.uid() = user_id`, los reads devuelven vacío:
- `getUserPlan` siempre retorna "free" → Pro usuarios usan Gemini en vez de GPT-4.1
- `getAdaptationUsage` retorna 0 → trial nunca agotado → adaptaciones ilimitadas gratis
- export DOCX/PDF: `getUserPlan` → "free" → 403 para todos, incluidos Pro
**Corrección**: Todas las funciones de lectura del servidor ahora usan `createServiceClient()`
(service role key, bypassa RLS correctamente desde server context).

#### Bug 2 — MEDIO: PDF exportable durante estado de carga del plan
**Archivo**: `app/page.tsx` — `handlePdf` y `handleDocx`
**Problema**: El gate era `if (userPlan === "free")`. Cuando `userPlan === null` (cargando),
la condición es false y PDF proceede. Como PDF es 100% client-side (iframe + browser print,
sin API enforcement), un usuario free podía imprimir la adaptación durante la ventana de
carga (~200ms post-resultado).
**Corrección**: Cambiado a `if (userPlan !== "pro")`. Null y "free" ambos muestran el modal.

### Riesgos residuales documentados (aceptados)

| Riesgo | Severidad | Motivo de no corregir |
|--------|-----------|----------------------|
| Anonymous trial bypass via cookie clear | Baja | Documentado, soft limit intencionado |
| `getAdaptationUsage` falla silenciosa (returns 0) | Baja | Fail-open para no bloquear por errores transitorios de DB |
| Rate limit in-memory se resetea en cold start | Media | Requiere Redis/Supabase, fuera del alcance del sprint |
| PDF export es client-side (no server enforcement) | Baja | Mitigado con el gate `!== "pro"` corregido |
| `hasFreeTrialRemaining` hace 2 llamadas a getUserPlan | Info | Redundancia menor, no bug funcional |

### Estado post-QA

| Layer | Estado |
|-------|--------|
| `/api/adapt` trial enforcement | ✅ Correcto (service client) |
| `/api/export/docx` plan check | ✅ Correcto (service client) |
| `/api/export/pdf` plan check | ✅ Correcto (service client) |
| `/api/checkout` duplicate guard | ✅ Correcto |
| `/api/webhooks/stripe` firma + upsert | ✅ Correcto |
| Client-side PDF gate | ✅ Corregido (`!== "pro"`) |
| Client-side DOCX gate | ✅ Corregido (`!== "pro"`) |
| Plan loading state UX | ✅ Modal bloqueante durante carga |

---

## OPTIMIZACIONES ACUMULADAS

- QA hardening: subscriptionService reads → service client; PDF/DOCX gates → `!== "pro"` (null-safe)
- `adapt/route.ts` v7: generationTier premium, PREMIUM_SYSTEM_SUFFIX, estilo docente en Pro, logging, JSON.parse try/catch
- `adapt/route.ts` v6: multi-provider IA (Gemini free / GPT-4.1 pro), plan resuelto una sola vez antes del stream, callGemini/streamGemini extraídos a providers/
- `adapt/route.ts` v5: CSS server-side (−550 tokens), Promise.all auth+pictogramas, system prompts por perfil NEE, streaming SSE, GEMINI_MODEL centralizado
- `style-analysis/route.ts`: responseMimeType json, temperature 0.2
- Rate limit: 5 anon / 20 auth / 60s
- Sprint A.2: 7 archivos legacy + src/ eliminados, build 14 rutas
