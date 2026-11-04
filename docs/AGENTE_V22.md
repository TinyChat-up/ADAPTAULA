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
| VP3 · límite de palabras por trozo | `v22-checks.ts › instructionChunks` | **Portado** |
| VP3 · prueba de pista, parte determinista | `v22-checks.ts` | **Portado** (solo la parte determinista, ver abajo) |
| VP3 · medios no autorizados | `v22-checks.ts › unauthorizedMeans` | **Portado** |
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

| Pregunta | Cobertura | Qué se mira |
|---|---|---|
| P1 · marcar lo que el alumno debe identificar | Juicio docente | — |
| P2 · añadir información que el original no da | Parcial | Términos de glosario, ideas clave y recuadros que no aparecen en el material |
| P3 · tratar distinto opciones equivalentes | Parcial | Formato de las opciones de una misma pregunta |
| P4 · revelar número, orden o delimitación | Parcial | Huecos o casillas cuyo número coincide con una respuesta inferida |
| P5 · el recurso es el producto pedido | Juicio docente | — |
| P6 · predeterminar la estructura de la respuesta | Juicio docente | — |
| P7 · hacer visible una errata o ambigüedad | Parcial | Destino marcado como dudoso por el análisis |
| P8 · espacios que sugieren extensión o tipo | Determinista | Tipo y pauta de los espacios de respuesta entre actividades comparables |

Ninguna comprobación V2.2 bloquea todavía una ficha. Todas llegan como revisión docente o como aviso del registro, para no cambiar el comportamiento de «Hacer magia» ni de las fichas ya entregadas.

## Registro de decisiones

`buildDecisionLedger` resume, para cada actividad:

- qué decisiones la cambian y con qué estado (aplicación directa, con justificación, validación docente o bloqueada);
- si el apoyo es individual o universal;
- qué necesidades del perfil no se aplicaron.

Solo afirma lo que se deduce de los datos. Lo que no puede deducirse aparece como «pendiente de revisión docente»; nunca se inventan barreras residuales ni justificaciones.

## Siguiente paso

Conectar la metodología con el planificador real: ver «Plan de conexión con el planificador» en el registro de desarrollo de esta entrega.
