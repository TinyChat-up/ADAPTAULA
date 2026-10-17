# Adaptaula — Producto

**Dirección vigente (2026-10-15): [Adaptaula 2.0](ADAPTAULA_2.md).** Desarrollo incremental centrado en el documento. Etapas 1, 2A y 2B integradas: fundamentos visuales, workspace documental y comparación/edición contextual sobre CLARO. La etapa 3A está integrada (mesa, biblioteca e historial); 3B incorpora perfiles progresivos y cuenta con nombre editable y consumo real separado. La política comercial nueva corresponde a la etapa 4 y no está aplicada. Las capacidades propuestas abajo no son una lista de funciones disponibles.

## Propuesta de valor

> Sube el material que ya utilizas y conviértelo en una versión adaptada para cada alumno en minutos.

El docente sube una ficha (PDF o imagen), indica contexto (etapa, curso, asignatura), elige uno o varios perfiles de alumnado o una adaptación rápida, y recibe una ficha adaptada, maquetada, editable, comparable con el original y exportable a PDF. Cada resultado explica **qué se ha adaptado y por qué**.

### Lo que el producto NO es

- No diagnostica ni infiere trastornos o discapacidades.
- No sustituye al docente, orientador/a, PT, AL ni a otros profesionales.
- No es un editor tipo Word o Canva, ni una red social, ni una plataforma para alumnos.
- Toda salida es una **propuesta editable** que el profesional revisa.

## Usuarios (V1)

Solo profesionales adultos: docentes de Primaria, ESO y Bachillerato; maestros/as PT y AL; orientadores/as; profesorado de apoyo; equipos educativos. **Sin cuentas de alumno ni de menores.**

Etapas soportadas: Primaria, ESO, Bachillerato. Etapas, cursos y asignaturas son **datos** (tablas `stages`, `grades`, `subjects`), extensibles a Infantil, FP, Educación especial y Adultos sin cambios de código.

## Principios

1. **Primero la necesidad, después la etiqueta.** La adaptación se decide por dimensiones funcionales (p. ej. longitud máxima de instrucción, carga visual, memoria de trabajo), no por diagnósticos. Las etiquetas solo sirven para precargar presets editables.
2. **Preservar el objetivo de aprendizaje** salvo petición explícita del docente (adaptación curricular, con advertencia).
3. **No infantilizar.** Lenguaje sencillo ≠ estética infantil. ESO/Bachillerato: diseño sobrio.
4. **Transparencia.** Cada adaptación lista 3-6 cambios realizados ("instrucciones fragmentadas", "vocabulario anticipado"…).
5. **Limitar cantidad, nunca destruir calidad.** El plan Free da resultados buenos, solo menos.
6. **Privacidad por defecto.** Alias en lugar de nombres; la IA no recibe identidad, notas ni etiquetas del alumno.
7. **DUA como marco**: compromiso, representación, acción y expresión. Ningún apoyo sin propósito.

## Flujo central (lo que optimizamos obsesivamente)

Entrar → subir material → elegir alumno/necesidades → **Adaptar** → ver ficha utilizable → entender qué ha cambiado → descargar PDF. Objetivo: 3-5 interacciones desde el dashboard hasta la generación.

North Star: **adaptaciones descargadas por profesor activo semanal.**

## Planes

**Política 4A implementada en migración 026, pendiente de aplicación remota autorizada.** Los límites efectivos viven en `plans`; el seed replica el catálogo para instalaciones nuevas. Precios provisionales con IVA incluido, pendientes de validar costes y demanda.

| | Free | Pro | Max |
|---|---|---|---|
| Precio mensual | 0 € | 24,90 € | 49,90 € |
| Adaptaciones/periodo mensual | 1 | 15 | 30 |
| Análisis/periodo mensual | 2 | 30 | 50 |
| Perfiles guardados | 2 | 30 | 100 |
| Páginas por material | 5 | 15 | 25 |
| PDF | Incluido | Incluido | Incluido |
| Disponibilidad comercial | Registro gratuito | Contratación no disponible | En preparación |

Sin precios anuales anunciados, sin imágenes IA habilitadas y sin diferencias de calidad introducidas entre Free y Pro. CLARO, editor y comparador existentes se conservan. Los metadatos heredados de funciones futuras no son prestaciones comerciales.

Una adaptación reserva una unidad; cancelarla antes de entregar libera esa reserva. Fallos/revisión conservan la reserva para recuperar el mismo trabajo. Análisis tiene cuota independiente: caché no consume, fallo definitivo devuelve una vez. No se cambia la semántica del pipeline.

Las suscripciones anteriores conservan sus filas y condiciones; su cuenta puede mostrar límites distintos del catálogo nuevo. No se ha inspeccionado producción. Véase [procedimiento de migración y compatibilidad](qa/adaptaula-2-etapa-4a/README.md).

**Adaptaula Centros** (futuro): el modelo `workspace` (personal, colegio, instituto, academia, organización) con roles `owner/admin/teacher/viewer` existe desde el día 1; la venta B2B no se construye en el MVP (solo `/centros` con formulario de contacto).

## Perfil funcional

Un perfil de alumnado (`learner_profiles`) tiene un alias, etapa/curso y un **perfil funcional** (no hay texto libre sobre el alumno: la columna `notes` se eliminó): un conjunto de dimensiones con nivel de apoyo `none | low | medium | high` (más algunas dimensiones numéricas, como el máximo de tareas visibles). El catálogo de dimensiones está en `src/lib/schemas/functional-profile.ts` y se agrupa en:

Lectura · Comprensión · Lenguaje · Atención y función ejecutiva · Matemáticas · Comunicación y predictibilidad · Sensorial · Visión · Audición · Motricidad · Regulación emocional · Ampliación y reto.

En la interfaz, esos grupos se presentan como 11 **áreas** para el docente (`src/lib/profiles/areas.ts`; «Acceso visual» reúne Visión y Sensorial). Cada dimensión tiene un texto llano en `src/lib/profiles/copy.ts`; los presets viven en `src/lib/profiles/presets.ts` y **no se guardan en el perfil**: solo las dimensiones resultantes.

Además de los niveles, el perfil admite **límites precisos opcionales** (máximo de palabras por instrucción, de tareas visibles y de minutos por tarea) y **permisos** sí/no (calculadora, teclado, apoyo bilingüe en un idioma concreto). Calculadora y teclado son permisos, no niveles de apoyo.

Las dimensiones no se infieren nunca automáticamente de un diagnóstico. El editor de perfil muestra siempre un resumen en lenguaje natural ("Así se aplicará"), nunca JSON.

## Presets (editables, nunca bloqueantes)

Un preset es un **atajo funcional**, no una categoría diagnóstica: precarga un conjunto de dimensiones (necesidades funcionales) que el docente puede cambiar todas. Ni su id ni su nombre se guardan en el perfil ni llegan a la IA: lo que se guarda y se envía son solo las dimensiones resultantes. Su nombre visible describe el apoyo que configura, nunca una condición. Los ids internos (`dislexia`, `tdah`…) se mantienen por compatibilidad del código y los tests; no se muestran y no se persisten.

Qué configura cada uno (`src/lib/profiles/presets.ts`; las dimensiones están congeladas en `tests/unit/fixtures/profile-presets-dimensions.json`):

- **Lectura y decodificación**: fragmentar textos largos, instrucciones directas, espacio suficiente, resaltar lo esencial, reducir copia, aclarar vocabulario. Mantener la demanda cognitiva cuando la lectura no es el objetivo. Ninguna tipografía es "la solución".
- **Atención, planificación y organización**: actividades fragmentadas, instrucciones numeradas, objetivo visible, menos distractores, checklist, duración clara, una acción por paso. No reducir la dificultad intelectual.
- **Lenguaje explícito y estructura predecible**: lenguaje explícito, sin ambigüedad innecesaria, estructura predecible, pasos anticipados, menos decoración. No asumir pictogramas. No infantilizar.
- **Comprensión y expresión del lenguaje**: sintaxis clara, vocabulario explicado, ejemplos, menor densidad verbal, instrucciones separadas, comprobación de comprensión.
- **Lenguaje concreto y práctica guiada**: según la competencia real indicada por el docente. Lenguaje concreto, menos abstracción, ejemplos resueltos, práctica guiada, pasos pequeños, menos alternativas. No convertir una ficha adolescente en material infantil.
- **Sentido numérico y pasos en matemáticas**: pasos visibles, ejemplos resueltos, alineación espacial, representación visual, menos operaciones simultáneas. Preservar el razonamiento matemático cuando sea el objetivo.
- **Ampliación y profundización**: profundidad, conexiones, transferencia, preguntas abiertas, múltiples soluciones, pensamiento crítico, elección. No "más ejercicios".
- **Vocabulario y apoyo en la lengua de la clase**: vocabulario esencial, definiciones sencillas, imágenes informativas, estructuras repetibles, glosario, apoyo bilingüe solo si se pide. No confundir lengua con capacidad.
- **Acceso visual: letra ampliada y contraste**: contraste, tipografía escalable, estructura, nada solo por color, texto alternativo, descripción de diagramas.
- **Todo por escrito, nada solo por audio**: instrucciones escritas, vocabulario explícito, transcripciones, nada esencial solo por audio.
- **Menos escritura y respuestas por selección**: menos copia y escritura, respuestas por selección, espacios amplios.

## Tipos de adaptación

| Tipo | Objetivos | Qué cambia |
|---|---|---|
| Accesibilidad | Se mantienen (y la dificultad) | Solo acceso, presentación y forma de respuesta |
| Metodológica | Se mantienen | Explicación, estructura, apoyos, ejemplos, actividades |
| Simplificación lingüística | Se mantiene el contenido | Barrera lingüística |
| Refuerzo | Se mantienen | Añade conocimientos previos, ejemplos, práctica guiada |
| Ampliación | Se mantienen y se amplían | Profundidad y reto |
| Curricular | **Pueden cambiar** | Objetivos y nivel; requiere confirmar advertencia |

Advertencia obligatoria en curricular: *"Esta opción puede modificar objetivos y nivel curricular. Revisa el resultado de acuerdo con las decisiones y medidas educativas establecidas para el alumno."* La IA nunca decide por sí sola una adaptación curricular significativa.

## Criterio de calidad de una adaptación

Debe cumplir a la vez: (1) contenido académico correcto; (2) barreras relevantes reducidas; (3) objetivo conservado cuando corresponde; (4) apariencia apropiada para la edad; (5) usable de verdad en clase; (6) el docente entiende qué cambió; (7) editable; (8) PDF imprimible; (9) sin infantilización; (10) cambios derivados de necesidades funcionales.

## Métricas

- **Activación**: genera y descarga la primera adaptación.
- **Time to value**: registro → primera descarga.
- **Retención**: vuelve y adapta otro material.
- **Conversión** Free → Pro; adopción de Max.
- **Coste IA por adaptación** y **margen bruto por plan**.
- % de adaptaciones con bloques regenerados; feedback 👍/👎.

El feedback ("¿Te ha servido esta adaptación?") nunca modifica automáticamente un perfil de alumno.
