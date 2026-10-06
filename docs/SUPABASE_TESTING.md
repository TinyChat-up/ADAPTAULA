# Pruebas contra un proyecto Supabase real

## Por qué hace falta

La suite local usa un backend de pruebas (`tests/e2e/fake-supabase.mjs`) que ejecuta **las migraciones reales** sobre PGlite (Postgres embebido): RLS, permisos por columna, triggers y funciones SQL son los de verdad. Eso da mucha confianza en el esquema, pero **no prueba** lo que solo hace Supabase: el servicio de Autenticación (GoTrue), el servicio de Storage (políticas, tipos MIME, límites, URLs firmadas), el gateway y la configuración del proyecto. Antes de usar datos reales hay que repetir las pruebas clave contra un proyecto real.

| Capa | Qué demuestra | Estado |
|---|---|---|
| `tests/db` (PGlite + migraciones) | RLS, permisos, límites, cuotas, cola de análisis | verde en cada `pnpm check` |
| E2E contra el backend de pruebas | flujos de interfaz, rutas protegidas, axe, responsive | verde (`pnpm test:e2e`) |
| `tests/rls-real` contra Supabase real | aislamiento entre workspaces, Storage, permisos de funciones | **PENDIENTE de ejecutar** |
| E2E contra Supabase real | flujo completo con Auth y Storage reales | **PENDIENTE de ejecutar** |

Cuando se ejecuten, anota aquí la fecha y el resultado.

## 1. Crear el proyecto de pruebas

1. En <https://supabase.com/dashboard> crea un proyecto **distinto del de producción**: `adaptaula-test`, región **Central EU (Frankfurt)**.
2. Guarda la contraseña de la base de datos (solo la necesitarás si abres un cliente SQL externo).
3. Nunca reutilices este proyecto como staging con datos reales: el script de limpieza borra usuarios de prueba.

## 2. Aplicar las migraciones

```bash
pnpm db:setup-sql        # genera supabase/setup.sql (migraciones 001-012 + seed)
```

Pega el contenido de `supabase/setup.sql` en **SQL Editor → New query → Run**. Se ejecuta en una sola transacción: si algo falla, no se aplica nada. Comprueba:

```sql
-- Todas las tablas de public con RLS activado (debe devolver 0 filas)
select tablename from pg_tables where schemaname = 'public' and not rowsecurity;
-- 3 planes, 3 buckets privados
select slug from public.plans order by sort_order;
select id, public, file_size_limit from storage.buckets;
```

Si aplicas el esquema sobre un proyecto que ya tenía las migraciones anteriores, ejecuta solo los ficheros nuevos de `supabase/migrations/` en orden (008 y 009; para la cuota de análisis, el borrado de `contextual_tags` y la contabilidad de la caché de prompts, además 010, 011 y 012). Las migraciones 010–012 no necesitan volver a ejecutar `seed.sql`: la 010 añade `monthly_analyses` (Free 10 · Pro 100 · Max 250) a los planes que ya existen sin pisar un valor ya configurado.

## 3. Variables

Crea `.env.test.local` (está en `.gitignore`; no lo subas):

```bash
# --- Para la app (E2E) ---
NEXT_PUBLIC_SITE_URL=http://localhost:3100
NEXT_PUBLIC_SUPABASE_URL=https://TU-PROYECTO-TEST.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
SUPABASE_SECRET_KEY=sb_secret_...
# El E2E nunca llama a un proveedor de IA real:
AI_MODEL_STANDARD=mock:default
MOCK_AI_DELAY_MS=400
CRON_SECRET=e2e-cron-secret-0123456789

# --- Para la suite de aislamiento y el script de limpieza ---
SUPABASE_TEST_URL=https://TU-PROYECTO-TEST.supabase.co
SUPABASE_TEST_ANON_KEY=sb_publishable_...
SUPABASE_TEST_SERVICE_KEY=sb_secret_...
SUPABASE_TEST_CONFIRM=este-es-un-proyecto-de-pruebas
```

Las claves están en **Project Settings → API Keys**. `SUPABASE_TEST_CONFIRM` es una salvaguarda deliberada: sin ese valor exacto, la suite y la limpieza se niegan a actuar.

## 4. Autenticación para los E2E

En **Authentication → Providers → Email**:

- Desactiva **Confirm email** (solo en este proyecto): los E2E se registran y entran sin bandeja de entrada.
- En **Authentication → Rate Limits** sube los límites de registros y de emails por hora: la suite crea decenas de usuarios.
- En **Authentication → URL Configuration** añade `http://localhost:3100/**` a las redirect URLs.

## 5. Ejecutar

```bash
# a) Aislamiento entre workspaces, Storage y permisos de funciones (sin navegador)
pnpm test:rls:real

# b) E2E completo: arranca la app contra el proyecto de pruebas y apunta Playwright a ella
set -a; source .env.test.local; set +a
pnpm dev -p 3100 &
E2E_BASE_URL=http://localhost:3100 pnpm test:e2e
```

Si faltan las variables, `pnpm test:rls:real` muestra el aviso **«PRUEBA REAL CONTRA SUPABASE PENDIENTE»** y omite los tests: nunca pasa en silencio.

## 6. Qué verifica y cómo comprobarlo a mano

`tests/rls-real/isolation.test.ts` crea dos usuarios (A y B) y comprueba, con la clave pública y la sesión de cada uno:

- B no ve, modifica ni borra perfiles ni materiales de A, ni crea filas en el workspace de A.
- Un usuario no puede falsear `status`, `analysis`, `content_hash` ni `analysis_meta` de un material, ni crearlo ya «analizado».
- Free admite 2 perfiles activos; el tercero lo rechaza la base de datos.
- Las funciones de cola, cuotas y *rate limit* no son accesibles con la clave pública; las tablas internas devuelven vacío.
- `workspace_usage` solo responde a miembros; `anon` solo lee catálogo y planes.
- Storage: B no puede firmar, descargar ni listar ficheros de A; nadie escribe directamente (solo con URL firmada emitida por el servidor); el bucket rechaza tipos MIME no permitidos.

Comprobaciones manuales complementarias (SQL Editor):

```sql
select schemaname, tablename, policyname, cmd from pg_policies where schemaname in ('public', 'storage') order by 1, 2, 3;
```

y **Advisors → Security** en el panel (avisos de RLS, funciones `security definer` y buckets).

## 7. Limpiar los datos

```bash
pnpm test:cleanup:real
```

Borra, en este orden, los ficheros de Storage de los usuarios de prueba, sus workspaces (y todo lo que cuelga: perfiles, materiales, jobs) y los propios usuarios. Solo toca emails de prueba (`docente-<n>-<n>@example.com`, `rls-<n>-a|b@example.com`, `shot-…@example.com`). Es necesario borrar los workspaces antes que el usuario porque `workspaces.owner_id` es `ON DELETE RESTRICT`: la baja de cuenta real (fase de privacidad) seguirá el mismo orden.

## Límites conocidos

- Los E2E contra Supabase real usan el proveedor de IA simulado: no verifican ni gastan nada del proveedor real. La prueba del modelo real son los evals (`evals/material-analysis/README.md`).
- Los marcadores `MOCK_FAIL`, `MOCK_INVALID`… solo funcionan con `mock:default`, que se rechaza en producción (`VERCEL_ENV=production`).
