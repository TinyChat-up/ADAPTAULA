# Recreación en la plataforma: materiales visuales y explicación en pantalla

2026-11-18 · rama `claude/recreacion-plataforma`, sobre `claude/recreacion-colaboracion` (PR #100, que depende de la #99). ADR-051. Sin IA de pago, migraciones remotas, merge ni despliegue. «Hacer magia» y las adaptaciones guardadas no cambian.

## 1. Propuesta visual de la pantalla

Una sola página dentro de la aplicación (mismo `AppShell`, tarjetas, alertas y botones), sin pestañas que carguen nada:

| Escritorio | Móvil |
| --- | --- |
| ![Pantalla en escritorio](pantalla-escritorio.png) | ![Pantalla en móvil](pantalla-movil.png) |

[Página completa en escritorio](pantalla-escritorio-completa.png).

- **Cabecera:**
  - el título, una frase de lo que es («Una ficha nueva con 7 actividades y materiales para recortar»);
  - si hay descargas, «Descargar ficha» y «Descargar materiales», opcionales: no hacen falta para entender la adaptación.
- **Columna derecha, fija al desplazar** (en móvil va **primero**):
  - **Qué hemos adaptado**;
  - **Por qué así**;
  - **Cómo utilizarlos**, en pasos numerados, con un desplegable «Qué observar en cada actividad».
- **Debajo, «Regenerar el material»**, una acción aparte con su aviso: «Se creará una versión nueva… La versión actual se conserva.».
- **Columna principal:**
  - la **ficha del alumno** y los **materiales para recortar**, dibujados por el mismo renderer que el PDF;
  - un acceso rápido a cada uno.
- **Qué no aparece:** solucionario, clave, estados de verificación, procedencia ni avisos técnicos.
- **Si falta algo imprescindible**, una sola alerta en lenguaje llano. Ejemplo: «Falta una imagen necesaria para la actividad 1. No uses la ficha hasta tenerla…».

Demostración local: `ADAPTAULA_DEMO=1 pnpm dev` y abrir `/demo/recreacion`. Fuera de producción, sin sesión ni datos de nadie; lee el registro guardado del estanque.

## 2. Recorrido funcional: se genera una vez y se consulta sin IA

```
crear (única vez)   createRecreation → permisos · cupo · presupuesto → Claude (plan + explicación, 1 llamada)
                    → verificación → imagen (brief → OpenAI → revisión) → MaterialDocuments → RecreationRecord guardado
consultar (siempre) loadRecreationView(store, id) → RecreationScreen          ← sin proveedores, sin pipeline, sin llamadas
regenerar (explícito) regenerateRecreation → permisos · cupo · presupuesto → confirmación → versión nueva (la anterior se conserva)
```

- **La explicación** la redacta Claude en la **misma** llamada del plan (`explanation` en `recreation_plan@v1`) y se guarda con la adaptación.
  - Se valida como cualquier texto del alumno: sin resultados, sin la opción correcta, sin el grupo de un elemento y sin el orden de una secuencia.
  - Además: sin diagnósticos ni etiquetas, y con cada «por qué» ligado a una necesidad funcional del contexto.
- **El estilo visual** es uno por material (`visual_style`) y viaja a cada brief, para que las ilustraciones formen un conjunto.
- **Los materiales** van ligados a su actividad:
  - el tablero de clasificación tiene exactamente los grupos de su actividad;
  - las tarjetas son exactamente sus elementos.
- **Persistencia:** `RecreationRecord`, con la ficha, los materiales, la explicación y las imágenes, más una parte `internal` que la vista nunca envía.
  - En la demo y en las pruebas, en memoria.
  - Para el producto, [propuesta de migración](propuesta-migracion.sql) **no aplicada**: tabla `recreations` por versión, `generated_assets.recreation_id`, `ai_runs.recreation_id`, RLS de lectura para miembros y la columna `internal` sin conceder.

## 3. Explicaciones en pantalla (el estanque)

**Qué hemos adaptado:**
- Los mismos cinco objetivos.
- Siete actividades nuevas: clasificar con tarjetas y tablero, dos cambios con su prueba, la flecha del esquema, la predicción sobre las ranas, el cálculo con su operación, valorar una idea y proponer una medida.
- El texto original, dividido en tres partes, más una ilustración para reconocer el estanque.

**Por qué así**, ligado a necesidades sin nombrar diagnósticos:
- se lee por partes;
- se responde colocando o marcando donde no se evalúa la escritura;
- las consignas son cortas y van en pasos.

**Cómo utilizarlos:**
1. Imprimir y recortar.
2. Empezar por la ilustración.
3. Leer cada parte cuando la actividad lo pida.
4. Colocar las tarjetas en el tablero y después escribir las letras.
5. Inicios de frase, o respuesta oral si escribir bloquea.

## 4. Documentos educativos (sin solucionario)

- [Ficha del alumno](estanque-ficha-alumno.pdf), **4 páginas**:
  - la ilustración del estanque abre la ficha, antes de la lectura, porque su función es de contexto;
  - el esquema alimentario va en la actividad 3, dibujado por código con los rótulos del original;
  - 7 actividades de 6 tipos: relacionar con letras, respuesta breve con inicios de frase, selección, cálculo con operación, valoración y propuesta.
- [Materiales para recortar](estanque-materiales-recortables.pdf), **1 página**: 6 tarjetas grandes con línea de corte y el tablero «Ser vivo · Elemento no vivo», cada uno con su instrucción.
- **Ya no se producen** la guía de 2 páginas ni la clave y revisión de 5 de la entrega anterior.
  - Las respuestas siguen **dentro** del registro (`answer_key`, `internal.verification`) para las comprobaciones.
  - No están en la vista: la ficha llega a la pantalla con la clave vacía (probado).
- Una actividad que no supera una comprobación imprescindible bloquea la generación («No hemos podido crear un material fiable… No se ha guardado nada»). Nunca se presenta como correcta.

La ilustración de estas capturas y PDF es el **dibujo local de prueba** de `MockImageProvider` (óvalos), no una imagen del estanque. La revisión página a página de la ficha llevó a tres cambios:
- **La ilustración, al principio:** en la versión anterior iba en la página 2, dejaba media página 1 vacía y llegaba después de la lectura.
- **Ficha de 5 a 4 páginas.**
- **Materiales de 2 páginas a 1:** el tablero quedaba separado de su instrucción; las tarjetas pasan a tres columnas.

## 5. Pruebas de que consultar no llama a ninguna IA

`tests/unit/recreation-platform.test.ts` (9 pruebas):
- **Abrir 100 veces:** se crea la recreación (4 llamadas simuladas: plan, brief, imagen y revisión) y se abre 100 veces; las llamadas siguen en **4** y el almacén registra 100 lecturas.
- **Imprimir desde lo guardado:** construir el modelo de impresión de la ficha y de los materiales a partir del registro no añade llamadas.
- **La vista no puede llamar a una IA:** `view.ts` y `record.ts` no importan en tiempo de ejecución nada de `src/lib/ai`, del planificador, del pipeline de imágenes ni de la creación.
- **La vista no lleva nada interno:** ni clave, ni plan, ni verificación, ni procedencia, ni estados (`verified`, `anchored`…). El registro sí conserva la clave.
- **Regenerar:**
  - sin confirmar, devuelve el aviso y **0** llamadas;
  - confirmado, crea la versión 2 y conserva la 1;
  - sin permiso, sin cupo o sin presupuesto: **0** llamadas y el motivo en lenguaje llano.
- **Plan inválido:** no se guarda.

Además, 24 pruebas del verificador (`recreation.test.ts`), incluidas las nuevas de la explicación (diagnóstico, necesidad ajena, resultado, grupo, opción correcta) y de los materiales (tablero y tarjetas que no casan). Hay 8 del recorrido simulado, 4 de PDF y una que comprueba que el registro de la demo es el que produce el recorrido.

## 6. Qué falta para que OpenAI genere las imágenes reales

1. **Autorización** de la prueba (punto 7).
2. **Configuración** en el entorno de la prueba (no en el repositorio):
   - `OPENAI_API_KEY`;
   - `AI_MODEL_IMAGE_QUALITY` con un modelo de OpenAI de la tabla de precios;
   - `ANTHROPIC_API_KEY` y `AI_MODEL_STANDARD` para Claude (plan, brief y revisión).
3. **Para una prueba controlada** basta un guion local, aún sin escribir a propósito, que use los mismos `createRecreation` e `illustrate()` con proveedores reales y almacén en memoria. No hace falta base de datos.
4. **Para el producto:**
   - aplicar la [migración propuesta](propuesta-migracion.sql) con su prueba de aislamiento;
   - conectar la puerta existente `illustrationAvailability()`: `FLAG_AI_IMAGES_ENABLED`, piloto de un workspace y plan Max con `image_generation` y cupo `monthly_images`;
   - URLs firmadas del bucket privado para la pantalla;
   - una ruta `/app/recreaciones/[id]` con `requireWorkspace`, que es la misma pantalla con el almacén de base de datos.

## 7. Coste máximo de una prueba controlada de las dos IA

Precios de `src/lib/ai/costs.ts` y peores casos de `ILLUSTRATION_BUDGET`.

| Por recreación | Llamadas | Peor caso |
| --- | --- | --- |
| Claude, plan + explicación (≈ 5 k tokens de entrada, ≤ 8 k de salida) + 1 reparación | 1–2 | 0,18 $ |
| Claude, brief de la ilustración | 1 | 0,03 $ |
| OpenAI, imagen + Claude, revisión (+1 reintento) | 2–4 | 0,22 $ |
| **Total** | **4–7** | **≤ 0,43 $** |

**Propuesta: 4 recreaciones**
- el estanque dos veces, para ver la consistencia del estilo y de las explicaciones;
- la célula y las fracciones una vez cada una.

Eso suma **entre 16 y 28 llamadas**, con un **peor caso de 1,72 $** y un esperado entre 0,7 y 1 $. **Tope duro: 3 $**, cortado por el presupuesto antes de cada llamada.

Qué se mirará:
- calidad y coherencia de las ilustraciones, revisadas por una persona;
- utilidad y concreción de las explicaciones;
- planes que pasan la verificación;
- coste real frente al estimado.

**Espera autorización.**

## Qué es real y qué es simulado

| Real (código del producto, probado) | Simulado |
| --- | --- |
| Contrato y verificación, explicación validada, decisión A/B/C, `illustrate()` con sus puertas, compilación, renderer y PDF, registro, vista sin IA, regenerar con controles, pantalla | Claude (`MockProvider` con respuestas fijas: el plan del estanque está escrito a mano), OpenAI (`MockImageProvider`), almacén en memoria, permisos/cupo/presupuesto inyectados |

## Problemas pedagógicos que persisten

- Las respuestas que no se pueden comprobar automáticamente (clasificación y selección) siguen sin comprobar internamente. Ya no se avisa en pantalla, por decisión de producto, así que la responsabilidad recae en el diseño del plan y en la revisión de la evaluación real.
- 7 actividades en 4 páginas para 5 objetivos: la carga adecuada para este perfil debe valorarla un docente.
- Que el conjunto de actividades nuevas equivalga al razonamiento del original sigue siendo un juicio pedagógico, no una comprobación.
