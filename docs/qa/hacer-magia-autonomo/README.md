# «Hacer magia» autónomo: diagnóstico del estanque y rediseño

## 1. Qué pasó con «Un estanque en equilibrio» (5.º de Primaria; solo lectura de Supabase, 2026-11-11)

Adaptación `2c195f0c…`, modo `automatic`, plan Max, workspace piloto. Reconstruido solo con sus artefactos (`adaptation_artifacts`, `adaptation_jobs`, `ai_runs`, `material_visual_autolocations`, análisis del material). Sin contenido de alumnado.

| Pregunta | Resultado comprobado |
|---|---|
| ¿Qué planificador se ejecutó? | **El anterior (`adaptation_planner` v2, contexto política 2), no V2.2.** `pipeline_versions.planner.prompt_version = 2`, sin `rules` y sin `ai_runs.rules_sha256`. El agente V2.2 no intervino: el flag no estaba activo. Ningún fallo de esta adaptación es atribuible a V2.2. |
| ¿Dónde se paró? | En el **orquestador, por la política visual**: `automatic_stop = visual_unavailable` sobre `vis_2`, tras generar la ficha y su revisión determinista. Las 8 decisiones del plan se aplicaron (la resolución automática aprobó las dos con aviso). |
| ¿Qué era `vis_2`? | Un **esquema de cuatro recuadros unidos por flechas** («Algas → Larvas de insectos → Ranas → Garzas»), imprescindible para las actividades 3a y 3b. El análisis (**análisis**) lo describió completo: etiquetas y orden. |
| ¿Por qué no se recuperó del PDF? | La localización automática (`auto_visuals@v7`) hizo una llamada de visión (confianza 0,96) pero **no pudo ajustar la hipótesis a los objetos del PDF** (`hypothesis_not_snapped`: `unique=false`, `clean=false`, visión en desacuerdo con la geometría). Sin recorte, no hay original recuperable. |
| ¿Por qué no se reconstruyó? | **Escalón de la política visual que faltaba.** El renderizador solo sabía dibujar figuras matemáticas (barra, recta, círculo, cuadrícula). Un esquema de flechas no tenía familia dibujable: `generateEquivalentFigure` devolvía `null`, la figura era imprescindible (`required`) y no dibujable, así que tampoco se podía reescribir ni sustituir. |
| ¿Por qué no se ilustró? | Imágenes generadas desactivadas (`illustration_unavailable`). Era correcto: un esquema con datos no debe generarlo un modelo de imagen. |
| ¿Quién ve «Dos ayudas podrían contradecirse»? | La **validación del plan** (`invariants.ts`), **no el planificador**: marcaba `needs_conflict` en *cualquier* decisión sobre un destino con un conflicto ya detectado (ejemplos resueltos), aunque la decisión cumpliera la guía que resuelve ese conflicto. Falso positivo de copy y de lógica. La resolución automática no se detuvo por él; el docente lo vio al elegir **Editar** en el panel de parada. |

Por tanto: análisis correcto, planificador correcto (el anterior), **política visual con un escalón ausente**, **validador con avisos espurios**; el orquestador solo cumplió su contrato (no entregar con un hueco).

## 2. Qué cambia

- **Política visual.** Nueva figura `flow` (recuadros + flechas) que se redibuja solo si el análisis imprime la cadena completa y su descripción coincide (etiquetas, orden y número de flechas). Se presenta como recurso nuevo equivalente, no como el original. Sin datos completos sigue siendo una parada honesta. (`from-analysis.ts › flowFromAnalysis`, `from-task.ts`, `spec.ts`, `visual-spec.tsx`.)
- **Conflictos.** `needs_conflict` solo si la decisión **hace lo que la guía prohíbe** (`conflicts.ts › conflictViolated`). Una clave desconocida conserva la lectura prudente.
- **V2.2 sin preguntas.** Una decisión retenida por el método (condicionada, pista, estrategia ajena) se resuelve internamente: variante segura → alternativa → original conservado (`autonomous-resolution.ts`). Con la causa y el motivo en el informe de ejecución; nadie responde Sí/No/No lo sé en «Hacer magia». «Revisar antes de crear» no cambia (las confirmaciones siguen exigidas al docente allí).
- **Perfil en el centro (política de contexto 3).** Las fortalezas declaradas reordenan las estrategias candidatas de cada necesidad (nunca añaden una). Cuatro fortalezas nuevas de acceso y respuesta (elegir entre opciones, listas de pasos, tareas cortas, organizadores gráficos). Cada decisión aplicada guarda su justificación (necesidad, barrera que reduce, fortaleza que aprovecha, lo que conserva) en `execution_report.automatic.justifications`.

## 3. Lo que NO se ha hecho (y por qué)

- **No hay prompt nuevo del planificador.** Las versiones publicadas no se editan y una `v4` exige evaluación con el modelo real (coste). Con el planificador anterior las fortalezas actúan por el orden de las estrategias candidatas, no por una instrucción propia; con V2.2 las aplican las reglas privadas. Pendiente: `adaptation_planner@v4` evaluada.
- **El perfil sigue siendo de catálogo cerrado** (11 barreras, 12 fortalezas, apoyos por dimensión): cumple «sin diagnósticos y sin texto libre sobre el alumno» pero no recoge aún autonomía, formas de acceso ni «qué funciona» con detalle. Ampliarlo es una decisión de producto y de privacidad (catálogo, no texto libre). La orientación al docente durante la creación (ayuda para completar fortalezas) tampoco está.
- **«Consultar las decisiones» tras «Hacer magia»**: la justificación queda guardada; su pantalla no se ha construido en esta entrega.
- **Localizador de imágenes:** `hypothesis_not_snapped` con confianza de visión 0,96 sigue sin recuperar un recorte. No se ha relajado el ajuste (riesgo de recortar mal una figura).
- Sin E2E ni llamadas de IA de pago; sin migraciones; sin despliegue.
