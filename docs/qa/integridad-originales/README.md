# Integridad de originales: finalización y limpieza de subidas

Fecha: 20/10/2026. Base `main` / `8a7e327`. Rama independiente `codex/integridad-originales`.
La PR #49 seguía abierta al iniciar: no se fusiona ni se modifica; su informe A1 se leyó desde su rama local. Esta entrega implementa ese hallazgo, sin una nueva auditoría ni rediseño. Product Design no requiere generar una interfaz para corregir esta operación de backend.

## Causa y reproducción previa

El cron anterior seleccionaba `uploading` de más de 60 minutos, borraba Storage y después hacía `DELETE materials ... status=uploading`. Una finalización entre selección y Storage conservaba la fila `uploaded` pero perdía el original. Además, incrementaba `removed` sin comprobar si el DELETE había afectado alguna fila. La URL firmada seguía siendo válida hasta dos horas: una subida de 90 minutos podía ser legítima.

`tests/unit/upload-cleanup-route.test.ts` controló esa intercalación sin pausas: devolvió al cron una selección antigua después de completar el material. **Antes del cambio falló:** el objeto desaparecía y se informaba `removed: 1`. Después pasa sin borrar el objeto y con contador cero. No hay evidencia de que el defecto haya ocurrido en producción; aquí solo se reproducen datos sintéticos locales.

## Solución mínima persistente

[Migración 029](../../../supabase/migrations/20261001002900_material_upload_integrity.sql).

- `materials.upload_expires_at`: ventana técnica de subida en PostgreSQL. La emisión de URL se hace después de persistir material y ruta. Tras obtener el token, `open_material_upload_window()` confirma dos horas completas antes de que el servidor lo entregue al navegador. Si no puede confirmar la ventana, no entrega el token ni borra los metadatos necesarios para recuperar.
- `complete_material_upload()`: bloquea la fila del material, comprueba actor/workspace/rol, ventana y ausencia de reclamación. Actualiza tamaño/páginas del archivo y estado/hash del material **en la misma transacción**. Los bytes se han validado previamente en el servidor. Solo `service_role` puede invocarla; un cliente no puede fingir validación con un hash enviado por RPC.
- `claim_material_upload_cleanups()`: bloquea candidatos `uploading` caducados usando `FOR UPDATE SKIP LOCKED`, excluye materiales con hash, jobs o adaptaciones y registra una reclamación irreversible con copia de todas las rutas. Comparte el lock de `materials` con la finalización. Después concede un lease de 330 segundos con token nuevo a cada trabajo que se puede procesar.
- `material_upload_cleanups`: tabla con RLS, sin acceso de clientes, con rutas UUID, intentos, próximo intento, lease, error técnico y fecha de borrado de fila. No contiene documentos, emails ni nombres de alumnos. No lleva FK que borre el seguimiento al eliminar un material/workspace.
- Los triggers bloquean actualizaciones y reutilización de una identidad de material reclamada, y que otro material vuelva a registrar una ruta de la lápida. La comprobación posterior al INSERT cubre también una espera por la unicidad de `storage_path`. Las identidades/rutas de archivos son inmutables. Una reclamación no puede perder su lista de rutas por una actualización tardía de `material_files`.
- El worker borra por ruta y consulta `Storage.info()` para confirmar ausencia: una respuesta DELETE vacía o parcial no basta. Solo después llama a `finish_material_upload_cleanup()`, que comprueba el token/lease y cuenta las filas que realmente elimina. No se mantienen transacciones PostgreSQL durante la red.
- Los rechazos de validación también se registran de forma atómica y recuperable. Ya no se hace un borrado ciego desde una petición de finalización fallida; si otra finalización ganó, el rechazo no toca ese original. Los rechazos pendientes no aparecen en la biblioteca.

### Por qué no pueden ganar las dos operaciones

Si la finalización obtiene primero el lock y confirma dentro de la ventana, el estado pasa a `uploaded` y el cron ya no es elegible para reclamarla. Si gana la limpieza, existe un registro duradero antes de acceder a Storage; la finalización devuelve `expired`, y los triggers impiden que una escritura antigua publique ese material. La comprobación se hace en la transacción que decide, no en una lectura de aplicación separada.

Una petición repetida de finalización reconoce el documento ya completado y no modifica el hash ni reserva un segundo análisis. Si la función cae después de confirmar `uploaded` y antes de pedir el análisis, conserva el comportamiento existente: el archivo queda recibido y se puede solicitar el análisis desde su pantalla.

## Ventana de subida y escrituras tardías

Se retira el corte de antigüedad de 60 minutos. El contrato es la duración de **7200 segundos** de las URLs firmadas de subida de Supabase; ese SDK no recibe aquí un parámetro de caducidad. Se confirma el plazo en PostgreSQL después de emitir la URL y antes de entregarla. Una prueba relaciona la ventana SQL con `ANALYSIS_LIMITS.signedUploadUrlSeconds`.

La migración da a las filas existentes una ventana completa de dos horas desde su aplicación: no puede conocer cuándo se emitió cada token antiguo. El nuevo campo no altera el contenido, hash, estado ni `updated_at` de los materiales completados. Las rutas históricas reconocidas `workspace/material/archivo` y las actuales `workspace/usuario/material/archivo` están cubiertas.

Caducar un token no permite afirmar que todos los PUT remotos iniciados antes hayan terminado. Por eso, tras el borrado confirmado, **se conserva la lápida con sus rutas y se vuelve a revisar cada día**, sin volver a contar el material eliminado. Una escritura tardía sigue identificada y se elimina en un reintento. No se inventa un plazo jurídico para destruir estas lápidas: no hay purga automática en esta entrega. No reutilizar esos IDs/rutas al restaurar un archivo; una restauración debe crear una identidad y ruta nuevas.

## Interrupciones y recuperación

| Punto de interrupción | Estado conservado | Recuperación |
| --- | --- | --- |
| Antes de guardar metadatos | No se ha entregado una URL de subida | Nueva petición de subida. |
| Tras guardar metadatos, antes/durante emisión de token | Material/ruta persisten aunque la petición falle | Al caducar la ventana, el cron los reclama. No se devuelve un token sin confirmar la ventana. |
| Durante validación/descarga del original | No hay un lock de BD sostenido en red | La RPC final decide contra el estado vigente. Un rechazo no borra un original completado por otra petición. |
| Tras reclamar, antes de Storage | Reclamación, rutas y lease persistidos | Otro cron recupera al vencer el lease; la finalización ya está excluida. |
| Storage falla o deja objetos presentes | Fila y metadatos permanecen; error fijo y siguiente intento | Reintento elegible al minuto; la ejecución efectiva depende del siguiente cron. |
| Storage devuelve ausencia incierta/permiso denegado | `storage_unconfirmed`; no se confirma el borrado de fila | Revisar/reintentar; no tratar un error genérico 400/403/503 como ausencia. |
| Objeto borrado, proceso cae antes del ACK | Fila, rutas, intentos y lease permanecen | Repetir el DELETE/consulta de ausencia y confirmar con el nuevo token. |
| Lease vencido y trabajador antiguo responde | Sus operaciones Storage solo afectan rutas abandonadas | Su ACK no puede borrar filas ni incrementar contadores. |
| ACK se confirma en BD pero se pierde la respuesta | Fecha de borrado y lápida permanecen | El resultado incierto no se anuncia como éxito; la repetición cuenta cero. El registro permite conciliar lo ocurrido. |
| Escritura remota termina después del primer barrido | La ruta sigue en la lápida | Revisiones posteriores; no se vuelve a dar de alta ese material. |
| Se agota el tiempo disponible del cron | Reclamaciones no procesadas mantienen su lease | Recuperación al caducar, sin borrar las filas por haber sido seleccionadas. |

El worker tiene un presupuesto blando de 20 s por lote y espera como máximo 8 s por operación de borrado/confirmación. Un timeout local no garantiza cancelar una operación remota ya aceptada: la seguridad depende de la reclamación irreversible y la recuperación, no de que la red se detenga. El cron procesa hasta 20 reclamaciones por ejecución; requiere vigilar el backlog. Los reintentos se vuelven elegibles al minuto, pero el cron actual es diario: no se promete eliminación inmediata ni una latencia fija. No se modifica el procesador de IA.

## Pruebas deterministas A–L

| Caso | Evidencia |
| --- | --- |
| A. Finalización gana | SQL completa, cron no reclama, bytes del original intactos. |
| B. Limpieza gana | Finalización devuelve `expired`; metadatos y estado reclamados no pueden actualizarse. |
| C. Solicitudes simultáneas | RPC concurrentes enviadas mediante `Promise.all`; exactamente un resultado ganador. |
| D. Storage falla/parcial | Error persistido, lista íntegra de rutas y posterior recuperación; respuestas vacías/parciales no prueban ausencia. |
| E. Storage borra y cae el proceso | Interrupción inyectada antes del ACK; fila persiste, lease se recupera y cuenta una sola eliminación. |
| F. Dos crons | Barrera explícita entre claim y Storage; el segundo no adquiere un lease vigente. E2E también lanza dos HTTP simultáneos. |
| G. Repetición/recuperación | Se vence el lease directamente en la BD de prueba; nuevo token, ACK antiguo rechazado y reintento correcto. |
| H. Ventana activa | Subida de 90 minutos todavía válida y apertura de ventana coherente con 7200 s, sin sleeps. |
| I. Aislamiento | Workspace B y lector no finalizan/rechazan A; clientes no ejecutan ninguna RPC administrativa ni leen las rutas de la cola. |
| J. Contadores | DELETE confirmado cuenta 1; fila ausente/repetición/ACK perdido o antiguo cuentan 0; lápida posterior no duplica el contador. |
| K. Idempotencia | Finalización repetida conserva hash y archivo; reutilización de análisis sigue sin doble consumo. |
| L. Compatibilidad | Migración sobre 028 con fila antigua; ventana conservadora y material completado intacto. Ruta histórica y ventana de datos nuevos. |

PGlite utiliza una conexión: permite controlar los dos órdenes y las barreras de aplicación, y ejecutar locks/SQL reales, pero **no equivale a un estrés multisesión de PostgreSQL/Supabase**. El fake de Storage prueba la integración y los fallos inyectados; no acredita el comportamiento del Storage desplegado. No se han usado pausas para provocar carreras ni datos educativos reales.

## Resultados ejecutados

- Regresión inicial de cron: FAIL antes del arreglo, PASS después.
- Pruebas nuevas de SQL/worker/Storage/cron: **25/25 PASS**.
- Regresión de todas las pruebas de BD local, justificada por los triggers globales nuevos: **386/386, 33 archivos PASS**; incluye pruebas nuevas, no sumar los recuentos como pruebas únicas.
- Lote focalizado adicional de servicios, validación, origen, despacho y fronteras: **89/89 PASS**, con solapamientos con el lote anterior.
- E2E local de subida, rechazo, caché, aislamiento, cron y limpieza nueva: **16/16 PASS**, escritorio y móvil; el E2E nuevo de integridad se repitió 2/2 tras cargar la migración definitiva. Proveedores simulados; ningún modelo pagado.
- Typecheck, build, escáner de secretos y `git diff --check`: correctos; lint sin errores, conserva un aviso previo en `analysis-run-auth.test.ts`.
- No se ha ejecutado la batería E2E completa ni se ha alterado CLARO/PDF. Las pruebas de exportación de BD están incluidas en la regresión de BD.

Comandos principales:

```bash
pnpm exec vitest run tests/db --maxWorkers=2
pnpm exec vitest run tests/unit/upload-cleanup-route.test.ts tests/unit/upload-cleanup-storage.test.ts
pnpm typecheck
pnpm lint
pnpm build
pnpm exec playwright test tests/e2e/materials.spec.ts tests/e2e/upload-integrity.spec.ts \
  --grep 'subir una ficha|contenido no es|más páginas|la imagen|otro usuario no accede|cron de limpieza|no se vuelve|dos crons'
```

En esta máquina se invocaron los ejecutables locales equivalentes para evitar una reinstalación automática de pnpm. El navegador se lanzó con Chromium 153 ya instalado, configuración temporal fuera del repositorio y sin flags que deshabiliten seguridad web. El E2E arrancó Next y `fake-supabase.mjs` locales; no apuntó a ningún servicio remoto.

## Antes de desplegar: tareas del responsable del entorno

**El código no está operativo en ningún Supabase remoto por publicar esta PR.** No se ha aplicado la migración ni ejecutado un despliegue desde esta sesión.

1. Revisar e integrar la PR manualmente. La #49 es independiente; no requiere fusionarla para aplicar este código. Verificar primero en un staging autorizado y aislado.
2. Identificar proyecto y esquema efectivos; resolver separadamente las migraciones anteriores pendientes y sus condiciones comerciales. Tener copia de seguridad verificable de BD y originales de Storage antes de aplicar 029; una copia de BD no equivale a una copia de los bytes de los archivos. No aplicar 025–029 en producción por inferencia de un historial vacío.
3. **Pausar el cron antiguo y las nuevas subidas/finalizaciones durante el cambio**, y comprobar que no quedan ejecuciones antiguas con acceso al mismo proyecto (incluidos previews). Esperar a que terminen las peticiones antiguas y sus operaciones de Storage. El cron antiguo borra antes de comprobar estado: desplegar la migración por sí sola no puede convertir ese acceso remoto en seguro.
4. Aplicar únicamente la migración 029 previamente autorizada al proyecto correcto; no editar migraciones ya aplicadas. Confirmar tabla con RLS, nueva columna y las cinco RPC exclusivas de `service_role` mediante [inspección de solo lectura](../../../scripts/staging/inspect-upload-integrity.sql). Los helpers de trigger/encolado no tienen EXECUTE para clientes.
5. Desplegar la versión compatible manteniendo el cron antiguo detenido. Verificar con identidades ficticias: subida/finalización, ventana activa, expiración controlada, dos crons y recuperación de un fallo Storage, conservación del original válido y ausencia de acceso cruzado.
6. Reactivar únicamente la versión nueva del cron y la entrada de materiales. Supervisar `claimed`, `removed`, `failed`, `deferred`, backlog y leases vencidos; nunca loguear tokens, URLs firmadas ni contenido.

Si falta 029, el cron nuevo responde 503 sin intentar un borrado alternativo; la emisión de subidas/finalización no promete éxito sin la RPC. Si una comprobación falla, mantener el mantenimiento/cron detenido, conservar filas y lápidas y desplegar una corrección. **No volver a activar el cron antiguo como rollback**, no hacer DROP de la tabla de seguimiento ni devolver materiales reclamados a un estado finalizable. La restauración de un original debe usar una ruta e identidad nuevas.

Las rutas heredadas que no coincidan con los dos formatos reconocidos bloquean la reclamación sin borrar archivos: requieren revisar los metadatos antes de reactivar la limpieza. No se fuerza su aceptación.

La existencia de objetos perdidos antes de esta corrección no se ha investigado. La reclamación protege el flujo nuevo; no reconstruye archivos que ya no existieran ni sustituye la validación real de Storage y de concurrencia multisesión previa al lanzamiento. No se modifica Stripe, planes, cuotas, pedagogía ni prompts.
