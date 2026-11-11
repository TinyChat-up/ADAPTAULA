# Copia de seguridad, verificación y migraciones 034–035

Procedimiento para proteger la base de datos y los archivos privados de Supabase antes de aplicar la 034 y la 035, y para reparar el historial de migraciones sin riesgo. **Nada de esto está ejecutado**: la sesión de Claude Code no alcanza Supabase (su red no resuelve la dirección del proyecto), no tiene credenciales y su disco es efímero. Lo ejecutas tú, en tu equipo.

Estado de referencia (2026-11-11, proyecto `jidhormdauthfbpxxydt`, solo lectura): 4 usuarios, 4 workspaces, 13 materiales, 29 adaptaciones, 30 versiones, 4 perfiles, 136 llamadas de IA, 68 eventos de uso y 19 archivos en Storage. Plan gratuito de Supabase: **no hay copias gestionadas**, así que estas son las únicas.

## 1. Destino seguro

- Una carpeta **fuera de cualquier repositorio** y en un disco cifrado (FileVault, BitLocker o una unidad cifrada). Ni Git ni la nube sin cifrar.
- La copia contiene hashes de contraseñas (`auth.users`) y el contenido de tus materiales: trátala como un secreto.
- Cifra el volcado de la base: `age -p -o copia.dump.age copia.dump` (o `gpg -c`). Guarda la contraseña en tu gestor de contraseñas, no junto al archivo.
- Una segunda copia en otro soporte (un disco externo). Una copia en un solo sitio no es una copia.

## 2. Base de datos (PostgreSQL)

Necesitas `pg_dump` 17 y la cadena de conexión directa del proyecto (Settings → Database → Connection string; sustituye la contraseña en tu terminal, **nunca en un archivo del repositorio**).

```bash
export DB_URL='postgresql://postgres:<CONTRASEÑA>@db.jidhormdauthfbpxxydt.supabase.co:5432/postgres'
pg_dump "$DB_URL" -Fc --no-owner --no-privileges --schema=public --schema=auth --schema=storage -f adaptaula-$(date +%Y%m%d).dump
```

`auth` conserva los usuarios; `storage` conserva solo los metadatos de los archivos (los archivos se copian en el apartado 3). Si la conexión directa falla (solo IPv6), usa la cadena del *pooler* en modo sesión.

## 3. Archivos privados (Storage)

```bash
printf 'NEXT_PUBLIC_SUPABASE_URL=https://jidhormdauthfbpxxydt.supabase.co\nSUPABASE_SECRET_KEY=<clave secreta>\n' > ~/.adaptaula-backup.env   # fuera del repositorio
node --env-file=$HOME/.adaptaula-backup.env scripts/backup/storage-backup.mjs backup /ruta/segura/storage-$(date +%Y%m%d)
node scripts/backup/storage-backup.mjs verify /ruta/segura/storage-$(date +%Y%m%d)
```

El script solo lee: lista y descarga los tres buckets (`source-materials`, `generated-assets`, `exports`), escribe el `manifest.json` con tamaño y SHA-256 de cada archivo, se niega a escribir dentro de un repositorio Git y no imprime claves ni contenido. Probado sin red con una copia sintética: detecta archivos ausentes, alterados y no inventariados. Borra `~/.adaptaula-backup.env` al terminar.

## 4. Verificar la integridad

1. **Estructura del volcado:** `pg_restore --list adaptaula-*.dump | head` debe listar tablas de `public`, `auth` y `storage`.
2. **Huella del archivo:** `sha256sum adaptaula-*.dump > adaptaula.sha256` y guárdala aparte.
3. **Archivos de Storage:** el `verify` del apartado 3 debe dar «N correctos de N; 0 problemas», con N igual a `select count(*) from storage.objects` (hoy 19).
4. **Restauración de prueba** (apartado 5): es la única verificación real de que la copia sirve.

## 5. Restaurar en un entorno aislado

En tu equipo, sin tocar Supabase:

```bash
docker run --name restauracion -e POSTGRES_PASSWORD=local -p 54999:5432 -d postgres:17
export RESTORE_URL='postgresql://postgres:local@localhost:54999/postgres'
psql "$RESTORE_URL" -c "create role anon nologin; create role authenticated nologin; create role service_role nologin; create role supabase_auth_admin nologin;"
pg_restore --no-owner --no-privileges -d "$RESTORE_URL" adaptaula-AAAAMMDD.dump
psql "$RESTORE_URL" -c "select (select count(*) from auth.users) users, (select count(*) from public.materials) materials, (select count(*) from public.adaptations) adaptations, (select count(*) from public.ai_runs) ai_runs;"
psql "$RESTORE_URL" -f scripts/backup/schema-fingerprint.sql
docker rm -f restauracion
```

Los recuentos deben coincidir con la referencia de arriba y la huella con la tabla del apartado 6. Algunos avisos de `pg_restore` sobre extensiones o roles de Supabase son normales; un error en una tabla de `public` no lo es. Los archivos de Storage no se restauran en este entorno: se comprueban con su manifiesto.

## 6. Esquema remoto frente a las migraciones 001–033

Comprobado el 2026-11-11 en solo lectura, construyendo el esquema desde las migraciones y comparando con el remoto. **Coincide exactamente**:

| Elemento | Remoto = migraciones | Huella agregada |
|---|---|---|
| Columnas (41 tablas) | sí | `30e55f90f1fa661b45d688bc160bc98f` |
| Restricciones (41 tablas; sin `NOT NULL`) | sí | `f104de104a1a87141c13cc37676147f1` |
| Funciones (77, con su código) | sí | `cd03b9b4df8078408b02d73667f1cf37` |
| Índices (41) | sí | `e5c7982fb6db07ab62874c15d24f16bc` |
| Políticas (32) | sí | `707580dde76bd18c2477769bc93e34df` |
| RLS (41 tablas) | sí | `d207bf8e48a3386169d9b13327f796b9` |
| Disparadores (26) | sí | `f5705ad18792f488c2dd7688dcfd9552` |

Para repetirlo justo antes de aplicar nada: ejecuta `scripts/backup/schema-fingerprint.sql` en el editor SQL de Supabase. Deben salir esas siete filas. Cualquier diferencia es un motivo para parar.

## 7. Reparar el historial de migraciones

El historial remoto está vacío aunque el esquema es el de 001–033. **Solo después de la copia (apartados 2–5) y de repetir la comprobación del apartado 6**:

```bash
supabase link --project-ref jidhormdauthfbpxxydt
supabase migration repair --status applied 20261001000100 20261001000200 20261001000300 20261001000400 20261001000500 \
  20261001000600 20261001000700 20261001000800 20261001000900 20261001001000 20261001001100 20261001001200 20261001001300 \
  20261001001400 20261001001500 20261001001600 20261001001700 20261001001800 20261001001900 20261001002000 20261001002100 \
  20261001002200 20261001002300 20261001002400 20261001002500 20261001002600 20261001002700 20261001002800 20261001002900 \
  20261001003000 20261001003100 20261001003200 20261001003300
supabase migration list     # 001–033 en Local y Remote; 034 y 035 solo en Local
```

`repair` solo escribe filas en la tabla de historial (`supabase_migrations.schema_migrations`); no ejecuta SQL de las migraciones ni toca tus tablas. Si `migration list` no muestra exactamente eso, para.

## 8. Aplicar la 034 y la 035

Comprobadas contra el esquema remoto real (solo lectura):

- **034** (`agent_rules`): crea el bucket privado `agent-rules` (la política de lectura existente solo cubre los tres buckets actuales, así que ningún usuario podrá leerlo) y añade `ai_runs.rules_sha256`. El remoto tiene las columnas de `storage.buckets` que usa; ni el bucket ni la columna existen aún.
- **035** (`pilot_spend_ledger`): redefine `record_ai_run` (el remoto tiene exactamente el código de la 033, así que es una actualización limpia), crea `ai_spend_reservations` y las funciones de gasto e informe, solo para `service_role`. Ya existe una función `ai_spend_summary` con otros argumentos (`p_workspace, p_from, p_to`): la nueva `ai_spend_summary(p_campaign text)` es otra firma y no choca.
- Solo añaden objetos; no modifican filas.

```bash
supabase db push --dry-run     # debe listar EXACTAMENTE 034 y 035
supabase db push               # tras tu confirmación
```

Después: repetir `schema-fingerprint.sql` (cambiarán las columnas de `ai_runs`, las funciones y las políticas por la adición de 034 y 035; guarda las nuevas huellas) y comprobar los recuentos de la referencia.

## 9. Marcha atrás

- **Historial:** `supabase migration repair --status reverted 20261001003400 20261001003500` solo marca el historial.
- **034/035:** al solo añadir objetos, se deshacen sin tocar datos: `drop table public.ai_spend_reservations; drop function ...` (las cinco funciones de la 035 que no existían) y `alter table public.ai_runs drop column rules_sha256;`. La función `record_ai_run` de la 033 se recupera de su migración. El bucket `agent-rules` se vacía y se elimina desde el panel de Storage. Hazlo solo si es necesario y con la copia a mano.
- **Todo lo demás:** restaurar el volcado del apartado 5 sobre una base nueva.
