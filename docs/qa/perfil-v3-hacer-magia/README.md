# Perfil V3 y Hacer magia: primer recorrido funcional (acceso y metodológica)

Sobre la rama preparatoria de Codex (contrato `pedagogical-scope.ts`, conservado). Sin migraciones, sin E2E, sin llamadas de pago; planificador, generador y revisor simulados.

## Qué funciona ahora

1. **Elección por ficha.** Al adaptar, el docente elige «De acceso» (por defecto) o «Metodológica». La curricular no se ofrece y el servidor la rechaza: necesita una autorización por ficha que no existe.
2. **Datos pertinentes y nada más.** El servidor resuelve, solo para el área EXACTA de la ficha (slug verificado), tres cosas: el alcance, las formas de respuesta que se pueden ejecutar y las actividades que trabajan lo que el docente declara «por reforzar» (coincidencia léxica hecha en el servidor). **El texto libre, el nivel de referencia, las otras áreas y las preferencias de adaptación no salen del servidor**: ni al contexto guardado ni al planificador.
3. **Decisiones observables y trazables** (`context.pedagogy` y `context.conflicts`, congelados con la adaptación):
   - *Acceso*: no se ofrece ninguna estrategia que solo cambie la respuesta o reduzca la tarea; una decisión que lo intente la bloquean las invariantes; los apoyos se enfocan en las actividades señaladas.
   - *Metodológica*: se indican los formatos de respuesta disponibles para ese perfil (respuesta breve; oral si el docente la declaró, primero cuando la necesidad de escribir menos es alta; teclado si está permitido). Un formato cerrado sin clave verificable se sustituye por el disponible.
4. **Sin llamadas nuevas.** El planificador publicado (v2) ya obedece `needs` y `conflicts`; un cambio de espacio de respuesta lo hace el ensamblador y ya no provoca una reescritura de la consigna.
5. **Perfiles antiguos.** Un perfil V1/V2 con adaptación de acceso produce el contexto de siempre.

## Formatos de ejercicio: compatibilidad real

| Declarado en el perfil | ¿Se puede generar y validar hoy? |
| --- | --- |
| Escribir, respuesta breve, oral, teclado | Sí (ensamblador, sin IA) |
| Clasificar | Solo se conserva la tabla del original; no se crea una nueva |
| Unir, completar, ordenar, seleccionar | **No**: ningún ejecutor produce una clave verificada. Se registran como no disponibles y nunca se prometen |

## Límites reales

- **El texto declarado no llega al planificador.** El prompt publicado trata el contexto como fiable; enviar texto libre exige una versión nueva del planificador con un bloque no confiable y un cribado de datos identificativos. Mínimo necesario: `adaptation_planner` nuevo + cribado; no se ha hecho.
- **La coincidencia léxica es estrecha** (dos palabras de contenido en común con la actividad, sus objetivos o sus textos): una redacción distinta no enfoca nada (nunca empeora la ficha).
- **Curricular (5.º → 3.º): no funciona.** El nivel por área se guarda y el contrato de autorización existe, pero no hay persistencia de la autorización, ni transformación, ni verificación de objetivos modificados. La prueba está documentada como pendiente (`it.todo` en `tests/db/pedagogical-scope-magic.test.ts`).
- Probado con servicios simulados: no mide lo que hará el modelo real.

## Pruebas

`tests/db/pedagogical-scope-magic.test.ts` (15 + 1 pendiente): caso A (5.º, lectura, acceso), caso B (5.º, escritura, metodológica), privacidad, área exacta, rechazo del servidor, perfiles antiguos y curricular rechazada.

---

_Nota anterior de la rama preparatoria (Codex), conservada:_

## Trabajo preparatorio (contrato)

Base `651d130` (#94 integrada). La primera entrega conserva la información V3 pero no la envía a Hacer magia. El formulario de creación existente fija `accessibility`; la acción genérica acepta más tipos, pero no conserva una autorización curricular detallada por ficha. El contexto histórico está versionado y congelado en la creación; la selección de área debe basarse en el slug del material verificado en servidor, no en una etiqueta del modelo. El planificador v2 ordena adaptar el acceso y sus decisiones exigen necesidades funcionales. Los validadores permiten marcar algunas consecuencias curriculares para revisión, pero eso no demuestra que se haya autorizado un alcance ni que el generador pueda construir y validar objetivos y actividades curriculares. Tampoco todos los cambios de respuesta tienen un ejecutor equivalente seguro.

Esta rama prepara **solo** un contrato puro y pruebas, sin conexión a la interfaz, persistencia, planificador ni generador. Aísla la búsqueda de área por coincidencia exacta; preserva nivel desconocido; comprueba que una hipotética autorización curricular incluya objetivos conocidos vinculados a actividades y la huella del análisis actual. Una actividad con varios objetivos solo entra en el conjunto si todos sus objetivos están autorizados. Esto no demuestra que una transformación sea pedagógicamente válida ni verifica el original independientemente del análisis.

## Trabajo imprescindible pendiente

1. Diseñar la autorización explícita por ficha, vinculada a actor, material, análisis y alcance, con escritura duradera, idempotencia y permisos. No permitir que una preferencia del perfil conceda esa autorización.
2. Definir qué datos declarados pueden enviarse al proveedor: los campos de aprendizajes son texto libre y la instrucción de no escribir nombres no es una garantía de anonimización. Deben tratarse como entrada no confiable y resolverse las garantías de privacidad antes de conectarlos.
3. Versionar y congelar contexto y prompts solo para adaptaciones nuevas, sin alterar rutas de perfiles antiguos. Añadir mecanismos para verificar que el alcance se respete en el plan, la generación y la revisión, con trazabilidad actividad–objetivo–transformación; no basta con que el modelo lo declare.
4. Comprobar y habilitar únicamente formatos que puedan ejecutarse y verificarse sin rebajar la exigencia. Mantener una parada honesta cuando no sea posible.
5. Ejecutar las tres pruebas de Ciencias de 5.º solicitadas con generadores simulados y las pruebas de autorización, persistencia, acceso cruzado, reintentos e historial. **Aún no se han ejecutado esas tres pruebas ni se ha implementado su comportamiento.**

Las pruebas del contrato son sobre estructuras sintéticas, no sobre adaptaciones generadas ni validación pedagógica. Sin E2E, servicios de pago, migración remota o despliegue. Rama con despliegue de Vercel desactivado.
