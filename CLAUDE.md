@AGENTS.md

---

# AdaptAula — Fuente de verdad técnica
**Fecha**: 2026-04-16 | **Build**: ✅ limpio | **Knip**: 0 archivos muertos, 9 exports pendientes

Todo el contenido está verificado directamente en el código del repositorio.

---

## 1. Resumen ejecutivo

AdaptAula adapta materiales educativos para alumnos con NEE (TEA, TEL, Dislexia, DI, TDAH, Retraso) usando IA generativa. El docente sube un PDF o pega texto, configura el perfil del alumno, y recibe una ficha adaptada en HTML lista para imprimir o exportar.

**Estado actual**: Beta funcional con monetización real activa. Stripe checkout + webhook operativos, proveedor IA diferenciado por plan, exportaciones Pro con enforcement en servidor.

---

## 2. Stack técnico real

| Capa | Tecnología | Versión |
|------|-----------|---------|
| Framework | Next.js App Router | 16.2.1 |
| UI | React | 19.2.4 |
| Tipos | TypeScript | ^5 |
| Estilos | Tailwind CSS + `@theme` CSS vars | ^4 |
| Auth + DB | Supabase (`@supabase/ssr` + `supabase-js`) | ssr ^0.6.1 / js ^2.100.0 |
| IA free | Google Gemini 2.5 Flash | vía REST |
| IA pro | OpenAI GPT-4.1 | openai ^6.34.0 |
| Pagos | Stripe | ^22.0.1 |
| Export DOCX | docx | ^9.6.1 |
| Export PDF | pdf-lib | ^1.17.1 |
| PDF parse | unpdf | ^1.4.0 |
| DOCX parse | mammoth | ^1.12.0 |

**Middleware**: `proxy.ts` con export nombrado `proxy` — convención Next.js 16.x.
`middleware.ts` es la convención deprecada (≤15). No usar.

**Scripts disponibles**: `dev`, `build`, `start`, `lint` (eslint), `knip`

---

## 3. Flujo principal actual

SPA con máquina de estados (`screen`). Sin router de páginas entre pantallas.

```
"upload"
  → pega texto o sube PDF/DOCX → POST /api/extract-text
  → handleContinue() → detecta nivel secundario (aviso) → "configure"

"configure"
  → selecciona perfil NEE, asignatura, apoyo, intereses, nivel educativo
  → handleGenerate() → POST /api/adapt (SSE)
      402 FREE_TRIAL_EXHAUSTED → ProGateModal "trial-exhausted" sobre ConfigScreen
      429 RATE_LIMIT           → toast + vuelve a configure
      error otro              → configError inline
      streaming OK            → "generating"

"generating"
  → GeneratingScreen, barra de progreso real (0→100%)
  → SSE "done" → setAdaptResult → "result"

"result"
  → ResultScreen: documento HTML, sticky header, banner Pro, notas docente
  → handlePdf():  if userPlan !== "pro" → ProGateModal "export-locked"
                  si pro → iframe + browser print (client-side)
  → handleDocx(): if userPlan !== "pro" → ProGateModal "export-locked"
                  si pro → POST /api/export/docx → descarga blob
  → onUpgrade → "subscription"
  → onReset   → "upload"

"subscription"
  → SubscriptionScreen → POST /api/checkout → { url } → Stripe hosted checkout
  → éxito  → /?checkout=success  (page reload, plan se recarga en mount)
  → cancel → /?checkout=canceled

Modales (fixed z-[200], encima de cualquier pantalla):
  ProGateModal "trial-exhausted" → sobre ConfigScreen
  ProGateModal "export-locked"   → sobre ResultScreen
```

---

## 4. Sistema de suscripciones

### Planes

| Plan | Precio | Adaptaciones | PDF | DOCX | IA |
|------|--------|-------------|-----|------|----|
| Free anónimo | gratis | 1 total (cookie) | ❌ | ❌ | Gemini |
| Free auth | gratis | 1 total (DB) | ❌ | ❌ | Gemini |
| Pro | 9,99 €/mes | ∞ | ✅ | ✅ | GPT-4.1 |

### Trial
- **Anónimo**: cookie `aa-trial=1` seteada client-side tras SSE `done`. Soft limit — borrable por el usuario. Servidor la lee del header `Cookie`.
- **Free auth**: count total de rows en `adaptations` para ese `user_id`. Si ≥ 1 → 402. No es mensual — es una sola adaptación de prueba de por vida.
- **Pro**: sin límite. `hasFreeTrialRemaining` devuelve `true` siempre.

### Flujo Stripe

```
Usuario → POST /api/checkout (Bearer requerido)
  → Guard: ya Pro → 409
  → stripe.checkout.sessions.create(mode:"subscription", metadata:{userId})
  → devuelve { url } → window.location.href = url

Pago completado → Stripe → POST /api/webhooks/stripe
  → verifica firma STRIPE_WEBHOOK_SECRET (raw body)
  → resuelve userId: metadata.userId → fallback por stripe_customer_id en DB
  → upsert tabla subscriptions con service-role
  → getUserPlan(userId) devuelve "pro" desde ese momento
```

Eventos manejados: `checkout.session.completed`, `customer.subscription.{created,updated,deleted}`

---

## 5. Reglas de negocio por tipo de usuario

| Capacidad | Anónimo | Free auth | Pro |
|-----------|---------|-----------|-----|
| Adaptaciones | 1 (cookie) | 1 (DB count) | ∞ |
| Proveedor IA | Gemini 2.5 Flash | Gemini 2.5 Flash | GPT-4.1 |
| System prompt | base | base | base + PREMIUM_SYSTEM_SUFFIX |
| Estilo docente | ❌ | ❌ | ✅ (si styleId en request) |
| Export PDF | ❌ modal | ❌ modal | ✅ client-side print |
| Export DOCX | ❌ modal | ❌ modal | ✅ /api/export/docx |
| Historial /history | ❌ redirect login | ✅ | ✅ |
| Estilos /styles | ❌ redirect login | ✅ | ✅ |

**Gating client-side**: `handlePdf` y `handleDocx` usan `userPlan !== "pro"` (no `=== "free"`).
Esto cubre `null` (plan cargando) — evita que usuarios free accedan durante la ventana de carga.

---

## 6. Arquitectura IA

### Selección de proveedor (`lib/ai/provider.ts`)

```typescript
getAIProvider(plan: Plan): AIProvider
  "pro" + OPENAI_API_KEY    → OpenAIProvider  (GPT-4.1)
  "pro" + sin OPENAI_API_KEY → GeminiProvider  (fallback silencioso)
  "free"                    → GeminiProvider
```

### GeminiProvider (`lib/ai/providers/gemini.ts`)
- Modelo: `GEMINI_MODEL` env || `"gemini-2.5-flash"` (centralizado en `lib/ai/model.ts`)
- Primario: `streamGemini()` (SSE `alt=sse`). Fallback: `callGemini()` (non-streaming)
- `responseMimeType: "application/json"`, temperature 0.3, maxOutputTokens 16384

### OpenAIProvider (`lib/ai/providers/openai.ts`)
- Modelo: `OPENAI_MODEL` env || `"gpt-4.1"`
- `response_format: { type: "json_object" }`, temperature 0.3, max_tokens 16384
- Streaming via SDK oficial

### Prompts (`lib/ai/systemPrompts.ts`)
- 6 system prompts específicos por perfil NEE + `FALLBACK_SYSTEM_PROMPT`
- `PREMIUM_SYSTEM_SUFFIX`: añadido al system prompt en tier premium. Refuerza fidelidad al original, jerarquía visual, tono no condescendiente, teacherNotes de calidad (≥3).
- `OUTPUT_RULES`: sufijo de salida JSON compartido entre todos los perfiles → maximiza caching implícito Gemini.

### Estilo docente en Pro

```
Si userPlan === "pro" && styleId en request:
  → query style_analyses con anon key + Bearer token (respeta RLS del usuario)
  → buildStyleContextBlock(row) → bloque "ESTILO DOCENTE" al final del userPrompt
  → Si falla: silent fallback — adaptación continúa sin contexto de estilo
```

### Robustez de salida

```typescript
const jsonMatch = rawText.match(/\{[\s\S]*\}/);
raw = JSON.parse(jsonMatch ? jsonMatch[0] : rawText);
// catch → error descriptivo, no crash genérico
```

### Logging en desarrollo

```
[ADAPT] { plan, tier, provider, hasStyleContext, profile }   // cada request
[ADAPT] JSON_PARSE_ERROR { provider, rawLength, parseErr }   // solo si falla parse
```

`next.config.ts` elimina `console.log` en production, conserva `.error` y `.warn`.

---

## 7. Stripe

### Variables necesarias

```env
STRIPE_SECRET_KEY=sk_test_...        # o sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...      # de Dashboard > Webhooks o CLI
STRIPE_PRO_PRICE_ID=price_...        # ID del precio Pro en Stripe
NEXT_PUBLIC_SITE_URL=https://...     # para success_url y cancel_url
```

### Probar webhook en local

```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe
# El CLI imprime el STRIPE_WEBHOOK_SECRET temporal → añadir a .env.local
```

### `getUserPlan(userId)` — fuente de verdad de plan

```typescript
// lib/subscriptionService.ts
// Usa createServiceClient() (service role) para bypasear RLS desde servidor
getUserPlan(userId) → "free" | "pro"
  → getActiveSubscription(userId) → busca status IN ('active','trialing')
  → valida current_period_end > now()
  → si nada coincide → "free"
```

---

## 8. Supabase

### Regla de uso de clientes

| Contexto | Cliente | Razón |
|---------|---------|-------|
| Componentes React | `supabase` de `supabaseClient.ts` (createBrowserClient) | Lee sesión de cookies del browser |
| API Routes — lecturas de plan | `createServiceClient()` | RLS de subscriptions requiere `auth.uid()`; en Node no hay sesión browser |
| API Routes — escrituras | `createServiceClient()` | Webhook bypasea RLS intencionalmente |
| API Routes — validar token | `createClient(url, anon_key).auth.getUser(token)` | Valida Bearer JWT del usuario |

**⚠️ Nunca usar el browser client para leer `subscriptions` desde un API route** — RLS devolverá vacío (`auth.uid()` = null en Node) y el plan siempre aparecerá como "free".

### Tablas confirmadas en código

#### `subscriptions` — migración en `supabase/migrations/20260416_subscriptions.sql`
```
id, user_id (→ auth.users CASCADE), plan ('free'|'pro'), status,
stripe_customer_id, stripe_subscription_id (UNIQUE), stripe_price_id,
current_period_end, created_at, updated_at (auto-trigger)
RLS: SELECT propio (auth.uid() = user_id) | escritura solo service-role
```

#### `adaptations` — insertada por adapt/route.ts y leída por history/exports
```
id, user_id, source_text, result_html, work_type, adaptation_type,
student_profile, with_pictograms, style_id, ai_notes, created_at
(+ campos legacy del schema rico de adaptationsService.ts)
```
**Nota**: `adapt/route.ts` inserta 8 campos directamente. `adaptationsService.ts` soporta schema más rico usado por /history y exports. Divergencia documentada → deuda técnica.

#### `style_analyses` — escrita por /api/style-analysis, leída por adapt route (Pro)
```
id, style_id, user_id, summary, usual_structure, instruction_style,
tone, key_observations, (+ otros campos de análisis Gemini)
```

#### `user_styles` — CRUD por stylesService.ts para /styles page
```
id, user_id, name/title, description, ...campos estilo docente
```

#### `adaptation_feedback` — tabla inferida, sin uso activo
```
id, adaptation_id, user_id, rating, comment, created_at
```

---

## 9. UX de conversión

### SubscriptionScreen (`components/screens/SubscriptionScreen.tsx`)
- Layout premium: badge "Plan Pro · 9,99 €/mes", título fuerte, grid 2×2 de beneficios
- CTA "Activar AdaptAula Pro" → `startProCheckout()` → `/api/checkout` → Stripe
- Error de checkout mostrado inline. Loading state con texto "Redirigiendo a Stripe…"
- Trust: "✓ Pago seguro vía Stripe · ✓ Cancela cuando quieras · ✓ Factura disponible"
- Link "¿Ya eres Pro? Accede a tu cuenta →" y botón "Volver" (prop `onBack`)

### ProGateModal (`components/ui/ProGateModal.tsx`)
- Props: `variant: "trial-exhausted" | "export-locked"`, `onUpgrade`, `onClose`
- `z-[200]`, backdrop blur semitransparente, click-outside cierra
- `"trial-exhausted"`: icono verde sparkle, "Ya has probado AdaptAula", features Pro, CTA "Ver plan Pro · 9,99 €/mes", secundario "Volver al inicio"
- `"export-locked"`: icono naranja document, badge "Función Pro", CTA igual, secundario "Cerrar"

### ResultScreen banner Pro
- Visible solo cuando `!isPro && onUpgrade` (oculto para usuarios Pro)
- Badge naranja "Con Pro obtienes" + copy + CTA "Ver plan Pro" + precio

### PlanBadge (`components/ui/PlanBadge.tsx`)
- Usado en sticky header de ResultScreen (`hidden sm:block` en mobile)
- Free: pill crema "Prueba gratuita" + link "Activar Pro →"
- Pro: pill verde oscuro "★ Pro activo"
- Plan cargado en mount de page.tsx desde `subscriptions` via Supabase browser client (RLS ok: usuario autenticado)

---

## 10. API routes activas

| Endpoint | Auth | Plan check | Descripción |
|----------|------|-----------|-------------|
| `POST /api/adapt` | Opcional | 402 si trial agotado | Motor SSE, provider IA por plan |
| `POST /api/checkout` | Bearer req. | 409 si ya Pro | Crea Stripe Checkout Session |
| `POST /api/webhooks/stripe` | Stripe sig. | — | Sincroniza subscriptions |
| `POST /api/export/docx` | Bearer req. | 403 si free | Genera DOCX con pictogramas |
| `POST /api/export/pdf` | Bearer req. | 403 si free | Genera PDF con pdf-lib ⚠️ ver nota |
| `POST /api/extract-text` | Sin auth | — | unpdf + mammoth, 10MB |
| `POST /api/style-analysis` | Bearer req. | — | Gemini T=0.2, guarda style_analyses |
| `GET /api/arasaac/search` | Sin auth | — | Proxy ARASAAC público |

**⚠️ Nota sobre PDF**: `/api/export/pdf` existe con enforcement correcto, pero `handlePdf` en page.tsx usa iframe + browser print (client-side). La API no es llamada desde el flujo actual. El gating es solo frontend (`userPlan !== "pro"`). Ver Sprint D.1 en deuda técnica.

### Rutas de página activas (build)

```
○ /               SPA principal
○ /history        historial de adaptaciones
○ /login          Supabase email/password
○ /styles         gestión de estilos docente
○ /admin/feedback redirect a /internal/feedback
ƒ Proxy (Middleware) — proxy.ts activo
```

---

## 11. Riesgos residuales aceptados

| Riesgo | Severidad | Decisión |
|--------|-----------|---------|
| Trial anónimo bypasseable (borrar cookie) | Baja | **Aceptado** — soft limit intencionado |
| `getAdaptationUsage` falla silenciosa → 0 | Baja | **Aceptado** — fail-open para errores transitorios de DB |
| Rate limit in-memory, se resetea en cold start | Media | **Pendiente** — requiere Redis para fix real |
| PDF export sin enforcement servidor en UI | Media | **Pendiente** — Sprint D.1 lo resuelve |
| Doble `auth.getUser(token)` en adapt route | Info | **Aceptado** — redundante pero sin impacto funcional |
| Progreso SSE estimado (`ESTIMATED_CHARS=5000`) | Info | **Aceptado** — UX menor, salto de ~50% a 100% si respuesta corta |

---

## 12. Deuda técnica

### 🔴 Alta — afecta correctitud o seguridad

1. **PDF export desconectado del servidor**: `handlePdf` usa iframe print sin API call. No hay enforcement real de plan para PDF. Sprint D.1.

### 🟠 Media — afecta mantenibilidad

2. **`adaptationsService.ts` schema divergente**: adapt/route.ts inserta 8 campos directamente; el servicio soporta schema rico (~30 campos). La historia lee via el servicio, el flujo principal bypasea. Si se extiende el historial puede haber inconsistencias.
3. **5 exports muertos en `adaptationsService.ts`**: `createAdaptation`, `getAdaptationById`, `getNextVersionNumber`, `getAdaptationChain`, `markAdaptationAsFinal` — knip confirmado. Eliminar o conectar.
4. **3 exports muertos en `arasaac.ts`**: `mergePictogramConcepts`, `resolveArasaacPictograms`, `enrichDocumentWithArasaac` — knip confirmado.

### 🟡 Baja — cosmética o cobertura

5. **`POPULAR_INTERESTS`** en adaptationRules.ts — export sin uso.
6. **`lib/document/`** — directorio vacío, puede eliminarse.
7. **`lib/authService.ts`** — uso no confirmado. Verificar antes de borrar.
8. **Cache ARASAAC** — cada request consulta la API pública. Sin cache persistente.
9. **Tests** — cero cobertura.

---

## 13. Próximos sprints recomendados

### Sprint D.1 — PDF server-side (Alta)
Conectar `handlePdf` en page.tsx a `/api/export/pdf` en lugar del iframe. La API ya existe con plan check correcto. Eliminar el iframe. Enforcement real para Pro.

### Sprint D.2 — Limpiar exports muertos (Media)
```bash
# Confirmar con knip antes de eliminar:
npm run knip
# Eliminar exports sin uso en adaptationsService.ts, arasaac.ts, adaptationRules.ts
# Verificar lib/authService.ts y lib/document/ antes de borrar
```

### Sprint D.3 — Portal Stripe (Media)
Customer portal para ver facturas, cancelar, cambiar método de pago.
`/api/billing-portal` → `stripe.billingPortal.sessions.create({ customer, return_url })`.

### Sprint D.4 — Rate limit persistente (Media)
Migrar `lib/rateLimit.ts` de Map in-memory a Upstash Redis o tabla Supabase.
Impacto: rate limit sobrevive cold starts en Vercel serverless.

### Sprint D.5 — Feedback de adaptaciones (Baja)
Añadir widget 👍/👎 en ResultScreen. La tabla `adaptation_feedback` existe en DB.

---

## 14. Notas operativas

### Variables de entorno completas

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=         # requerida — subscriptionService usa service role

# IA
GEMINI_API_KEY=                    # requerida
GEMINI_MODEL=gemini-2.5-flash      # opcional, default en lib/ai/model.ts
OPENAI_API_KEY=                    # opcional — sin ella, Pro usa Gemini como fallback
OPENAI_MODEL=gpt-4.1               # opcional, default gpt-4.1

# Stripe
STRIPE_SECRET_KEY=                 # sk_test_... o sk_live_...
STRIPE_WEBHOOK_SECRET=             # whsec_... del CLI o Dashboard
STRIPE_PRO_PRICE_ID=               # price_... del plan Pro

# App
NEXT_PUBLIC_SITE_URL=https://adaptaula.com
INTERNAL_FEEDBACK_ALLOWED_EMAILS=email@dominio.com
```

### Webhook Stripe local

```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe
# Copia el whsec_... que imprime → STRIPE_WEBHOOK_SECRET en .env.local
```

### Verificar plan Pro de un usuario

```sql
-- En Supabase Dashboard > SQL Editor
SELECT user_id, plan, status, current_period_end
FROM subscriptions
WHERE user_id = '<uuid>'
ORDER BY created_at DESC LIMIT 1;
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

### Knip

```bash
npm run knip
# Estado actual: 0 unused files, 9 unused exports
# Objetivo: 0 findings
```

### Build de referencia

```
✓ Compiled successfully
○ 6 static routes + ƒ 8 API routes + ƒ Proxy (Middleware)
```
