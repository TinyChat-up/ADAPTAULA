# Agente pedagógico V2.2 · integración en Adaptaula

Estado (2026-11-04), en dos entregas:

1. **PR #79**: registro de decisiones y validadores deterministas ([ADR-044](ARCHITECTURE.md)).
2. **Rama `feature/agente-v22-planificador-v3`**:
   - carga privada y verificada de las reglas y la biblioteca (fase A);
   - `adaptation_planner@v3`, que **decide** con ellas (fase B, [ADR-045](ARCHITECTURE.md)).

Todo está validado solo con modelos simulados. v3 **no está activo**: falta la evaluación con el modelo real, que no está autorizada, y conectar sus declaraciones al orquestador.

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

## Planificador v3: cómo usa la metodología (fases A y B)

```
reglas privadas (bucket agent-rules o copia local fuera del repo)
  → loadAgentRules: tamaño y SHA-256 de cada archivo contra manifest-v22.ts (falla cerrado)
  → buildRulesBlock: reglas estables + precedentes seleccionados, con versión y huella
  → adaptation_planner@v3: primera parte de la petición; después, contexto y material (igual que v2)
  → DraftAdaptationPlan v3 → AdaptationPlan v1 (sin cambios) + declaraciones cribadas
  → revisión: sin docente, lo condicionado o con pista que descarta el recurso se rechaza
  → generador, CLARO y apoyos visuales, igual que siempre
  → registro de decisiones: lo declarado, aparte de lo que la plataforma comprueba
```

Lo que el modelo declara nunca prueba nada:
- un «sí» en la prueba de pista retiene la decisión para el docente, salvo en P7, que solo se registra;
- un «no» no da por comprobada ninguna pregunta;
- un precedente citado que no iba en la petición se marca;
- una pregunta o una nota que revela una respuesta inferida no se muestra.

Una decisión cuya estrategia no sirve a ninguna de las necesidades que cita también se retiene para el docente (`strategy_not_for_need`).

## Selección de precedentes (optimizada antes de la primera prueba real)

El propio método pide leer los errores corregidos (E) y las alternativas rechazadas (R) **de los recursos que se van a usar**, y los casos de esos recursos. «Que se pueden usar» se decide con el catálogo de la plataforma: necesidades activas y aplicables → sus estrategias (`DIMENSION_STRATEGIES`) → los recursos de la biblioteca que esas estrategias pueden realizar (`RESOURCES_BY_STRATEGY`).

| Tipo de caso | Se envía si… |
|---|---|
| E y R | tocan un recurso general (conservar, solución propia, finalidad, paginación…) o uno habilitado |
| A y P | solo tocan recursos generales, o tocan un recurso específico habilitado |
| Control (`perfil_C`) | el contexto no tiene ninguna necesidad activa |

Por qué no se pierde cobertura:

- **Recursos inalcanzables.** Un recurso que ninguna estrategia del contexto puede realizar no se puede usar: v3 retiene cualquier decisión cuya estrategia no sirva a sus necesidades. Los espacios de respuesta los dimensiona `answer_space@v1` para todos los perfiles, así que el planificador solo llega a ellos con estrategias de formato de respuesta o de escritura.
- **Prueba por construcción** (`tests/unit/precedent-coverage.test.ts`, en CI). Se recorren las tres fichas, los 10 perfiles de prueba y cada necesidad por cada una de las 20 estrategias. Toda decisión aplicable solo realiza recursos de la selección, y toda estrategia ajena queda retenida.
- **Prueba con el índice real** (solo con la copia privada local). Ningún caso excluido toca un recurso utilizable; todos los E y R con recurso utilizable van; todo recurso específico de la biblioteca es alcanzable por alguna estrategia.

**Medida con las reglas reales.** Las reglas estables (DEC, guía, cómo consultar e índice) son fijas, unos 31.000 tokens, y nunca se recortan. Tokens estimados con caracteres / 2,4 (pesimista); con caracteres / 3, unos 20 % menos.

| Perfil | Casos antes → ahora | Bloque de reglas (tokens) | Entrada total por petición | Peor caso por llamada |
|---|---|---|---|---|
| A | 43 → **30** | 61.700 → **51.400** (−17 %) | ≈ 69.000 → **58.700** | 0,46 → **0,44 $** |
| B | 42 → **37** | 61.200 → **57.600** (−6 %) | ≈ 68.500 → **64.900** | 0,46 → **0,45 $** |
| C | 40 → **19** | 59.700 → **43.000** (−28 %) | ≈ 66.800 → **50.100** | 0,46 → **0,42 $** |

- Las cifras son de fracciones; geografía y argumentación dan lo mismo ±1.000 tokens.
- El ahorro en dinero por llamada es pequeño: la salida máxima (32.000 × 10 $/M = 0,32 $) domina el peor caso.
- Un recuento exacto necesita el endpoint de recuento de tokens, que también es una llamada a la API y no se ha hecho.

## Salidas estructuradas

Límites documentados en platform.claude.com («Structured outputs», leído el 2026-11-04):

- 24 parámetros opcionales y 16 con unión por petición;
- `additionalProperties: false` en todo objeto;
- `minItems` solo 0 o 1;
- sin `minLength`, `maxLength`, `minimum` ni `maximum`;
- sin recursión ni `$ref` externos;
- regex sin referencias hacia atrás, *lookaround* ni `\b`.

`src/lib/ai/structured-limits.ts` los comprueba sobre el esquema **exacto** que enviaría el SDK (`zodOutputFormat`):

| Esquema | Opcionales | Uniones | Problemas |
|---|---|---|---|
| plan v1 | 3 | 1 | 0 |
| plan v2 | 6 | 1 | 0 |
| **plan v3** | **11** | **1** | **0** |

- **Entrega.** v3 usa entrega `auto`: decodificación restringida, con vuelta automática al esquema en el prompt si la API respondiera «Schema is too complex».
- **Lo que valida Zod en local.** La prueba de pista obligatoria en los recursos y la existencia de las preguntas no se pueden expresar en el esquema. El SDK instalado también pasa `enum` y `pattern` a la descripción.
- **Pendiente.** La API tiene límites internos de gramática que no publica: la compatibilidad solo quedará demostrada en la primera llamada real.

## Piloto: MAT-007 con el perfil A (pendiente de tu autorización)

- **Material.** MAT-007 es una ficha de 2 páginas (CeDeC) bajo **CC BY-SA 4.0 España**, según su propio pie. Permite usarla y adaptarla con atribución; si una adaptación se distribuyera, tendría que llevar la misma licencia. Se usa solo en privado.
- **Comando.**

  ```bash
  pnpm eval:adaptation:pilot -- --material <ruta privada del PDF> --rules-dir <copia privada de las reglas> --profile A --budget-usd 1.00
  ```

  - Sin `--yes`: valida el material y las reglas y calcula las cotas, **sin llamar a la API**.
  - Con `--yes` y la clave en el entorno: hace exactamente **dos llamadas**. Primero el análisis (una sola, salida ≤ 16.000 tokens). Después recalcula la cota del planificador con el análisis real y solo lo llama (una sola vez, salida ≤ 32.000 tokens) si el gasto más esa cota cabe en el presupuesto.
  - Sin reparaciones ni regeneraciones.
- **Resultados.** Van a `evals/adaptation/private/pilot-v22/`, ignorada por git y con control de privacidad: análisis, contexto, plan v1, declaraciones, validación y registro, con las huellas de las reglas y los precedentes enviados, nunca su texto. El terminal muestra solo huellas y métricas.
- **Cota calculada hoy sin llamadas** (`STANDARD` = `claude-sonnet-5-5`, esfuerzo `medium` del registro; precios de `src/lib/ai/costs.ts`):

| Llamada | Entrada máxima | Salida máxima | Coste máximo |
|---|---|---|---|
| Análisis de MAT-007 (2 páginas) | 17.400 tokens | 16.000 | 0,2035 $ |
| Planificador v3 (todas las reglas, material ≤ 1,5 × la salida del análisis) | 96.469 tokens | 32.000 | 0,5612 $ |
| **Total** | | | **≤ 0,7647 $ ≈ 0,68 €** (a 1,12 USD/EUR; revisa el tipo de cambio) |

- **Por qué la cota es fiable.** La salida no puede superar `max_tokens`, y el razonamiento adaptativo cuenta dentro de ese límite. Toda la entrada se cobra como escritura de caché (1,25×), y el bloque de reglas se cuenta con los 45 precedentes. `tests/unit/pilot-v22.test.ts` comprueba que la cota previa nunca queda por debajo de la recalculada con el análisis.
- **Margen.** Cabe con holgura en el presupuesto de 10 €.
- **Antes de lanzarlo:** fijar un límite de gasto en la consola del proveedor y revisar el tipo de cambio.

## Activación (después de la evaluación)

- Persistir las declaraciones de v3 junto a la versión del plan. Esto sí exige migración.
- Conectar `normalizePlanV3` y `withholdForTeacher` en el orquestador. Hoy `checkPlanDraft` rechaza v3 de forma explícita.
- Subir las reglas al bucket:

  ```bash
  node --env-file=.env.local --import tsx scripts/agent-rules/upload.ts <copia> --upload
  ```

  Configurar `AGENT_RULES_SOURCE=storage`.
- Mostrar el registro y las preguntas al docente.
- Cambiar `ACTIVE_ADAPTATION_PROMPT_VERSIONS.adaptation_planner` a 3. Una decisión aparte, con la E2E completa.

## Riesgo residual de lo publicado en la PR #79

Los commits `47711ce`…`db63904` de la rama `feature/integracion-agente-v22`, que es pública, contienen en `AGENTE_V22.md` un resumen de una línea, **redactado por nosotros**, del sentido de cada pregunta P1–P8. También hay una descripción breve de los perfiles A y B. Se retiraron en `12632b7`, pero siguen en el historial.

- **Qué revelan:** la idea general de cada pregunta de pista. No revelan el texto de V2.2, sus decisiones DEC, su guía, los casos de la biblioteca, sus fuentes ni ningún material. La búsqueda de coincidencias de 5 palabras no encontró texto de los materiales.
- **Valoración:** riesgo **bajo**. Son principios de diseño accesible conocidos en la literatura, y sin las reglas, los criterios de aplicación y la biblioteca no permiten reproducir el agente. El riesgo sube si se quiere proteger la metodología como secreto empresarial: lo publicado indica qué se evalúa, aunque no cómo.
- **Opciones:**
  - mantener el historial (recomendado si el riesgo se acepta);
  - reescribir la rama de la #79 con squash y force-push. Necesita tu aprobación, y no borra copias, *forks* ni cachés ya hechas.

  No se reescribe nada sin aprobación.

