# Adaptaula · lanzamiento comercial v1 · preflight (23/10/2026)

**Estado: NO-GO para contratación de pago.** Este documento es un inventario verificable del **repositorio**, no un certificado de producción o de cumplimiento jurídico. No se han conectado servicios externos, ejecutado SQL remoto, usado materiales reales ni activado pagos en esta entrega.

- **Base analizada:** `main` en `c45b7892107036b2c0a29a53eb125675f4d6bae2`, posterior a las PR #59 y #60.
- **Seguimiento del lanzamiento:** [issue #61](https://github.com/TinyChat-up/ADAPTAULA/issues/61).
- **Alcance de esta entrega:** ampliar la inspección de solo lectura para la migración 019 y fijar el orden, las pruebas y los criterios de salida al mercado. **No modifica la aplicación, CLARO, modelos, cuotas, precios ni base de datos.**
- **Estados:** `REPOSITORIO` = verificado en el código; `NO EJECUTADO` = requiere entorno real; `BLOQUEO` = impide vender. Ningún `REPOSITORIO` implica validación en producción.

## 1. Diagnóstico contrastado

| Área | Evidencia verificable | Situación de lanzamiento |
| --- | --- | --- |
| Código actual | PR #59 (PDF y reflow) y #60 (fallos de «Hacer magia») fusionadas en `main`; la #60 documenta 128/128 E2E en su entorno | **REPOSITORIO**; E2E remota no ejecutada en esta entrega |
| Protecciones de entrega | GitHub informa `main.protected=false`; no hay archivos `.github/workflows/` en el árbol de `main` | **BLOQUEO**: definir y aplicar CI + política de integración antes de cambios de cobro |
| Esquema 019 | `20261001001900_creation_mode.sql` añade `creation_mode` y sustituye `create_adaptation` por una firma con un parámetro adicional | **NO EJECUTADO** en Supabase; comprobar con `inspect-magic-019.sql` |
| Esquema 025–028 | Existe la auditoría de permisos y planes `scripts/staging/inspect-schema.sql` | **NO EJECUTADO** contra el proyecto remoto; especialmente crítico el cierre de la RPC antigua de baja (028) |
| Esquema 029 | `scripts/staging/inspect-upload-integrity.sql` comprueba guards, RLS y RPC del sistema de limpieza recuperable | **NO EJECUTADO** remotamente; no activar el cron nuevo sin procedimiento de despliegue y migración |
| PDF, Auth, RLS, Storage, correo | Existen `scripts/staging/pdf-probe.mjs`, `pnpm smoke:pdf`, `pnpm test:rls:real` y el guion 5B | **NO EJECUTADO** en staging/producción en esta entrega |
| Planes de pago | `src/lib/plans/upgrade.ts` indica contratación deshabilitada; `src/components/marketing/pricing.tsx` no ofrece checkout; no hay rutas Stripe operativas | **BLOQUEO**: solo Free es registrable |
| Precio Pro | `docs/ADAPTAULA_2.md` y 4A: 24,90 €/mes IVA incluido **provisional**; `docs/BILLING.md` mantiene una tabla anterior de 9,99 € | **BLOQUEO**: aprobar precio y unificar documentación/catálogo/Stripe antes de cobrar |
| Condiciones | `/terminos`, `/privacidad` y `/cookies` presentan textos aún pendientes de revisión | **BLOQUEO** para contratación |
| Borrado de cuenta | Exportación personal y solicitud de baja implementadas, pero la eliminación física y retenciones automáticas constan como pendientes | **BLOQUEO**: resolver proceso y obligaciones antes del lanzamiento |
| Calidad pedagógica | Fases B/C y corpus sintético documentados; revisión con docentes y materiales reales autorizados pendiente | **NO EJECUTADO**; validar antes de cobrar |

Fuentes internas: `AGENTS.md`, `docs/PROJECT_STATUS.md`, `docs/qa/adaptaula-2-etapa-5b/README.md`, `docs/qa/integridad-originales/README.md`, `docs/BILLING.md`, `docs/legal/REVISION_ESPECIALISTA.md`, `docs/PRIVACY.md`.

## 2. Fase A: inspección REMOTA estrictamente de solo lectura

**No ejecutar estas consultas en un entorno remoto sin confirmar primero el proyecto/destino y disponer de autorización de lectura.** No aplicar migraciones, no activar crons, no introducir credenciales en el repositorio y no copiar filas de usuarios en los resultados.

1. Identificar exactamente **proyecto Supabase, región, despliegue Vercel y SHA** que atienden a la app. Tomar nota del entorno (`staging` o `producción`) y fecha UTC; no almacenar URLs privadas ni claves.
2. En Supabase SQL Editor, ejecutar **por separado**, con permiso de consulta, estos tres ficheros, todos de solo lectura:
   - `scripts/staging/inspect-magic-019.sql` (**nuevo**): campo, restricción, firma actual y antigua de la RPC, y permisos.
   - `scripts/staging/inspect-schema.sql` (reutilizado): migraciones 025–028, cuotas Free/Pro/Max, firma y seguridad de baja, buckets.
   - `scripts/staging/inspect-upload-integrity.sql` (reutilizado): 029, guards y permisos de cleanup.
3. Consultar `select to_regclass('supabase_migrations.schema_migrations') as cli_history;`. **Solo si existe** la tabla y el rol tiene acceso, consultar el historial de 019 y 025–029 con:
   ```sql
   select version
   from supabase_migrations.schema_migrations
   where version in (
     '20261001001900', '20261001002500', '20261001002600',
     '20261001002700', '20261001002800', '20261001002900'
   )
   order by version;
   ```
   **Advertencia:** la instalación manual desde SQL Editor puede no dejar historial CLI. El resultado del catálogo de objetos y permisos prevalece sobre su mera ausencia. Una versión registrada tampoco demuestra que la migración con ese identificador conserve el contenido esperado.
4. Registrar **solo** IDs de comprobación, `PASS/FAIL`, fecha UTC, SHA y entorno. Cualquier `FAIL` o ambigüedad de permisos = **NO-GO**; diagnosticar y preparar un plan, nunca aplicar SQL automáticamente. Para 029, seguir [el procedimiento de seguridad de despliegue](../integridad-originales/README.md) antes de permitir el cron.
5. Con autorización **separada** de pruebas que creen datos, usar staging aislado y dos cuentas ficticias. Seguir el [procedimiento existente 5B](../adaptaula-2-etapa-5b/README.md): Auth/correo real, aislamiento A/B de RLS y Storage, cuotas Free, job/«Hacer magia», borrador, PDF en Vercel con sonda autenticada, prueba de renovación y controles de privacidad. No realizarlo con datos de menores ni claves de producción.
6. Una eventual **migración** necesita autorización distinta de la inspección, copia de seguridad, plan de reversión/compensación, ensayo staging y orden coordinado de cron/despliegue. No editar migraciones antiguas ya aplicadas para «arreglarlas».

**Registro de ejecución remota** (rellenar exclusivamente después de ver resultados):

| Entorno | Fecha UTC | SHA desplegado | 019 | 025–028 | 029 | Auth / RLS / Storage | PDF Vercel | Cuotas |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Staging | NO EJECUTADO | Sin confirmar | — | — | — | — | — | — |
| Producción (consulta únicamente) | NO EJECUTADO | Sin confirmar | — | — | — | — | — | — |

## 3. Decisiones y secuencia para llegar a venta

### Entrega 1 — preflight (esta PR)
- [x] Auditar repositorio, migraciones, precio anunciado y servicios ausentes.
- [x] Recuperar una comprobación segura de migración 019 sin duplicar los diagnósticos de 025–029.
- [x] Publicar matriz de evidencia, condiciones de parada y responsables de la validación.
- [ ] Obtener resultados reales autorizados de las tres consultas y del despliegue.

### Entrega 2 — barrera de integración
- [ ] Crear GitHub Actions para `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm smoke:pdf` y `pnpm check:secrets`, con versión de Node/pnpm compatibles; dimensionar los smoke PDF/Chromium y separar la E2E final.
- [ ] Tras probar CI, configurar reglas de protección de `main` (revisión y checks obligatorios) con autorización administrativa.
- [ ] Registrar prueba negativa ante errores de PDF, login y cuota.

### Entrega 3 — pago Pro mensual, sin vender Max
- [ ] Aprobar el precio real (provisional 24,90 €/mes, IVA incluido) tras revisión de costes e IVA y resolver la tabla obsoleta de `docs/BILLING.md`.
- [ ] Implementar Checkout, firma e idempotencia de webhook, Customer Portal y sincronización de estado/periodos desde Stripe. Ningún retorno del navegador habilita el plan.
- [ ] Ensayar con Stripe en **modo de prueba**: alta, renovación, fallos y reintentos, webhooks fuera de orden, cancelación, degradación y plan vigente en BD. No activar live mode hasta completar todas las barreras.
- [ ] Comprobar facturas, política de cancelación, soporte y correo transaccional. Max y anualidades siguen sin contratarse.

### Entrega 4 — datos, garantías y contenido pedagógico
- [ ] Revisión jurídica profesional: titular, aviso legal, términos, privacidad, propiedad intelectual, responsable/encargado, DPA y subencargados, retención y derechos, encaje AI Act/EIPD y obligaciones comerciales.
- [ ] Implementar un procedimiento **efectivo, duradero, verificable** de baja y eliminación de Auth, filas y Storage, respetando la conservación legal acordada.
- [ ] Validar con 3–5 docentes y materiales propios sin datos personales (Matemáticas, Lengua y Ciencias), tanto fichas aceptadas como rechazos explicados, impresión, apoyos y espacio de respuesta.
- [ ] Medir costes por adaptación/análisis, tasa de entrega, incidentes de PDF y viabilidad del plan Pro. Verificar canal de asistencia.

## 4. Decisión GO / NO-GO

**GO solo para abrir el cobro:** pruebas críticas de staging y despliegue reales con evidencia, 019 y 025–029 coherentes y seguros, CI y control de rama, Stripe de prueba de extremo a extremo sin cobros indebidos, textos jurídicos definitivos revisados, proceso de derechos operable, materiales docentes validados y costes compatibles con las cuotas anunciadas.

**NO-GO** si hay un FAIL de migración/seguridad/RLS, PDF roto, Auth/correo sin entrega, cobros o suscripciones inconsistentes, páginas legales con «Pendiente», borrado solicitado sin vía efectiva de ejecución, o adaptación con errores pedagógicos graves. Un despliegue `Ready` en Vercel **no** acredita ninguna de esas condiciones.

## 5. Entrega y pruebas de este cambio

- Cambios limitados a **documentación y SQL de solo lectura**. El SQL únicamente consulta `information_schema` y `pg_catalog`, con `to_regprocedure`/permisos; no ejecuta la función inspeccionada.
- **No ejecutado:** comandos locales del proyecto, E2E, SQL remoto, migraciones, tests con datos o proveedor de IA, Stripe/Vercel/Supabase. No declarar un `PASS` de ejecución que no existe.
- PR de revisión sobre `main`; **no hacer merge ni desplegar sin autorización**. Siguiente acción: obtener evidencia autorizada de fase A y después abrir una PR técnica de CI independiente.
