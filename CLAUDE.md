@AGENTS.md

---

# AUDITORÍA TÉCNICA — AdaptAula
**Fecha**: 2026-04-16 | **Build**: ✅ limpio (14 rutas) | **Fuente**: inspección directa del código

---

## 1. RESUMEN EJECUTIVO

AdaptAula es una Next.js 16 SPA con 5 pantallas en máquina de estados, motor de adaptación pedagógica sobre Gemini 2.5 Flash, integración ARASAAC para pictogramas, y auth/DB en Supabase. El flujo principal funciona de extremo a extremo. Hay tres zonas de riesgo crítico para las próximas fases: (1) **el middleware de protección de rutas no está activo** (`proxy.ts` nunca se carga), (2) **el paywall es 100% UI mockup sin backend** (sin Stripe ni columna de plan en DB), (3) **Gemini está acoplado en dos lugares** en el route de adapt con lógica duplicada.

---

## 2. MAPA DE ARQUITECTURA REAL

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
├── history/page.tsx        ← adaptations table, filtros perfil+fecha, modal iframe
├── history/error.tsx       ← error boundary específico
├── error.tsx               ← error boundary raíz
├── styles/page.tsx         ← IMPLEMENTADO (~600 líneas), usa stylesService.ts
│                              (no es esqueleto — gestión completa de estilos)
├── admin/feedback/page.tsx ← redirect a /internal/feedback
├── internal/feedback/page.tsx ← SSR, requiere INTERNAL_FEEDBACK_ALLOWED_EMAILS
│
├── api/
│   ├── adapt/route.ts      ← MOTOR: SSE stream + fallback, rate limit, CSS server-side
│   ├── extract-text/       ← PDF (unpdf) + DOCX (mammoth), sin auth, 10MB límite
│   ├── style-analysis/     ← Gemini T=0.2, REQUIERE auth, timeout 45s
│   ├── export/docx/        ← docx lib, pictogramas incrustados, REQUIERE auth
│   ├── export/pdf/         ← pdf-lib, paginación manual, NO requiere auth
│   └── arasaac/search/     ← proxy API pública, sin auth, no cache persistente
│
components/
├── screens/                ← 5 pantallas SPA (ver arriba)
├── ui/Toast.tsx            ← Context + useReducer, 4 variantes, auto-dismiss 4s
├── ErrorBoundary.tsx       ← class component, prop onError para toast
├── AuthNavButton.tsx       ← detecta sesión, login/logout
├── BrandLogo.tsx           ← SVG logo
└── workspace/
    ├── DocumentCanvas.tsx  ← iframe viewer (sin importadores activos)
    └── GenerationCompanion.tsx ← UI generación (sin importadores activos)

lib/
├── adaptationRules.ts      ← tipos + reglas pedagógicas (fuente de verdad)
├── ai/
│   ├── model.ts            ← GEMINI_MODEL = env || "gemini-2.5-flash"
│   └── systemPrompts.ts    ← 6 system prompts por perfil NEE
├── buildDocumentCss.ts     ← CSS dinámico server-side
├── pictogramResolver.ts    ← ARASAAC batching, blacklist matemática
├── rateLimit.ts            ← Map in-memory, ventana 60s
├── authService.ts          ← wrapper Supabase Auth
├── supabaseClient.ts       ← createBrowserClient
├── adaptationsService.ts   ← CRUD tabla adaptations
├── arasaac.ts              ← utilidades avanzadas (enrichDocument, merge)
├── stylesService.ts        ← CRUD tabla user_styles, análisis
├── styleContextService.ts  ← contexto de estilo activo
├── adaptationFeedbackService.ts ← ratings tabla adaptation_feedback
├── approvedExamplesService.ts   ← tabla approved_adaptation_examples
├── documentTemplatesService.ts  ← tabla document_templates
├── export/adaptationExport.ts   ← parseo + serialización para export
├── extractDocumentText.ts  ← wrapper (llama a extract-text API)
├── extractPdfText.ts       ← unpdf directo (usado en api/extract-text)
├── mock-data.ts            ← arrays de opciones UI — SIN IMPORTADORES ACTIVOS
│                              (huérfano, puede eliminarse con knip)
├── document-format.ts      ← applyOutputFormatTemplate (legacy workspace)
├── document-structure.ts   ← analyzeDocumentStructure (legacy workspace)
└── [más servicios de workspace legacy]

proxy.ts                    ← CÓDIGO CORRECTO pero NUNCA SE EJECUTA
                               (no hay middleware.ts → protección de rutas INACTIVA)
src/app/page.tsx            ← landing page estática huérfana (no afecta rutas Next.js)
```

---

## 3. TABLA DE ESTADO REAL

| Feature | Estado | Notas |
|---------|--------|-------|
| SPA Upload→Config→Generate→Result | **IMPLEMENTADO** | Flujo completo funciona |
| Streaming SSE Gemini | **IMPLEMENTADO** | `streamGenerateContent?alt=sse` + fallback |
| Progreso real barra generación | **IMPLEMENTADO** | 0-95% basado en chars, 100% al finalizar |
| Rate limiting /api/adapt | **IMPLEMENTADO** | 5 anon / 20 auth por minuto, in-memory |
| Metadata SEO | **IMPLEMENTADO** | title, og, twitter, lang="es" |
| Error boundaries | **IMPLEMENTADO** | raíz + /history + screens ConfigScreen/ResultScreen |
| Toast system | **IMPLEMENTADO** | 4 variantes, Context, auto-dismiss |
| Accesibilidad ConfigScreen | **IMPLEMENTADO** | role=radiogroup, aria-checked, labels |
| Export PDF | **IMPLEMENTADO** | print dialog via iframe oculto (no pdf-lib real) |
| Export DOCX | **IMPLEMENTADO** | docx lib, pictogramas incrustados, requiere auth |
| Auth email/password | **IMPLEMENTADO** | Supabase, confirmation email |
| Historial /history | **IMPLEMENTADO** | filtros, modal iframe, empty state SVG |
| Gestión estilos /styles | **IMPLEMENTADO** | ~600 líneas, stylesService CRUD completo |
| Análisis estilo docente | **IMPLEMENTADO** | Gemini T=0.2, guarda en style_analyses |
| **Middleware protección rutas** | **🔴 ROTO** | proxy.ts existe pero NO hay middleware.ts → todas las rutas "protegidas" accesibles sin login |
| **Paywall / Suscripciones** | **🔴 MOCKUP** | SubscriptionScreen es UI sin backend, sin Stripe, sin columna plan en DB |
| **DOCX export sin auth** | **PARCIAL** | Requiere auth ✓, pero no verifica plan de usuario |
| Rate limit sin persistencia | **PARCIAL** | Map en memoria, se pierde en deploy/cold start |
| Gestión estilos en SPA principal | **NO CONECTADO** | /styles existe pero SPA no navega ahí |
| mock-data.ts | **LEGACY** | Sin importadores activos, candidato a eliminar |
| document-format.ts / document-structure.ts | **LEGACY** | Usados solo en workspace (eliminado), sin importadores activos |
| components/workspace/ | **LEGACY** | DocumentCanvas + GenerationCompanion sin importadores |
| src/app/page.tsx | **LEGACY** | Landing estática huérfana, no afecta build pero confunde |
| Pictogramas con cache persistente | **NO IMPLEMENTADO** | Cada request consulta ARASAAC desde cero |
| Tests (unit / e2e) | **NO IMPLEMENTADO** | Cero cobertura |
| i18n | **NO IMPLEMENTADO** | Hardcoded español |
| Stripe / pago real | **NO IMPLEMENTADO** | Sólo UI mockup |

---

## 4. CONTRADICCIONES ENTRE CÓDIGO Y CLAUDE.md ANTERIOR

| Afirmación en CLAUDE.md | Realidad en código |
|--------------------------|-------------------|
| `/history` "esqueleto vacío (sin implementación)" | **FALSO** — historia completa con filtros, modal y estado vacío SVG, 500+ líneas |
| `/styles` "esqueleto vacío" | **FALSO** — página completa ~600 líneas con CRUD stylesService |
| "Rutas incompletas /adapt, /workspace" borradas | **CORRECTO** — eliminadas en sprint 2 |
| "Rate limiting aceptable para MVP" | Correcto pero omite que el Map se resetea en CADA deploy (Vercel serverless → cold starts frecuentes) |
| "Auth middleware Supabase" | **INCOMPLETO** — proxy.ts tiene la lógica correcta pero NUNCA SE EJECUTA porque no hay middleware.ts |
| "PDF via pdf-lib" | **INCORRECTO** — export PDF usa print dialog via iframe oculto (no pdf-lib). pdf-lib está en package.json sin uso activo aparente |
| GEMINI_MODEL "abstraído en lib/ai/model.ts" | **PARCIAL** — model.ts existe pero route.ts duplica `process.env.GEMINI_MODEL || "gemini-2.5-flash"` en dos funciones (callGemini y streamGemini) sin importar model.ts |

---

## 5. DEUDA TÉCNICA PRIORIZADA

### 🔴 CRÍTICA (bloquea producción segura)

1. **middleware.ts no existe** → `proxy.ts` está huérfano, ninguna ruta está realmente protegida. Un usuario sin sesión puede acceder directamente a `/history`, `/styles`, `/admin`, `/internal`. Las páginas tienen redirects client-side (getCurrentUser en useEffect) pero el middleware server-side no existe.
   - Archivos: `proxy.ts` → renombrar/convertir a `middleware.ts` con `export default` + `export { config }`

2. **Paywall sin backend** → `SubscriptionScreen` redirige users no-auth al checkout, pero no hay: tabla `subscriptions` en Supabase, verificación de plan en los endpoints, ni integración Stripe. El gating actual es solo "tiene sesión = puede exportar DOCX" lo cual no es modelo de negocio.
   - Archivos: `components/screens/SubscriptionScreen.tsx`, `app/api/export/docx/route.ts`, nuevo `lib/subscriptionService.ts`

3. **GEMINI_MODEL duplicado en route.ts** → Si se quiere cambiar de proveedor, hay que tocar múltiples lugares. El `model.ts` existe pero no se importa en `route.ts`.
   - Archivo: `app/api/adapt/route.ts` líneas 85 y 130

### 🟠 ALTA (afecta estabilidad o escalabilidad)

4. **Rate limiting en memoria** → Se resetea en cada cold start de Vercel. En producción con tráfico real, usuarios pueden hacer burst de requests tras cada deploy. Para producción real necesita Redis/Upstash o tabla Supabase.
   - Archivo: `lib/rateLimit.ts`

5. **/api/export/pdf no usa auth** → Cualquier usuario (sin sesión) puede llamar a `/api/export/pdf` con cualquier HTML y generar PDFs. No hay verificación de origen ni de plan.
   - Archivo: `app/api/export/pdf/route.ts`

6. **Acoplamiento Gemini en route.ts** → Todo el código de llamada a Gemini (streamGemini, callGemini, building prompts, parsing) está en un único archivo de 600 líneas. Para soportar múltiples providers hay que extraer a `lib/ai/`.
   - Archivo: `app/api/adapt/route.ts`

7. **src/app/page.tsx** → Existe una landing estática en `src/app/` que TypeScript checkea (incluido en tsconfig `**/*.tsx`) pero Next.js no enruta. No causa errores pero confunde. Si algún día se añade `srcDir: 'src'` en next.config.ts, crearía conflicto de ruta con `/`.

### 🟡 MEDIA (UX o mantenimiento)

8. **mock-data.ts sin importadores** → Arrays de opciones de UI (workOptions, adaptationTypes, studentProfiles, outputFormats) sin ningún archivo que los importe. Candidato directo a `knip`.

9. **components/workspace/ sin importadores** → DocumentCanvas + GenerationCompanion huérfanos tras borrar rutas legacy.

10. **document-format.ts / document-structure.ts** → Usados solo por workspace (eliminado). Misma situación.

11. **lib/approvedExamplesService.ts + lib/documentTemplatesService.ts** → Solo eran usados por workspace legacy. Verificar si /styles los usa antes de eliminar.

12. **css injectAndStripStyles en page.tsx** → Manipulación DOM directa para inyectar `<style>` (línea 57-67). Funciona pero es frágil y difícil de testear. El CSS server-side ya viene en el HTML — este código puede no ser necesario.

13. **Progreso SSE: estimación basada en chars** → `ESTIMATED_CHARS = 5000`. Si la respuesta real es <2500 chars, el progreso llega a ~50% y salta a 100%. Funciona pero la UX es inconsistente. Mejor: streaming real de tokens o un fake smooth linear.

### 🟢 BAJA (limpieza)

14. **pdf-lib en package.json sin uso** → `pdf-lib: 1.17.1` instalado, el export PDF usa print dialog. Peso en bundle innecesario.
15. **proxy.ts renaming** → Una vez creado middleware.ts, proxy.ts debe eliminarse.
16. **CLAUDE.md stale** → Este archivo (recién actualizado).

---

## 6. TABLAS SUPABASE INFERIDAS DEL CÓDIGO

```
adaptations
  id uuid PK
  user_id uuid FK → auth.users
  title text
  source_text text
  result_html text
  work_type text
  adaptation_type text
  student_profile text
  with_pictograms bool
  visual_support_level text ('bajo'|'medio'|'alto')
  style_id uuid FK → user_styles
  ai_notes text
  status text ('draft'|'completed')
  version_number int
  parent_adaptation_id uuid FK → adaptations
  is_final bool
  pictogram_concepts text[]
  pictogram_data jsonb
  adapted_content text
  result_text text
  prompt_used text
  style_snapshot jsonb
  template_id uuid FK → document_templates
  template_snapshot jsonb
  used_approved_examples bool
  approved_examples_count int
  approved_example_ids text[]
  generation_variant text
  created_at timestamptz
  updated_at timestamptz

user_styles
  id uuid PK
  user_id uuid FK → auth.users
  name/title text
  [campos de estilo docente]

style_analyses
  id uuid PK
  style_id uuid FK → user_styles
  user_id uuid FK → auth.users
  simplification_level text
  pictogram_usage_level text
  usual_structure text
  instruction_style text
  average_length text
  tone text
  key_observations text
  analysis_json jsonb
  source_excerpt text
  strengths text[]
  improvement_points text[]
  visual_metrics jsonb
  summary text
  show_improvements bool
  created_at timestamptz

adaptation_feedback
  id uuid PK
  adaptation_id uuid FK → adaptations
  user_id uuid FK → auth.users
  rating text
  comment text
  created_at timestamptz

approved_adaptation_examples
  id uuid PK
  adaptation_id uuid FK → adaptations
  user_id uuid FK → auth.users
  output_format text
  student_profile text
  visual_support_level text
  feedback_rating text
  was_approved bool
  created_at timestamptz

document_templates
  id uuid PK
  user_id uuid FK → auth.users
  [campos de template]
  created_at timestamptz

-- FALTA (para suscripciones):
subscriptions
  id uuid PK
  user_id uuid FK → auth.users
  plan text ('free'|'pro'|'teams')
  status text ('active'|'canceled'|'past_due')
  stripe_subscription_id text
  stripe_customer_id text
  current_period_end timestamptz
  created_at timestamptz
```

---

## 7. RECOMENDACIÓN DE SPRINTS

### Sprint A — Estabilización (hacer ANTES de cualquier monetización)

**Objetivo**: Que lo que dice que funciona, realmente funcione de forma segura.

**Archivos a tocar**:
```
proxy.ts                       → renombrar a middleware.ts + export default + export config
app/api/adapt/route.ts         → importar GEMINI_MODEL desde lib/ai/model.ts (x2)
app/api/export/pdf/route.ts    → añadir auth check (bearer token)
lib/rateLimit.ts               → documentar claramente limitación cold start
knip (npm run knip)            → eliminar: mock-data.ts, document-format.ts,
                                  document-structure.ts, components/workspace/,
                                  src/app/page.tsx, lib/approvedExamplesService.ts*,
                                  lib/documentTemplatesService.ts*
                                  (* verificar primero si /styles los usa)
CLAUDE.md                      → este archivo (actualizar tras sprint)
```

**KPIs de éxito**:
- Rutas `/history`, `/styles`, `/admin` redirigen a login sin sesión (middleware activo)
- `/api/export/pdf` devuelve 401 sin token
- `npm run knip` → 0 findings

### Sprint B — Suscripciones

**Objetivo**: Paywall real con Stripe. Free tier limitado, Pro ilimitado.

**Modelo mínimo viable** (ver sección 8):
- Free: 3 adaptaciones/mes, solo PDF, sin pictogramas
- Pro (9,99€/mes): ilimitado, DOCX, pictogramas, historial

**Archivos a crear/tocar**:
```
lib/subscriptionService.ts     → NUEVO: checkUserPlan(userId), getPlanFromDB()
app/api/webhooks/stripe/       → NUEVO: route.ts (webhook Stripe → update subscriptions)
app/api/checkout/              → NUEVO: route.ts (crear Stripe checkout session)
app/api/adapt/route.ts         → añadir checkUserPlan() antes del stream
app/api/export/docx/route.ts   → añadir checkUserPlan()
app/api/export/pdf/route.ts    → añadir checkUserPlan() para plan free
components/screens/SubscriptionScreen.tsx → conectar botón "Suscribirse" a /api/checkout
supabase/                      → migración: tabla subscriptions
.env.local                     → STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRO_PRICE_ID
package.json                   → añadir stripe sdk
```

**Lógica de gating**:
```typescript
// lib/subscriptionService.ts
type Plan = 'free' | 'pro' | 'teams';

async function getUserPlan(userId: string): Promise<Plan> {
  const { data } = await supabase
    .from('subscriptions')
    .select('plan, status, current_period_end')
    .eq('user_id', userId)
    .eq('status', 'active')
    .maybeSingle();
  if (!data || new Date(data.current_period_end) < new Date()) return 'free';
  return data.plan as Plan;
}
```

**KPIs de éxito**:
- Botón "Suscribirse" abre Stripe checkout
- Webhook actualiza tabla subscriptions
- /api/adapt devuelve 402 tras 3 adaptaciones si plan=free (leer de DB, no rateLimit)
- DOCX export solo disponible con plan≥pro

### Sprint C — Proveedor IA Premium

**Objetivo**: Soportar modelos premium (GPT-4o, Claude Sonnet) además de Gemini, sin reescribir route.ts.

**Archivos a crear/tocar**:
```
lib/ai/provider.ts             → NUEVO: factory de providers (ver sección 9)
lib/ai/providers/gemini.ts     → NUEVO: extraer streamGemini + callGemini
lib/ai/providers/openai.ts     → NUEVO: implementación OpenAI streaming
lib/ai/providers/anthropic.ts  → NUEVO: implementación Claude Anthropic
app/api/adapt/route.ts         → reemplazar callGemini/streamGemini por getAIProvider()
.env.local                     → OPENAI_API_KEY o ANTHROPIC_API_KEY
supabase/                      → migración: columna preferred_model en subscriptions
                                  (pro puede elegir modelo)
```

---

## 8. PROPUESTA MODELO DE SUSCRIPCIÓN

### Planes

| Feature | Free | Pro (9,99€/mes) | Teams (precio a medida) |
|---------|------|-----------------|------------------------|
| Adaptaciones/mes | 3 | Ilimitadas | Ilimitadas |
| Pictogramas ARASAAC | ❌ | ✅ | ✅ |
| Export PDF | ✅ | ✅ | ✅ |
| Export DOCX | ❌ | ✅ | ✅ |
| Historial | ❌ (solo sesión) | ✅ (guardado) | ✅ |
| Análisis de estilo | ❌ | ✅ | ✅ |
| Modelo IA | Gemini Flash | Gemini Pro / GPT-4o | Modelo configurable |
| Soporte | - | Email | 24/7 dedicado |

### Columnas afectadas en código actual

```
Cambios mínimos:
- /api/adapt: añadir plan check → sin pictogramas si free, contar adaptaciones mes
- /api/export/docx: ya tiene auth check, añadir plan≥pro
- /api/export/pdf: añadir auth check + plan (gratis: PDF siempre ok)
- /history page: redirigir con "upgrade" si plan=free
```

### Conteo de uso mensual (free tier)

Supabase query:
```sql
SELECT COUNT(*) FROM adaptations
WHERE user_id = $1
  AND created_at >= date_trunc('month', now())
```

---

## 9. ABSTRACCIÓN MULTI-PROVEEDOR IA

### Interfaz mínima

```typescript
// lib/ai/provider.ts

export interface AIStreamEvent {
  type: 'delta';
  progress: number;
}

export interface AIProvider {
  stream(
    systemPrompt: string,
    userPrompt: string,
    onProgress: (chars: number) => void,
  ): Promise<Record<string, unknown>>;
  generate(
    systemPrompt: string,
    userPrompt: string,
  ): Promise<Record<string, unknown>>;
}

export function getAIProvider(model?: string): AIProvider {
  const m = model ?? process.env.AI_MODEL ?? 'gemini-2.5-flash';
  if (m.startsWith('gpt-')) return new OpenAIProvider(m);
  if (m.startsWith('claude-')) return new AnthropicProvider(m);
  return new GeminiProvider(m); // default
}
```

### Cambio en route.ts

```typescript
// Antes (acoplado):
raw = await streamGemini(userPrompt, systemPrompt, onProgress);

// Después (abstracto):
const ai = getAIProvider(process.env.AI_MODEL);
raw = await ai.stream(systemPrompt, userPrompt, onProgress);
```

### Archivos a crear en Sprint C

```
lib/ai/provider.ts          → interfaz AIProvider + getAIProvider factory
lib/ai/providers/gemini.ts  → extraer streamGemini + callGemini de route.ts
lib/ai/providers/openai.ts  → OpenAI chat completions streaming
lib/ai/providers/anthropic.ts → Claude messages streaming
```

**Output esperado**: Cambiar de Gemini a GPT-4o solo requiere `AI_MODEL=gpt-4o` en env, sin tocar route.ts.

---

## 10. VARIABLES DE ENTORNO

```env
# Requeridas hoy
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash    # opcional

# Sprint B (suscripciones)
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRO_PRICE_ID=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=

# Sprint C (multi-IA)
AI_MODEL=gemini-2.5-flash        # o gpt-4o, claude-sonnet-4-6
OPENAI_API_KEY=                  # si AI_MODEL empieza por gpt-
ANTHROPIC_API_KEY=               # si AI_MODEL empieza por claude-

# Interno
NEXT_PUBLIC_SITE_URL=https://adaptaula.com
INTERNAL_FEEDBACK_ALLOWED_EMAILS=email1@,email2@
```

---

## 11. ESTADO DEL BUILD (2026-04-16)

```
✅ npm run build → LIMPIO, sin errores TypeScript
Rutas activas: 14
  ○ / (SPA)
  ○ /admin/feedback
  ƒ /api/adapt (streaming SSE)
  ƒ /api/arasaac/search
  ƒ /api/export/docx
  ƒ /api/export/pdf
  ƒ /api/extract-text
  ƒ /api/style-analysis
  ○ /history
  ƒ /internal/feedback
  ○ /login
  ○ /styles
  ƒ Proxy (Middleware)   ← ENGAÑOSO: proxy.ts existe pero no hay middleware.ts activo
```

---

## OPTIMIZACIONES ACUMULADAS (para referencia)

- `adapt/route.ts` v5: CSS server-side (−550 tokens), Promise.all auth+pictogramas, system prompts por perfil NEE (caché Gemini), streaming SSE
- `style-analysis/route.ts`: console.log eliminados, responseMimeType json, temperature 0.2
- Rate limit in-memory: 5 anon / 20 auth / 60s
- build: 14.3s, 14 rutas (4 legacy eliminadas)
