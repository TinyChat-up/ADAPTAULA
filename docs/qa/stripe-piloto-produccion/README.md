# Piloto privado en producción: Stripe TEST y Max

## Alcance autorizado y estado

El fundador decidió trabajar directamente con producción en esta conversación (2026-10-23). Esta entrega adapta el bloqueo absoluto de #66 a un modo explícito `production-pilot`, limitado al backend y workspace configurados. No habilita contratación pública ni cobros reales. Parte de `main` `e016d8b`, con #66 integrada. Rama `codex/stripe-piloto-produccion`; [PR #67](https://github.com/TinyChat-up/ADAPTAULA/pull/67) abierta sin merge.

**No se ha accedido a APIs administrativas, migrado ni desplegado ningún servicio real.** El usuario ha identificado el dominio destino: https://adaptaula-nine.vercel.app/. No se ha confirmado mediante Vercel cuál es su proyecto interno. La consulta pública de portada y `/precios` fue bloqueada por el túnel de red del entorno (`CONNECT 403`, HTTP destino `000`); esto no prueba que la aplicación esté caída. El entorno disponible no tiene conectores Vercel/Supabase/Stripe; las pruebas usan el Supabase ficticio local, mocks de transporte y documentos sintéticos. La disponibilidad del modelo y las tarifas actuales siguen pendientes. No se ha gastado en IA.

## Qué se implementa

- Checkout de suscripción exclusivamente con `sk_test_`, desde Plan y cuenta y solo para el propietario de un workspace personal, único miembro y configurado expresamente. Sin parámetros de precio, workspace o retorno procedentes del navegador. Origen y sesión obligatorios; cinco intentos por hora.
- Precio Stripe de prueba mensual, EUR, IVA incluido, validado contra el importe Max efectivo del catálogo. No crea productos/precios ni cambia importes. No usa claves publicables ni incorpora Stripe.js: redirección al Checkout alojado.
- Transporte REST acotado con contrato `2025-02-24.acacia`, HTTPS, timeout, sin redirecciones ni reintentos automáticos de mutaciones. Disponibilidad de ese contrato en la cuenta real **pendiente** de ensayo. No hay nueva dependencia ni SDK de terceros.
- Firma HMAC del cuerpo original, tolerancia de 300 s y límite de 128 KiB; rechazo de eventos live. Recuperación de sesión y suscripción desde la API TEST antes de conceder el acceso. Metadata y asociaciones persistidas verificadas. No concede nada la URL de retorno.
- Reserva única por workspace, idempotencia de creación y asociación de sesión. Si una preparación sin sesión supera 30 minutos, se detiene para revisión; no recrea sesiones después de la ventana de idempotencia. Un mismo piloto no se reinicia automáticamente.
- RPC privilegiada y atómica: asociación, suscripción y registro de evento se confirman juntos. La repetición no duplica; un fallo devuelve 503 para reintento de Stripe y no registra un éxito parcial. Los eventos ajenos no alteran otras suscripciones. Una cancelación no se reabre por un evento tardío.
- Migración **030**, nueva e idempotente. No modifica 024/026 ni seed. Añade `billing_pilot_requests` y `subscriptions.pilot_request_id`, con RLS y RPC solo service_role. No sobrescribe ninguna suscripción previa, ni siquiera manual o cancelada. Si existe una, requiere revisión específica antes de ensayar.
- `workspace_plan()` conserva la semántica previa para las suscripciones normales. Solo el piloto confirmado, vinculado y vigente devuelve Max con cinco imágenes, tres por adaptación y presupuesto defensivo 0,50 USD. **La fila global Max sigue con cero imágenes y generación apagada.** Precios públicos y otros usuarios no cambian.
- Caduca a los siete días de **preparar** el Checkout, no siete días después de pagarlo. El resolver devuelve Free cuando vence, sin depender de Cron/webhooks ni borrar filas. `current_period()` vuelve al periodo Free cuando corresponde. Si el workspace pasa a compartido o cambia de propietario, deja de conceder el piloto. No interrumpe retroactivamente una llamada de IA ya admitida.
- El servidor también rechaza el proveedor de imagen mock; no presenta dibujos simulados como generación real. Las pruebas inyectan sus fixtures directamente, sin abrir esa vía al producto.
- El flag de imágenes sigue independiente. Checkout no ejecuta Hacer magia ni genera imágenes. El piloto respeta las cuotas, SHA, activos privados, revisión y PDF de #66/#65.

## Antes de activar en producción

1. Integrar esta PR tras revisar sus resultados, sin merge automático. Identificar el dominio Vercel y el proyecto Supabase reales. Confirmar copia de seguridad y migraciones previas, especialmente 026/028/029. La inspección es distinta de aplicar 030.
2. Consultar `INSPECCION.sql` (solo lectura) para comprobar versión y permisos. Si faltan tablas/columnas, no activar flags. Revisar suscripciones previas de la cuenta sin cambiar sus condiciones.
3. Aplicar **solo 030**, una vez autorizada su aplicación concreta. Ejecutar de nuevo la inspección. La migración por sí sola no concede Max, no cambia el catálogo y no activa generación.
4. En Stripe, seleccionar un sandbox/modo TEST. Crear manualmente producto/precio recurrente mensual en EUR, IVA incluido, por el importe Max que indique la base (49,90 € si 026 está aplicada). Copiar únicamente el ID `price_…`. No crear precios live ni introducir tarjetas reales. Utilizar las tarjetas de prueba que documente Stripe.
5. Crear un destino webhook de TEST `https://adaptaula-nine.vercel.app/api/stripe/webhook`, suscrito a `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`. No seleccionar un destino live. Configurar la versión de contrato indicada o verificar explícitamente su compatibilidad. La API vuelve a recuperar los datos; un evento de prueba genérico sin asociaciones válidas no concede acceso.
6. En Vercel → proyecto → Settings → Environment Variables → Production, introducir valores mediante su gestor seguro. Nunca por chat ni Git:

| Variable | Configuración |
|---|---|
| `STRIPE_SECRET_KEY` | Clave de sandbox que comienza por `sk_test_`; el código rechaza `sk_live_` y claves restringidas no verificadas. |
| `STRIPE_WEBHOOK_SECRET` | Secreto `whsec_…` del destino TEST exacto. |
| `STRIPE_PILOT_PRICE_ID` | ID de precio TEST verificado. |
| `STRIPE_PILOT_ENABLED` | `true` únicamente para iniciar esta prueba privada. |
| `AI_IMAGES_PILOT_MODE` | `production-pilot`. |
| `AI_IMAGES_PILOT_SUPABASE_URL` | URL exacta del proyecto usado por la app. |
| `AI_IMAGES_PILOT_WORKSPACE_ID` | UUID del único workspace autorizado. |
| `NEXT_PUBLIC_SITE_URL` | `https://adaptaula-nine.vercel.app` (dominio facilitado por el usuario). |
| `FLAG_AI_IMAGES_ENABLED` | **`false` durante la prueba Stripe**. |

Conservar Supabase/Auth existentes. `VERCEL_ENV=production` lo establece Vercel. No cambiar modelos ni prompts. Redeploy únicamente después de confirmar la configuración; la app puede necesitar un nuevo despliegue para recoger variables.

## Prueba Stripe sin coste real

- Abrir Plan y cuenta como propietario autorizado. La sección privada no se publica para otras cuentas. Si 030 falta o falla su lectura, no se ofrece un botón operativo.
- Abrir Stripe TEST y completar con sus datos de prueba. Volver a la cuenta no confirma el plan; recargar después de que el evento tenga respuesta 200. Si falla, inspeccionar solo códigos/IDs; no copiar payloads con datos personales a logs o Git.
- Confirmar `workspace_plan()` Max y cinco imágenes para el workspace del piloto, mientras la tabla `plans` sigue en cero. Otra cuenta debe seguir con su plan y sin sección privada.
- Reenviar **el mismo evento TEST**: no debe duplicar suscripción ni extender `expires_at`. No modificar registros de otros usuarios para probar aislamiento.
- Suscripción previa: se bloquea el inicio. No borrar ni sobrescribirla para hacer pasar el ensayo. Un marcador `manual-max-test:*` del SQL de conversación también provoca ese bloqueo y requiere tratamiento separado.
- Stripe TEST puede mantener una suscripción de prueba recurrente después de la caducidad local; cancelar después en el sandbox. No es una suscripción cobrable ni se escribe en `billing_customers`. Una futura integración LIVE necesitará una transición explícita de estos registros de prueba: no basta con cambiar la clave.

## Ensayo de imágenes (coste real, todavía pendiente)

La propuesta de cinco es un cupo de aprobadas, no de llamadas ni de dólares. Las rechazadas devuelven cuota, pero su API puede cobrar. Se mantienen tres/adaptación, hasta dos intentos/imagen y 0,50 USD estimados por adaptación; no es límite absoluto de factura.

Antes de habilitar el flag: comprobar que no hay trabajos pendientes del workspace que puedan reanudarse y consumir API automáticamente; verificar disponibilidad del alias y tarifas, secretos de Anthropic/OpenAI mediante gestor seguro y presupuesto autorizado. Ver [guía del ensayo limitado](../max-visuales/PRUEBA_MANUAL.md). La parte que decía “nunca producción” describe #66; para este piloto privado aplica el modo y grant de 030. No ejecutar la generación real de esa guía ni Hacer magia hasta que se autorice su coste concreto. Stripe TEST no convierte OpenAI o Anthropic en gratuitos.

## Desactivar y recuperar

- Detener inicios nuevos: `STRIPE_PILOT_ENABLED=false`. Esto cierra también el webhook de este piloto; no hacerlo mientras se necesita reconciliar un evento pendiente sin registrar su estado. La caducidad SQL permanece efectiva aunque el webhook se apague.
- Detener nuevas imágenes: `FLAG_AI_IMAGES_ENABLED=false` y retirar la configuración del piloto. No cancela llamadas ya iniciadas.
- Revocar antes de los siete días: usar `REVOCAR.sql`, limitado al UUID del workspace y a su solicitud vinculada. Conserva registros y activos; no elimina documentos ni borra consumos. Revisar resultado con la inspección.
- Cancelar la suscripción únicamente en Stripe TEST. No revertir 030 borrando tablas/columnas mientras existan concesiones vinculadas; mantener el resolver que impide reactivarlas al caducar.
- Si falla una validación, no abrir contratación ni activar imágenes. La exportación personal actual no incorpora los metadatos nuevos de la solicitud Stripe; no se promete una copia completa de facturación. El piloto no es facturación comercial completa: no incorpora portal, facturas reales, cambios de plan, promociones, impuestos adicionales ni pagos live.

## Pruebas reproducibles

Pruebas focalizadas (ningún proveedor real):

```bash
pnpm exec vitest run tests/db/billing-pilot.test.ts tests/unit/stripe-pilot.test.ts tests/unit/stripe-pilot-routes.test.ts tests/unit/illustration-production-provider.test.ts tests/unit/boundaries.test.ts
pnpm exec playwright test tests/e2e/stripe-pilot.spec.ts
```

La UI privada configurada usa `tests/e2e/stripe-pilot-configured.spec.ts`: requiere `E2E_STRIPE_PILOT_STATE` apuntando al storageState de una cuenta **ficticia local**, y un segundo servidor Next local configurado con su UUID, `STRIPE_PILOT_ENABLED=true`, modo `local`, precio/secreto TEST ficticios y `FLAG_AI_IMAGES_ENABLED=false`. El test solo admite hostname loopback; intercepta **su propia API Checkout** para simular carga/error, nunca llama a Stripe. No guardar storageState en Git ni reutilizar una sesión real. Sin esa configuración, se omite expresamente.

```bash
E2E_BASE_URL=http://localhost:3101 E2E_STRIPE_PILOT_STATE=/tmp/stripe-ui-state.json pnpm exec playwright test tests/e2e/stripe-pilot-configured.spec.ts
```

Las capturas corresponden a ese panel real con cuenta ficticia y respuesta simulada. El flujo positivo servidor→Stripe se prueba con contratos de transporte controlados y RPC/BD local, todavía no de extremo a extremo con el proveedor.

## Evidencias

| Comprobación | Estado | Evidencia |
|---|---|---|
| Unidad/BD completa | PASS local | 1.967 correctas, 13 omitidas; 140 archivos correctos y uno omitido. |
| Dominio focalizado final | PASS local | 38/38: firma, TEST-only, autorización, RPC/BD, cuota, caducidad, aislamiento y rechazo de imagen mock. |
| PDF / regresiones #65/#66 | PASS local | 75/75; raster y carga desde trazas correctos. Sin cambios de renderer ni líneas base. |
| E2E completa | PASS local | 134/134, escritorio/móvil, 18,6 min, sin reintentos. |
| UI privada configurada | PASS con respuesta simulada | 2/2 adicionales en navegador real, escritorio/móvil; foco, carga/error y recuperación. No llama a Stripe. |
| Typecheck / build | PASS local | Binarios instalados equivalentes a los pasos de `check`. |
| Lint | PASS con aviso previo | 0 errores; `_id` sin uso en `analysis-run-auth.test.ts`. |
| Secretos | PASS local | 111 archivos revisados; sin coincidencias de valores configurados. |
| Dominio proporcionado | NO VERIFICADO | Túnel de red bloquea GET públicos de portada/precios, CONNECT 403 / destino 000. |
| Migración 030 / permisos remotos | PREPARADO, NO EJECUTADO | SQL de inspección, migración y revocación; no se ha escrito en Supabase remoto. |
| Checkout / webhook Stripe externos | PREPARADO, NO EJECUTADO | Contrato y servidor comprobados con mocks; falta validación del sandbox real. |
| Imágenes pagadas / Vercel PDF | NO EJECUTADO | No se ha autorizado un coste concreto ni utilizado un proveedor real. |

[Panel escritorio](capturas/piloto-privado-desktop.png) · [Panel móvil](capturas/piloto-privado-mobile.png) · [Error simulado escritorio](capturas/piloto-error-simulado-desktop.png) · [Error simulado móvil](capturas/piloto-error-simulado-mobile.png).

Distinguir verificado localmente, preparado para producción y verificado realmente en producción. Estos resultados no validan Stripe real, correo, Chromium en Vercel ni calidad pedagógica de imágenes de un modelo.
