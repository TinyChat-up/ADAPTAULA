# Motor de recreación: colaboración Claude + OpenAI (piloto del estanque)

> **Sustituido en parte por ADR-051** ([recreación en la plataforma](../recreacion-plataforma/README.md)).
> - El producto ya no genera la guía ni la clave y revisión en PDF: la explicación se muestra en pantalla y las respuestas quedan solo para las comprobaciones internas.
> - Los PDF enlazados abajo se han retirado. Los vigentes están en `docs/qa/recreacion-plataforma/`.
> - El resto de este informe (verificadores, recorrido simulado, coste) sigue vigente.

2026-11-18 · rama `claude/recreacion-colaboracion`, sobre `claude/recreacion-pedagogica` (PR #99). Sin IA de pago, E2E, migraciones, merge ni despliegue. «Hacer magia» no cambia. Diseño: [RECREATION.md](../../RECREATION.md) · ADR-049 y ADR-050.

## Material generado (recorrido completo simulado)

| Documento | Páginas | Para quién |
| --- | --- | --- |
| [Ficha del alumno](estanque-recreado-alumno.pdf) | 5 | alumno: 9 actividades nuevas, lectura por partes, ilustración (simulada) junto a la actividad 1, esquema exacto en la 5 |
| [Tarjetas recortables](estanque-tarjetas-recortables.pdf) | 1 | alumno: 6 tarjetas grandes con línea de corte y su instrucción |
| [Guía docente](estanque-guia-docente.pdf) | 2 | docente: estado de la revisión, cómo aplicarla, qué observar |
| [Clave y revisión](estanque-clave-y-revision.pdf) | 5 | docente, aparte: clave con su estado, equivalencia, imágenes, procedencia |
| [Ficha sin imágenes autorizadas](estanque-recreado-alumno-sin-imagenes.pdf) | 5 | variante: la ilustración no se genera y la clave explica por qué |

La ilustración de la ficha es el **dibujo local de `MockImageProvider`** (óvalos esquemáticos). Prueba el recorrido, la colocación y la impresión, no la calidad de una imagen real.

## 1. Qué se ha probado realmente

**Fase 1 · verificadores** (`src/lib/recreation/verify.ts`, `recreation_verify@v2`), con 22 pruebas de unidad, todas de regresión:

- **Cantidades.** La cita debe contener la cifra seguida de su unidad.
  - Si la cifra no está, o va con otra unidad, es **error**: el plan se rechaza, es una solución equivocada.
  - Si falta la unidad, hay varias cifras o la cita se repite en el original, la solución queda **sin comprobar**, nunca «verificada».
- **Secuencias.** Cada secuencia declara su base: orden del texto, temporal o causal.
  - Orden del texto: se verifica solo si el enunciado pregunta por ese orden.
  - Temporal o causal: se verifica solo si, en cada paso, un conector del tipo correcto («después»/«más tarde», o «por eso»/«porque») está **entre** los dos hechos.
  - Probado con textos variantes: un «por eso» no prueba un orden temporal, un «después» no prueba una causa, y un eslabón sin conector deja la secuencia sin comprobar.
  - La secuencia del estanque real queda **sin comprobar**: el texto la cuenta en ese orden, pero no dice que ocurriera así.
- **Estados honestos.**
  - Clasificar, seleccionar y V/F son `anchored`, presentados como **«SIN COMPROBAR: apoyada en el texto; revísela antes de corregir»**.
  - Solo la resta del estanque es `verified`.
  - `review_required` es verdadero mientras algo esté sin comprobar o pendiente.
- **Equivalencia pedagógica, por objetivo.** Comprobaciones deterministas:
  - lo que se producía por escrito (justificar, proponer, predecir, localizar pruebas) sigue siendo respuesta abierta; si pasa a elegir entre opciones, se **rechaza**;
  - no se clasifican menos elementos que en el original;
  - se sigue pidiendo escribir la operación.

  El **razonamiento** queda siempre **pendiente** de la revisión docente; nunca se da por superado.
- **Pistas cruzadas.** Se detectan y se prueban:
  - una afirmación verdadera de otra actividad que parafrasea la opción correcta;
  - un texto que dice la relación que el esquema pide interpretar («las larvas comen algas»);
  - el resultado, la opción literal o el grupo de un ítem;
  - una secuencia escrita en orden;
  - un distractor que dice lo mismo que la cita de la respuesta correcta. Uno que invierte la relación sí se admite: es un distractor legítimo.

**Fases 2, 3 y 5 · recorrido completo simulado** (`tests/unit/recreation-pipeline.test.ts`, 8 pruebas; `tests/pdf/recreation-pilot.test.ts`, 4 pruebas):

- **Planificador** sobre la fontanería existente:
  - `createRecreationPlanner` llama al proveedor con `callStructured` (el mismo de los asistentes visuales), prompt versionado `recreation_planner` v1 y salida validada con `recreation_plan@v1`;
  - cada llamada se registra como `ai_runs`, sin contenido (probado);
  - antes de cada llamada se comprueba el peor caso de gasto (probado: sin presupuesto, no se llama);
  - como máximo una reparación con los motivos (probado: un plan con pista se repara; si vuelve a fallar, no se entrega).
- **Imágenes:** decisión A/B/C y el pipeline real `illustrate()` (brief → reserva de cuota → imagen → revisión → almacenamiento) con dependencias en memoria. Probado:
  - **Autorizado:** brief, imagen y revisión; ilustración colocada justo antes de su actividad.
  - **No autorizado:** cero llamadas de imagen; la causa («generación no disponible (disabled)») queda en la clave y la ficha sigue completa porque la imagen no era imprescindible.
  - **Imprescindible y no producible:** hueco en el documento, aviso «FALTA 1 imagen imprescindible» en la guía, y el renderer **no** da la ficha por imprimible.
  - **Revisión que rechaza:** un segundo intento y, después, nada en la ficha, con el motivo.
  - **Brief con rótulos o marcadores:** se rechaza; el texto lo pone el renderer.
  - **Generabilidad:** no se genera nada que dependa de rótulos, flechas o números, ni nada que los pida dentro de la imagen.
- **Procedencia:** cada recurso registra qué lo produjo y qué lo comprobó, y se imprime en la clave.
- **PDF:** las cuatro piezas se imprimen con el motor del producto, sin avisos de validación y sin peticiones de red. Ninguna página antes de la última tiene menos del 3 % de tinta. La ficha no contiene la clave.

**Revisión visual de todas las páginas.** Tras leerlas se corrigió:

- La guía tenía 7 páginas, con una tabla que repetía el mismo «pendiente» por objetivo. Se separa en guía breve (2 págs.) y clave y revisión (5 págs.).
- Las tarjetas llevaban la etiqueta automática «Observa» del diseño CLARO; se quita en las tarjetas.

**Suites completas:** unidad 2.021, BD 515 y PDF 100, todas correctas. Typecheck correcto; lint con un aviso preexistente; `check:privacy` correcto.

## 2. Qué es simulado

- **«Claude»** es `MockProvider` con respuestas fijas (`fixtures`, cambio aditivo):
  - el plan es el del estanque, escrito a mano con el contrato;
  - el brief y la revisión son también respuestas fijas.
- **«OpenAI»** es `MockImageProvider`: un dibujo esquemático local, sin relación con el estanque.
- **Almacenamiento, cuota y presupuesto de las ilustraciones** están en memoria. En producción, `illustrate()` usa `generated_assets`, `consume_quota('image')` y `ai_runs`, que exigen una fila de `adaptations`; el motor de recreación todavía no tiene la suya (ver punto 4).
- **La puerta de imágenes** (`FLAG_AI_IMAGES_ENABLED`, piloto de un workspace, plan Max) la decide quien llama. En las pruebas se fija a «autorizado» o «no autorizado».

## 3. Problemas pedagógicos que persisten

1. **El sentido de las respuestas `anchored`** (qué grupo, qué opción, el orden temporal del estanque) no lo comprueba el sistema. La clave lo dice, pero depende del docente.
2. **Equivalencia del razonamiento:** pendiente en los cinco objetivos. Por ejemplo, seleccionar los dos cambios (actividad 2) exige reconocer, no localizar ni redactar; la localización se mantiene en la 3, pero que el conjunto equivalga al original es un juicio pedagógico.
3. **Pistas semánticas** que no comparten palabras con la respuesta (una escena que sugiere la solución, una analogía) siguen fuera del alcance del verificador. La revisión de imagen y el docente son la defensa. El revisor semántico (ADR-048, apagado) no se aplica aún a la ficha recreada.
4. **La secuencia del estanque** (actividad 4) se ofrece como temporal, pero el texto no la demuestra. Dos opciones:
   - pedir el orden del texto, que es verificable pero cambia lo que se trabaja;
   - aceptarla como «sin comprobar».

   Decisión del docente o del equipo pedagógico.
5. **La ilustración** es de contexto (reconocer los componentes antes de clasificarlos). Su utilidad real con alumnado con dificultades de lectura está por validar, y su calidad con un modelo real, por medir.
6. **Carga:** 9 actividades en 5 páginas para 5 objetivos. Es menos que en la primera entrega (10) y dentro del límite que vigila el verificador (≤ 2 por objetivo), pero la carga adecuada para este perfil la debe valorar el docente.

## 4. Qué falta para probar Claude y OpenAI reales

1. **Autorización expresa** de la evaluación de pago (abajo) y del presupuesto.
2. **Claves en el entorno de la evaluación** (no en el repositorio): `ANTHROPIC_API_KEY` y `OPENAI_API_KEY`.
3. **Modelos por alias:**
   - `AI_MODEL_STANDARD` para el planificador, el brief y la revisión (Anthropic, Sonnet 5.5 con precio en la tabla);
   - `AI_MODEL_IMAGE_QUALITY` para la imagen.
4. **Un guion de evaluación local** (`evals/recreation/`) que:
   - use los mismos `createRecreationPlanner` e `illustrate()` con los proveedores reales;
   - guarde en memoria, como las pruebas;
   - escriba los `ai_runs` y los PDF en una carpeta local;
   - corte por presupuesto.

   No necesita base de datos ni toca producción. Está **sin escribir a propósito**, hasta la autorización.
5. **Para el producto** (no para la evaluación):
   - una fila «anfitriona» o una tabla propia para las recreaciones (una migración), de modo que `generated_assets`, la cuota y `ai_runs` se asocien;
   - conectar la puerta real `illustrationAvailability()`;
   - interfaz.

## 5. Coste estimado de la prueba real (propuesta, sin ejecutar)

Precios de `src/lib/ai/costs.ts` (Sonnet 5.5: 2 $/M de entrada y 10 $/M de salida) y peores casos de `ILLUSTRATION_BUDGET` (imagen 0,08 $; brief o revisión 0,03 $).

| Llamada por ficha | Número | Peor caso |
| --- | --- | --- |
| Planificador (≈ 4 k tokens de entrada, ≤ 8 k de salida) | 1 + 1 reparación | 2 × 0,09 = 0,18 $ |
| Brief de la ilustración | 1 | 0,03 $ |
| Imagen + revisión | 1 + 1 reintento | 2 × (0,08 + 0,03) = 0,22 $ |
| **Total por ficha** | **4 a 7 llamadas** | **≤ 0,43 $** (esperado ≈ 0,20 $) |

**Propuesta:**

- Fichas: el estanque y dos fichas más de Ciencias o Matemáticas de Primaria ya incluidas en las pruebas (célula, fracciones).
- **Dos repeticiones** de cada una, para medir la consistencia.
- En total, **6 recorridos, entre 24 y 42 llamadas**.
- **Peor caso: 2,58 $**; esperado entre 1,0 y 1,5 $. Dentro del límite de 3 USD ya fijado para evaluaciones, con corte automático por presupuesto.
- **Criterios de lectura:**
  - % de planes que pasan la verificación a la primera y tras la reparación;
  - errores por código;
  - pistas cruzadas detectadas a mano;
  - estados de las soluciones;
  - imágenes aprobadas o rechazadas por la revisión, con revisión visual humana de cada una;
  - páginas y tinta;
  - coste real frente al estimado.

**Espera autorización.** No se ha hecho ninguna llamada de pago.
