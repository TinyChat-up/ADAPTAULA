@AGENTS.md

---

# AUDITORÍA COMPLETA — AdaptAula (2026-04-15)

## Resumen ejecutivo

**AdaptAula** es una aplicación Next.js full-stack que adapta materiales educativos en español para alumnos con Necesidades Educativas Especiales (NEE). Usa Google Gemini 2.5 Flash con prompts pedagógicos por perfil, pictogramas ARASAAC gratuitos, y exportación PDF/DOCX. Auth y DB vía Supabase.

---

## Stack técnico

| Capa | Tecnología | Versión |
|------|-----------|---------|
| Framework | Next.js | 16.2.1 |
| UI | React | 19.2.4 |
| Tipado | TypeScript | 5 |
| CSS | Tailwind CSS | 4 (PostCSS) |
| Auth + DB | Supabase | 2.100.0 |
| IA | Google Gemini | 2.5 Flash |
| Pictogramas | ARASAAC API | pública, gratis |
| Extracción PDF | unpdf | 1.4.0 |
| Extracción DOCX | mammoth | 1.12.0 |
| Generación DOCX | docx | 9.6.1 |

---

## Flujo principal de usuario

```
/ (page.tsx SPA)
  └─ upload     → ConfigScreen → GeneratingScreen → ResultScreen → SubscriptionScreen
```

El usuario sube un PDF/DOCX o pega texto → configura perfil NEE + asignatura + nivel de apoyo + intereses → Gemini genera HTML adaptado + notas docente → se puede exportar PDF (print) o DOCX (requiere auth).

---

## Rutas y páginas

### Activas
| Ruta | Descripción |
|------|-------------|
| `/` | SPA principal (upload → config → generate → result) |
| `/login` | Auth email/password con Supabase |

### Incompletas / legacy
| Ruta | Estado |
|------|--------|
| `/upload`, `/result` | Interfaces alternativas sin integrar |
| `/adapt`, `/workspace` | Versiones antiguas de la interfaz |
| `/history` | Esqueleto vacío (sin implementación) |
| `/styles` | Esqueleto vacío (gestión de estilos pendiente) |
| `/admin/feedback`, `/internal/feedback` | Sin integración completa |

---

## API routes

| Ruta | Auth | Descripción |
|------|------|-------------|
| `POST /api/adapt` | Opcional | Core: llama a Gemini, inyecta CSS server-side, resuelve pictogramas |
| `POST /api/extract-text` | No | Extrae texto de PDF/DOCX (unpdf + mammoth) |
| `POST /api/style-analysis` | Requerida | Analiza estilo docente vía Gemini, guarda en `style_analyses` |
| `POST /api/export/docx` | Requerida | Genera .docx con pictogramas incrustados |
| `POST /api/export/pdf` | No | Print dialog vía iframe oculto |
| `GET /api/arasaac/search` | No | Proxy hacia API ARASAAC |

---

## Perfiles NEE implementados (6)

| ID | Nombre | Referencia pedagógica |
|----|--------|----------------------|
| `tea` | TEA (Autismo) | TEACCH, lenguaje literal, max 8 palabras/frase |
| `tel` | TEL | Morfosintaxis simple, max 8-10 palabras |
| `dislexia` | Dislexia | BDA Style Guide 2023, 65 chars/línea |
| `di` | Discapacidad Intelectual | UNE 153101:2018 EX (Lectura Fácil) |
| `tdah` | TDAH | Marcadores de tarea, chunking visual, autonomía |
| `retraso` | Retraso madurativo | Andamiaje regresivo, enfoque evolutivo |

---

## Componentes principales

### Screens (`/components/screens/`)
- **UploadScreen** — Drag-drop / paste / selector de archivo
- **ConfigScreen** — Perfil, asignatura, nivel de apoyo, intereses
- **GeneratingScreen** — Barra de progreso animada (28s), spinner
- **ResultScreen** — Viewer HTML + acordeón notas docente + botones exportar
- **SubscriptionScreen** — Paywall para DOCX (requiere auth)

### Utilidades UI
- **BrandLogo** — Logo verde/naranja
- **AuthNavButton** — Botón login en navbar
- **DocumentCanvas** — Viewer iframe
- **GenerationCompanion** — UI de estado de generación

---

## Librerías (`/lib/`)

| Archivo | Función |
|---------|---------|
| `adaptationRules.ts` | Tipos, reglas pedagógicas, métricas por perfil/nivel |
| `pictogramResolver.ts` | Búsqueda ARASAAC por lotes (5 a la vez, 150ms delay) |
| `ai/systemPrompts.ts` | Prompts de sistema por perfil (cacheable en Gemini) |
| `ai/model.ts` | Constante `GEMINI_MODEL` |
| `buildDocumentCss.ts` | CSS generado server-side por perfil+nivel |
| `authService.ts` | Wrapper Supabase Auth |
| `supabaseClient.ts` | Browser client |
| `adaptationsService.ts` | CRUD tabla `adaptations` |
| `export/adaptationExport.ts` | Parseo y exportación estructurada |
| `adaptationFeedbackService.ts` | Valoraciones y feedback |
| `styleContextService.ts` | Contexto de estilo docente |
| `extractDocumentText.ts` | Wrapper extracción texto |

---

## Variables de entorno requeridas

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash   # opcional, hay fallback
```

---

## Tablas Supabase (inferidas del código)

```
adaptations       — id, user_id, source_text, result_html, work_type,
                    adaptation_type, student_profile, with_pictograms,
                    style_id, ai_notes, created_at

style_analyses    — id, style_id, user_id, simplification_level,
                    pictogram_usage_level, usual_structure, instruction_style,
                    average_length, tone, key_observations, analysis_json,
                    source_excerpt, strengths[], improvement_points[],
                    visual_metrics (jsonb), summary, show_improvements

user_styles       — id, user_id, name, description, ...
```

---

## Diseño visual (tokens CSS)

```css
--aa-cream:      #FAF7F2   /* fondo principal */
--aa-green:      #7BAF7F   /* acento primario */
--aa-green-dark: #4A7C59   /* variante oscura */
--aa-orange:     #E8834A   /* acento secundario */
--aa-text:       #2C3B2D   /* texto body */
--aa-text-muted: #6B7A6C   /* texto atenuado */
```

**Animaciones CSS**: `aa-dropzone-pulse`, `aa-shimmer`, `aa-progress-fill`, `aa-block-in`

---

## Optimizaciones aplicadas

- `adapt/route.ts` v4→v5: CSS server-side (−550 tokens), Promise.all auth+pictogramas, system prompts por perfil NEE (caché implícita Gemini)
- `adapt/route.ts` v5: `streamGenerateContent?alt=sse` + fallback a `generateContent`
- `style-analysis/route.ts`: console.log eliminados, responseMimeType json, temperature 0.2
- **knip**: ✅ zero findings — 10 archivos + 9 exports eliminados, build 14.3s

---

## Mejoras implementadas

### Sprint 1 — UI/UX alta prioridad (commits 526d737→eee13aa)
- **Metadata SEO**: `layout.tsx` título, descripción, openGraph, twitter card, `lang="es"`
- **Historial `/history`**: rediseño completo tokens AA, filtros perfil+fecha, modal iframe `result_html`, estado vacío SVG
- **Toast system**: `hooks/useToast.ts` + `components/ui/Toast.tsx` (4 variantes, auto-dismiss 4s, `aria-live`)
- **Accesibilidad ConfigScreen**: `role=radiogroup`, `aria-checked`, `aria-describedby`, `htmlFor`+`id`, `.sr-only`

### Sprint 2 — Backend y arquitectura (commits a931e4e→77e7f0b)
- **Streaming Gemini**: SSE `delta`/`done`/`error`, progreso real en barra (elimina fake 28s), fallback automático
- **Rate limiting**: `lib/rateLimit.ts` ventana deslizante 60s (5 anon / 20 auth), headers `X-RateLimit-*`, toast warning 429
- **Error boundaries**: `app/error.tsx`, `app/history/error.tsx`, `components/ErrorBoundary.tsx` con `onError`→toast
- **Limpieza legacy**: eliminados `/upload`, `/result`, `/adapt`, `/workspace` (14 rutas activas)

---

## Estado actual del proyecto

### ✅ Funciona
- Extracción texto PDF/DOCX (10 MB máx)
- Adaptación IA con 6 perfiles NEE
- Pictogramas ARASAAC por lote
- Notas pedagógicas para el docente
- Exportar PDF (print dialog)
- Exportar DOCX (requiere auth)
- Auth email/password Supabase
- Guardado de adaptaciones en DB

### ⚠️ Incompleto
- Historial de adaptaciones (`/history`) — esqueleto sin datos
- Gestión de estilos docentes (`/styles`) — sin implementar
- Integración feedback — páginas admin existen, sin flujo completo
- Soporte ESO — heurística de detección existe, reglas ESO por expandir
- Tests — cero cobertura (no hay Jest/Vitest/Cypress)
- Metadata layout.tsx — todavía dice "Create Next App"

---

## Mejoras UI/UX prioritarias (backlog)

### Alta prioridad
1. **Metadata SEO**: Cambiar título/descripción en `layout.tsx` de "Create Next App" a "AdaptAula"
2. **Estado vacío `/history`**: Implementar lista de adaptaciones guardadas con filtros por perfil/fecha
3. **Toast/feedback de errores**: Actualmente los errores de API no tienen UI de notificación consistente
4. **Loading skeleton ResultScreen**: Mostrar placeholder mientras llega el HTML adaptado
5. **Accesibilidad ConfigScreen**: Labels visibles en selects, no solo placeholders

### Media prioridad
6. **Dark mode**: Variables CSS preparadas, pero no hay toggle ni media query `prefers-color-scheme`
7. **Mobile responsive**: ReviewResultScreen en móvil (iframe full-width, overflow horizontal)
8. **Progress realista**: La barra de `aa-progress-fill` es fake (28s fijos) — conectar a streaming o polling real
9. **Preview pictogramas en ConfigScreen**: Mostrar muestra de pictogramas antes de generar
10. **Onboarding first-time**: Sin estado vacío ni guía para usuario nuevo

### Baja prioridad
11. **Animación de transición entre screens**: Actualmente es corte abrupto
12. **Keyboard navigation**: Verificar tab order y focus visible en todos los screens
13. **Print stylesheet**: El PDF vía print puede perder estilos — revisar `@media print` en `buildDocumentCss.ts`
14. **Internacionalización**: Hardcoded en español, sin soporte i18n futuro
15. **Favicon y PWA**: Sin favicon personalizado, sin manifest

### Backend / arquitectura
16. **Streaming Gemini**: La respuesta espera completion completa — implementar `streamGenerateContent` para UX más rápida
17. **Rate limiting**: Sin throttle en `/api/adapt` — usuario puede hacer llamadas ilimitadas
18. **Tests E2E**: Al menos happy path (upload → adapt → result) con Playwright
19. **Error boundaries React**: Sin `error.tsx` en ninguna ruta
20. **Cleanup páginas legacy**: Eliminar `/adapt`, `/workspace`, `/upload`, `/result` si no se usan

---

## Convenciones de código

- Rutas API: `app/api/[recurso]/route.ts`
- Screens: `components/screens/[Name]Screen.tsx`
- Servicios: `lib/[recurso]Service.ts`
- Tipos compartidos: definidos en `lib/adaptationRules.ts`
- CSS global: `app/globals.css` (variables + animaciones)
- CSS dinámico: `lib/buildDocumentCss.ts` (generado server-side)
- Auth: siempre via `lib/authService.ts`, nunca directo supabase en componentes
