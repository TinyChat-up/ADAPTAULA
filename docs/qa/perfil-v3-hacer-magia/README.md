# Perfil V3 y Hacer magia: primer recorrido funcional (acceso y metodológica)

Sobre la rama preparatoria de Codex (contrato `pedagogical-scope.ts`, conservado). Sin migraciones remotas, sin E2E, sin llamadas de pago; planificador, generador y revisor simulados.

## Qué funciona ahora

1. **Elección por ficha.** Al adaptar, el docente elige «De acceso» (por defecto) o «Metodológica». La curricular no se ofrece y el servidor la rechaza: necesita una autorización por ficha que no existe.
2. **Datos pertinentes y nada más.** El servidor resuelve, solo para el área EXACTA de la ficha (slug registrado en el material, sin verificar independientemente su clasificación), tres cosas: el alcance, las formas de respuesta que se pueden ejecutar y las actividades que trabajan lo que el docente declara «por reforzar» (coincidencia léxica hecha en el servidor). **El texto libre, el nivel de referencia, las otras áreas y las preferencias de adaptación no salen del servidor**: ni al contexto guardado ni al planificador.
3. **Decisiones observables y trazables** (`context.pedagogy` y `context.conflicts`, congelados con la adaptación):
   - *Acceso*: no se ofrece ninguna estrategia que solo cambie la respuesta o reduzca la tarea; una decisión que lo intente la bloquean las invariantes; los apoyos se enfocan en las actividades señaladas.
   - *Metodológica*: se indican los formatos de respuesta disponibles para ese perfil (respuesta breve; oral si el docente la declaró, primero cuando la necesidad de escribir menos es alta; teclado si está permitido). Un formato cerrado sin clave verificable se sustituye por el disponible.
4. **Sin llamadas nuevas.** El planificador publicado (v2) recibe `needs` y `conflicts`; no se ha comprobado con un modelo real que los siga; un cambio de espacio de respuesta lo hace el ensamblador y ya no provoca una reescritura de la consigna.
5. **Perfiles antiguos.** Un perfil V1/V2 con adaptación de acceso produce el contexto de siempre.

## Formatos de ejercicio: compatibilidad real

| Declarado en el perfil | ¿Se puede generar y validar hoy? |
| --- | --- |
| Escribir, respuesta breve, oral, teclado | Sí (ensamblador, sin IA) |
| Clasificar | Solo se conserva la tabla del original; no se crea una nueva |
| Unir, completar, ordenar, seleccionar | **No**: ningún ejecutor produce una clave verificada. Se registran como no disponibles y nunca se prometen |

## Límites reales

- **El texto declarado no llega al planificador.** El prompt publicado trata el contexto como fiable; enviar texto libre exige una versión nueva del planificador con un bloque no confiable y un cribado de datos identificativos. Mínimo necesario: `adaptation_planner` nuevo + cribado; no se ha hecho.
- **La coincidencia léxica es estrecha** (dos palabras de contenido en común con la actividad, sus objetivos o sus textos): una redacción distinta puede no coincidir y coincidencias de palabras pueden señalar actividades que no correspondan; requiere revisión docente.
- **Curricular (5.º → 3.º): no funciona.** El nivel por área se guarda y el contrato de autorización existe, pero no hay persistencia de la autorización, ni transformación, ni verificación de objetivos modificados. La prueba está documentada como pendiente (`it.todo` en `tests/db/pedagogical-scope-magic.test.ts`).
- Probado con servicios simulados: no mide lo que hará el modelo real.

## Pruebas

`tests/db/pedagogical-scope-magic.test.ts` (casos A y B y una prueba curricular pendiente): caso A (5.º, lectura, acceso), caso B (5.º, escritura, metodológica), privacidad, área exacta, rechazo del servidor, perfiles antiguos y curricular rechazada.


## Cierre técnico y límites de la verificación

Se reprodujo y corrigió la aceptación de respuesta oral no declarada: el servidor bloquea formatos fuera de los disponibles. También se dividen las restricciones cuando afectan a más de seis dimensiones, para cumplir el contrato sin perder necesidades. Los controles preservan referencias y elementos identificados por el análisis; no prueban de forma independiente la equivalencia semántica ni garantizan que el modelo respete los objetivos. El resultado requiere revisión docente. El contexto de acceso de perfiles anteriores conserva su comportamiento anterior, que no incorpora la nueva restricción V3 de respuesta.

Verificación local: batería completa de unidad y BD **2.506 correctas, 18 omitidas y 1 pendiente**, 183 archivos correctos y 1 omitido; adicionalmente 74 focalizadas correctas y 1 pendiente tras los últimos cambios. Typecheck correcto; lint sin errores con un aviso previo en `analysis-run-auth.test.ts`. Sin E2E por indicación. No se ha comprobado producción ni un proveedor real.
