@AGENTS.md

---

# AUDITORÍA TÉCNICA — AdaptAula
**Fecha**: 2026-04-16 | **Sprint**: A.2 completado | **Build**: ✅ limpio | **Fuente**: inspección directa del código

---

## 1. RESUMEN EJECUTIVO

AdaptAula es una SPA Next.js 16.2.1 con 5 pantallas en máquina de estados, motor de adaptación pedagógica sobre Gemini 2.5 Flash con streaming SSE, integración ARASAAC para pictogramas, y auth/DB en Supabase. El flujo principal funciona de extremo a extremo.

**Estado tras Sprint A.1 + A.2**:
- ✅ Middleware de rutas activo (`proxy.ts` es la convención correcta en Next.js 16.2.1)
- ✅ `/api/export/pdf` protegido con auth (Bearer token)
- ✅ `GEMINI_MODEL` centralizado en `lib/ai/model.ts`
- ✅ Código legacy eliminado (8 archivos + src/)
- 🔴 Paywall sigue siendo 100% UI mockup sin backend (Sprint B pendiente)

---

## 2. STACK REAL

| Capa | Tecnología | Notas |
|------|-----------|-------|
| Framework | Next.js 16.2.1 App Router | `proxy.ts` = middleware (convención 16.x) |
| UI | React 19 + TypeScript 5 strict | sin `any` innecesarios |
| Estilos | Tailwind CSS 4 + `@theme` | CSS variables `--aa-*` |
| Auth + DB | Supabase (SSR + browser client) | email/password, confirmación |
| IA | Google Gemini 2.5 Flash | streaming SSE + fallback generateContent |
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
│   └── systemPrompts.ts    ← 6 system prompts por perfil NEE
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
| **Paywall / Suscripciones** | **🔴 MOCKUP** | SubscriptionScreen UI sin Stripe ni backend |
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
  → Promise.all([getUser, resolvePictograms])
  → streamGemini() → ReadableStream text/event-stream
      data: {"type":"delta","progress":N}\n\n    ← 0-95%
      data: {"type":"done","result":{...}}\n\n    ← 100%
      data: {"type":"error","message":"..."}\n\n  ← error
  → fallback a callGemini() si stream falla
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

## 10. SUBSCRIPTIONSCREEN (estado actual)

`components/screens/SubscriptionScreen.tsx` es **100% UI mockup**:
- Muestra planes Free / Pro / Teams con features
- Botón "Suscribirse" NO conecta a Stripe
- NO hay verificación de plan en ningún API route
- NO existe tabla `subscriptions` en Supabase (o si existe, no se consulta)
- El gating actual es solo "tiene sesión = puede exportar"

**No tocar hasta Sprint B.**

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

## 13. BACKLOG SPRINT B — SUSCRIPCIONES

**Objetivo**: Paywall real con Stripe. Free tier limitado, Pro ilimitado.

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

## 14. BACKLOG SPRINT C — PROVEEDOR IA PREMIUM

**Objetivo**: Soportar modelos premium (GPT-4o, Claude Sonnet) sin reescribir route.ts.

**Archivos a crear/tocar**:
```
lib/ai/provider.ts              NUEVO — interfaz AIProvider + factory getAIProvider()
lib/ai/providers/gemini.ts      NUEVO — extraer streamGemini + callGemini de route.ts
lib/ai/providers/openai.ts      NUEVO — OpenAI chat completions streaming
lib/ai/providers/anthropic.ts   NUEVO — Claude messages streaming
app/api/adapt/route.ts          reemplazar callGemini/streamGemini por getAIProvider()
```

**Interfaz mínima**:
```typescript
export interface AIProvider {
  stream(system: string, user: string, onProgress: (chars: number) => void): Promise<Record<string, unknown>>;
  generate(system: string, user: string): Promise<Record<string, unknown>>;
}
export function getAIProvider(model?: string): AIProvider { ... }
```

**Output esperado**: cambiar a GPT-4o solo requiere `AI_MODEL=gpt-4o` en env.

---

## 15. VARIABLES DE ENTORNO

```env
# Requeridas hoy
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash    # opcional, default en lib/ai/model.ts

# Sprint B (suscripciones)
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRO_PRICE_ID=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=

# Sprint C (multi-IA)
AI_MODEL=gemini-2.5-flash        # o gpt-4o, claude-sonnet-4-6
OPENAI_API_KEY=
ANTHROPIC_API_KEY=

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

## OPTIMIZACIONES ACUMULADAS

- `adapt/route.ts` v5: CSS server-side (−550 tokens), Promise.all auth+pictogramas, system prompts por perfil NEE, streaming SSE, GEMINI_MODEL centralizado
- `style-analysis/route.ts`: responseMimeType json, temperature 0.2
- Rate limit: 5 anon / 20 auth / 60s
- Sprint A.2: 7 archivos legacy + src/ eliminados, build 14 rutas
