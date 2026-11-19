# Auditoría de «Hacer magia» (motor de recreación) · 2026-11-19

Evidencia de **producción** (solo metadatos de `ai_runs`, `adaptations`, `generated_assets` y estructura del plan; sin contenido de alumnado ni secretos) y lectura del código de `main` (`517dd6f`). Adaptación real examinada: la más reciente con `recreation_v1` (planificador v3, `ready`).

## Flujo actual (comprobado)

```
PDF → análisis → contexto del perfil → [planning] Claude (recreation_plan@v1) → saneado/rescate → verificador
    → [generation] visual_requests → A original · B esquema por código · C illustrate()
         C: brief (Claude) → render (OpenAI) → revisión (Claude) → almacén (Storage + generated_assets) → bloque «generated»
    → compile (ficha + materiales) → persistencia sin respuestas → entrega → pantalla / PDF (sin IA)
```

## Respuestas a las 10 preguntas

| # | Pregunta | Respuesta (evidencia) |
|---|---|---|
| 1 | ¿Qué motor usa «Hacer magia»? | `recreation_v1`: las 4 últimas adaptaciones (18–19 nov), planificador v1→v3. Las anteriores (11–13 nov) usan el motor original. |
| 2 | ¿Claude pide imágenes con `visual_requests`? | Sí, pero **solo una** (`vr_1`, observación, `essential:false`); sin `for_cards`; **sin ningún esquema de flechas** (`plan.visuals` vacío). |
| 3 | ¿Llegan a las ilustraciones? | Sí: `ai_runs` registra `image_brief` → `image` → `image_review` (×2 intentos). |
| 4 | ¿Algo impide llamar a OpenAI? | **No.** 2 llamadas `image`, proveedor `openai`, `status=success`, con coste. Puertas (flag, piloto, plan, cupo) abiertas. |
| 5 | ¿Modelo de imagen real? | Sí (`gpt-image-2.5-sunburst`, congelado en la adaptación). |
| 6 | ¿Se pierden imágenes tras generarse? | No hubo ninguna aprobada: `generated_assets = 0`. Bucket `generated-assets` y columnas existen; **el almacenamiento nunca se ha ejecutado con éxito en producción** (sin demostrar). |
| 7 | ¿Y si se rechaza o falla? | Se descarta, se devuelve la unidad de imagen y, si la petición no es esencial, **se entrega sin imagen sin avisar**. |
| 8 | ¿Por qué instrucciones que apuntan a lo ausente? | `compile.ts` copiaba `prompt`/`steps` tal cual; **ningún verificador cruzaba el texto con los recursos**. |
| 9 | ¿Se generan los manipulativos? | Sí (`materials_document` con tarjetas y tablero) pero en un **documento aparte** que la ficha nunca mencionaba. |
| 10 | ¿Conserva objetivos/operaciones? | El verificador exige todos los objetivos con `level: kept` y las operaciones originales (`objective_dropped`, `operation_dropped`…). Las actividades cerradas (1, 2, 5) quedan «apoyadas, sin demostrar» → aviso de revisión docente. |

## Problemas confirmados

**P0-1 · Referencias a recursos inexistentes.** En el plan real, la actividad 1 manda observar una ilustración (rechazada), la 4 habla de flechas (no hay esquema) y la 2 manda recortar tarjetas (en otro documento). Causa: sin comprobación texto↔recurso. *Corrección:* `src/lib/recreation/references.ts` quita del enunciado o paso solo la frase que apunta a lo que no existe, al sanear el plan (lo no declarado) y al compilar (lo no producido); si no queda instrucción, la ficha es `incomplete` y no se entrega (unidad devuelta). La ficha añade «Imprime también el documento «Materiales para recortar»».

**P0-2 · Revisión de imágenes excesiva.** Las dos imágenes se rechazaron con `concept:` («la garza es grande respecto a la rana, pero es plausible y no constituye un error grave»), `activity_mismatch` y `rejected`. Causa: cualquier texto en `conceptual_errors` veta; `matches_activity` se leía como «la imagen resuelve la actividad». *Corrección:* `image_review` v2 (solo recreación; v1 intacto) define ambos campos; aprueba si es clara, segura, sin texto ni respuestas y no enseña nada falso.

**P0-3 · El planificador no declara lo que menciona.** *Corrección:* `recreation_planner` v4 (reglas 19–20: imagen en `visual_requests`, flechas solo en `visuals`, tarjetas en `materials`). v1–v3 quedan congeladas para lo ya creado.

**P0-4 · Rotura latente de fronteras cliente/servidor** (introducida con #97/#104, no detectada porque no se ejecutó la prueba): componentes cliente alcanzaban `recreation/pilot.ts` y `visuals.ts`. *Corrección:* `RecreationServicesPort`, `engine.ts` sin dependencias de servidor y `flag.ts` (`server-only`). `tests/unit/boundaries.test.ts` vuelve a pasar.

## Pendiente / probable (no demostrado)

- **P1 · Opción A muerta en producción:** `locatedOriginals` va siempre vacío (nunca se reutiliza una imagen del original). Requiere conectar los localizadores de `material_visuals`.
- **P1 · Esquema de flechas:** B solo se construye si la figura original del análisis contiene `→` (2–6 rótulos); si el análisis no la recoge así y Claude no declara `visuals`, la ficha queda sin flechas (ahora sin mencionarlas). Habrá que medirlo con el análisis real del estanque.
- **P1 · Rechazo repetido:** el segundo intento vuelve a recibir la objeción ya tachada; v2 debería reducirlo; falta medirlo con OpenAI real.
- **P2 · Espacios vacíos:** en la prueba local, páginas con ~40 % libre por el límite de tareas visibles por página del perfil (apoyo deliberado de «densidad visual»). No es un fallo de composición; valorar rellenar con más tareas cuando el límite lo permite.
- **P2 · Ficha y materiales en dos PDF:** ahora se avisa en la ficha; un PDF combinado sería más robusto.
- No demostrado con proveedores reales: aprobación de una imagen, subida a Storage, render de una imagen real en el PDF.

## Verificación sin gasto

- Pruebas nuevas: `tests/unit/recreation-references.test.ts` (5: detección, recorte, saneado, estanque con imágenes rechazadas, ficha incompleta).
- Ejecutadas: recreación (referencias, recorrido, plataforma, evaluación, registro de demostración), fronteras, entorno, `magic-recreation` (BD, PGlite con migraciones reales), cuotas y PDF de Chromium: **todas correctas**; typecheck y lint sin errores.
- Estanque simulado: [captura](estanque-simulado.png), [ficha](estanque-ficha-simulada.pdf) y [materiales](estanque-materiales-simulados.pdf). Las imágenes son marcadores locales, no OpenAI.

## Cómo validar (requiere autorización y presupuesto)

1. Previsualizar la rama; con `HACER_MAGIA_ENGINE=on` y el piloto de imágenes de tu workspace.
2. Pulsar «Hacer magia» con la ficha del estanque (coste esperado 0,6–1,2 $).
3. Comprobar: ninguna actividad habla de una imagen, flechas o tarjetas ausentes; los materiales existen; y en `ai_runs` hay `image_review` con `prompt_version = 2` y, si se aprueba, filas en `generated_assets`.
