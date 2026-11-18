# Piloto del motor de recreación: «Un estanque en equilibrio»

2026-11-18 · rama `claude/recreacion-pedagogica`, desde `main` `ae1ba94`, independiente de las PR #97 y #98. Sin IA de pago, E2E, migraciones, merge ni despliegue. «Hacer magia» no cambia. Diseño: [RECREATION.md](../../RECREATION.md).

PDF generados con el motor nuevo y el renderer de siempre:

- [Ficha del alumno](estanque-recreado-alumno.pdf), 5 páginas A4.
- [Guía docente](estanque-recreado-guia-docente.pdf), 4 páginas A4, solo para el profesorado.

## Caso

- **Fuente:** `tests/support/pond-case.ts`, la ficha de prueba del docente ya incluida en el repositorio: 5.º de Primaria, Ciencias, 5 objetivos y 8 actividades.
- **Perfil:** dificultades de lectura y escritura, solo con necesidades funcionales: decodificación, lectura por partes, longitud del texto, letra e interlineado, instrucciones en pasos, menos escritura, respuesta por selección y apoyo a la expresión.
- **Alcance:** metodológico.
- **Plan:** escrito a mano con el contrato que producirá el modelo (ver *Límites*).

## Comparación: original → recreada

| Objetivo (original) | Lo que evaluaba el original | Actividades nuevas | Formato nuevo | Cómo se conoce la solución |
| --- | --- | --- | --- | --- |
| obj_1 · Identificar cambios a partir del texto | 1: escribir dos cambios y la información que lo prueba | **2**: marcar los dos cambios entre cuatro (dos distractores no apoyados por el texto) · **3**: copiar las palabras que prueban uno | selección + 2 líneas con inicio de frase | 2: citas del texto (`anchored`) · 3: criterios |
| obj_2 · Clasificar componentes | 2: tabla vacía de dos columnas | **1**: relacionar cada componente con A/B, con tarjetas recortables opcionales | relacionar | ítems citados, grupo único (`anchored`) |
| obj_3 · Relaciones alimentarias y consecuencias | 3a, 3b, 4b: explicar flechas, predecir, consecuencia del descenso | **4**: numerar tres hechos encadenados · **5**: qué indica una flecha concreta del esquema · **6**: predecir qué pasa a las ranas y justificarlo con el esquema | ordenar + selección + 3 líneas | 4: orden del texto (`verified`) · 5: cita (`anchored`) · 6: criterios |
| obj_4 · Calcular una variación con datos | 4a: «¿cuántos centímetros descendió?», con la operación | **7**: buscar los dos datos en la parte 2, escribir la operación y el resultado con su unidad | campos Operación / Resultado / Unidad | aritmética (`verified`: 30 − 18 = 12 cm) |
| obj_5 · Valorar afirmaciones y proponer una medida | 5: valorar una afirmación con el texto · 6: proponer una medida | **8**: V/F de tres frases con apoyo en el texto · **9**: valorar la idea del original con una prueba · **10**: proponer una medida y a quién ayuda | V/F + 3 + 3 líneas | 8: citas (`anchored`) · 9 y 10: criterios |

Los cinco objetivos se conservan con todas sus operaciones mínimas, comprobado por el servidor y por una prueba. Ningún enunciado nuevo reproduce uno del original (Jaccard < 0,5, también probado). La exigencia que se mantiene a propósito:

- se escribe la **operación**, no solo el resultado;
- se **justifica** con pruebas del texto en 3, 6 y 9;
- la **propuesta** es libre.

Lo que cambia es la forma:

- la lectura se presenta en tres partes con título;
- donde lo evaluado no es escribir, se responde marcando, relacionando u ordenando;
- las respuestas escritas son breves y llevan inicios de frase neutros.

## Revisión de todas las páginas (no solo los tests)

**Ficha del alumno**

| Pág. | Contenido | Valoración |
| --- | --- | --- |
| 1 | Cabecera, título, consigna y la lectura **literal** en tres partes con título | Ocupa algo más de la mitad: la actividad 1 se mantiene entera en la página 2. No es una página vacía. |
| 2 | Actividades 1 a 3 | Relacionar con casillas, cuatro opciones y dos líneas con inicio de frase. |
| 3 | Actividades 4 y 5, con el esquema Algas → Larvas de insectos → Ranas → Garzas dibujado desde los datos | Esquema completo, sin recortes ni deformación. Los hechos de la 4 se imprimen desordenados. |
| 4 | Actividades 6 a 8 | La 6 remite al esquema de la actividad 5 (página anterior). |
| 5 | Actividades 9 y 10 | Última página, unos dos tercios llena. |

**Guía docente:**

- Objetivos con sus operaciones.
- Por actividad: objetivo, estrategia, solución, cómo se sabe y qué observar.
- Tarjetas para recortar.

La guía usa letra estándar (es para el docente) y conserva el contraste del perfil.

**Comprobado en el PDF** (`tests/pdf/recreation-pilot.test.ts`):

- La validación de impresión no da avisos.
- Ninguna página antes de la última tiene menos del 3 % de tinta.
- El esquema lleva sus cuatro rótulos.
- La ficha del alumno no contiene ni la operación resuelta, ni los criterios, ni la guía.
- La guía contiene la solución calculada y las tarjetas.

### Defectos encontrados al revisar y corregidos antes de entregar

La primera versión pasaba las pruebas automáticas, pero al leer las páginas aparecieron estos defectos:

1. **Pistas cruzadas entre actividades.** En la actividad 8:
   - «Cuando bajó el agua…» confirmaba una opción correcta de la 2;
   - «En junio había más sitios…» quedaba resuelta por un ítem de la 4;
   - «Las garzas pueden alimentarse de ranas», junto al esquema, revelaba qué indica la flecha (la 5).

   Se sustituyeron por afirmaciones sobre otras partes del texto. El verificador no detecta este tipo de pista (es semántica); queda documentado como límite.
2. La actividad 9 decía «elige la frase marcada con F», lo que revelaba cuántas eran falsas. Ahora valora la afirmación del original de forma independiente.
3. Doble numeración en la actividad 1 (un paso «1.» sobre los ítems «1. Algas…»): el paso pasa al enunciado.
4. Inicios de frase con «… …»: el renderer ya añade los puntos. El contrato ahora rechaza un inicio que termina en puntos suspensivos.
5. Guía de 9 páginas con una tabla de soluciones en columnas estrechas: ahora son bloques por actividad (4 páginas).
6. Título del esquema duplicado (título y pie): ahora solo se imprime el título.
7. Las cantidades de la actividad 7 se citaban de una tabla del original que el alumno no ve: ahora se citan de la lectura impresa.

## Pruebas

- **Unidad** (`tests/unit/recreation.test.ts`, 15 casos):
  - el piloto se verifica y compila;
  - objetivos y operaciones conservados;
  - novedad de los enunciados;
  - trazabilidad de cada bloque a sus objetivos y estrategias;
  - soluciones deterministas (orden y resta);
  - la clave queda fuera del modelo de impresión del alumno;
  - entrada mínima y bloque no confiable.

  Rechazos probados:
  - una cita inventada;
  - un objetivo o una operación perdidos;
  - alcance curricular o de acceso, o un alcance distinto del autorizado;
  - un enunciado copiado;
  - cuatro tipos de pista;
  - una selección sin cita o con un recuento distinto;
  - un V/F uniforme;
  - una secuencia ambigua;
  - una necesidad ajena al contexto;
  - un contrato mal formado.
- **PDF** (`tests/pdf/recreation-pilot.test.ts`, 2 casos): ficha y guía impresas con el motor del producto.
- **Comprobaciones:**
  - suites de unidad, BD y PDF;
  - typecheck;
  - lint;
  - `check:privacy`.

## Límites (qué es real, qué es simulado y qué falta)

- **Simulado:** el plan del estanque lo escribió una persona con el contrato del modelo. No es evidencia de que un modelo lo haga igual de bien. El prompt `recreation_planner` v1 existe, pero **no se ha ejecutado** (sin llamadas de pago). La siguiente prueba sería una evaluación con un presupuesto autorizado.
- **No verificable aún:**
  - el sentido de las respuestas `anchored` (grupo, opción o V/F);
  - las pistas semánticas entre actividades.

  Lo revisa el docente con la guía; la siguiente pieza es el revisor semántico aplicado a la ficha recreada.
- **No conectado:**
  - persistencia en `adaptation_versions`;
  - cuota, permisos y `ai_runs`;
  - interfaz.

  El motor produce dos `MaterialDocument`, la misma unidad que ya se guarda, así que la conexión no requiere cambiar el esquema.
- **Fuera de alcance:**
  - adaptación curricular (se rechaza);
  - imágenes generadas;
  - hoja de recortables con su propio diseño;
  - otras áreas y etapas.
