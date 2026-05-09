@AGENTS.md

---

# AdaptAula — Fuente de verdad técnica
**Fecha**: 2026-04-20 | **Build**: ✅ limpio | **Knip**: 9 exports pendientes (pre-existentes) | **Último commit**: `693dd5d`

Todo el contenido está verificado directamente en el código del repositorio.

---

## 1. Resumen ejecutivo

AdaptAula adapta materiales educativos para alumnos con NEE (TEA, TEL, Dislexia, DI, TDAH, Retraso) usando IA generativa. El docente sube un PDF o pega texto, configura el perfil del alumno, y recibe una ficha adaptada en HTML lista para imprimir o exportar.

**Estado actual**: Beta funcional con monetización real activa. Stripe checkout + webhook + billing portal operativos, proveedor IA diferenciado por plan, exportaciones Pro con enforcement servidor real (PDF + DOCX), arquitectura dos llamadas IA (análisis previo + adaptación), parser JSON robusto de 4 capas, capa de normalización estructural del documento post-generación.

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
  → nav top-right: "Mi cuenta" (auth) | "Iniciar sesión" (anon)

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
  → SSE "error" → setAdaptError → "result" (renderiza ResultError)

"result" (con adaptResult)
  → ResultScreen: documento HTML, sticky header, banner Pro, notas docente
  → handlePdf():  if userPlan !== "pro" → ProGateModal "export-locked"
                  si pro → POST /api/export/pdf (Bearer) → descarga blob
  → handleDocx(): if userPlan !== "pro" → ProGateModal "export-locked"
                  si pro → POST /api/export/docx → descarga blob
  → onUpgrade → "subscription"
  → onReset   → "upload"

"result" (con adaptError)
  → ResultError: icono warning, mensaje, botones "Intentar de nuevo" + "Volver"
  → onRetry: limpia adaptError, vuelve a llamar handleGenerate()
  → onBack:  vuelve a "configure"

"subscription"
  → SubscriptionScreen → POST /api/checkout → { url } → Stripe hosted checkout
  → éxito  → /?checkout=success  (page reload, plan se recarga en mount)
  → cancel → /?checkout=canceled

Modales (fixed z-[200], encima de cualquier pantalla):
  ProGateModal "trial-exhausted" → sobre ConfigScreen
  ProGateModal "export-locked"   → sobre ResultScreen

savedAdaptationIdRef: ref compartida entre handlePdf y handleDocx para evitar
  insertar la misma adaptación dos veces en Supabase si el usuario descarga ambos.
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

Usuario Pro → /account → POST /api/billing-portal (Bearer req.)
  → stripe.billingPortal.sessions.create({ customer, return_url: /account })
  → devuelve { url } → redirección a Stripe Customer Portal
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
| Export PDF | ❌ modal | ❌ modal | ✅ /api/export/pdf (server-side) |
| Export DOCX | ❌ modal | ❌ modal | ✅ /api/export/docx |
| Historial /history | ❌ redirect login | ✅ | ✅ |
| Estilos /styles | ❌ redirect login | ✅ | ✅ |
| Portal Stripe | — | — | ✅ /account → billing-portal |

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

### Arquitectura dos llamadas (`lib/ai/documentAnalysis.ts`)

```
Llamada 1 — análisis previo (paralela a pictogramas + auth):
  analyzeDocument(sourceText, educationalLevel)
  → Gemini T=0.1, maxTokens 1024, timeout 12s, falla silenciosamente
  → Devuelve DocumentAnalysis: tipo, nivel, complejidad, conceptos_clave,
    vocabulario_complejo, estructura_detectada, advertencias, num_actividades
  → buildAnalysisContextBlock(analysis) → bloque de texto al final del userPrompt

Llamada 2 — adaptación pedagógica (proveedor por plan):
  aiProvider.stream(systemPrompt, userPrompt, progressCallback)
  → userPrompt = basePrompt + analysisBlock + styleContextBlock
  → systemPrompt = profilePrompt + (premium: PREMIUM_SYSTEM_SUFFIX)
```

### Prompts (`lib/ai/systemPrompts.ts`)
- 6 system prompts específicos por perfil NEE + `FALLBACK_SYSTEM_PROMPT`
- `PREMIUM_SYSTEM_SUFFIX`: añadido al system prompt en tier premium
- `OUTPUT_RULES`: sufijo JSON compartido entre todos los perfiles (maximiza caching implícito Gemini). Contiene 5 reglas explícitas de formato: no fences markdown, escaping correcto de `"` y `\n` dentro de strings, cierre obligatorio de todos los tokens, no texto fuera del objeto JSON.

### Corrección crítica de perfil NEE (`lib/adaptationRules.ts`)

```
ANTES (bug): adaptationType ("pictogramas", "autonomia"...) → profileMap → LearningProfile
  → TEL recibía reglas de dislexia, DI recibía reglas de TEA

AHORA (correcto): learningProfile llega directo desde page.tsx → buildConfigFromForm()
  → page.tsx envía: body.learningProfile = perfil (string del estado React)
  → route.ts lee: body.learningProfile as LearningProfile (con fallback legacy)
  → buildConfigFromForm({ learningProfile }) → AdaptationConfig correcto
```

### Parser JSON robusto (`lib/ai/parseModelResponse.ts`)

```typescript
parseModelJsonResponse(rawText): ParseResult
  Capa 0: JSON.parse directo               → happy path, sin overhead
  Capa 1: strip fences markdown + trim     → ```json...```
  Capa 2: extraer primer {...}             → texto antes/después del objeto
  Capa 3: limpiar chars de control         → U+0000-U+001F literales en strings
  Capa 4: repairTruncatedJson()            → cierra strings/arrays/objetos abiertos
  → Si todo falla: error con rawLength + mensaje exacto

Logging: [ADAPT] JSON_RECOVERED { recoveryLevel, recoveryNote } si capa > 0
```

### Estilo docente en Pro

```
Si userPlan === "pro" && styleId en request:
  → query style_analyses con anon key + Bearer token (respeta RLS del usuario)
  → buildStyleContextBlock(row) → bloque "ESTILO DOCENTE" al final del userPrompt
  → Si falla: silent fallback — adaptación continúa sin contexto de estilo
```

### Logging en desarrollo

```
[ADAPT] { plan, tier, provider, hasStyleContext, hasAnalysis, analysisWarnings,
          profile, subject, educationalLevel }          // cada request
[ADAPT] JSON_RECOVERED { recoveryLevel, recoveryNote }  // si se usó fallback parser
[ADAPT] JSON_PARSE_ERROR { provider, rawLength, parseErr } // solo si falla definitivo
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

#### `adaptation_feedback` — tabla existe en DB, sin uso activo en código
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

### ProGateModal (`components/ui/ProGateModal.tsx`)
- Props: `variant: "trial-exhausted" | "export-locked"`, `onUpgrade`, `onClose`
- `z-[200]`, backdrop blur semitransparente, click-outside cierra
- `"trial-exhausted"`: icono verde sparkle, "Ya has probado AdaptAula", CTA "Ver plan Pro · 9,99 €/mes"
- `"export-locked"`: icono naranja document, badge "Función Pro", mismo CTA

### ResultError (`components/ui/ResultError.tsx`)
- Se renderiza cuando `screen === "result" && adaptError !== null`
- Icono warning naranja, título, subtítulo, botones "Intentar de nuevo" y "Volver a configurar"
- `onRetry` limpia `adaptError` y relanza `handleGenerate()`

### ResultScreen banner Pro
- Visible solo cuando `!isPro && onUpgrade` (oculto para usuarios Pro)
- Badge naranja "Con Pro obtienes" + copy + CTA "Ver plan Pro" + precio

### PlanBadge (`components/ui/PlanBadge.tsx`)
- Usado en sticky header de ResultScreen (`hidden sm:block` en mobile)
- Free: pill crema "Prueba gratuita" + link "Activar Pro →"
- Pro: pill verde oscuro "★ Pro activo"

### /account page (`app/account/page.tsx`)
- "use client", carga sesión + plan Supabase en mount
- Muestra: email, plan badge, fecha de renovación/fin
- Botón "Gestionar suscripción" → POST /api/billing-portal → redirect Stripe
- Botón "Cerrar sesión" → signOut() → router.push("/")

### /login page (restyled)
- Mismos aa-* tokens: fondo cream, card blanca, toggle verde, footer legal
- Mantiene toda la lógica original (modo login/register, getCurrentUser redirect, Suspense)

---

## 10. API routes activas

| Endpoint | Auth | Plan check | Descripción |
|----------|------|-----------|-------------|
| `POST /api/adapt` | Opcional | 402 si trial agotado | Motor SSE, dos llamadas IA, provider por plan |
| `POST /api/checkout` | Bearer req. | 409 si ya Pro | Crea Stripe Checkout Session |
| `POST /api/webhooks/stripe` | Stripe sig. | — | Sincroniza subscriptions |
| `POST /api/export/docx` | Bearer req. | 403 si free | Genera DOCX con pictogramas |
| `POST /api/export/pdf` | Bearer req. | 403 si free | Genera PDF con pdf-lib |
| `POST /api/billing-portal` | Bearer req. | — | Crea sesión Stripe Customer Portal |
| `POST /api/extract-text` | Sin auth | — | unpdf + mammoth, 10MB |
| `POST /api/style-analysis` | Bearer req. | — | Gemini T=0.2, guarda style_analyses |
| `GET /api/arasaac/search` | Sin auth | — | Proxy ARASAAC público |

### Rutas de página activas (build)

```
○ /               SPA principal
○ /account        gestión de cuenta y plan
○ /history        historial de adaptaciones
○ /login          Supabase email/password (restyled)
○ /styles         gestión de estilos docente
○ /legal/terms    términos de servicio (estático)
○ /legal/privacy  política de privacidad (estático)
○ /admin/feedback redirect a /internal/feedback
ƒ Proxy (Middleware) — proxy.ts activo
```

---

## 11. Sistema de documentos generados

### Estructura HTML generada por la IA

```html
<div class="aa-page">
  <div class="aa-header">
    <h1>Título</h1>
    <div class="aa-meta">Documento adaptado · AdaptAula</div>
  </div>
  <div class="aa-body">
    <div class="aa-block aa-reading-block" data-block="lectura-1">
      <span class="aa-subtitle">Sección</span>
      <p>Texto adaptado.</p>
      <!-- Alto apoyo: <div class="aa-picto-row">...</div> -->
    </div>
    <hr class="aa-separator">
    <h2 class="aa-section-title">Actividades</h2>
    <div class="aa-block aa-activity" data-block="actividad-1">
      <div class="aa-activity-number">Actividad 1</div>
      <p class="aa-instruction">Instrucción.</p>
      <!-- V-F, tabla, ruled-box, calc-box, etc. -->
    </div>
  </div>
</div>
```

**Restricciones duras**: NO `<style>` en HTML (CSS inyectado servidor), cada `.aa-block` requiere `data-block`, máximo 1/2/3 actividades por bloque según apoyo.

### CSS generado server-side (`lib/buildDocumentCss.ts`)

`buildDocumentCss(config, writingMetrics)` genera ~65 clases `.aa-*` embebidas en `<style id="aa-document-styles">` dentro del HTML. El CSS usa valores dinámicos según perfil:

| Métrica | Fuente | Efecto |
|---------|--------|--------|
| `fontSize` | `getWritingMetrics(config)` | 15–19px según perfil+apoyo |
| `lineHeight` | idem | 36/44/52px — alinea ruled lines |
| `boxMinHeight` | idem | 72/96/120px — cajas de escritura |
| `bodyBg` | perfil | Dislexia: `#FFF8E7` · TEA: `#FAFAF5` · otros: `#F5F0E8` |

`injectCssIntoHtml()` extrae el `<style>` del HTML y lo mueve al `<head>` via `injectAndStripStyles()`. Regex crítico: `/<style[^>]*>([\s\S]*?)<\/style>/i` (acepta atributos como `id=`).

### Normalización estructural post-generación (`lib/document/normalizeDocumentHtml.ts`)

Capa determinista insertada entre `sanitizeHtml` y `injectCssIntoHtml`. Filosofía Pretext: *preparar primero → maquetar después*. Falla silenciosamente (try/catch global devuelve original si algo lanza).

| Transformación | Problema que resuelve |
|---------------|----------------------|
| `normalizeBrSequences` | `<br><br>` → `</p><p>` — la IA usa `<br>` en vez de párrafos |
| `splitLongParagraphs` | Párrafos >250 chars sin HTML interior → dos párrafos en el primer límite seguro ≥100 chars |
| `ensureDataBlockAttributes` | `.aa-block` sin `data-block` → `bloque-N` (requerido por IntersectionObserver de animaciones) |
| `addLazyLoadingToPictograms` | `loading="lazy"` en `aa-picto-img` / `aa-picto-inline` |
| `injectSubjectAttribute` | `data-subject="<asignatura>"` en `.aa-body` (forward compat para Sprint E.3) |

`splitLongParagraphs` solo actúa sobre `[^<]{250,}` — párrafos de texto puro sin etiquetas internas. Hace un único corte conservador; nunca recursivo.

### Pictogramas (`lib/pictogramResolver.ts`)

```
extractKeywordsForPictograms(text, { supportLevel, subject })
  → tokenización + stop words + blacklist abstractos (70+ términos math)
  → top N: alto=12, medio=7, bajo=4 (math: ×0.67)

resolvePictograms(keywords)
  → ARASAAC API pública: /v1/pictograms/es/search/{word}
  → lotes de 5 con throttle 150ms
  → URL: https://static.arasaac.org/pictograms/{id}/{id}_500.png
  → revalidate 86400s (cache Next.js)

buildPictogramSuggestions(resolved)
  → texto para el prompt: lista "palabra → <img src=URL>"
  → la IA coloca los <img> en el HTML según modo (card/inline)
```

**Modos de pictograma** (decididos por la IA según `supportLevel`):
- **Alto**: `.aa-picto-card` (imagen 64×64px + palabra debajo) en `.aa-picto-row`
- **Medio/Bajo**: `.aa-picto-inline` (40×40px, vertical-align middle) dentro del texto

### Pipeline completo de generación

```
page.tsx → POST /api/adapt
  ↓
route.ts:
  1. Rate limit + trial check
  2. buildConfigFromForm({ learningProfile, subject, supportDegree, studentInterests })
  3. Promise.all([
       auth.getUser(token),
       resolvePictograms(keywords),          ← ARASAAC
       analyzeDocument(sourceText, level),   ← Gemini llamada 1
     ])
  4. buildPrompt({ config, rulesText, pictogramSuggestions, ... })
  5. userPrompt = basePrompt + analysisBlock + styleContextBlock
  6. aiProvider.stream(systemPrompt, userPrompt, onProgress)  ← llamada 2
  7. parseModelJsonResponse(rawText)         ← parser 4 capas
  8. buildDocumentCss(config, writingMetrics)
  9. normalizeDocumentHtml(sanitizedHtml, { subject })  ← normalización estructural
  10. injectCssIntoHtml(normalizedHtml, css)             ← inyección CSS final
  11. SSE "done" → { documentHtml, teacherNotes, adaptationDecisions }
```

---

## 12. Riesgos residuales aceptados

| Riesgo | Severidad | Decisión |
|--------|-----------|---------|
| Trial anónimo bypasseable (borrar cookie) | Baja | **Aceptado** — soft limit intencionado |
| `getAdaptationUsage` falla silenciosa → 0 | Baja | **Aceptado** — fail-open para errores transitorios de DB |
| Rate limit in-memory, se resetea en cold start | Media | **Pendiente** — requiere Redis para fix real |
| Doble `auth.getUser(token)` en adapt route | Info | **Aceptado** — redundante pero sin impacto funcional |
| Progreso SSE estimado (`ESTIMATED_CHARS=5000`) | Info | **Aceptado** — UX menor, salto de ~50% a 100% si respuesta corta |
| Pictograma placement via IA (sin validación servidor) | Media | **Pendiente** — ver Sprint E.2 |

---

## 13. Deuda técnica

### 🟠 Media — afecta mantenibilidad

1. **`adaptationsService.ts` schema divergente**: adapt/route.ts inserta 8 campos directamente; el servicio soporta schema rico (~30 campos). La historia lee via el servicio, el flujo principal bypasea.
2. **5 exports muertos en `adaptationsService.ts`**: `createAdaptation`, `getAdaptationById`, `getNextVersionNumber`, `getAdaptationChain`, `markAdaptationAsFinal` — knip confirmado.
3. **3 exports muertos en `arasaac.ts`**: `mergePictogramConcepts`, `resolveArasaacPictograms`, `enrichDocumentWithArasaac` — knip confirmado.
4. **CSS hardcodeado en `buildDocumentCss.ts`**: colores, tamaños y fuentes como literales de string. Dificulta un panel de personalización futuro.
5. **No hay CSS por asignatura en el HTML**: la asignatura se pasa al prompt pero no como `data-subject` en el DOM → imposible hacer override CSS por asignatura sin cambiar el template.

### 🟡 Baja — cosmética o cobertura

6. **`POPULAR_INTERESTS`** en adaptationRules.ts — export sin uso (knip).
7. **`lib/document/`** — contiene `normalizeDocumentHtml.ts` (activo). No eliminar.
8. **`lib/authService.ts`** — uso no confirmado. Verificar antes de borrar.
9. **Cache ARASAAC** — sin cache persistente cross-request (solo revalidate Next.js).
10. **Tests** — cero cobertura.
11. **Pictogram cards overflow mobile**: `.aa-picto-card` min-width 80px fijo, no responsive.

---

## 14. Próximos sprints recomendados

### Sprint E.1 — Intereses del alumno integrados en el documento ⭐ (Alta — diferenciador)

**Problema**: `studentInterests` llega al prompt solo como "usa para ejemplos", pero no influye en los pictogramas ni en el contenido concreto.

**Objetivo**: Si el alumno tiene interés en "pokemon", "fútbol" o "coches", ese interés debe aparecer:
1. **En los ejemplos del texto adaptado**: "María tiene 3 cartas de Pokémon" en vez de "María tiene 3 manzanas"
2. **En los pictogramas**: complementar ARASAAC con imágenes temáticas cuando el interés es concreto
3. **En los enunciados de actividades**: el contexto de las preguntas usa el universo del interés

**Implementación sugerida**:
- En `buildPrompt()`: añadir bloque explícito `CONTEXTO DE INTERESES` con instrucciones concretas para cada actividad, no solo para "ejemplos". Indicar que las actividades deben usar el universo del interés como contexto.
- Para imágenes de intereses: añadir una lista curada de URLs de imágenes libres (Wikipedia Commons / ARASAAC temático) por categoría de interés. Inyectar en `buildPictogramSuggestions()` como "pictogramas de interés" separados de los ARASAAC.
- Crear `lib/interestImages.ts`: mapa `{ "pokemon": [...urls], "futbol": [...urls], "dinosaurios": [...urls] }` con 5-8 imágenes libres por categoría.

### Sprint E.2 — Pictogramas programáticos + validación servidor (Alta — calidad)

**Problema**: La colocación de pictogramas depende enteramente de la IA, sin validación posterior.

**Objetivo**: Garantizar que todos los pictogramas disponibles se usan y están bien colocados.

**Implementación sugerida**:
- Post-procesar el HTML devuelto por la IA: verificar que cada palabra en `resolvedPictograms` aparece como `<img>` en el HTML.
- Para los que faltan: inyectarlos programáticamente en el primer párrafo que mencione la palabra.
- Normalizar `.aa-picto-row` para que tenga un máximo de 4 tarjetas por fila (responsive).
- Añadir `alt` text correcto y `loading="lazy"` a todos los `<img>` de pictogramas.

### Sprint E.3 — CSS por asignatura (Media — calidad visual) ✅ DESBLOQUEADO

**Problema**: El documento tiene el mismo aspecto visual para matemáticas que para lengua.

**Objetivo**: Cada asignatura tiene un esquema visual diferenciado.

**Estado**: `data-subject="${subject}"` ya se inyecta en `.aa-body` vía `normalizeDocumentHtml`. Solo falta añadir los overrides CSS en `buildDocumentCss.ts`.

**Implementación**:
- `data-subject` en `.aa-body` ya existe — no requiere cambio en prompts ni route.ts.
- En `buildDocumentCss()`: añadir bloque de overrides por asignatura:
  - **Matemáticas**: `.aa-equation-block` con grid para alinear operaciones en columna, color accent azul/gris
  - **Lengua**: `.aa-vf-item` con border-left verde, espacio extra para justificación
  - **Naturales**: `.aa-reading-block` con fondo ligeramente más cálido, tablas de comparación
  - **Inglés**: badge bilingüe en `.aa-instruction` (ES/EN), vocabulario en pill verde claro
- Esto no requiere cambios en la IA, solo en `buildDocumentCss.ts` y el template del prompt.

### Sprint E.4 — Limpiar exports muertos (Media)

```bash
npm run knip
# Eliminar exports sin uso en adaptationsService.ts, arasaac.ts, adaptationRules.ts
# Verificar lib/authService.ts y eliminar lib/document/ (directorio vacío)
```

### Sprint E.5 — Rate limit persistente (Media)

Migrar `lib/rateLimit.ts` de Map in-memory a tabla Supabase o Upstash Redis.
Impacto: rate limit sobrevive cold starts en Vercel serverless.

### Sprint E.6 — Feedback de adaptaciones (Baja)

Añadir widget 👍/👎 en ResultScreen. La tabla `adaptation_feedback` existe en DB.

### Sprint E.7 — Pretext (Evaluado — No prioritario)

[**Evaluado 2026-04-20**] `pretext` (github.com/chenglou/pretext) es una librería MIT de medición de texto sin DOM (para layout sin `getBoundingClientRect`). Su valor en AdaptAula sería:
- Validar server-side que los párrafos caben en `.aa-ruled-box` antes de devolver el HTML
- Mejorar precisión del PDF export (layout de paginación)

**Decisión**: No integrar ahora. Las ruled lines ya funcionan con la estimación CSS actual. El valor es incremental y requiere font metrics en Node (dependencia `canvas`). Reconsiderar cuando el PDF server-side sea el flujo principal (post Sprint D.1).

---

## 15. Notas operativas

### Variables de entorno completas

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=         # requerida — subscriptionService usa service role

# IA
GEMINI_API_KEY=                    # requerida (análisis previo + free tier)
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
# Estado actual: 0 unused files, 9 unused exports (pre-existentes, deuda técnica documentada)
# Objetivo: 0 findings (Sprint E.4)
```

### Build de referencia

```
✓ Compiled successfully
○ 9 static routes + ƒ 9 API routes + ƒ Proxy (Middleware)
```

---

## 16. Invariantes del sistema (NO romper)

Estas reglas no son preferencias — son restricciones que, si se violan, rompen la monetización
o la seguridad del producto. Aplicar en cualquier sprint futuro.

| # | Invariante | Razón |
|---|-----------|-------|
| 1 | `getUserPlan()` es la **única fuente de verdad** del plan | Cualquier otra lectura puede ser stale o engañada por RLS mal configurado |
| 2 | **Nunca usar browser client para leer `subscriptions` en API routes** | `auth.uid()` es null en Node.js — RLS devuelve vacío, plan siempre "free" |
| 3 | El gating siempre usa `userPlan !== "pro"` (no `=== "free"`) | Cubre `null` (loading) y evita que free acceda durante la ventana de carga |
| 4 | **La lógica pedagógica de `adapt/route.ts` no se toca sin validación manual** | Cambios en prompts o reglas pueden degradar silenciosamente la calidad para NEE |
| 5 | Pro siempre usa `OpenAIProvider` si `OPENAI_API_KEY` está disponible | Sin esto, Pro paga pero recibe calidad free — fallo de producto crítico |
| 6 | **`ProGateModal` es la única vía de bloqueo UX** (no errores crudos) | Consistencia de conversión — mensajes de error genéricos rompen el funnel |
| 7 | `learningProfile` llega **directo** desde el formulario a `buildConfigFromForm()` | No derivar de `adaptationType` — ese mapeo causaba perfiles NEE incorrectos |
| 8 | `parseModelJsonResponse()` es el **único punto de parseo** de respuestas IA | No hacer JSON.parse directo en route.ts — el parser robusto maneja los casos edge de Gemini |

---

## AUDITORÍA 2026-05-09

### 1. npx knip --reporter compact

```
Unused files (4)
components/ui/FeedbackWidget.tsx
components/ui/PlanBadge.tsx
components/ui/PlanStatusBanner.tsx
lib/ai/providers/openai.ts

Unused dependencies (2)
package.json: openai, pdf-lib

Unused exports (4)
lib/adaptationRules.ts: POPULAR_INTERESTS
lib/adaptationsService.ts: createAdaptation, getAdaptationById, getNextVersionNumber, getAdaptationChain, markAdaptationAsFinal
lib/arasaac.ts: mergePictogramConcepts, resolveArasaacPictograms, enrichDocumentWithArasaac
lib/export/adaptationExport.ts: loadAdaptationForExport
```

**Novedades respecto a auditoría anterior:**
- `lib/ai/providers/openai.ts` ahora detectado como archivo muerto (no importado desde `provider.ts` — Nvidia/NVIDIA provider lo sustituyó en el flujo Pro)
- `openai` y `pdf-lib` como dependencias no usadas (migración a Puppeteer + chromium)
- `loadAdaptationForExport` en `adaptationExport.ts` — export nuevo sin uso activo

---

### 2. Árbol de archivos (app/api/, lib/ai/, app/components/, lib/)

```
app/api/
  adapt/route.ts
  adaptations/route.ts
  arasaac/search/route.ts
  billing-portal/route.ts
  checkout/route.ts
  export/docx/route.ts
  export/pdf/route.ts          ← Puppeteer + @sparticuz/chromium (migrado 2026-05-09)
  extract-text/route.ts
  feedback/route.ts            ← nuevo (Sprint E.6)
  style-analysis/route.ts
  user-plan/route.ts
  webhooks/stripe/route.ts

app/components/
  feedback/FeedbackPanel.tsx   ← nuevo (Sprint E.6) — modal slide-up post-descarga

lib/
  adaptationRules.ts
  adaptationsService.ts        ← deuda técnica (exports muertos)
  arasaac.ts                   ← deuda técnica (exports muertos)
  authService.ts
  buildDocumentCss.ts
  document/normalizeDocumentHtml.ts
  export/adaptationExport.ts
  extractDocumentText.ts
  extractPdfText.ts
  pictogramResolver.ts
  rateLimit.ts
  stylesService.ts
  subscriptionService.ts
  supabaseClient.ts

lib/ai/
  documentAnalysis.ts
  model.ts
  parseModelResponse.ts
  provider.ts
  providers/gemini.ts
  providers/nvidia.ts          ← nuevo proveedor (NVIDIA/Llama)
  providers/openai.ts          ← archivo muerto (sustituido por nvidia.ts en Pro)
  systemPrompts.ts
```

---

### 3. Prompt de adaptación completo (buildPrompt + buildNvidiaPrompt en app/api/adapt/route.ts)

```
DOCUMENTO ORIGINAL
${sourceText}

CONFIGURACIÓN
Perfil: ${learningProfile} | Nivel: ${adaptationLevel} | Apoyo: ${supportLevel}
${studentInterests?.length ? `Intereses (solo para ejemplos): ${interests.join(", ")}` : ""}

REGLAS PEDAGÓGICAS OBLIGATORIAS
${rulesText}

${subjectRulesText}

${interestsBlock}

═══════════════════════════════════════════════
SISTEMA DE PICTOGRAMAS — MODO [TARJETA|INLINE]
═══════════════════════════════════════════════

[Si apoyo ALTO — MODO TARJETA]:
  <div class="aa-picto-card"><img class="aa-picto-img" src="URL" alt="palabra"><span class="aa-picto-word">palabra</span></div>
  <div class="aa-picto-row">[tarjetas]</div>

[Si apoyo bajo/medio — MODO INLINE]:
  <img class="aa-picto-inline" src="URL_ARASAAC" alt="palabra">

PICTOGRAMAS DISPONIBLES (usa SOLO estos):
${pictogramSuggestions}

NO uses pictograma si la palabra no está en la lista.
NO pongas pictogramas en preguntas (¿...?) ni en palabras abstractas.

═══════════════════════════════════════════════
ESPACIOS DE ESCRITURA
═══════════════════════════════════════════════

LÍNEA SIMPLE:     <div class="aa-ruled-line"></div>
CAJA PAUTA:       <div class="aa-ruled-box"></div>
CAJA GRANDE:      <div class="aa-ruled-box aa-ruled-box--large"></div>
INICIO DADO:      <div class="aa-ruled-box"><span class="aa-starter">Texto...</span></div>
VERDADERO/FALSO:  <div class="aa-vf-item">...</div>
TABLA:            <table class="aa-table"><tr><td class="aa-cell-label">...</td><td class="aa-cell-ruled"></td></tr></table>
EJEMPLO RESUELTO: <div class="aa-example">...</div>
[Si TDAH] CASILLA: <div class="aa-done-row"><span class="aa-checkbox"></span><span>He terminado ✓</span></div>

═══════════════════════════════════════════════
ELEMENTOS VISUALES
═══════════════════════════════════════════════

CONCEPTO:         <div class="aa-concept-box"><span class="aa-concept-label">...</span><span class="aa-concept-def">...</span></div>
SECUENCIA:        <div class="aa-flow"><div class="aa-flow-step">...</div><div class="aa-flow-arrow">↓</div>...</div>
CAUSA→EFECTO:     <div class="aa-cause-effect"><div class="aa-cause">...</div><div class="aa-effect-arrow">→</div><div class="aa-effect">...</div></div>
GLOSARIO:         <div class="aa-glossary-item"><span class="aa-gloss-term">...</span><span class="aa-gloss-def">...</span></div>
AVISO:            <div class="aa-highlight-box"><span class="aa-highlight-icon">💡</span><p>...</p></div>

═══════════════════════════════════════════════
ESTRUCTURA DEL DOCUMENTO — SIN <style>
═══════════════════════════════════════════════

<div class="aa-page">
  <div class="aa-header"><h1>Título</h1><div class="aa-meta">Documento adaptado · AdaptAula</div></div>
  <div class="aa-body">
    <div class="aa-block aa-reading-block" data-block="lectura-1">
      <span class="aa-subtitle">...</span>
      <p>...</p>
      [Si alto: <div class="aa-picto-row">...</div>]
    </div>
    <hr class="aa-separator">
    <h2 class="aa-section-title">Actividades</h2>
    <div class="aa-block aa-activity" data-block="actividad-1">
      <div class="aa-activity-number">Actividad 1</div>
      <p class="aa-instruction">...</p>
    </div>
  </div>
</div>

OBLIGATORIO:
- ADAPTA absolutamente TODAS las actividades. Ninguna puede faltar.
- NO incluyas ningún bloque <style>
- Devuelve SOLO el objeto JSON: { documentHtml, adaptation_decisions, teacherNotes }
[Si secundaria]: Mantén el rigor curricular completo. Adapta el ACCESO, nunca el CONTENIDO.

buildNvidiaPrompt(): igual que buildPrompt() + mandato JSON explícito al inicio
  ("Your response must start with { and end with }") + bloque REQUIRED JSON OUTPUT FORMAT
  con reglas de escape críticas para Llama (\\" para comillas, \\n para saltos).
```

---

### 4. package.json (dependencies y devDependencies)

```json
{
  "dependencies": {
    "@sparticuz/chromium": "^123.0.0",
    "@supabase/ssr": "^0.6.1",
    "@supabase/supabase-js": "^2.100.0",
    "docx": "^9.6.1",
    "mammoth": "^1.12.0",
    "next": "16.2.1",
    "openai": "^6.34.0",
    "pdf-lib": "^1.17.1",
    "puppeteer-core": "^22.0.0",
    "react": "19.2.4",
    "react-dom": "19.2.4",
    "stripe": "^22.0.1",
    "unpdf": "^1.4.0"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4",
    "@types/node": "^20",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "eslint": "^9",
    "eslint-config-next": "16.2.1",
    "knip": "^6.4.1",
    "tailwindcss": "^4",
    "typescript": "^5"
  }
}
```

**Nota**: `openai` y `pdf-lib` marcadas como unused por knip. `openai` está en package.json pero `lib/ai/providers/openai.ts` no se importa desde `provider.ts` (el proveedor Pro actual es `nvidia.ts`). Candidatas a limpiar en Sprint E.4.
