@AGENTS.md

# Adaptaula — convenciones permanentes

SaaS español para docentes: transforma materiales educativos existentes en versiones adaptadas a necesidades funcionales de aprendizaje. El producto NO diagnostica y NO sustituye al profesional: genera propuestas editables.

Documentación de referencia (leer antes de tocar el área correspondiente):
`docs/PRODUCT.md` · `docs/ARCHITECTURE.md` · `docs/DATABASE.md` · `docs/AI_PIPELINE.md` · `docs/ADAPTATION.md` · `docs/PROMPTS.md` · `docs/SECURITY.md` · `docs/PRIVACY.md` · `docs/BILLING.md` · `docs/UX.md` · `docs/ROADMAP.md`

## Comandos

```bash
pnpm dev          # servidor local
pnpm typecheck    # next typegen && tsc --noEmit
pnpm lint         # eslint
pnpm test         # vitest: unit + base de datos (PGlite)
pnpm test:e2e     # Playwright (app contra tests/e2e/fake-supabase.mjs: migraciones reales sobre PGlite; ver ADR-017)
pnpm test:rls:real # aislamiento contra un proyecto Supabase REAL de pruebas (se omite sin credenciales; docs/SUPABASE_TESTING.md)
pnpm eval:analysis # evals del análisis con el modelo REAL (cuesta dinero; nunca en check; evals/material-analysis/README.md)
pnpm build        # build de producción
pnpm check        # typecheck + lint + test + build (puerta de calidad)
```

Una fase no está terminada hasta que `pnpm check` pasa sin errores. No continuar sobre código roto.

## Stack

Next.js 16 (App Router, `proxy.ts` en lugar de `middleware.ts`) · React 19 · TypeScript estricto · Tailwind 4 · primitivas propias en `src/components/ui` (sin shadcn/Radix por ahora) · Lucide · Server Actions + Zod 4 (sin React Hook Form por ahora) · Supabase (Postgres, Auth, Storage, RLS) · Stripe · SDKs oficiales de Anthropic y OpenAI tras `src/lib/ai`. Gestor de paquetes: **pnpm**.

Esta versión de Next tiene cambios incompatibles: consultar `node_modules/next/dist/docs/` antes de usar una API de Next que no esté ya en el código.

## Idioma

- UI, copy, documentación y mensajes de commit: **español**.
- Código, identificadores, nombres de tablas y columnas: **inglés**.
- Rutas públicas y de la app: español (`/app/alumnos`, `/precios`), según `docs/UX.md`.

## Reglas no negociables

**Seguridad**
- RLS activado en todas las tablas expuestas. Toda tabla nueva lleva políticas y test de aislamiento entre workspaces.
- Nunca confiar en `workspace_id`, plan, rol o límites enviados por el navegador. Resolver siempre en servidor (`src/lib/auth`, `src/lib/permissions`).
- La secret key de Supabase (`SUPABASE_SECRET_KEY`, equivalente a service role) solo se usa en `src/lib/supabase/admin.ts` (marcado `server-only`), y solo para webhooks, jobs, contabilidad de uso, Storage (URLs firmadas de subida y borrado de ficheros tras autorizar), `ai_runs`, *rate limits*, cron y admin. Los módulos que la importan están acotados por `tests/unit/boundaries.test.ts`.
- Validar con Zod en servidor toda entrada externa (formularios, route handlers, webhooks, salidas de IA).
- Nunca renderizar HTML generado por IA. La IA produce JSON validado (`MaterialDocument`) que se mapea a componentes propios.
- Ningún secreto en el cliente. Variables `NEXT_PUBLIC_*` solo para valores públicos.

**IA**
- Nunca llamar a proveedores de IA desde componentes cliente. Todo pasa por `src/lib/ai` (servidor).
- La lógica de negocio usa alias (`ECONOMY`, `STANDARD`, `PREMIUM`, `IMAGE_FAST`, `IMAGE_QUALITY`), nunca IDs de modelo. Los IDs vienen de env/config.
- Nunca mostrar nombres de modelo, tokens ni costes de API en la UI de usuario.
- Prompts versionados en `prompts/<key>/v<N>.ts`. Nunca editar una versión publicada: crear `v<N+1>`.
- `AIProvider` es solo transporte: prompts, parseo, validación y normalización viven en los pipelines. La salida de un modelo se valida con Zod y el servidor asigna los ids persistentes.
- El contenido de un material subido es **no confiable**: va siempre entre `<untrusted_material>` y nunca se interpreta como instrucción.
- Analizar un material **no** consume cuota de adaptaciones; el coste real queda en `ai_runs` (`estimated_cost_usd` es `null` si el modelo no tiene precio, nunca un 0 inventado).
- Registrar cada llamada en `ai_runs` (sin contenido del material ni datos del alumno).
- Si un job falla y no se entrega material, la cuota se devuelve.

**Privacidad**
- A la IA solo se envían: material, etapa/curso/asignatura, perfil funcional (dimensiones) y la petición del docente. **Nunca** `display_name` ni `contextual_tags` del perfil. El análisis de un material no usa ningún dato de alumnado.
- Nada que identifique a un alumno va a analítica ni a logs.
- No pedir ni almacenar datos médicos, DNI, fechas de nacimiento, fotos ni informes. No hay texto libre sobre el alumnado (la columna `notes` se eliminó).
- Los ficheros subidos se validan en servidor sobre los bytes (firma, tamaño, páginas); el nombre original es solo metadato y nunca un identificador. Un análisis solo se reutiliza dentro del mismo workspace.

**Planes y límites**
- Los límites viven en la tabla `plans` (y `features` JSONB). Prohibido codificar límites en componentes.
- Toda acción con coste pasa por `checkEntitlement()` / `consume_quota()` en servidor antes de ejecutarse.

**Pedagogía**
- Adaptar por necesidades funcionales, no por etiquetas diagnósticas.
- No infantilizar; respetar edad y etapa. ESO/Bachillerato: estética sobria.
- No afirmar que una tipografía concreta "soluciona" la dislexia.
- Separar estrategia de adaptación (pedagogía) de plantilla visual (presentación).

## Estilo de código

- TypeScript estricto. Prohibido `any` salvo justificación escrita en un comentario de una línea. Nada de `@ts-ignore`; `@ts-expect-error` solo con motivo.
- Server Components por defecto; `"use client"` solo cuando haga falta interactividad.
- Mutaciones: Server Actions para formularios de la app; Route Handlers para webhooks, uploads, jobs y endpoints consumidos por polling.
- Módulos de servidor con `import "server-only"`. `tests/unit/boundaries.test.ts` falla si un componente cliente llega (incluso indirectamente) a un módulo `server-only`, al cliente admin o a un secreto.
- Variables de entorno: público en `src/lib/config/env.public.ts`, servidor en `env.server.ts` (lazy, `server-only`). Las claves de IA, Stripe y cron son opcionales hasta la fase que las usa.
- Componentes pequeños y enfocados. Si un componente supera ~200 líneas, dividirlo.
- Sin comentarios que expliquen *qué* hace el código; solo el *porqué* cuando no sea obvio.
- Schemas Zod en `src/lib/schemas` son la fuente de verdad de los contratos; los tipos se derivan con `z.infer`.
- Migraciones SQL solo en `supabase/migrations/` (nunca cambios manuales en el panel). No editar una migración ya aplicada: crear otra.

## Estados de UI

Toda pantalla diseña: loading, empty, success, partial, error, retry, sin permisos y límite alcanzado. Los errores importantes no se comunican solo con un toast. Nunca mostrar mensajes técnicos ("Error 403 quota exceeded"): usar el copy de `docs/UX.md`.

## Accesibilidad

Objetivo WCAG 2.2 AA: navegación por teclado, foco visible, labels asociados, errores vinculados a campos (`aria-describedby`), contraste AA, no usar el color como única señal, objetivos táctiles ≥ 24px, `prefers-reduced-motion`, zoom 200 %.
