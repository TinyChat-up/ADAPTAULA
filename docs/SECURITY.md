# Seguridad

El producto trata material educativo y perfiles de necesidades de menores (datos potencialmente sensibles). La seguridad tiene prioridad sobre cualquier otra consideración.

## Modelo de amenazas (resumen)

| Amenaza | Mitigación principal |
|---|---|
| Un usuario accede a datos de otro workspace | RLS en todas las tablas y en Storage + comprobación de membresía en servidor + tests de BD (tests/db) y E2E de aislamiento |
| Manipular el plan o los límites desde el cliente | Entitlements y cuotas solo en servidor (`checkEntitlement`, `consume_quota`); el plan se deriva de `subscriptions` |
| Webhooks de Stripe falsificados | Verificación de firma (`STRIPE_WEBHOOK_SECRET`), idempotencia con `stripe_events` |
| Inyección de prompts desde el material subido | Material envuelto como datos en el prompt; salida restringida a un schema; la IA no tiene herramientas ni acceso a nada |
| XSS a través del contenido de IA | Nunca HTML de IA; JSON → componentes; texto inline parseado por nosotros; KaTeX con `trust: false`; CSP |
| Ficheros maliciosos | Validación por *magic bytes*, tamaño y páginas; buckets privados; los ficheros nunca se sirven públicamente ni se ejecutan; URLs firmadas cortas |
| Fuga de la service role o de las claves de IA | Solo en módulos `server-only`; nunca `NEXT_PUBLIC_`; revisión en CI |
| Abuso de coste (IA) | Cuotas, rate limit, `MAX_SINGLE_JOB_COST_USD`, alertas diarias y mensuales, interruptor `ai_paused` |
| Acceso al panel admin | `/admin` exige `is_system_admin()` en el layout **y** en cada acción o lectura; sin enlaces desde la app |
| CSRF | Server Actions (protección de origen integrada en Next); Route Handlers mutantes comprueban `Origin` y requieren sesión; cookies `SameSite=Lax` |
| Toma de cuentas | Supabase Auth (hash, rate limit, confirmación de email); restablecimiento de contraseña con token de un solo uso |

## Autenticación y sesión

- Supabase Auth con `@supabase/ssr`: cookies httpOnly; `proxy.ts` refresca la sesión.
- **`proxy.ts` no es la barrera de seguridad**: cada Server Component, Server Action y Route Handler protegido llama a `requireUser()` / `requireWorkspace()` (capa de acceso a datos). El proxy solo redirige para dar buena experiencia.
- En servidor se usa `supabase.auth.getUser()` (validado contra Auth), nunca la sesión sin verificar.
- Métodos: email + contraseña, magic link, Google (flag `GOOGLE_AUTH`).

- El destino posterior al login (`next`) solo admite rutas relativas del propio sitio (`safeNextPath`); cualquier otra cosa vuelve a `/app`.
- Los mensajes de login, registro y recuperación no revelan si un email existe.

## Autorización

1. **Autenticación**: `requireUser()`.
2. **Membresía y rol**: `requireWorkspace({ roles })` resuelve el workspace activo desde la cookie, validado contra `workspace_members`.
3. **Entitlement**: `checkEntitlement(workspaceId, action)` para `adaptation.generate`, `image.generate`, `profile.create`, `class.create`, `block.revise`, `material.upload`.
4. **RLS** como segunda barrera, aunque el código de servidor falle.

## Validación de entradas

- Todo lo que entra al servidor se valida con Zod (`safeParse`); los errores se devuelven por campo.
- Las salidas de IA también se validan con Zod antes de persistirlas.
- Límites de longitud en todos los textos libres (alias 60, notas 1000, petición del docente 1000, comentario de feedback 500).

## Ficheros

- Tipos permitidos: PDF, JPG/JPEG, PNG, WEBP. Se rechazan DOCX, PPTX, ZIP, audio y vídeo. Configuración única en `src/lib/materials/config.ts`.
- **Se valida en servidor, sobre los bytes recibidos**, nunca sobre lo que declara el navegador: la firma (*magic bytes*) debe coincidir con la extensión, el tamaño se mide sobre el fichero real y las páginas del PDF se cuentan con un parser. La validación del navegador es solo un atajo de UX; el servidor la repite tras la subida y, si falla, **borra el fichero y los registros**.
- Límites: los de `plans.features` (`max_file_mb`, `max_pages_per_material`) acotados por techos duros: PDF 20 MiB (el proveedor admite 32 MB y base64 añade un tercio), imagen 5 MiB (límite del proveedor), 30 páginas.
- PDFs cifrados o corruptos → rechazo con un mensaje claro. Ningún mensaje muestra detalles técnicos.
- **Storage:** bucket privado; ruta `<workspace>/<usuario>/<material>/<uuid>.<ext>` generada por el servidor; la subida usa una URL firmada de un solo uso emitida tras resolver el workspace; no existen URLs públicas permanentes. La lectura va por `/api/materials/[id]/file`, que autoriza con la sesión del usuario (RLS) y redirige a una URL firmada de 60 s (o transmite PDFs pequeños para la vista previa).
- **Ficheros huérfanos:** una subida no completada se limpia a las 60 min (cron diario); borrar un material elimina primero el fichero y luego la fila.
- Escaneo de malware: no disponible en el MVP. Riesgo aceptado y documentado: los ficheros solo los procesan las APIs de los proveedores de IA y nuestro parser, nunca se ejecutan ni se sirven públicamente.

## Material no confiable e inyección de prompts

El contenido de un material es **dato**, nunca instrucción. El fichero viaja como bloque binario entre `<untrusted_material>` y `</untrusted_material>`; el system prompt lo declara y las instrucciones reales van después. Una frase dirigida a la IA dentro del material se registra como incertidumbre y no se obedece. Además, la salida del modelo nunca ejecuta nada: se valida contra un schema cerrado (enumeraciones, longitudes, referencias) y el modelo no tiene herramientas ni acceso a datos. El contexto del docente se escapa (`<`, `>`) antes de entrar al prompt. Cubierto por tests unitarios y por el caso `esp-prompt-injection` de los evals.

## Rutas de API

Las rutas `/api/*` que modifican datos exigen sesión y comprueban el **origen** (`Origin` = host propio; si no, 403) antes de hacer nada; las de lectura exigen sesión y responden 401, sin redirigir. El workspace nunca viene del cuerpo ni de la URL. El cron de limpieza exige `Authorization: Bearer $CRON_SECRET`. Lo mismo el cron de las etapas de adaptación (`/api/cron/adaptations`, comparación en tiempo constante; el secreto no se registra ni se devuelve). Las rutas de lectura de adaptaciones (`/api/adaptations/[id]/{status,plan,version}`) responden `Cache-Control: no-store, private`: son datos privados y cambiantes. Las mutaciones de adaptaciones son Server Actions (origen comprobado por Next); ninguna acepta `workspaceId` ni el revisor del cliente.

## Cabeceras HTTP

`Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` restrictiva y `frame-ancestors 'none'`. CSP con `self` + Supabase + Stripe; se endurece con nonces en la Fase 7.

## Secretos

`tests/unit/boundaries.test.ts` falla si un componente cliente llega (incluso de forma indirecta) a un módulo `server-only`, importa el cliente admin fuera de las zonas permitidas o lee un secreto sin pasar por el env validado.

- `.env*` en `.gitignore` (excepto `.env.example`, sin valores reales).
- Variables de servidor validadas en `src/lib/config/env.ts`; acceder a una variable de servidor desde el cliente rompe el build (`server-only`).
- Rotación documentada de: service role, claves de IA, secreto del webhook de Stripe.
- **La clave del proveedor de IA** (`ANTHROPIC_API_KEY`) solo existe en el servidor. Comprobaciones automáticas: (1) `tests/unit/boundaries.test.ts` — ningún componente cliente llega, directa o indirectamente, a un SDK de proveedor de IA ni a un módulo `server-only`, y la clave solo se nombra en el esquema de env validado, el *runtime* y el *router* de IA; (2) `tests/unit/secrets.test.ts` — `.env.local` está ignorado y no se versiona, ninguna variable `NEXT_PUBLIC_*` puede ser un secreto, `.env.example` no lleva valores, el *logger* descarta los campos con nombre de secreto y enmascara valores con forma de clave; (3) `pnpm check:secrets` (último paso de `pnpm check`, tras el build) — busca por **valor** y por **forma** (`sk-ant-…`, `sk-…`, `sb_secret_…`, Stripe) y, en los bundles del navegador, también por **nombre**, en `.next/static`, las páginas renderizadas en el build, `evals/results` y los snapshots. Imprime rutas y el tipo de secreto, nunca el secreto.
- Los errores del proveedor no llegan al usuario ni a los logs con su texto original: se categorizan (`AIError`) y el mensaje técnico solo vive en `cause`. Las herramientas de evals pasan cualquier texto de error por `redactSecrets`.

## Logs

Sin contenido de materiales, alias, notas, emails ni tokens. Identificadores opacos (`workspaceId`, `jobId`, `requestId`).

## Dependencias

Dependabot (o Renovate) para actualizaciones de seguridad; `pnpm audit` en CI; lockfile commiteado; `allowBuilds` de pnpm restringido.

## Tests de seguridad obligatorios

- E2E: el usuario A no puede leer, editar ni descargar recursos del workspace de B (perfiles, materiales, adaptaciones, exports, URLs firmadas).
- Free: la sexta adaptación del mes se bloquea en servidor aunque se llame a la API directamente.
- Un webhook sin firma válida devuelve 400 y no modifica nada.
- Un usuario que no es admin recibe 404 en `/admin`.
