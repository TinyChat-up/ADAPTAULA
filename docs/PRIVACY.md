# Privacidad y protección de datos

> **Antes del lanzamiento comercial es obligatoria una revisión legal profesional** (RGPD, LOPDGDD, contratos de encargado del tratamiento y normativa autonómica sobre datos educativos). Este documento recoge decisiones de diseño, no asesoramiento jurídico. No afirmaremos que el producto "cumple el RGPD" por usar un proveedor concreto.

## Contexto

Los usuarios son profesionales adultos. Sin embargo, los perfiles describen necesidades de aprendizaje de **menores**, y las etiquetas (p. ej. "TDAH") pueden constituir datos de salud (categoría especial, art. 9 RGPD). El diseño minimiza esos datos por defecto.

Roles previsibles (a confirmar legalmente): para usuarios individuales, Adaptaula es responsable de los datos de la cuenta y encargado respecto a los datos de alumnado que introduce el docente; para centros, el centro es responsable y Adaptaula encargado (contrato de encargo).

## Minimización por diseño

- **Alias**: el perfil pide un `display_name` con el aviso *"Para proteger la privacidad, puedes utilizar iniciales o un alias."*
- **No se piden**: nombre completo, DNI, dirección, fecha de nacimiento, teléfono, fotografías, documentación médica ni informes. No se permite subir informes médicos.
- **Necesidades funcionales en lugar de diagnósticos**: el perfil funciona sin etiquetas. La columna `contextual_tags` se eliminó (migración 011) porque nada la usaba y invitaba a guardar etiquetas diagnósticas de menores.
- **Sin texto libre sobre el alumnado:** la columna `notes` se eliminó (migración 008) porque nada la usaba y invitaba a guardar información sensible.
- **Nombre de los ficheros:** el nombre original de un material se guarda solo como metadato saneado; no es un identificador ni se envía a la IA.
- **Sin cuentas de alumno** ni de menores.
- **Avisos en la subida**: *"Evita incluir información personal innecesaria en los materiales que subas."*

## Datos enviados a proveedores de IA

Solo el material, el contexto educativo, las dimensiones funcionales y la petición del docente (tabla completa en `docs/AI_PIPELINE.md`). Nunca el alias, las etiquetas ni la identidad del docente. **El análisis del material (fase 3) no usa ningún dato de alumnado:** solo el fichero y el contexto que el docente ha confirmado.

**Objetivo, no verificado:**
- que los proveedores no usen los datos para entrenamiento, con retención mínima o nula y procesamiento en la UE cuando exista;
- transferencias internacionales documentadas en el registro de subencargados.

**Esto no lo impone el código:** las llamadas no envían parámetros de retención ni de región. Depende de los contratos y de la
configuración de las cuentas, que están sin comprobar. Ver
[`legal/FINALIDADES_Y_CORPUS.md` §6](legal/FINALIDADES_Y_CORPUS.md#6-estado-real-de-los-proveedores).

**Ilustraciones generadas (migración 024).**
- El brief se escribe con la actividad, su objetivo, la descripción del visual que falta y los nombres de los apoyos de la ficha.
  Nunca lleva alias, perfil ni identidad del docente.
- El modelo de imagen recibe solo el prompt construido a partir de ese brief.
- La imagen se guarda en el bucket privado del workspace, sin URL pública. Se borra en cascada con su adaptación y su espacio de
  trabajo.

`ai_runs` y los logs **no guardan contenido**. Los evals usan materiales preparados internamente.

## Finalidades separadas y corpus de mejora (2026-10-15)

- **A · prestar el servicio:** la única finalidad activa.
- **B · evaluación interna y mejora:** requiere una autorización opcional, separada y por material, que aún no existe en el
  producto. Hoy solo entran fichas propias.
- **C · entrenamiento o ajuste fino:** desactivado en el código.
- Aceptar los términos o subir un fichero nunca autoriza B ni C.
- Fichas con datos del alumnado o de terceros: excluidas siempre. La seudonimización no cuenta como anonimización.

Diseño, contrato y decisiones pendientes: [`legal/FINALIDADES_Y_CORPUS.md`](legal/FINALIDADES_Y_CORPUS.md). Estado real
auditado: [`legal/AUDITORIA_DATOS.md`](legal/AUDITORIA_DATOS.md).

## Subencargados (registro inicial a completar)

| Proveedor | Finalidad | Región |
|---|---|---|
| Supabase | Base de datos, autenticación, almacenamiento | UE (Frankfurt) |
| Vercel | Hosting y ejecución | Funciones en `fra1`; CDN global |
| Anthropic | Procesamiento de IA de texto | A documentar (opciones de geografía de inferencia) |
| OpenAI | IA de imagen (Max: ilustraciones de «Hacer magia»; recibe solo el prompt construido desde el brief validado, nunca el material ni datos del alumnado). Proveedor alternativo de texto (sin uso) | A documentar |
| Stripe | Pagos | UE/EE. UU. |
| Proveedor de email transaccional | Emails de autenticación y avisos | A elegir (preferiblemente UE) |

## Retención

> **Objetivos de diseño, NO implementados** salvo el borrado de subidas abandonadas y el borrado individual de materiales sin
> adaptaciones. No existe job de retención, exportación, borrado de cuenta ni opción de borrado automático de originales. Los
> plazos están pendientes de revisión jurídica ([auditoría §3](legal/AUDITORIA_DATOS.md#3-conservación-y-borrado)).

| Dato | Retención por defecto (objetivo) |
|---|---|
| Ficheros originales | Hasta que el usuario los borre; opción "Eliminar originales automáticamente" (7/30/90 días) en Configuración → Privacidad |
| Adaptaciones y versiones | Hasta borrado; Free: historial visible de 30 días (los datos se conservan hasta borrado para no perder trabajo al cambiar de plan) |
| Exports PDF | Regenerables; los ficheros se borran a los 30 días |
| `ai_runs`, `product_events` | 13 meses (agregados después) |
| `audit_logs` | 24 meses |
| Cuenta eliminada | Borrado completo de datos y Storage en ≤ 30 días; se conserva solo lo que exige la ley (facturación en Stripe) |

Un cron diario aplicaría las retenciones. Hoy solo limpia subidas abandonadas.

## Derechos del usuario

> Objetivo. Hoy solo existe el borrado individual de materiales; ni la exportación ni el borrado de cuenta están implementados.

- **Exportar mis datos** (Configuración → Datos): ZIP con JSON de perfiles, materiales, adaptaciones y PDFs.
- **Eliminar cuenta**: confirmación reforzada; cancela la suscripción en Stripe y borra workspace(s) personales.
- Eliminar perfiles, materiales y adaptaciones de forma individual (borrado físico + Storage).

## Analítica y cookies

- Cookies estrictamente necesarias: sesión de Supabase, workspace activo y preferencias de UI.
- Previsto: analítica propia en servidor (`product_events`, hoy sin escritores) y Vercel Web Analytics sin cookies (no instalado). Por eso **no hace falta un banner de consentimiento** en el MVP; si se añade una herramienta con cookies, se añadirá también el consentimiento previo.
- Lista blanca de propiedades por evento; prohibido enviar `display_name`, notas, etiquetas o contenido.

## Centros (Fase 3)

Políticas de retención por centro, contrato de encargo, exportación y borrado institucional, y registro de actividades de tratamiento para el centro.
