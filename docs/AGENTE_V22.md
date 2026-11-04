# Agente pedagógico V2.2 · integración en Adaptaula

Estado: **integración parcial** (registro de decisiones y validadores deterministas). No es todavía la integración completa del agente V2.2: el planificador real no recibe la metodología V2.2 ni emite la prueba de pista. Decisión: [ADR-044](ARCHITECTURE.md).

## Qué es privado y dónde está

El agente V2.2 se desarrolló en un laboratorio aparte (`adaptaula-lab`, Python). Son **privados** y nunca entran en este repositorio ni en su historial:

- los documentos de reglas V2.2 (decisiones DEC, guía de presentación, formato de salida, perfiles de los pilotos);
- la biblioteca de precedentes (ciclos D-001 y D-002);
- el código, el historial y los informes del laboratorio;
- los materiales reales de prueba y sus oráculos.

Aquí solo se citan **identificadores** (DEC-021, P8, D002-R01…) para trazar de dónde sale cada comprobación. El texto de las reglas no se reproduce.

Control: `scripts/privacy/check-private-content.mjs` busca rutas reservadas, copias exactas de archivos privados y frases de documentos privados. Las frases se reconocen por huellas truncadas (`private-fingerprints.json`), que no contienen texto. Corre en cuatro sitios:

- en el hook de pre-commit (`.githooks`, que activa `pnpm install`);
- en `pnpm test` (`tests/unit/private-content.test.ts`);
- en `pnpm check:privacy`;
- en la CI (`.github/workflows/privacidad.yml`), que revisa cada commit de la PR y no solo el resultado final.

Una paráfrasis no se detecta, así que la revisión humana de la PR sigue siendo necesaria. Para regenerar las huellas hace falta la copia local del material privado:

```bash
node scripts/privacy/build-fingerprints.mjs <carpeta-o-archivo-privado>...
```

## Correspondencia laboratorio → Adaptaula

| Laboratorio (Python) | Adaptaula (TypeScript) | Decisión |
|---|---|---|
| Extractor de PDF a modelo de documento | Ingesta + `MaterialAnalysis v3` + localizador de visuales | No se porta: sería un segundo análisis |
| Generador determinista de PDF | CLARO + `pdf-export` | No se porta: sería un segundo generador |
| Verificación del PDF | `validatePdf` y pruebas PDF | Se conserva lo existente |
| Proveedores, gasto y compatibilidad de la API | `src/lib/ai`, `ai_runs`, cuotas | No se porta |
| Separación del análisis privado y el plan | `model-input.ts` (sin respuestas inferidas para planificador y generador) | Ya existe |
| VP1 esquema, VP2 integridad, VP5 coherencia | Zod, huellas y referencias de `validatePlan` | Ya existe |
| VP3 · apoyo con dimensión activa | `unjustified_change` | Ya existe |
| VP3 · límite de palabras por trozo | `v22/checks.ts › wordLimit` (reutiliza `instructionPieces` de la revisión) | **Portado** |
| VP3 · prueba de pista, parte determinista | `v22/checks.ts` | **Portado** (solo la parte determinista, ver abajo) |
| VP3 · medios no autorizados | `v22/checks.ts › conditionalMeans` | **Portado** |
| VP4 · fugas aproximadas | `text.ts › approximateLeak` | **Portado** |
| Autorizaciones firmadas | Revisión docente persistida (RLS) | No se porta: la plataforma ya autentica al docente |
| Registro de decisiones del plan | `decision-ledger.ts` | **Nuevo**, derivado en servidor |
| Perfiles ficticios A, B y C | Fixtures sintéticos de pruebas | **Reutilizado** en la regresión contrastiva |
| Biblioteca de precedentes | — | Pendiente: privada y fuera de esta entrega |
| Protección de atribución y licencia | — | Pendiente: requiere cambiar el análisis |

## Prueba de pista: qué se comprueba y qué no

Ninguna de las ocho preguntas se verifica por completo de forma automática. El informe distingue tres casos:

- **determinista**: se comprueba sobre datos tipados;
- **parcial**: se comprueba un indicio, y que no se cumpla no demuestra la ausencia de pista;
- **juicio docente**: no se comprueba y se presenta como pendiente.

| Pregunta | Cobertura | Qué comprueba la plataforma |
|---|---|---|
| P1 | Juicio docente | Nada |
| P2 | Parcial | Términos de glosario de la ficha que no aparecen en el material. La información de un recuadro no se valora |
| P3 | Parcial | Formato desigual (énfasis) entre las opciones de una misma pregunta |
| P4 | Parcial | Número de espacios igual al de partes de la respuesta inferida, mayor que el del original y que el que pide el enunciado |
| P5 | Juicio docente | Nada |
| P6 | Juicio docente | Nada |
| P7 | Parcial | Recurso añadido sobre un destino que el análisis marca como dudoso |
| P8 | Determinista (el indicador) | Diferencias de tipo o de proporción que la ficha introduce entre actividades con el mismo espacio y el mismo producto en el original. No se marca lo que pide el propio enunciado (productos distintos, número de resultados, extensión). Que una diferencia marcada sea pista lo decide el docente |

El significado de cada pregunta está en la documentación privada de V2.2 y no se reproduce aquí.

Ninguna comprobación V2.2 bloquea todavía una ficha. `auditAdaptation` (`src/lib/adaptation/v22/audit.ts`) ejecuta los validadores y construye el registro **aparte** de `validatePlan` y de la revisión pedagógica. No cambia el plan, el documento, el veredicto ni la entrega; en esta entrega tampoco se persiste ni se muestra en la interfaz. Así, «Hacer magia», el generador, los apoyos visuales y las fichas ya entregadas se comportan igual.

Hallazgo de la primera ejecución: con la ficha sintética de fracciones, `answer_space@v1` da cuadrícula al cálculo y renglones a la respuesta escrita. P8 no lo marca porque el original ya pide productos distintos. Sin esa excepción, el aviso saltaría en casi todas las fichas mixtas de Matemáticas.

## Registro de decisiones

`buildDecisionLedger` resume, para cada actividad:

- qué decisiones la cambian y con qué estado (aplicación directa, con justificación, validación docente o bloqueada);
- si el apoyo es individual o universal;
- qué necesidades del perfil no se aplicaron.

Solo afirma lo que se deduce de los datos. Lo que no puede deducirse aparece como «pendiente de revisión docente»; nunca se inventan barreras residuales ni justificaciones.

## Resultados de la regresión A/B/C (pipeline simulado, sin IA)

Fichas sintéticas de `evals/adaptation/fixtures.ts`.

| Ficha | Perfil | Decisiones | Actividades cambiadas | Necesidades no aplicadas pendientes | Avisos V2.2 | Veredicto |
|---|---|---|---|---|---|---|
| Fracciones (Primaria) | A | 1 | 1/5 | 19 | — | con avisos |
| | B | 2 | 2/5 | 12 | — | con avisos |
| | C | 0 | 0/5 | 0 | — | con avisos |
| Geografía (ESO) | A | 8 | 5/5 | 18 | P8 `act_1/act_3` | con avisos |
| | B | 3 | 3/5 | 8 | P8 `act_1/act_3` | aprobada |
| | C | 0 | 0/5 | 0 | P8 `act_1/act_3` | aprobada |
| Argumentación (Bachillerato) | A | 5 | 5/5 | 14 | P8 sobre `act_2` (4 pares) | con avisos |
| | B | 5 | 5/5 | 0 | — | con avisos |
| | C | 0 | 0/5 | 0 | P8 sobre `act_2` (4 pares) | con avisos |

- Las «pendientes» son necesidades activas que ninguna decisión aplica en esa actividad y cuyo motivo no se deduce de los datos. El registro no las justifica: las deja al docente.
- Los avisos P8 aparecen también con C. Vienen de `answer_space@v1`, que es universal, y no de una decisión individual:
  - en Geografía, dos cálculos con el mismo espacio original reciben cuadrícula y renglones;
  - en Argumentación, una respuesta escrita se amplía más que las demás.

  Queda registrado y no se corrige en esta entrega.

## Plan de conexión con el planificador real

Objetivo: que `adaptation_planner` razone con la metodología V2.2 y que la plataforma compruebe y muestre lo que declara, sin publicar la documentación original. Cada etapa es una PR, con pruebas y sin merge automático.

### Etapa 1 · Auditoría visible (sin IA ni gasto)

- Ejecutar `auditAdaptation` en servidor al cargar la revisión del plan y la ficha entregada (`page-data`). Se recalcula bajo demanda, así que no hace falta migración.
- Mostrar al docente un panel «Registro de decisiones», con el copy de `docs/UX.md` y sin nombres técnicos. Para cada actividad:
  - qué se cambia y por qué necesidad;
  - lo que queda pendiente de su revisión;
  - los avisos P8, P2, P3, P4 y P7, con su cobertura («comprobado» o «indicio; revisar»).
- Pruebas: unidad del modelo de vista, E2E de la pantalla de revisión (escritorio y móvil), accesibilidad.

### Etapa 2 · Reglas privadas fuera del repositorio (requiere ADR y tu aprobación)

- Guardar las reglas V2.2 y la biblioteca en un almacén privado del servidor: un bucket privado de Supabase leído con el cliente admin (`server-only`) o una variable de entorno de Vercel.
- En el repositorio solo quedan:
  - el identificador y la huella SHA-256 de cada versión (`agent_rules@v2.2` → `fdda7e6d…`);
  - el código que las carga, que verifica la huella y falla cerrado si no coincide.
- `ai_runs` registra la huella de las reglas usadas, nunca su contenido.
- Portar la selección de precedentes del laboratorio a TypeScript:
  - siempre las reglas estables;
  - todos los casos E/R del perfil;
  - los casos A/P cuyos recursos coincidan con las operaciones posibles.
- El índice de la biblioteca también es privado.
- Alternativa, si prefieres no depender de un almacén: redactar en el prompt público solo las reglas comprobables, con redacción propia. La metodología queda entonces parcialmente pública. Recomiendo el almacén privado.

### Etapa 3 · Contrato `adaptation_planner@v3` (sin gasto)

- Nuevo prompt `prompts/adaptation-planner/v3.ts`. El texto público es solo la estructura y las reglas de la plataforma; las reglas V2.2 se insertan en servidor, delimitadas y con su huella.
- El borrador v3 añade, por decisión:
  - la prueba de pista declarada (las preguntas P1–P8 que el modelo responde «sí»);
  - el estado («activa» o «condicionada», con su pregunta al docente);
  - las barreras residuales declaradas;
  - los precedentes citados.
- Se normaliza a `AdaptationPlan v1` (sin cambiar el plan) más una parte «declarada» del registro.
- Lo que declara el modelo nunca da nada por comprobado:
  - un «sí» genera revisión docente;
  - un «no» en P1, P5 o P6 sigue pendiente;
  - un precedente citado que no estaba en la petición se marca, como el VP3 del laboratorio.
- El esquema debe caber en las salidas estructuradas. El laboratorio midió que plan/1.1 excedía el límite de parámetros opcionales, así que el contrato v3 será compacto. Una prueba unitaria contará los opcionales del esquema generado.
- Pruebas: planificador simulado v3, regresión A/B/C, contrato y límites del esquema.

### Etapa 4 · Evaluación con el modelo real (cuesta dinero: solo con autorización expresa)

- Materiales MAT-007 y MAT-024 en `evals/adaptation/private/` (ignorado y bajo el control de privacidad), con los perfiles A, B y C.
- Campaña mínima: 2 materiales × 3 perfiles = 6 llamadas al planificador. El laboratorio estimó un máximo de unos 0,55–0,58 € por llamada con 32 000 tokens de salida, así que el techo ronda los 3,5 €.
  - Antes, medir el contexto con el recuento de tokens (también es una llamada que hay que autorizar).
  - Fijar un límite de gasto en la consola del proveedor.
- Se comparan las decisiones con las salidas revisadas del laboratorio. La revisión docente decide; ningún resultado se convierte en regla sin un segundo caso.

### Etapa 5 · Activación

- Activar v3 (`ACTIVE_ADAPTATION_PROMPT_VERSIONS`) solo después de revisar la etapa 4.
- Promover cada comprobación de aviso a `review` cuando haya evidencia. Ninguna pasa a `block` sin una decisión docente.
- Decidir la política de `answer_space@v1` ante P8: espacios homogéneos entre actividades comparables, o confirmación docente.

### Decisiones pendientes

1. Almacén privado de las reglas (recomendado) o reglas comprobables en un prompt público.
2. Si el registro se persiste (migración) o se recalcula bajo demanda (recomendado al principio).
3. Presupuesto y materiales de la etapa 4.
4. Política de `answer_space@v1` frente a P8.
5. Derechos de uso de MAT-007 y MAT-024 antes de usarlos fuera del laboratorio.
