# Etapa 5A · primera entrega: copia personal y solicitud de eliminación

Base: PR #45 integrada en `5317031`. Rama: `codex/adaptaula-2-datos-5a`. No se aplicó ninguna migración remota ni se eliminó ninguna cuenta real.

## Qué funciona

- `POST /api/account/export` exige sesión y origen propio. Aplica un límite atómico de dos descargas por día e identidad. Devuelve un JSON con SHA-256 global en la cabecera, sin persistir un ZIP ni crear URL pública.
- El JSON contiene datos básicos de la cuenta y, para cada workspace **personal de propietario único**, perfiles funcionales, clases y sus relaciones, materiales, adaptaciones, versiones, borradores docentes y comentarios de revisión. En espacios compartidos solo devuelve nombre/rol del espacio y declara que excluye su contenido.
- Los originales del espacio personal se incluyen en base64 con SHA-256 mientras el conjunto no exceda 2 MB y los 30 primeros archivos; los demás figuran con `/api/materials/{id}/file?download=1`, que vuelve a comprobar sesión, workspace y RLS y crea un enlace firmado de un minuto. El límite de 500 registros por entidad y 4 MB para el JSON evita respuestas excesivas y detiene la exportación completa con un error claro. PDF de adaptaciones y recursos visuales almacenados no se empaquetan en esta versión; se pueden obtener por las rutas privadas de producto cuando están disponibles. La descarga solo representa las entidades y archivos indicados.
- `POST /api/account/deletion-request` exige sesión, origen propio, confirmación literal y contraseña actual comprobada en un cliente Auth aislado. Cinco intentos por hora. La función SQL registra una sola solicitud por cuenta, repetible sin crear nuevas bajas. La tabla tiene RLS de solo lectura para el titular; solo servicio puede cambiar su estado. Conserva un UUID seudónimo aunque en el futuro se borre Auth, para poder reconciliar fallos; su plazo de retención requiere revisión jurídica.
- «Plan y cuenta» presenta alcance, límites y estado real. Una solicitud **no** borra datos ni impide trabajar. Queda pendiente de revisión manual. No existe todavía un proceso de correo ni una eliminación automática.

## Lo que falta para una baja efectiva

Antes de habilitar el borrado, decidir con revisión jurídica la conservación de facturación y registros técnicos y el tratamiento de espacios compartidos. Implementar un orquestador idempotente que marque el workspace/cuenta en eliminación, impida nuevas escrituras y jobs, drene o cancele los activos, inventaríe todos los objetos privados (`source-materials`, `generated-assets`, `exports`), quite objetos con reintentos y conciliación, elimine filas en orden y finalmente use `auth.admin.deleteUser` solo desde servidor. Debe mantener una traza de fases sin contenido sensible y bloquear acceso desde el primer paso. La limpieza actual de subidas abandonadas en `/api/cron/materials` se conserva; no se introduce una purga por tiempo de borradores, exportaciones, registros u originales activos sin política aprobada.

Operación manual mientras tanto: consultar `account_deletion_requests` con credenciales administrativas y tramitar cada solicitud fuera de la aplicación. **No** marcar `completed` sin comprobar el borrado de Storage, filas y Auth. La solicitud no es prueba de cumplimiento jurídico.

## Aplicación futura

1. Revisar que el entorno de destino ya tenga las migraciones previas hasta 026 y que su política de conservación y canal de atención estén preparados. No se han comprobado datos ni condiciones comerciales del Supabase remoto.
2. Aplicar **solo tras autorización de despliegue** `supabase/migrations/20261001002700_account_deletion_requests.sql` mediante el proceso habitual de migraciones y verificar la tabla, la función, grants y RLS en staging.
3. Desplegar la aplicación después de la migración. Probar con dos identidades ficticias: una no lee ni descarga archivos de la otra; la solicitud no borra la cuenta; la tercera exportación en un día devuelve 429. Verificar que el canal manual atiende las solicitudes antes de ofrecer el control en producción.

## Verificación local

- PGlite: `tests/db/account-deletion-request.test.ts` (anon denegado, RLS, repetición idempotente, filas intactas).
- Unitarias: `tests/unit/account-export.test.ts` (datos personales, original con base64, exclusión de espacio compartido y secreto).
- E2E con Supabase simulado y PDF sintético: `tests/e2e/account-privacy-stage5a.spec.ts` en escritorio y móvil (descarga, aislamiento, acceso privado denegado a otro usuario, contraseña errónea, solicitud y recarga, rate limit, Axe WCAG 2.2 AA, 320 px con texto al 200 %, movimiento reducido y alto contraste).
- Typecheck, lint y build: ejecutados localmente. La calidad de los documentos generados por IA no se evalúa aquí.

Capturas reales: [cuenta escritorio](capturas/cuenta-escritorio.png), [cuenta móvil](capturas/cuenta-movil.png), [solicitud escritorio](capturas/solicitud-escritorio.png), [solicitud móvil](capturas/solicitud-movil.png).
