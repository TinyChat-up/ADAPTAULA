# Etapa 2.3 · diseño: una sola regeneración semántica y retirada determinista de un apoyo confirmado

Estado: **diseño, no implementado** (decisión del 2026-11-13). Premisas del usuario:

1. Como objetivo, **una sola regeneración semántica** (coste).
2. Si un apoyo sigue **revelando una respuesta confirmada, no puede entregarse simplemente con un aviso**.
3. Primero, una **retirada o sustitución determinista segura, sin otra llamada de IA**.
4. Si no hay alternativa que conserve una **necesidad esencial**, la adaptación **no se entrega como correcta**.

## Qué hace hoy (PR #91) y por qué se cambia

Un hallazgo confirmado hace fallar `answers_not_leaked` (bloquea) y `attemptCorrection` lo repara: generación 2 con la restricción, y si
se repite, generación 3 con una **sustitución por IA** (solo con `SUPPORT_SUBSTITUTION_MODE=on`) o la retirada de la decisión (si sus
necesidades siguen cubiertas) o la parada honesta. Peor caso: 3 generaciones y 3 revisiones. Cada ciclo extra son ≈ 0,044 $ (generador 0,0176 +
revisión ≈ 0,026), más de la mitad de lo que cuesta entera una adaptación entregada (0,0694).

Hecho comprobado en el código: una reparación en la que solo se **dejan fuera** decisiones **no llama al generador** (`automatic_repair_reused`:
se reutiliza lo ya escrito); lo que sí hace es un ciclo y **una revisión más**. Esa retirada existe, pero opera por **decisión entera** y cuesta
una llamada de revisión.

## Diseño

### Flujo

```
generación 1 → revisión 1
  ├─ sin confirmados ........................................... se entrega (flujo actual)
  └─ confirmados:
       a) ¿Se puede retirar el bloque SIN perder ninguna necesidad (§ cobertura)? y el tipo de hallazgo es verificable
          (resolves_item · gives_result · assigns_item) ─► RETIRADA INMEDIATA (0 generaciones, 0 revisiones más)
       b) si no ─► UNA regeneración localizada con la restricción semántica (1 llamada del generador)
            → revisión 2
               ├─ sin confirmados ................................ se entrega
               └─ confirmados otra vez ─► RETIRADA / PLANTILLA DETERMINISTA (§ siguiente), nunca otra llamada de IA
                    ├─ cobertura íntegra ........................... se entrega (apoyo retirado, registrado)
                    ├─ necesidad no esencial sin cubrir ............ se entrega SIN ese apoyo, resultado `uncovered`, nunca «applied»
                    └─ necesidad ESENCIAL (alta) sin cubrir ........ NO se entrega como correcta: parada honesta (`blocked`)
```

Máximo por motivo semántico: **1 llamada del generador y 2 revisiones**; la tercera generación deja de usarse por esta vía. (La vía literal
de la etapa 2.2 no cambia.) `states_concept` y `performs_operation` van siempre por regeneración primero (hay que conservar la necesidad
educativa con un apoyo mejor); la retirada inmediata es solo para los tipos que entregan un ítem o un resultado, donde regenerar rara vez mejora
al otro apoyo que ya cubre la necesidad.

### Cobertura, sobre lo que HAY en la ficha

`coverageOf` hoy razona sobre **decisiones** del plan. Aquí hay que razonar sobre los **bloques presentes** tras retirar: una necesidad queda
servida si la resuelve la presentación, o si otro apoyo **presente** de la misma actividad (o que la alcanza) tiene un tipo que la sirve
(`kindServes`). Un apoyo omitido o no generado nunca cuenta. El resultado por necesidad es el de siempre (`same_activity` /
`reachable_resource` / `presentation` / `none`) y solo `applied` se lee como aplicada.

### Retirada determinista (`retireSupports`)

- Quita **solo bloques de apoyo** (`origin` `support`/`extension`) de los hallazgos confirmados; nunca originales, actividades ni datos
  (se comprueba y, si no, no se hace).
- Recalcula la revisión **determinista** sobre el documento nuevo (cero llamadas). De la revisión de IA ya hecha conserva los hallazgos y
  descarta los que apuntan a los bloques quitados: retirar contenido no puede crear una fuga, un problema de tono ni una instrucción
  incompleta; sí puede dejar una necesidad sin apoyo, y eso lo decide la cobertura de arriba, no el modelo.
- Guarda la traza (ids, códigos y huellas; sin texto): qué bloques, por qué, de qué documento deriva y qué necesidades siguen cubiertas.
- Idempotente y reanudable: clave = huella del documento revisado + ids retirados + versión de la política.

**Implementación sin migración:** la versión derivada se persiste con una huella de generación propia (`persist_adaptation_version` ya
deduplica por `generation_fingerprint` y fija `source = 'ai_generated'`; la traza va en `execution_report` y en `pedagogical_review.semantic`,
ambos tipos ya existentes). **Precondición que hay que probar antes de construirlo**: que dejar la versión anterior sin revisión y finalizar la
derivada no rompe el historial ni la pantalla. **Alternativa de reserva** (menos precisa, sin tocar nada de lo anterior): la retirada por
decisión entera que ya existe, a costa de una revisión más (≈ 0,026 $) y un ciclo.

### Sustitución determinista (plantilla) — solo si se aprueba

Para una necesidad **procedimental** (memoria de trabajo, planificación, instrucciones) que se quedaría sin cubrir, un recordatorio de **texto
fijo**, por etapa y registro, sin ningún contenido de la ficha: no puede filtrar nada por construcción. Nunca sirve necesidades de contenido
(vocabulario, conocimientos previos, inferencia): esas se retiran o paran. Condiciones: texto revisado según `docs/EDITORIAL.md` (sin
infantilizar en ESO y Bachillerato), un máximo por actividad y una comprobación determinista de que no se repite en la ficha. Riesgo: un
apoyo genérico puede ser decorativo; por eso es opcional y su cobertura se cuenta como `partial` salvo que la necesidad sea puramente
procedimental. **Recomendación: no empezar por aquí**; medir primero cuántas retiradas dejan una necesidad procedimental sin cubrir.

### Parada honesta

Una necesidad **esencial** (nivel alto) sin cobertura tras la retirada → `blocked` con `automatic_stop` (código `semantic_unresolved`, la
diagnosis con reglas, decisiones y bloques, nunca contenido), sin consumir la unidad (como hoy) y sin presentarse como una adaptación correcta.
Una ficha con un bloque confirmado **nunca** llega a `ready`: o el bloque se retira, o hay parada.

### Interruptores

- La retirada determinista actúa solo con `REVIEWER_V2_MODE=on`; con `shadow` solo se registra qué habría hecho (`dry_run` del registro).
- `SUPPORT_SUBSTITUTION_MODE` queda limitado a la vía literal de la 2.2: un hallazgo **semántico** ya no pasa por una sustitución con IA (pediría
  una llamada más). Se retira de la conexión actual la bandera `semantic_confirmed` hacia `planSubstitution`; se conserva la traza.

## Coste

| Caso | Hoy (peor) | Diseño |
| --- | --- | --- |
| Confirmado y cobertura intacta sin ese bloque (tipos verificables) | 2–3 generaciones y 2–3 revisiones | **0** generaciones y **0** revisiones extra |
| Confirmado, se corrige con la regeneración | 2 generaciones, 2 revisiones | igual |
| Confirmado otra vez tras la regeneración | 3.ª generación (o sustitución IA) y 3.ª revisión | **0** llamadas extra (retirada o parada) |
| Máximo semántico por adaptación | 3 + 3 llamadas | **1 + 2** |

Ahorro en el peor caso ≈ 0,044 $ por adaptación afectada; el coste de una regeneración innecesaria es ≈ 5 veces el sobrecoste del v2.

## Pruebas necesarias (todas con generador y revisor simulados; 0 llamadas de pago)

1. **Retirada inmediata:** hallazgo `resolves_item` sobre un bloque cuyas necesidades cubre otro apoyo de la misma actividad → ficha entregada con
   0 regeneraciones y 0 revisiones adicionales; el bloque ya no está; los demás bloques y las actividades, intactos byte a byte.
2. **Regeneración y éxito:** `states_concept` confirmado → 1 regeneración con la restricción → limpio → entregada en 2 ciclos.
3. **Repetición → retirada:** confirmado otra vez → sin 3.ª llamada del generador ni 3.ª revisión; retirada con cobertura íntegra → entregada.
4. **Cobertura parcial:** una necesidad media que solo servía el bloque retirado → entregada sin él y registrada `uncovered`/`none` (nunca
   `applied`).
5. **Necesidad esencial sin alternativa:** parada honesta, **no entregada**, unidad no consumida, sin entrega «correcta»; diagnosis sin contenido.
6. **Nunca con aviso:** una ficha con un confirmado persistente jamás termina `ready` en ninguna combinación de interruptores en `on`.
7. **Solo apoyos:** si el bloque confirmado fuera original o una actividad, no se retira (parada).
8. **Qué se conserva:** los hallazgos de IA que no apuntan al bloque quitado se mantienen; los deterministas se recalculan; ninguna fuga nueva.
9. **Sospechas:** una sospecha jamás retira, regenera ni para; solo se registra y avisa.
10. **Interruptores:** `off` y `shadow` no retiran nada (en `shadow`, solo el registro de lo que habría hecho); `SUPPORT_SUBSTITUTION_MODE` en
    cualquier valor no cambia la vía semántica; la vía literal de la 2.2 conserva sus pruebas.
11. **Ciclos y reanudación:** máximo 1 llamada del generador y 2 revisiones por motivo semántico; reiniciar el proceso entre etapas o visitar
    de nuevo no duplica llamadas ni versiones; la clave de idempotencia evita retirar dos veces.
12. **Historial de versiones (precondición):** la versión derivada se persiste y finaliza sin romper el historial, la entrega ni la pantalla;
    la anterior queda como historia.
13. **Trazabilidad:** la traza guarda ids, códigos y huellas, nunca el texto del apoyo ni la respuesta; `needStates` marca `clear` solo cuando
    corresponde.

## Decisiones que necesito

1. ¿Una necesidad **no esencial** (media o baja) sin cobertura permite entregar la ficha sin ese apoyo (registrada como `uncovered`), o también
   debe pararse?
2. ¿La retirada inmediata (sin regenerar) para los tipos verificables te parece bien, o prefieres regenerar siempre una vez antes de retirar?
3. ¿Se descarta de momento la plantilla determinista (recomendado) y se decide con datos?
4. ¿Se acepta la implementación sin migración (versión derivada con huella propia), condicionada a la prueba 12, con la retirada por decisión
   entera como reserva?
