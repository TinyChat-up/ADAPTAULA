# Evals de adaptación (Fase 4, offline)

Comprueban el **sistema** de adaptación (contexto, invariantes, ensamblado del documento y revisión) con los mocks deterministas. No llaman a ningún proveedor y no cuestan nada.

```bash
pnpm eval:adaptation:mock   # todos los escenarios con el pipeline simulado
```

Los mismos escenarios se ejecutan en `pnpm test` (`tests/unit/adaptation-pipeline.test.ts`).

## Materiales (`fixtures.ts`)

Análisis v3 sintéticos, normalizados con el normalizador real, modelados sobre las fichas validadas en la Fase 3 (misma estructura y tipo de exigencias; otras palabras y otros números: las fichas reales siguen privadas y fuera de git).

| Material | Qué valida |
|---|---|
| Primaria · fracciones | operaciones, figuras necesarias, equivalencias, ordenar, explicar en 3 líneas, no revelar respuestas (`3/5`, `2/4 y 4/8`) |
| ESO · geografía | tabla y dos gráficos (uno con un nombre de serie inferido), datos, condición de escenario («sin reducir el número total…»), puntos porcentuales, conclusión de 4-5 líneas con al menos dos datos |
| Bachillerato · argumentación | texto fuente literal, tesis, argumentos, conector «No obstante», registro, 150-180 palabras, no infantilización |

## Perfiles (`scenarios.ts`)

Solo dimensiones, como las guarda el producto: lectura, funciones ejecutivas, lenguaje, carga visual, reducción de escritura (con teclado), conflicto apoyo/objetivo (acortar texto y escribir menos sobre un texto que se analiza y una escritura evaluada) y ampliación.

## Qué se comprueba

Cada escenario declara los conflictos que deben detectarse y las comprobaciones que no pueden fallar (objetivos, protegidos, respuestas, datos, consignas, restricciones, formato de respuesta, trazabilidad, no infantilización). Además, ninguna respuesta inferida aparece en el contenido del alumno ni en la clave.

Los casos adversos (un generador que pierde una condición, revela una respuesta, parafrasea el texto fuente, cambia una celda…) están en `tests/unit/adaptation-review.test.ts` y `adaptation-invariants.test.ts`.

## Cuándo ejecutar evals reales

Cuando existan los prompts `adaptation_planner`, `material_generator` y `pedagogical_reviewer`, con un presupuesto aprobado y siempre separados de `pnpm check`. El mock no mide calidad pedagógica: mide que el sistema impide los errores graves sea cual sea el modelo.

## Planner v1 frente a v2, sin modelo

`pnpm eval:adaptation:planner:ab:mock` (`planner-ab.ts`) pasa los tres materiales por planner v1 (política de contexto 1) y planner v2 (política 2) con los mocks deterministas y compara tamaño de la entrada, decisiones, avisos del validador y duplicación de la presentación. Coste 0; no mide la calidad de un modelo. Las fixtures no se tocan.

## Una llamada real del planner v2

`pnpm eval:adaptation:planner -- --analysis <resultados.json> --planner-version 2 --context-policy 2 --max-output-tokens <N> --budget <USD>` (solo pre-flight sin `--yes`). El pre-flight calcula el peor caso con caché fría y salida máxima; no se llama si lo supera.
