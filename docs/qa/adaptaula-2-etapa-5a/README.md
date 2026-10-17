# Etapa 5A · primera entrega: copia personal y solicitud de eliminación

Base: PR #45 integrada en `5317031`. Rama: `codex/adaptaula-2-datos-5a`. No se aplicó ninguna migración remota ni se eliminó ninguna cuenta real.

## Qué funciona

- `POST /api/account/export` exige sesión y origen propio. Aplica un límite atómico de dos descargas por día e identidad. Devuelve un JSON con SHA-256 global en la cabecera, sin persistir un ZIP ni crear URL pública.
- El JSON contiene datos básicos de la cuenta y, para cada workspace **personal de propietario único**, perfiles funcionales, clases y sus relaciones, materiales, adaptaciones, versiones, borradores docentes y comentarios de revisión. En espacios compartidos solo devuelve nombre/rol del espacio y declara que excluye su contenido.
- Los originales del espacio personal se incluyen en base64 con SHA-256 mientras el conjunto no exceda 2 MB y los 30 primeros archivos; los demás figuran con `/api/materials/{id}/file?download=1`, que vuelve a comprobar sesión, workspace y RLS y crea un enlace firmado de un minuto. El límite de 500 registros por entidad y 4 MB para el JSON evita respuestas excesivas y detiene la exportación completa con un error claro. PDF de adaptaciones y recursos visuales almacenados no se empaquetan en esta versión; se pueden obtener por las rutas privadas de producto cuando están disponibles. La descarga solo representa las entidades y archivos indicados.
- `POST /api/account/deletion-request` exige sesión, origen propio, confirmación literal y contraseña actual comprobada en un cliente Auth aislado. Cinco intentos por hora. Solo después, el servidor invoca `request_account_deletion(p_user)` con `service_role`; la firma antigua sin argumentos se elimina y `authenticated` no puede invocar ninguna de ellas. La función SQL conserva una sola solicitud por cuenta. El `p_user` proviene de `auth.getUser()`, nunca del cuerpo enviado por el navegador. La tabla mantiene RLS de solo lectura para el titular; solo servicio puede cambiar su estado. Conserva un UUID seudónimo aunque en el futuro se borre Auth, para poder reconciliar fallos; su plazo de retención requiere revisión jurídica.
- «Plan y cuenta» presenta alcance, límites y estado real. Una solicitud **no** borra datos ni impide trabajar. Queda pendiente de revisión manual. No existe todavía un proceso de correo ni una eliminación automática.

## Lo que falta para una baja efectiva

Antes de habilitar el borrado, decidir con revisión jurídica la conservación de facturación y registros técnicos y el tratamiento de espacios compartidos. Implementar un orquestador idempotente que marque el workspace/cuenta en eliminación, impida nuevas escrituras y jobs, drene o cancele los activos, inventaríe todos los objetos privados (`source-materials`, `generated-assets`, `exports`), quite objetos con reintentos y conciliación, elimine filas en orden y finalmente use `auth.admin.deleteUser` solo desde servidor. Debe mantener una traza de fases sin contenido sensible y bloquear acceso desde el primer paso. La limpieza actual de subidas abandonadas en `/api/cron/materials` se conserva; no se introduce una purga por tiempo de borradores, exportaciones, registros u originales activos sin política aprobada.

Operación manual mientras tanto: consultar `account_deletion_requests` con credenciales administrativas y tramitar cada solicitud fuera de la aplicación. **No** marcar `completed` sin comprobar el borrado de Storage, filas y Auth. La solicitud no es prueba de cumplimiento jurídico.

## Aplicación futura

1. Comprobar **en staging, solo cuando se autorice** el estado real de 025–028 y que la política de conservación y el canal de atención estén preparados. La evidencia de esta PR solo muestra 027 en PGlite local; no se ha consultado Supabase compartido. No puede afirmarse que 027 no se haya aplicado fuera de esta sesión.
2. Si 027 no se ha aplicado, ejecutar la versión corregida de 027 y luego 028 en orden. Si 027 ya se aplicó, ejecutar **028 compensatoria** antes de desplegar la nueva API: elimina la RPC antigua y deja solo la firma con permiso de `service_role`. Revisar manualmente cualquier solicitud registrada durante la ventana anterior, pues no se puede probar que superara la contraseña.
3. Verificar en staging que `authenticated` no puede ejecutar ninguna firma ni insertar directamente, que `service_role` sí puede registrar una solicitud idempotente, y que RLS permite al titular leer solo la propia. Desplegar la aplicación después de la migración. Probar con dos identidades ficticias: una no lee ni descarga archivos de la otra; una contraseña incorrecta no crea la solicitud; la solicitud no borra la cuenta; la tercera exportación en un día devuelve 429. No se han aplicado migraciones ni cambiado secretos remotos en esta PR.

## Verificación local

- PGlite: `tests/db/account-deletion-request.test.ts` (3 pruebas aprobadas; RPC directa e inserción de `authenticated` denegadas, firma de servicio idempotente, RLS, cuenta intacta y compensación de un esquema 027 heredado). La nueva prueba de RPC directa falló antes del arreglo: la función anterior devolvió un UUID.
- Unitarias: `tests/unit/account-export.test.ts` (1 prueba aprobada: datos personales, original con base64, exclusión de espacio compartido y secreto).
- E2E con Supabase simulado y PDF sintético: `tests/e2e/account-privacy-stage5a.spec.ts` (4 pruebas aprobadas; escritorio y móvil: RPC directa denegada, descarga, aislamiento, acceso privado denegado a otro usuario, contraseña errónea/correcta, solicitud repetida sin duplicación ni suplantación, límite de intentos, cuenta disponible, errores genéricos, Axe WCAG 2.2 AA, 320 px con texto al 200 %, movimiento reducido y alto contraste).
- Typecheck, lint y build: ejecutados localmente. La calidad de los documentos generados por IA no se evalúa aquí.

Capturas reales: [cuenta escritorio](capturas/cuenta-escritorio.png), [cuenta móvil](capturas/cuenta-movil.png), [solicitud escritorio](capturas/solicitud-escritorio.png), [solicitud móvil](capturas/solicitud-movil.png).
