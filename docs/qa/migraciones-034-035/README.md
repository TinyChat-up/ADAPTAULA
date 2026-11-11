# Plan de ejecución: historial de migraciones y migraciones 034 y 035

Estado: **revisado, no ejecutado**. Decisión del propietario (2026-11-11): se prescinde de la copia de seguridad en esta fase y se acepta el riesgo; por eso el plan se limita a operaciones que solo **añaden** objetos, y ninguna borra, reinicia ni sobrescribe datos.

## 1. Lo comprobado (solo lectura, 2026-11-11)

**El esquema remoto es el de las migraciones 001–033, con definiciones completas.** Se construyó el esquema desde las migraciones y se comparó con el remoto, por tipo de objeto, con huellas MD5 de sus definiciones. Los siete resultados son idénticos:

| Objeto | Qué incluye la huella | Huella |
|---|---|---|
| Columnas (41 tablas) | tipo, nulabilidad, valor por defecto, longitud | `77045eb476bd25b66ed2156013a439a6` |
| Restricciones (41) | definición completa (`pg_get_constraintdef`), sin `NOT NULL` | `1865c25934766a8332a810ff2a191870` |
| Índices (41) | definición completa (`indexdef`) | `b4fa0c24e78b515e30b2148f38ac1d0e` |
| Políticas RLS (32) | comando, roles, `using` y `with check` | `a0f0918c9bd8f9625f7765dd6dae75e1` |
| Disparadores (26) | definición completa | `5d6ab9d74de4ec678f6670c58dc9d323` |
| Funciones (77) | cuerpo completo (comprobación del 2026-11-11, `cd03b9b4…`), más `security definer`, configuración y permisos | `2fed849816ae5e4e0db5a61fc486d780` |
| Permisos de tablas (41) | `relacl` | `3eaa40495bea506ee6034e44adc664f3` |

(Los `NOT NULL` se excluyen porque Postgres 17 no los registra como restricciones y Postgres 18 sí.)

**El historial no existe.** El esquema `supabase_migrations` y su tabla `schema_migrations` no están en la base: el esquema se creó sin la CLI. `supabase migration repair` los crea por sí mismo; el paso 1 de abajo hace lo mismo con SQL.

**034 y 035, sin operaciones destructivas.** Revisadas línea a línea y simuladas en local sobre una base con datos (usuario, material, perfil y una llamada de IA) construida hasta la 033:

| | 034 `agent_rules` | 035 `pilot_spend_ledger` |
|---|---|---|
| Crea | bucket privado `agent-rules` (1 MB; solo markdown y JSON); columna `ai_runs.rules_sha256` (nula, con comprobación de formato) | tabla `ai_spend_reservations` (RLS activa, sin acceso para usuarios); 4 funciones nuevas de gasto y la de informe |
| Reemplaza | nada | `record_ai_run` (`create or replace`): misma firma y mismo comportamiento, más la columna nueva |
| Borra / actualiza / trunca filas | **no** (el único `insert … on conflict do update` afecta solo al bucket `agent-rules`, que no existe) | **no** |
| Dependencias | `storage.buckets` con las columnas que usa (existen) | la columna de la 034 (`rules_sha256`), `ai_runs`, `adaptations`, `materials`, el rol `service_role` (existen) |

Resultado de la simulación: orden `034 → 035`; las 41 tablas existentes conservan exactamente los mismos datos (comparando el contenido de cada fila, sin la columna nueva); aparece una tabla nueva (`ai_spend_reservations`); `record_ai_run` sigue funcionando con filas antiguas. **El orden importa:** la 035 usa la columna de la 034.

Ya existe una función `ai_spend_summary(p_workspace, p_from, p_to)`; la nueva `ai_spend_summary(p_campaign text)` tiene otra firma y coexiste.

## 2. Operaciones exactas

### Opción A · con la CLI (ejecutas tú, necesita la contraseña de la base)

```bash
supabase link --project-ref jidhormdauthfbpxxydt
supabase migration repair --status applied 20261001000100 20261001000200 20261001000300 20261001000400 20261001000500 \
  20261001000600 20261001000700 20261001000800 20261001000900 20261001001000 20261001001100 20261001001200 20261001001300 \
  20261001001400 20261001001500 20261001001600 20261001001700 20261001001800 20261001001900 20261001002000 20261001002100 \
  20261001002200 20261001002300 20261001002400 20261001002500 20261001002600 20261001002700 20261001002800 20261001002900 \
  20261001003000 20261001003100 20261001003200 20261001003300
supabase migration list      # 001–033 en Local y Remote; 034 y 035 solo en Local
supabase db push --dry-run   # debe listar EXACTAMENTE 034 y 035
supabase db push
```

Nunca `supabase db reset`.

### Opción B · con SQL (lo ejecuto yo, con tu confirmación, desde el editor SQL conectado)

Cada paso va en una transacción; si falla, no queda nada a medias.

0. **Guarda de entrada:** repetir la comparación de huellas (apartado 1). Si alguna difiere, **parar**.
1. `paso1-historial.sql` (esta carpeta): crea la tabla de historial y las 33 filas.
2. Aplicar el contenido de `supabase/migrations/20261001003400_agent_rules.sql` dentro de `begin; … insert into supabase_migrations.schema_migrations (version, name) values ('20261001003400','agent_rules'); commit;`.
3. Lo mismo con `20261001003500_pilot_spend_ledger.sql` (`'20261001003500'`, `'pilot_spend_ledger'`).

Con la herramienta `apply_migration` no: asignaría su propia versión (la fecha de ese momento) en lugar de `20261001003400`, y la CLI creería después que la 034 está pendiente.

## 3. Comprobaciones posteriores

**Base de datos (solo lectura):**
1. `select count(*), max(version) from supabase_migrations.schema_migrations;` → 35 y `20261001003500`.
2. Recuentos sin cambios respecto a antes: usuarios 4, workspaces 4, materiales 13, adaptaciones 29, versiones 30, perfiles 4, llamadas de IA 136, eventos de uso 68, archivos 19. (`ai_runs` puede subir si usas la web entre medias.)
3. Huellas: las columnas de `ai_runs` y las funciones cambian (esperado); el resto de huellas debe seguir igual.
4. `ai_spend_reservations` existe, vacía, con RLS; el bucket `agent-rules` existe y es privado; la columna `rules_sha256` existe.
5. Permisos: `has_function_privilege('authenticated', 'public.ai_spend_admit(text, numeric, text, text, integer, integer, numeric)', 'execute')` es falso; el de `service_role`, verdadero.
6. Asesor de seguridad de Supabase sin avisos nuevos.

**Aplicación (tú, en `adaptaula-tawny.vercel.app`):** iniciar sesión, ver tus materiales y plan Max, abrir una adaptación existente, descargar un PDF existente.

## 4. Marcha atrás

Las dos migraciones solo añaden, así que se deshacen sin tocar datos:

```sql
begin;
delete from supabase_migrations.schema_migrations where version in ('20261001003400', '20261001003500');
drop function if exists public.ai_cost_report(timestamptz, uuid);
drop function if exists public.ai_spend_summary(text);
drop function if exists public.ai_spend_settle(uuid, numeric);
drop function if exists public.ai_spend_admit(text, numeric, text, text, integer, integer, numeric);
drop function if exists public.ai_spend_committed(text);
drop table if exists public.ai_spend_reservations;
alter table public.ai_runs drop column if exists rules_sha256;
commit;
```

Después, `record_ai_run` hay que restaurarla con el cuerpo de la migración 033 (`supabase/migrations/20261001001300_adaptation_pipeline.sql`, definición de `record_ai_run`). El bucket `agent-rules` se vacía y se elimina desde el panel de Storage. Hazlo solo si fuera necesario.

## 5. Después de las migraciones

Subir las reglas privadas (`scripts/agent-rules/upload.ts`, verificación previa de las 56 huellas), fusionar las PR #79–#82 y fijar las variables de V2.2 en el proyecto de ACME. Cada paso con su confirmación.
