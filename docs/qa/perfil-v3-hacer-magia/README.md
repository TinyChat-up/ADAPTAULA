# Perfil V3 y Hacer magia: trabajo preparatorio, NO funcional

Base `651d130` (#94 integrada). La primera entrega conserva la información V3 pero no la envía a Hacer magia. El formulario de creación existente fija `accessibility`; la acción genérica acepta más tipos, pero no conserva una autorización curricular detallada por ficha. El contexto histórico está versionado y congelado en la creación; la selección de área debe basarse en el slug del material verificado en servidor, no en una etiqueta del modelo. El planificador v2 ordena adaptar el acceso y sus decisiones exigen necesidades funcionales. Los validadores permiten marcar algunas consecuencias curriculares para revisión, pero eso no demuestra que se haya autorizado un alcance ni que el generador pueda construir y validar objetivos y actividades curriculares. Tampoco todos los cambios de respuesta tienen un ejecutor equivalente seguro.

Esta rama prepara **solo** un contrato puro y pruebas, sin conexión a la interfaz, persistencia, planificador ni generador. Aísla la búsqueda de área por coincidencia exacta; preserva nivel desconocido; comprueba que una hipotética autorización curricular incluya objetivos conocidos vinculados a actividades y la huella del análisis actual. Una actividad con varios objetivos solo entra en el conjunto si todos sus objetivos están autorizados. Esto no demuestra que una transformación sea pedagógicamente válida ni verifica el original independientemente del análisis.

## Trabajo imprescindible pendiente

1. Diseñar la autorización explícita por ficha, vinculada a actor, material, análisis y alcance, con escritura duradera, idempotencia y permisos. No permitir que una preferencia del perfil conceda esa autorización.
2. Definir qué datos declarados pueden enviarse al proveedor: los campos de aprendizajes son texto libre y la instrucción de no escribir nombres no es una garantía de anonimización. Deben tratarse como entrada no confiable y resolverse las garantías de privacidad antes de conectarlos.
3. Versionar y congelar contexto y prompts solo para adaptaciones nuevas, sin alterar rutas de perfiles antiguos. Añadir mecanismos para verificar que el alcance se respete en el plan, la generación y la revisión, con trazabilidad actividad–objetivo–transformación; no basta con que el modelo lo declare.
4. Comprobar y habilitar únicamente formatos que puedan ejecutarse y verificarse sin rebajar la exigencia. Mantener una parada honesta cuando no sea posible.
5. Ejecutar las tres pruebas de Ciencias de 5.º solicitadas con generadores simulados y las pruebas de autorización, persistencia, acceso cruzado, reintentos e historial. **Aún no se han ejecutado esas tres pruebas ni se ha implementado su comportamiento.**

Las pruebas del contrato son sobre estructuras sintéticas, no sobre adaptaciones generadas ni validación pedagógica. Sin E2E, servicios de pago, migración remota o despliegue. Rama con despliegue de Vercel desactivado.
