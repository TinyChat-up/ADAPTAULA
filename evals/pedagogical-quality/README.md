# Calidad pedagógica (Fase III, experimental)

Evalúa si una adaptación conserva lo que una actividad enseña. No llama a modelos, no usa red ni base de datos, y `src/` no lo
importa (`tests/unit/boundaries.test.ts`). Informe de la fase: [docs/qa/calidad-pedagogica-fase3](../../docs/qa/calidad-pedagogica-fase3/README.md).

## Piezas

| Fichero | Qué es |
| --- | --- |
| `contract.ts` | Contratos Zod de la ficha original transcrita (`OriginalSheet`), la referencia de evaluación (`ReferenceSheet`), la adaptación puntuada (`AdaptedSheet`) y el resultado (`Evaluation`) |
| `evaluate.ts` | Criterios A–E deterministas. Reutiliza `src/lib/adaptation/text.ts` (los mismos ayudantes que la revisión de producción) |
| `adapter.ts` | Adaptador controlado: aplica un plan escrito a mano a la ficha original. **No recibe la referencia** |
| `mutations.ts` | Errores pedagógicos deliberados, declarativos, aplicados sobre una adaptación correcta |
| `figure-review.ts` | Contrato de revisión humana de una figura candidata del localizador `figure_geometry@v2` |
| `cases.ts` | Un caso = original + referencia + planes correctos + errores. Carga el corpus externo (`<dir>/<ficha>/case.json`) |
| `fixtures.ts` | Seis fichas sintéticas propias (fracciones, cálculo, lectura, ciencias, esquema etiquetado y geometría) para CI |
| `metrics.ts` · `run.ts` | Ejecución y medidas (`pnpm eval:pedagogy`) |

## Reglas que el código impone

- **Nada está validado por un docente.** `validation.status` es `sintetica_provisional` salvo que exista el registro de la revisión:
  rol `docente`, fecha y sha-256 de la versión revisada de la referencia. Una edición posterior invalida la revisión. El código
  solo lee ese registro; nunca lo crea.
- **Nunca hay PASS global.** Si alguna comprobación falla, el veredicto es `FAIL`. Si no, es `NEEDS_TEACHER_REVIEW`: la claridad
  visual (D) y la conservación del aprendizaje (E) las juzga siempre el docente.
- **Separación adaptador / clave.** Los candidatos salen de `adapt(original, plan)`. Las respuestas, los elementos que hay que
  conservar y los cambios inaceptables solo los lee `evaluate`. Una prueba comprueba los `import` de `adapter.ts`.
- **Control de copia literal.** Cada ficha se evalúa también copiada sin cambios: si la copia literal falla, el error está en la
  referencia (por ejemplo, un patrón de fuga que coincide con el enunciado original), no en la adaptación.
- **Reserva.** La ejecución `--split holdout` guarda el hash de las reglas. Volver a ejecutarla con reglas distintas exige
  `--rerun-holdout` y el informe la marca como contaminada.

## Criterios

| Criterio | Deterministas (PASS/FAIL) | Siempre para el docente |
| --- | --- | --- |
| A · Conservación de datos | Números (fracciones incluidas) y unidades por actividad, nombres, relaciones («prestó», «no se desperdició»), orden impreso de secuencias, opciones, hechos de figura (particiones, flechas, posiciones, medidas), hechos clave del texto y cantidades nuevas | — |
| B · Integridad | Actividad omitida, duplicada, mezclada o inventada, y figura asignada a otra actividad | Cambio de orden de las actividades |
| C · Seguridad de respuestas | Huellas de la respuesta (números o frases que el original no imprime) y patrones de fuga, en enunciado y apoyos; figuras resueltas; operación planteada que el original no daba | Respuestas abiertas sin huella |
| D · Accesibilidad | — | Apoyo sin barrera declarada, frases más largas, sobrecarga, barreras sin apoyo y organización visual |
| E · Fidelidad pedagógica | Desaparición de la operación cognitiva o de su marca en la consigna («explica», «justifica», «ordena»…) | Si se conserva el aprendizaje evaluado |

## Ejecutar

```bash
pnpm exec vitest run tests/unit/pedagogical-quality.test.ts
pnpm eval:pedagogy                                              # fichas propias → results-fixtures/ (solo report.md en Git)
pnpm eval:pedagogy -- --corpus <dir> --split development        # corpus externo, fuera de Git → <dir>/results-development/
pnpm eval:pedagogy -- --corpus <dir> --split holdout            # una sola vez; medir, no ajustar
```

Los patrones de fuga son expresiones regulares sobre el texto normalizado: minúsculas, sin tildes y con los números canónicos.
