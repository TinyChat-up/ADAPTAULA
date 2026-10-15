# Fase III · Calidad pedagógica y referencias docentes (experimental)

| | |
| --- | --- |
| **Base** | `main` en `370a9d8` (PR #36 integrada) |
| **Alcance** | `evals/pedagogical-quality/`, sus pruebas, una prueba de fronteras y la documentación |
| **Sin cambios en** | `src/`, Hacer magia, bloqueos semánticos, `MaterialAnalysis`, PDF, Supabase, Stripe, páginas legales y UI |
| **No se ha hecho** | Llamadas de pago, entrenamiento, datos de alumnado, fichas de usuarios, subir las fichas originales a Git |

**Nada de lo que hay aquí está validado por un docente.**
- Las 8 referencias de las fichas originales son propuestas sintéticas provisionales del agente (`sintetica_provisional`), igual que
  las 6 fichas propias de CI.
- Las adaptaciones «correctas» las escribe el agente con un adaptador controlado, a partir de la ficha original y sin ver la
  referencia.
- Los errores se introducen a propósito.

## Qué se ha construido

- **Contrato de referencia.** Por ficha:
  - objetivo y área;
  - actividades con la operación cognitiva que evalúan y su marca en la consigna;
  - datos que deben sobrevivir: números, unidades, nombres, relaciones, orden impreso y opciones;
  - figuras con sus hechos y lo que debe quedar sin resolver;
  - respuestas que no pueden aparecer;
  - barreras, adaptaciones admisibles y cambios inaceptables;
  - adaptación de referencia;
  - estado de validación docente.
- **Evaluador A–E** (`evaluate.ts`).
  - Reutiliza los ayudantes de texto de la revisión de producción.
  - Devuelve PASS, FAIL, NEEDS_TEACHER_REVIEW o NOT_APPLICABLE por comprobación.
  - **El veredicto global nunca es PASS:** es FAIL o NEEDS_TEACHER_REVIEW.
- **Adaptador controlado y mutaciones.**
  - 16 tipos de error.
  - Una mutación cuyo texto no existe es un error de autoría, no un caso silencioso.
- **Contrato de revisión humana de figuras** (`figure-review.ts`).
  - El docente confirma, corrige o rechaza la candidata del localizador `figure_geometry@v2`.
  - Para confirmar hay que marcar explícitamente tres comprobaciones: pertenece a la actividad, está completa y no contiene
    respuestas.
  - La decisión se liga al sha-256 del material, la página, la región normalizada, el sha-256 del recorte mostrado y el recorte
    realmente visto.
  - Si cambia cualquiera de ellos, o la decisión es anterior a mostrar el recorte, deja de valer.
  - Una corrección crea una región nueva que necesita su propia revisión.
  - No hay UI ni conexión con Hacer magia.

## Conjuntos

| Conjunto | Fichas | Uso |
| --- | --- | --- |
| Propias (CI, en Git) | 6 sintéticas: fracciones, cálculo, lectura, ciencias, esquema etiquetado y geometría | Pruebas unitarias |
| Desarrollo (fuera de Git) | Originales 01 fracciones, 02 problemas, 04 comprensión lectora, 06 planta y 08 plano | Ajustar reglas |
| Reserva (fuera de Git) | Originales 03 geometría, 05 gramática y 07 ciclo del agua | Escrita y congelada (sha-256) antes de cualquier ejecución; ejecutada **una vez** |

- La división se decidió antes de leer las fichas en detalle.
- La guía docente se usó solo para la clave de corrección (respuestas y criterios), nunca para generar adaptaciones.
- Los originales siguen intactos y fuera de Git, con sus hashes registrados.

## Resultados

| Medida | Propias | Desarrollo | Reserva |
| --- | --- | --- | --- |
| Fichas | 6 | 5 | 3 |
| Referencias validadas por docente | 0 | 0 | 0 |
| Adaptaciones correctas + controles de copia literal | 18 | 15 | 9 |
| **Falsos bloqueos** | 0/18 | 0/15 (3/15 antes del único ajuste) | **0/9** |
| Datos críticos conservados en adaptaciones correctas | 108/108 | 144/144 | 81/81 |
| **Errores verificables detectados** | 37/37 | 52/52 | **28/29** |
| Fugas de respuesta detectadas | 11/11 | 12/12 | 8/8 |
| Fugas en adaptaciones correctas | 0 | 0 | 0 |
| Errores de figura detectados | 9/9 | 13/13 | 7/7 |
| Figuras íntegras en adaptaciones correctas | 30/30 | 18/18 | 15/15 |
| Errores no verificables detectados | 0/5 | 0/6 | 0/3 |
| … que llegan al docente como pendientes (nunca PASS) | 5/5 | 6/6 | 3/3 |
| Adaptaciones correctas pendientes de revisión docente | 18/18 | 15/15 | 9/9 |
| Comprobaciones pendientes de docente por adaptación | 2,7 | 2,7 | 2,7 |

### Por área y tipo

| Área | Tipo | Conjunto | Errores verificables detectados | Falsos bloqueos |
| --- | --- | --- | --- | --- |
| Matemáticas | fracciones | desarrollo | 11/11 | 0/3 |
| Matemáticas | numeración y cálculo | desarrollo | 11/11 | 0/3 |
| Lengua | comprensión lectora | desarrollo | 10/10 | 0/3 |
| Ciencias Naturales | esquema etiquetado | desarrollo | 10/10 | 0/3 |
| Ciencias Sociales | plano y coordenadas | desarrollo | 10/10 | 0/3 |
| Matemáticas | geometría | **reserva** | 10/10 | 0/3 |
| Lengua | gramática | **reserva** | 9/10 | 0/3 |
| Ciencias Naturales | ciencias (ciclo del agua) | **reserva** | 9/9 | 0/3 |

### Por tipo de error (desarrollo + reserva)

| Error | Detectados | Error | Detectados |
| --- | --- | --- | --- |
| Dato cambiado (fracción, cantidad, medida, coordenada) | 16/16 | Respuesta revelada (pista, glosario, tabla, ruta) | 13/13 |
| Figura sustituida | 4/4 | Figura resuelta (barra sombreada, lado, rótulo) | 4/4 |
| Etiquetas o flechas confundidas | 3/3 | Figura asignada a otra actividad | 2/2 |
| Actividad omitida | 8/8 | Consignas mezcladas | 6/6 |
| Actividad duplicada | 1/1 | Orden de hechos alterado | 1/1 |
| Relación cambiada («prestó» → «añadió», desperdicio) | 3/3 | Unidad cambiada | 1/1 |
| Texto recortado (causas, incertidumbre, reglas) | 4/4 | Operación planteada | 3/3 |
| Objetivo cambiado (inferir → copiar, respuesta cerrada) | 2/2 | **Sobresimplificación** | **9/10** |

## El único ajuste y el único fallo de la reserva

- **Ajuste en desarrollo.** En la ficha del plano, el control de copia literal fallaba: la respuesta corta «la biblioteca» ya está
  impresa en otra pregunta del original. Igual que con los números, una frase que el original ya imprime es un dato, no una fuga.
  Con este ajuste, los falsos bloqueos pasaron de 3/15 a 0/15.
- **Fallo en la reserva (gramática).** Se quitaba a la tabla la petición de escribir los rasgos (género, número, tiempo y
  persona), pero las cabeceras de columna seguían en el contenido. La comprobación de relaciones acepta cualquier forma
  equivalente y la encontró en la cabecera.
  - El error llegó al docente como pendiente, no como PASS.
  - No se ha corregido después de la reserva.

## Lo que todavía no se detecta (errores no verificables)

Todos quedan como «pendiente de revisión docente», pero ninguna regla los bloquea:

- un apoyo que enseña un criterio falso (equivalencia por «mismo número de partes», «quedaron = restar», «las hojas absorben
  agua», avanzar en diagonal);
- una inferencia escrita dentro del texto de lectura;
- una pregunta reescrita que conserva las palabras clave («por qué», «con seguridad») pero pide otra cosa o copiar;
- un banco de palabras que convierte recordar en reconocer;
- pistas de estrategia que resuelven el razonamiento sin dar el resultado;
- columnas o partes de una tabla eliminadas cuando su cabecera sigue impresa.

## Límites

- **Mismo autor.** El agente escribió referencias, adaptaciones, errores y reglas. La reserva mide la generalización a fichas
  nuevas, no la independencia del autor.
- **Muestra pequeña.** Son 8 fichas y 3 de reserva.
- **Las adaptaciones no son de un modelo.** Esta fase no prueba el generador real.
- **Patrones de fuga a mano.** Una fuga parafraseada fuera de ellos no se ve.
- **D y E siguen siendo humanos.** La accesibilidad real y la conservación del aprendizaje no se automatizan.

## Reproducir

```bash
pnpm exec vitest run tests/unit/pedagogical-quality.test.ts tests/unit/boundaries.test.ts
pnpm eval:pedagogy                                                 # propias
pnpm eval:pedagogy -- --corpus /copia/externa --split development  # fuera de Git
pnpm eval:pedagogy -- --corpus /copia/externa --split holdout       # ya ejecutada; repetir exige --rerun-holdout
```
