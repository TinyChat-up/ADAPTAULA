# Piloto del planificador V3 desde la interfaz

Guía para probar `adaptation_planner@v3` (agente V2.2) desde la interfaz habitual de Adaptaula, en un entorno aislado, sin cambiar nada para el resto de usuarios. Decisiones técnicas: [ADR-046](../../ARCHITECTURE.md). Metodología y límites del agente: [AGENTE_V22](../../AGENTE_V22.md).

**Nada de esta guía está ejecutado.** El código está listo y probado sin red. Cada paso marcado con 🔒 necesita tu autorización expresa.

## 1. Estado real de staging (comprobado el 2026-11-06, solo lectura)

| Pieza | Estado comprobado | Consecuencia |
|---|---|---|
| Supabase | La organización tiene **un único proyecto de Adaptaula**, en pausa (`INACTIVE`), y otro proyecto ajeno. **No existe un proyecto de staging.** | Hay que crearlo antes de nada. |
| Vercel, variables | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` y `ANTHROPIC_API_KEY` son **una sola variable cada una, compartida por Producción y Preview**. | Hoy un Preview usa la misma base de datos y la misma clave de IA que producción. **Staging no es independiente.** |
| Vercel, despliegues | Cada push a las ramas de las PR #79 y #80 crea un Preview automático (8 en estado `READY`). Están protegidos por Vercel Authentication. | Esos Previews llevan las variables de producción. V3 no se puede activar en ellos (no hay variables del piloto) y el proyecto de Supabase está en pausa. |
| Rama de este piloto | `vercel.json` desactiva el despliegue automático de `feature/agente-v22-piloto-interfaz`. | Abrir la PR **no** despliega nada. |

No se ha consultado el contenido de ninguna base de datos ni se ha descifrado ninguna variable.

## 2. Qué protege el código, aunque se configure mal

- **Producción.** V3 nunca se ofrece en producción: no hay modo de producción y `VERCEL_ENV=production` lo bloquea. El libro de gasto se ignora en producción, para que un presupuesto copiado por error nunca frene a usuarios reales.
- **Un workspace y un backend.** V3 exige el workspace autorizado **y** que el backend sea exactamente `AI_PLANNER_V3_PILOT_SUPABASE_URL`. Pedido desde otro workspace, se rechaza antes de crear nada.
- **Sin reglas o sin presupuesto, no hay V3.** Además, las reglas solo estarían en el bucket del proyecto de staging: el proyecto de producción no puede ejecutar V3 aunque se le pida (fallo cerrado).
- **Versiones fijadas.** Cada adaptación guarda su planificador y la huella de sus reglas. Las demás adaptaciones siguen con el planificador actual.
- **Gasto.** Con `AI_PILOT_BUDGET_USD`, cada petición de pago se cuenta y se reserva antes de enviarse (§ 6). Las imágenes de pago no se crean en ese despliegue.

## 3. Preparación (🔒 todo requiere autorización)

1. 🔒 **Crear el proyecto Supabase de staging**, independiente y en la UE. Comprobar el límite de proyectos activos del plan; hoy hay dos en pausa.
2. 🔒 **Aplicar las migraciones 001–035** con la CLI de Supabase (`supabase link` al proyecto de staging, después `supabase db push`). Nunca a mano en el panel.
3. 🔒 **Verificarlo**: inspección de solo lectura del [procedimiento 5B](../adaptaula-2-etapa-5b/README.md) y `pnpm test:rls:real` contra staging ([SUPABASE_TESTING](../../SUPABASE_TESTING.md)).
4. 🔒 **Subir las reglas privadas** al bucket `agent-rules` de staging. Verificar primero sin subir: `pnpm agent-rules:verify <copia privada>`. Después, con las variables de staging cargadas: `node --env-file=.env.pilot --import tsx scripts/agent-rules/upload.ts <copia privada> --upload`.
5. 🔒 **Clave de IA exclusiva**: una clave de Anthropic solo para el piloto, con **límite de gasto en la consola** (≤ 10 €). Así su uso en la consola es exactamente el coste del piloto. OpenAI no hace falta en la primera ronda.
6. 🔒 **Variables de Vercel limitadas a la rama** `feature/agente-v22-piloto-interfaz`: en *Preview*, «Git branch» = esa rama. Se introducen en el panel de Vercel, nunca en el chat ni en Git.

   | Variable | Valor |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` | las del proyecto de **staging** |
   | `ANTHROPIC_API_KEY` | la clave exclusiva del piloto |
   | `AGENT_RULES_SOURCE` | `storage` |
   | `FLAG_PLANNER_V3_PILOT` | `true` (paso 9) |
   | `AI_PLANNER_V3_PILOT_MODE` | `staging` |
   | `AI_PLANNER_V3_PILOT_SUPABASE_URL` | idéntica a `NEXT_PUBLIC_SUPABASE_URL` de staging |
   | `AI_PLANNER_V3_PILOT_WORKSPACE_ID` | UUID de tu workspace de staging (paso 8) |
   | `AI_PILOT_BUDGET_USD` | `10` (≈ 8,9 € a 1,12 $/€: por debajo de los 10 € de referencia) |
   | `AI_PILOT_CAMPAIGN` | `piloto-v22-1` |
   | `FLAG_AI_IMAGES_ENABLED` | `false` |
   | `CRON_SECRET` | uno propio de staging |

   Las variables limitadas a una rama tienen prioridad sobre las generales de Preview. Las demás ramas siguen con las compartidas. Separar también esas de Producción es una decisión aparte, recomendable.
7. 🔒 **Desplegar el Preview** de la rama: retirar la línea de `vercel.json` o desplegarlo a mano desde Vercel. Comprobar en el despliegue que la URL de Supabase es la de staging.
8. **Cuenta de pruebas**: registrarte en el Preview, sin datos reales, y copiar el UUID del workspace en `AI_PLANNER_V3_PILOT_WORKSPACE_ID`. 🔒 Ajustar en el catálogo **de staging** la cuota mensual de adaptaciones del plan de esa cuenta, para que quepa la campaña (§ 5). Nunca en producción.
9. 🔒 **Activar** `FLAG_PLANNER_V3_PILOT=true` y volver a desplegar.

## 4. Perfiles ficticios A, B y C

Créalos en `/app/alumnos` con nombres ficticios («Perfil A», «Perfil B», «Perfil C»). El nombre nunca se envía a la IA. Son los mismos de `evals/adaptation/v22-profiles.ts`:

Nombres tal como aparecen en el formulario del perfil. Nivel: bajo = «A veces le ayuda», medio = «Lo necesita con frecuencia», alto = «Es un apoyo habitual o imprescindible».

| Perfil | Apoyos (nivel) | Marcar «No necesita este apoyo» |
|---|---|---|
| A · comprensión de instrucciones y organización | Dividir los textos en partes (medio) · Destacar las ideas clave (bajo) · Aliviar la memoria de trabajo (medio) · Ayudar a planificar (medio) · Explicar qué se espera (bajo). Límite de palabras por instrucción: 15 en Primaria, 20 en Secundaria. | Simplificar el vocabulario · Reducir la exigencia de motricidad fina · Reducir la escritura |
| B · escritura y motricidad fina | Reducir la exigencia de motricidad fina (alto) · Reducir la escritura (medio) · Permitir otras formas de responder (bajo) · Apoyar la expresión (bajo) | Ajustar el nivel de lectura · Acortar los textos · Simplificar el vocabulario · Dividir instrucciones largas en pasos |
| C · control | Nada valorado. No significa que no necesite nada. | — |

## 5. Cómo probar cada caso

1. Sube la ficha en `/app/materiales` y espera al análisis. El análisis se reutiliza dentro del workspace y no consume adaptaciones, pero sí cuesta.
2. En «Adaptar este material», elige el perfil y, en «Planificador (solo en este espacio de pruebas)», **Planificador actual**. Crea con «Revisar antes de crear».
3. Repite con el **mismo material y perfil** eligiendo **Planificador experimental V2.2**.
4. En la revisión del plan de V3:
   - las decisiones que esperan tu decisión empiezan sin marcar, con su motivo y su pregunta;
   - «Lo que queda en tus manos» muestra las preguntas y las barreras que la adaptación no elimina.

   Decide y crea la ficha.
5. Descarga el PDF de cada adaptación y compáralas con el original en *Comparar* (`/app/adaptaciones/<id>/comparar`).
6. Rellena la [plantilla de valoración](PLANTILLA_VALORACION.md) por cada PDF.
7. Prueba también «Hacer magia» con V3 en algún caso: si hay decisiones retenidas, debe detenerse en la revisión del plan en vez de generar.

Campaña inicial propuesta: los 9 casos T01–T09 del banco de pilotos (3 materiales × A/B/C) con los dos planificadores, es decir 18 adaptaciones. Añade MAT-007 y MAT-024 como regresión. Separación de materiales: [MATERIALES](MATERIALES.md).

## 6. Presupuesto y costes

- **Admisión.** Antes de cada petición de pago se reserva su cota:
  - el recuento oficial × 1,10 + 1.000 tokens, cobrados como escritura de caché;
  - más toda la salida (`max_tokens`).

  Se admite solo si lo comprometido de la campaña más la cota cabe en `AI_PILOT_BUDGET_USD`.
- **Qué cuenta como comprometido.** Lo liquidado cuenta por su coste real. Lo pendiente o retenido cuenta por su cota entera: trabajos simultáneos, errores, respuestas sin uso conocido y liquidaciones que no llegaron.
- **Qué pasa por el medidor.** Análisis, planificación, generación, revisión, apoyos visuales, reparaciones, reintentos de los trabajos y el respaldo de salidas estructuradas: cada uno es otra petición admitida. El SDK no reintenta por su cuenta.
- **Al llegar al límite.** No se envía nada más. La adaptación falla como «servicio no disponible» y la cuota de adaptaciones se devuelve (regla existente). El registro del servidor anota `ai_spend_refused`.
- **Orden de magnitud orientativo, no medido.** Una planificación V3 envía unos 50.000 tokens de entrada; su reserva ronda 0,30 $ y su coste real será menor. 18 adaptaciones más 5 análisis deberían caber en 10 $. El libro de gasto lo impone en cualquier caso.
- **Coste real.** `ai_runs` guarda los tokens que devuelve la API por las tarifas de `src/lib/ai/costs.ts`. Es una estimación precisa, no la factura: concíliala con el uso de la clave exclusiva en la consola de Anthropic.

**Informe.** Con las variables de staging en un `.env.pilot` local (ignorado por Git):

```bash
pnpm pilot:report -- --since 2026-11-10 --decisions
```

Escribe en `evals/adaptation/private/pilot-ui/<fecha>/`:
- `calls.csv`: una fila por llamada, con fase, modelo, tokens, coste, estado, reparación y huella de reglas;
- `summary.json`: por adaptación y fase, con el análisis aparte por material, y el libro de gasto;
- `decisions.json`: plan, declaraciones V2.2, revisiones, veredicto y el registro de decisiones recalculado con los controles de la ficha generada.

Es privado: contiene contenido de los materiales. La misma consulta está disponible en el editor SQL de staging: `select * from public.ai_cost_report('2026-11-10', null);` y `select * from public.ai_spend_summary('piloto-v22-1');`.

## 7. Desactivación

1. `FLAG_PLANNER_V3_PILOT=false` y nuevo despliegue: nadie puede elegir V3. Las adaptaciones V3 existentes conservan sus versiones.
2. Revisar `ai_spend_summary` y conciliarlo con la consola. Una reserva `pending` antigua es un gasto pendiente de registrar: compruébalo antes de cerrar la campaña.
3. Retirar las variables de la rama y la clave exclusiva, borrar los materiales de prueba de staging y pausar o borrar el proyecto.

## 8. Riesgos que quedan

- **Primera ejecución real.** El esquema de v3 en salidas estructuradas y el tope de 12.000 tokens de salida no se han probado con el modelo real. El primer caso puede fallar por esquema o por truncado: el informe lo mostrará y la cuota se devuelve.
- **Recuento.** El recuento oficial es una estimación; el margen del 10 % más 1.000 tokens lo cubre en la práctica, pero no es una garantía matemática. El límite de la consola es la segunda barrera.
- **Variables compartidas.** Mientras Preview y Producción compartan variables generales, una rama nueva distinta de esta usaría la base de datos de producción.
- **E2E.** No se han ejecutado por indicación; siguen pendientes, junto con los dos fallos previos de `materials.spec.ts` ([detalle](../e2e-fallos-preexistentes/README.md)).

## 9. Activación en producción para un solo workspace (ADR-047)

Sustituye al plan de un Supabase de staging separado. Todo requiere autorización expresa, en este orden:

1. **Copia de seguridad** de la base actual (hay datos de otros usuarios).
2. **Comparar el esquema antes de tocar el historial de migraciones.** El historial está vacío aunque las tablas existen, así que `supabase db push` intentaría reaplicar todo. No marques 001–033 como aplicadas solo porque existan sus tablas: compara con una base local construida desde las migraciones (`supabase db diff` contra esa copia, tablas, columnas, funciones y políticas) y repara el historial (`supabase migration repair --status applied …`) solo si no hay diferencias.
3. **Aplicar solo 034 y 035** (añaden objetos; no tocan filas), con el código ya desplegado.
4. **Subir las reglas** al bucket `agent-rules` de producción (`scripts/agent-rules/upload.ts`, con verificación previa).
5. **Variables de Production** en Vercel: `AGENT_RULES_SOURCE=storage`, `FLAG_PLANNER_V3_PILOT=true`, `AI_PLANNER_V3_PILOT_MODE=production-pilot`, `AI_PLANNER_V3_PILOT_WORKSPACE_ID=8e6baa28-9efd-45c3-b5fd-37b70647d149`, `AI_PLANNER_V3_PILOT_SUPABASE_URL` (la de producción), `AI_PILOT_BUDGET_USD=10`, `AI_PILOT_CAMPAIGN`. Límite de gasto en la consola de Anthropic.
6. **Fusionar y desplegar.** Hasta aquí nadie ve V2.2.
7. Comprobar con el planificador actual (PDF incluido) y después con V2.2 desde tu cuenta.

Los Preview están desactivados a nivel de proyecto. Los antiguos siguen existiendo tras el acceso de Vercel con las variables de producción de su momento.
