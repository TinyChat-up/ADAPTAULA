# Seguridad

El producto trata material educativo y perfiles de necesidades de menores (datos potencialmente sensibles). La seguridad tiene prioridad sobre cualquier otra consideración.

## Modelo de amenazas (resumen)

| Amenaza | Mitigación principal |
|---|---|
| Un usuario accede a datos de otro workspace | RLS en todas las tablas y en Storage + comprobación de membresía en servidor + tests de BD (tests/db) y E2E de aislamiento |
| Manipular el plan o los límites desde el cliente | Entitlements y cuotas solo en servidor (`checkEntitlement`, `consume_quota`); el plan se deriva de `subscriptions` |
| Facturación | Contratación desactivada; las tablas y variables reservadas no acreditan una integración Stripe operativa |
| Inyección de prompts desde el material subido | Material envuelto como datos en el prompt; salida restringida a un schema; la IA no tiene herramientas ni acceso a nada |
| XSS a través del contenido de IA | JSON validado → componentes React; sin HTML arbitrario. El HTML de impresión usa CSP propia; no hay KaTeX instalado ni CSP global configurada en el repositorio |
| Ficheros maliciosos | Validación por *magic bytes*, tamaño y páginas; buckets privados; los ficheros nunca se sirven públicamente ni se ejecutan; URLs firmadas cortas |
| Fuga de la service role o de las claves de IA | Solo en módulos `server-only`; nunca `NEXT_PUBLIC_`; revisión en CI |
| Abuso de coste (IA) | Cuotas, rate limit, `MAX_SINGLE_JOB_COST_USD`, alertas diarias y mensuales, interruptor `ai_paused` |
| Administración | No existe un panel `/admin` implementado; no se considera disponible por existir funciones SQL reservadas |
| CSRF | Server Actions (protección de origen integrada en Next); Route Handlers mutantes comprueban `Origin` y requieren sesión; cookies `SameSite=Lax` |
| Toma de cuentas | Supabase Auth (hash, rate limit, confirmación de email); restablecimiento de contraseña con token de un solo uso |

## Autenticación y sesión

- Supabase Auth con `@supabase/ssr`: sesión en cookies gestionadas por el SDK; `proxy.ts` refresca la sesión en sus rutas configuradas. No se afirma `HttpOnly`: el cliente navegador también participa en Auth.
- **`proxy.ts` no es la barrera de seguridad**: cada Server Component, Server Action y Route Handler protegido llama a `requireUser()` / `requireWorkspace()` (capa de acceso a datos). El proxy solo redirige para dar buena experiencia.
- En servidor se usa `supabase.auth.getUser()` (validado contra Auth), nunca la sesión sin verificar.
- Interfaz operativa: email + contraseña, confirmación y recuperación. No se ofrecen Google ni magic link como métodos de acceso.

- El destino posterior al login (`next`) solo admite rutas relativas del propio sitio (`safeNextPath`); cualquier otra cosa vuelve a `/app`.
- Los mensajes de login, registro y recuperación no revelan si un email existe.

## Autorización

1. **Autenticación**: `requireUser()`.
2. **Membresía y rol**: `requireWorkspace({ roles })` resuelve el workspace activo desde la cookie, validado contra `workspace_members`.
3. **Entitlement**: `evaluateEntitlement` y sus consumidores comprueban roles y límites de perfiles/análisis; la orquestación comprueba y reserva adaptaciones en SQL. Los recursos visuales tienen sus propios gates. No existe un guard universal llamado `checkEntitlement`.
4. **RLS** como segunda barrera, aunque el código de servidor falle.

## Validación de entradas

- Todo lo que entra al servidor se valida con Zod (`safeParse`); los errores se devuelven por campo.
- Las salidas de IA también se validan con Zod antes de persistirlas.
- Límites de longitud en los contratos Zod y SQL de cada entidad. Los perfiles funcionales no admiten notas libres sobre menores.

## Ficheros

- Tipos permitidos: PDF, JPG/JPEG, PNG, WEBP. Se rechazan DOCX, PPTX, ZIP, audio y vídeo. Configuración única en `src/lib/materials/config.ts`.
- **Se valida en servidor, sobre los bytes recibidos**, nunca sobre lo que declara el navegador: la firma (*magic bytes*) debe coincidir con la extensión, el tamaño se mide sobre el fichero real y las páginas del PDF se cuentan con un parser. La validación del navegador es solo un atajo de UX; el servidor la repite tras la subida. Si falla, registra una reclamación de limpieza irreversible que no puede borrar un original completado por otra petición; el worker elimina archivos y filas después de la ventana de subida (029).
- Límites: los de `plans.features` (`max_file_mb`, `max_pages_per_material`) acotados por techos duros: PDF 20 MiB (el proveedor admite 32 MB y base64 añade un tercio), imagen 5 MiB (límite del proveedor), 30 páginas.
- PDFs cifrados o corruptos → rechazo con un mensaje claro. Ningún mensaje muestra detalles técnicos.
- **Storage:** bucket privado; ruta `<workspace>/<usuario>/<material>/<uuid>.<ext>` generada por el servidor; la subida usa una URL firmada de un solo uso emitida tras resolver el workspace; no existen URLs públicas permanentes. La lectura va por `/api/materials/[id]/file`, que autoriza con la sesión del usuario (RLS) y redirige a una URL firmada de 60 s (o transmite PDFs pequeños para la vista previa).
- **Subidas incompletas (029):** finalización y limpieza comparten una decisión atómica en PostgreSQL. No se reclama por antigüedad de 60 minutos: se respeta la ventana de los tokens de 7200 s. Rutas, errores e intentos persisten; Storage se verifica antes de confirmar el DELETE y las lápidas permiten recuperar escrituras tardías. [Contrato y despliegue](qa/integridad-originales/README.md). El borrado explícito de materiales por el docente es otro flujo y no se amplía en esta entrega.
- **Figuras reconstruidas (8.2B.1):** el SVG lo dibuja nuestro componente a partir de números validados con Zod (VisualSpec v1). No
  hay cadenas de marcado, scripts, enlaces, recursos externos, `style` ni `foreignObject`, y un test lo comprueba. El PDF sigue
  saliendo de Chromium sin red y con una CSP que no permite nada externo.
- **Ilustraciones generadas (migración 024).**
  - Las genera solo el servidor, con la clave de servicio, dentro de un trabajo ya autorizado.
  - Los bytes se validan (firma PNG, IHDR, dimensiones, 10 MiB) antes de revisarse y guardarse.
  - Bucket privado, en `<workspace>/<adaptación>/illustrations/<sha256>.png`.
  - Fila inmutable (trigger) y única por adaptación, necesidad y brief. El navegador no puede escribirla.
  - Se leen por `/api/adaptations/[id]/generated/[assetId]`, que autoriza con la sesión del usuario (RLS), exige que el activo sea
    de esa adaptación y verifica el sha-256. Cabeceras privadas, sin URL pública.
  - El PDF fija la instancia exacta por su sha-256.
- Escaneo de malware: no disponible en el MVP. Riesgo aceptado y documentado: los ficheros solo los procesan las APIs de los proveedores de IA y nuestro parser, nunca se ejecutan ni se sirven públicamente.

## Material no confiable e inyección de prompts

El contenido de un material es **dato**, nunca instrucción. El fichero viaja como bloque binario entre `<untrusted_material>` y `</untrusted_material>`; el system prompt lo declara y las instrucciones reales van después. Una frase dirigida a la IA dentro del material se registra como incertidumbre y no se obedece. Además, la salida del modelo nunca ejecuta nada: se valida contra un schema cerrado (enumeraciones, longitudes, referencias) y el modelo no tiene herramientas ni acceso a datos. El contexto del docente se escapa (`<`, `>`) antes de entrar al prompt; en los prompts de «Hacer magia» publicados con la migración 024 (`image_brief`, `image_review`, `visual_substitute`) el material también va como JSON con `<` y `>` escapados, así que no puede cerrar su envoltorio (test en `tests/unit/illustrations.test.ts`). Un brief o una revisión manipulados no bastan para colar nada en una ficha: el brief pasa reglas deterministas y la imagen solo se acepta si el servidor confirma cada punto de la revisión. Cubierto por tests unitarios y por el caso `esp-prompt-injection` de los evals.

## Rutas de API

Las rutas `/api/*` que modifican datos exigen sesión y comprueban el **origen** (`Origin` = host propio; si no, 403) antes de hacer nada; las de lectura exigen sesión y responden 401, sin redirigir. El workspace nunca viene del cuerpo ni de la URL. El cron de limpieza exige `Authorization: Bearer $CRON_SECRET`. Lo mismo el cron de las etapas de adaptación (`/api/cron/adaptations`, comparación en tiempo constante; el secreto no se registra ni se devuelve). Las rutas de lectura de adaptaciones (`/api/adaptations/[id]/{status,plan,version}`) responden `Cache-Control: no-store, private`: son datos privados y cambiantes. Las mutaciones de adaptaciones son Server Actions (origen comprobado por Next); ninguna acepta `workspaceId` ni el revisor del cliente.

## Cabeceras HTTP

No hay una política global de cabeceras de seguridad configurada en `next.config.ts` ni en `proxy.ts`. Varias rutas privadas sí fijan `Cache-Control`, `Vary` y `X-Content-Type-Options`. La impresión autónoma usa `PRINT_CSP` y Chromium sin red. HSTS del hosting, CSP del sitio, protección frente a framing y Permissions-Policy requieren comprobación y una entrega específica; no se dan por implementadas. La política de framing debe conservar los visores privados del mismo origen.

## Secretos

`tests/unit/boundaries.test.ts` falla si un componente cliente llega (incluso de forma indirecta) a un módulo `server-only`, importa el cliente admin fuera de las zonas permitidas o lee un secreto sin pasar por el env validado.

- `.env*` en `.gitignore` (excepto `.env.example`, sin valores reales).
- Variables de servidor validadas en `src/lib/config/env.server-schema.ts` y leídas mediante `env.server.ts`; módulos sensibles marcados `server-only`.
- La rotación de claves y los secretos del despliegue requieren un procedimiento operativo externo; esta revisión local no acredita su configuración.
- **Las claves de los proveedores de IA** (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`) solo existen en el servidor. Comprobaciones automáticas: (1) `tests/unit/boundaries.test.ts` — ningún componente cliente llega, directa o indirectamente, a un SDK de proveedor de IA ni a un módulo `server-only`, y la clave solo se nombra en el esquema de env validado, el *runtime* y el *router* de IA; (2) `tests/unit/secrets.test.ts` — `.env.local` está ignorado y no se versiona, ninguna variable `NEXT_PUBLIC_*` puede ser un secreto, `.env.example` no lleva valores, el *logger* descarta los campos con nombre de secreto y enmascara valores con forma de clave; (3) `pnpm check:secrets` (último paso de `pnpm check`, tras el build) — busca por **valor** y por **forma** (`sk-ant-…`, `sk-…`, `sb_secret_…`, Stripe) y, en los bundles del navegador, también por **nombre**, en `.next/static`, las páginas renderizadas en el build, `evals/results` y los snapshots. Imprime rutas y el tipo de secreto, nunca el secreto.
- Los errores del proveedor no llegan al usuario ni a los logs con su texto original: se categorizan (`AIError`) y el mensaje técnico solo vive en `cause`. Las herramientas de evals pasan cualquier texto de error por `redactSecrets`.

## Logs

Sin contenido de materiales, alias, notas, emails ni tokens. Identificadores opacos (`workspaceId`, `jobId`, `requestId`).

## Dependencias

Lockfile versionado y `allowBuilds` de pnpm restringido. No hay workflows de GitHub Actions ni configuración de Dependabot/Renovate en el repositorio. `pnpm audit` puede ejecutarse localmente; no se afirma ejecución automática en CI. Resultado y alcance de la revisión de 2026-10-20 en [la auditoría](qa/auditoria-2026-10-20/README.md).

## Tests de seguridad obligatorios

- E2E: el usuario A no puede leer, editar ni descargar recursos del workspace de B (perfiles, materiales, adaptaciones, exports, URLs firmadas).
- Política 026: la segunda adaptación Free y el tercer análisis del periodo se bloquean en servidor; comprobar además reservas, devoluciones e idempotencia.
- No activar facturación antes de implementar y probar firma e idempotencia de webhooks.
- No publicar un panel administrativo sin guards y pruebas de aislamiento propios.
