# Finalidades del tratamiento, autorizaciones opcionales y corpus de mejora

> **Esto no es asesoramiento jurídico ni garantiza el cumplimiento.** Es una propuesta técnica y de producto para revisar con
> asesoría especializada en protección de datos y en propiedad intelectual antes del lanzamiento. La lista de lo que hay que
> revisar está en [REVISION_ESPECIALISTA.md](REVISION_ESPECIALISTA.md).
>
> Lo marcado **PENDIENTE** no se ha decidido ni comprobado, y no debe rellenarse con datos supuestos.

**Situación de partida:** [AUDITORIA_DATOS.md](AUDITORIA_DATOS.md).

**Decisión de arquitectura:** ADR-028 en [ARCHITECTURE.md](../ARCHITECTURE.md).

## 1. Objetivo

Adaptaula debe mejorar su análisis y sus adaptaciones con fichas cuyo uso esté justificado. En esta etapa decide y dirige la
mejora el equipo. Las fuentes, por orden:

1. Fichas originales creadas por el equipo expresamente para evaluar.
2. Más adelante, fichas aportadas por usuarios, solo con autorización adecuada y base legal revisada.

No hay aprendizaje automático a partir de las preferencias de los docentes ni reentrenamiento continuo, y esta PR no los
prepara.

## 2. Tres finalidades separadas

| | Finalidad | Qué incluye | Fundamento previsto (**PENDIENTE de validar**) | Estado |
| --- | --- | --- | --- | --- |
| **A** | Prestar el servicio | Analizar y adaptar la ficha que el docente pide; conservarla en su espacio mientras no la borre | Ejecución del contrato con el docente o el centro (art. 6.1.b RGPD) para sus datos de cuenta. Para los datos de terceros que contenga la ficha, el papel de Adaptaula (encargado o responsable) está por determinar (§5) | Implementado |
| **B** | Evaluación interna y mejora de los algoritmos de Adaptaula | Copiar la ficha a un corpus interno, anotarla, reproducir errores y medir versiones de reglas, prompts, OCR o geometría. Sin cederla a terceros para entrenar | Autorización expresa y separada, por material. Para la reutilización del contenido hace falta además una **licencia** de quien tenga los derechos (§4). Si la ficha no tiene datos personales, el RGPD afecta sobre todo al registro de la autorización | **No activo**: solo se admiten fichas propias |
| **C** | Entrenamiento o ajuste fino de modelos | Usar fichas para entrenar o ajustar un modelo, propio o de un tercero | Requisitos y autorización diferenciados, acuerdo específico y análisis de impacto previo. **No se ofrece** | **Desactivado en el código** (`trainingEnabled: false`) |

**Reglas que se derivan:**
- Aceptar los términos o subir un fichero solo cubre A. Nunca equivale a autorizar B ni C.
- B no implica C, y C no implica B. Cada una tiene su propio registro.
- Una autorización vale para **un material concreto** (id y SHA-256 de sus bytes) y **una finalidad**. No hay autorizaciones
  globales para «todo lo que suba».
- Usar el servicio no depende de autorizar B o C.

## 3. Mecanismo de autorización opcional (diseño)

El contrato está en `src/lib/schemas/improvement-corpus.ts` y las reglas en `src/lib/corpus/admission.ts`. Las pruebas están en
`tests/unit/improvement-corpus.test.ts`.

| Requisito | Cómo se cumple en el diseño |
| --- | --- |
| Desactivado por defecto | La autorización es un registro aparte que solo crea una acción explícita (`channel: "explicit_opt_in"`, el único valor válido). Sin registro, el material queda fuera (`authorization_missing`) |
| Finalidad específica explicada | Cada registro guarda `noticeVersion` y `noticeSha256`: la versión y el hash del texto que se mostró. Una versión no publicada invalida la autorización |
| Usar el servicio sin autorizar | A no consulta nunca estos registros |
| Retirada | `revokedAt`. `applyRevocation()` excluye del corpus todas las entradas que dependen de esa autorización; después hay que borrar sus copias |
| Límites y plazos | `expiresAt` es obligatorio y no puede superar `maxRetentionDays`. **El plazo está PENDIENTE (`null`), y mientras lo esté no se admite ninguna contribución** |
| Prueba de qué, cuándo y bajo qué información | El registro guarda quién (`grantedBy`), qué material y bytes (`materialId`, `materialSha256`), finalidad, fecha y versión con hash del aviso |
| Sin uso retroactivo | `mechanismEffectiveAt` es hoy `null`, así que nada es admisible. Cuando exista, una autorización anterior a esa fecha, o un material **subido** antes de ella, se rechaza. Para aportar un material antiguo habría que volver a subirlo con el mecanismo ya activo |
| Declaraciones del docente | Derechos sobre el contenido, ausencia de datos personales y material del centro. Son declaraciones, no pruebas: siguen haciendo falta la licencia verificada y la revisión de privacidad |

**Política en vigor** (`CURRENT_CONTRIBUTION_POLICY`):
- sin mecanismo, sin aviso publicado y sin plazo confirmado;
- sin acuerdos con centros;
- `trainingEnabled: false`.

El resultado es que hoy **ninguna ficha de usuario puede entrar** en el corpus.

**Borrador del aviso de contribución.** No está publicado ni se muestra en la aplicación. Se mostraría junto a un control
desactivado por defecto:

> «Puedes ceder esta ficha, de forma voluntaria, para que el equipo de Adaptaula la use **solo** para evaluar y mejorar
> internamente cómo analiza y adapta materiales. No es necesario para usar el servicio. Al hacerlo declaras que la ficha es tuya o
> que tienes permiso de su autor para este uso, y que no contiene nombres, respuestas, notas, fotografías ni otros datos de
> alumnos u otras personas. Revisaremos la ficha antes de incluirla. No se usará para entrenar modelos ni se entregará a terceros
> para ello. Se conservará como máximo [PENDIENTE] y puedes retirar la cesión cuando quieras desde [PENDIENTE]: la retiraremos
> del conjunto de evaluación y borraremos nuestra copia en [PENDIENTE]. Responsable: [PENDIENTE]. Más información: [enlace a la
> política].»

**No se añade ninguna casilla en la interfaz** mientras el servidor no registre la autorización como se describe en §8. Una
casilla que no se registra prometería algo que no se cumple.

## 4. Datos personales frente a derechos de autor

Son dos permisos distintos, y ninguno sustituye al otro:

- **Datos personales (RGPD/LOPDGDD).** Afectan a la información sobre personas que aparezca en la ficha y al propio registro de
  la autorización (datos del docente).
  - Un docente no puede consentir en nombre del alumnado ni de otras personas. Por eso **el corpus solo admite fichas sin datos
    personales de terceros**; no se buscan bases legales para incluirlos.
- **Contenido protegido (TRLPI, Real Decreto Legislativo 1/1996).** Copiar una ficha a un corpus y crear versiones derivadas son
  actos de reproducción y transformación.
  - Solo puede autorizarlos quien tenga los derechos. Fichas de editoriales, cuadernos comerciales y materiales del centro o de
    compañeros no son del docente que las sube.
  - La declaración «es mía» no prueba la autoría. La entrada exige `rights.status = licence_verified`, con evidencia
    (`declared_third_party_rights`, `rights_not_verified`).
  - Posibles excepciones legales, como la ilustración con fines educativos o la minería de textos y datos (art. 32 y siguientes
    del TRLPI, tras su transposición), **no se usan como base** mientras no las valore un especialista. La finalidad B no es
    docencia.
- **Material de un centro.** Se tramita mediante acuerdo con el centro (`institutional`), no con la autorización individual de
  un docente (`institutional_requires_agreement`).

## 5. Protección reforzada del alumnado

**Nunca entran al corpus, ni para B ni para C:**
- fichas con datos identificables del alumnado;
- informes médicos, diagnósticos o datos de salud;
- calificaciones vinculadas a alumnos;
- fotografías identificativas;
- respuestas o trabajos personales de menores;
- identificadores ocultos en metadatos;
- datos personales de terceros.

Cada caso es un hallazgo de la revisión de privacidad (`PRIVACY_FINDINGS`), y cualquier hallazgo bloquea la entrada.

**Sobre la anonimización:**
- **Sustituir nombres por códigos es seudonimización, no anonimización.** Sigue siendo un dato personal (considerando 26 del
  RGPD), y por eso existe el hallazgo `pseudonymised_student_data`, que también bloquea.
- No se ofrece un servicio de «anonimizar y aportar». Si una ficha necesita anonimización, no se admite.
- **Los metadatos** (autor, dispositivo, GPS, historial del PDF) pueden identificar. Hoy los originales se guardan sin
  limpiarlos ([auditoría §1](AUDITORIA_DATOS.md#1-subida-y-almacenamiento-de-materiales)).
- La revisión debe examinar los metadatos y la copia del corpus debe ser una versión limpia.

**Centros educativos:**
- Cuando un centro contrata Adaptaula para su profesorado, se prevé que el centro (o la administración educativa titular) sea
  **responsable** del tratamiento y Adaptaula **encargado** (art. 28 RGPD), con un contrato de encargo que limite el tratamiento
  a la finalidad A.
- Un encargado no puede usar los datos para sus propios fines. Cualquier otra finalidad (B o C) exigiría:
  - un **acuerdo específico y separado**, que defina finalidad, datos excluidos, plazos, devolución y borrado y quién atiende los
    derechos;
  - que la base jurídica la determine el centro como responsable.
- Hay que tener en cuenta la disposición adicional 23.ª de la LOE (datos del alumnado) y la normativa autonómica. **PENDIENTE de
  valorar.**

**Retirada y modelos entrenados:**
- La retirada **sí puede cumplirse** en B: se excluye la entrada, se borra la copia y los resultados de evaluación guardan solo
  códigos y recuentos.
- **No se puede prometer que un modelo ya entrenado «desaprenda» un documento de inmediato.** Las técnicas de desaprendizaje
  automático no garantizan eliminar la influencia de un ejemplo, y reentrenar sin él es costoso y no inmediato.
- Por eso C queda desactivado. Si algún día se valora, solo con datos sobre los que se puedan atender derechos y retiradas
  (idealmente sin datos personales y con licencia que admita el entrenamiento), y con este límite explicado antes de pedir la
  autorización.

## 6. Estado real de los proveedores

Lo que sigue es lo que dice la **documentación pública** consultada el 2026-10-15. **No se ha comprobado:**
- qué contrato, condiciones comerciales o DPA ha aceptado o firmado Adaptaula con cada proveedor;
- la configuración real de las organizaciones y proyectos (retención, residencia, ZDR);
- los modelos configurados en producción.

Hay cuatro cosas distintas en juego:

1. **Inferencia para producir la adaptación (A).** Ocurre en cada análisis o adaptación y lleva contenido.
2. **Conservación y registros del proveedor.** Registros de abuso, estado de aplicación, ficheros y lotes.
3. **Entrenamiento propio de Adaptaula (C).** No existe.
4. **Posible uso de los datos por el proveedor para sus modelos.**

Ningún corpus privado se transmite a terceros para entrenar. Esta PR no lo autoriza.

| Proveedor | Qué recibe hoy (código) | Documentación pública | No comprobado / PENDIENTE |
| --- | --- | --- | --- |
| **Anthropic** (API de Claude) | Original completo en el análisis, PNG de página en la localización visual, texto derivado en la adaptación | [API and data retention](https://platform.claude.com/docs/en/manage-claude/api-and-data-retention) (detalle abajo) | Condiciones comerciales y DPA aceptados; ZDR; modelos en producción. El código no envía `inference_geo` ni ningún parámetro de retención |
| **OpenAI** (Images) | Solo el prompt construido desde el brief, sin material ni datos del alumnado | [Your data](https://developers.openai.com/api/docs/guides/your-data) (detalle abajo) | Proyecto, aprobación de controles, región y DPA. El código usa el dominio por defecto, sin prefijo regional |
| **Supabase** | Todo lo almacenado: cuenta, materiales, análisis, adaptaciones y perfiles funcionales | [DPA de Supabase](https://supabase.com/legal/dpa), que se firma desde el panel | Si el DPA está firmado; región real del proyecto (los documentos dicen Frankfurt, sin verificar); mecanismo de transferencia |
| **Vercel** | Peticiones y respuestas en tránsito; logs de las funciones | [DPA de Vercel](https://vercel.com/legal/dpa) (Vercel como encargado) | Aplicabilidad según el plan contratado; contenido de los logs de runtime; transferencias (CDN global) |
| **Stripe**, correo transaccional | Pagos y avisos | No revisado | PENDIENTE |

**Anthropic, según su documentación pública:**
- Los datos conservados no se usan para entrenar sin permiso expreso.
- Por defecto no conserva el contenido de las conversaciones, salvo con los «Covered Models» (Fable 5/5.1 y Mythos 5/5.1), que
  exigen 30 días de conservación.
- La retención cero (ZDR) requiere aprobación por organización. Files API, Batch y ejecución de código no están cubiertos por ZDR.
- Existe residencia de inferencia (`inference_geo`).

**OpenAI, según su documentación pública:**
- Los datos de la API no se usan para entrenar salvo que el cliente lo active.
- Los registros de monitorización de abusos se conservan hasta 30 días; en los endpoints de imágenes, sin estado de aplicación.
- ZDR y la monitorización modificada requieren aprobación previa.
- La residencia en Europa requiere aprobación y una enmienda contractual.

**Corrección documental:**
- `PRIVACY.md` y `AI_PIPELINE.md` dicen que las llamadas usan «configuraciones sin entrenamiento y retención mínima o nula».
  Eso no es una configuración del código: es una condición contractual o de cuenta que falta verificar.
- La tabla de subencargados debe completarse con contratos firmados, regiones comprobadas y mecanismos de transferencia
  (decisión de adecuación UE-EE. UU. o cláusulas tipo), no con suposiciones.

## 7. Corpus de mejora

**Registro mínimo** (`CorpusEntrySchema`):
- identificador técnico (`cx_*`) y SHA-256;
- familia de variantes;
- origen: propio, contribución autorizada o acuerdo con un centro;
- derechos verificados, con referencia a la evidencia;
- estado de la revisión de privacidad, con hallazgos;
- tipo de ficha, asignatura, etapa y dificultad;
- versiones de análisis y adaptación;
- códigos de error reproducidos (sin contenido);
- resultado esperado y su validación (rol, nunca nombre);
- partición;
- fecha de alta y exclusión con motivo.

**Particiones:**

| Partición | Para qué |
| --- | --- |
| `development` | Ajustar reglas y prompts |
| `evaluation` | Medir de forma independiente |
| `holdout` | Reserva que no se mira al ajustar |

Ninguna partición comparte bytes ni familia con otra (`splitProblems`): un reescaneo de la misma ficha no puede estar en
desarrollo y en evaluación a la vez.

**Admisión:** es manual, la decide el equipo y se registra.
- **No existe ninguna copia automática desde producción al corpus.** El esquema no tiene un origen «producción» y las
  contribuciones requieren un registro de autorización.
- No se usan trabajos de alumnos ni documentos privados para probar esta arquitectura. El ejemplo de `evals/corpus/` son cuatro
  fichas sintéticas escritas por el equipo, más una entrada hipotética que debe rechazarse.

**Almacenamiento futuro de las copias del corpus:** separado de los buckets de los clientes, con acceso restringido al equipo y
borrado al retirar o caducar. **PENDIENTE de decidir** (bucket propio o almacenamiento fuera de Supabase). Nunca en Git.

## 8. Esquema propuesto en Supabase (no aplicado)

Es una **propuesta para revisar**. No se ha creado ninguna migración ni se ha ejecutado SQL.

```sql
-- Autorizaciones opcionales (finalidad B). Inmutables salvo la retirada; evidencia de qué se autorizó y bajo qué aviso.
create table public.contribution_notices (
  version     text primary key,                 -- 'contribucion@1'
  text_sha256 text not null check (text_sha256 ~ '^[0-9a-f]{64}$'),
  published_at timestamptz not null,
  retired_at  timestamptz
);

create table public.contribution_authorizations (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  material_id     uuid references public.materials(id) on delete set null,  -- conservar la evidencia: plazo PENDIENTE
  material_sha256 text not null check (material_sha256 ~ '^[0-9a-f]{64}$'),
  purpose         text not null check (purpose = 'internal_evaluation'),  -- 'model_training' no se admite
  notice_version  text not null references public.contribution_notices(version),
  granted_by      uuid not null references public.profiles(id),
  granted_at      timestamptz not null default now(),
  expires_at      timestamptz not null,
  revoked_at      timestamptz,
  revoked_by      uuid references public.profiles(id),
  declarations    jsonb not null,
  check (expires_at > granted_at)
);
alter table public.contribution_authorizations enable row level security;

-- Lectura: miembros del workspace. Sin insert/update/delete directos: solo mediante RPC security definer.
create policy contribution_authorizations_select on public.contribution_authorizations
  for select to authenticated using (public.is_workspace_member(workspace_id));
```

**RPC propuestas** (`security definer`, `search_path` fijo):
- `grant_contribution(material_id, notice_version, declarations)`:
  - exige un rol de escritura en el workspace del material;
  - comprueba que el aviso está publicado y no retirado y que el material está `analyzed`;
  - copia `content_hash` como `material_sha256`;
  - calcula `expires_at` con el plazo aprobado.
- `revoke_contribution(id)`: cualquier miembro con rol de escritura; fija `revoked_at` y `revoked_by` y nunca borra la fila.
- Ninguna función de cliente puede leer o escribir el corpus. La copia al corpus la hace el equipo con service role, tras la
  revisión.

**Pruebas exigidas** antes de aplicar (PGlite y Supabase de pruebas):
- aislamiento entre workspaces;
- imposibilidad de insertar o actualizar sin RPC;
- un viewer no puede autorizar;
- la retirada solo marca la fila;
- `model_training` se rechaza por `check`;
- un aviso retirado no admite nuevas autorizaciones.

## 9. Decisiones pendientes (no inventar)

1. Identidad del responsable del tratamiento, contacto y, si procede, delegado de protección de datos.
2. Papel de Adaptaula frente a los datos que contienen las fichas de un docente individual (responsable o encargado), y modelo de
   contrato con centros.
3. Base jurídica de B (consentimiento o interés legítimo con oposición) y forma de la licencia de derechos de autor.
4. Plazo máximo de conservación de B y plazo de conservación de la evidencia tras la retirada.
5. Texto definitivo del aviso de contribución y su canal de retirada.
6. Contratos y configuraciones de Anthropic, OpenAI, Supabase, Vercel, Stripe y correo; regiones y transferencias.
7. Si hace falta una evaluación de impacto (EIPD, art. 35 RGPD) para el servicio y para B. Hay indicios: perfiles de necesidades
   de menores.
8. Encaje en el Reglamento de IA de la UE. El ámbito educativo tiene usos de alto riesgo (anexo III); Adaptaula no evalúa ni
   decide el acceso, pero debe valorarse.
9. Limpieza de metadatos de los originales y procedimiento de revisión de privacidad (quién la hace y con qué lista).
