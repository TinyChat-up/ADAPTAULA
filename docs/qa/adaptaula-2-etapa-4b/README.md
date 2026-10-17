# Adaptaula 2.0 · Etapa 4B

PR de esta entrega: [#45](https://github.com/TinyChat-up/ADAPTAULA/pull/45), abierta y sin merge.

Base: `main` tras fusionar #44 (`c925c33`). Sin cambios en planes, RLS, Supabase remoto, Stripe, CLARO o modelos/prompts. Esta entrega cambia la experiencia pública y el onboarding.

## Demostración pública

`Demo` presenta una tabla completamente sintética de Ciencias. Permite Original, Adaptación, Comparar y Revisión sin sesión. La adaptación de muestra separa opciones, añade un apoyo de lectura y espacio de respuesta; no muestra una respuesta. En escritorio, Comparar coloca ambas hojas juntas; en móvil alterna un documento cada vez. Revisión es un ejemplo visual del inspector: no ofrece edición, guardado ni descarga. La página indica de forma visible que la muestra se preparó a mano para explicar el producto y no es un resultado generado en directo. No consulta documentos privados ni servicios de IA.

La landing sitúa esta muestra bajo el titular y acorta el resto de contenido al recorrido real, privacidad, precios efectivos desde servidor y FAQ. «Cómo funciona» comparte los cinco pasos y la misma demostración. Algunos materiales pueden requerir intervención o bloquearse.

## Acceso y primera experiencia

Los formularios conservan acciones de Supabase Auth y sus respuestas sin enumeración de cuentas. La nueva composición destaca la tarea y mejora espacio y navegación móvil. Nombre visible sigue siendo opcional; email y contraseña bastan para registrarse. El onboarding conserva la escritura de `teaching_stages` y `onboarding_completed`, pero muestra una sola pantalla: etapa, explicación breve de perfil funcional, cuotas obtenidas de `workspace_usage`, opción progresiva para comenzar por perfil/mesa y acción principal que lleva a la primera subida. No se solicita información médica ni nombres de menores.

## Verificación y límites

Resultados y capturas reales de Chromium se registran al completar las pruebas. Las pruebas E2E utilizan el Supabase simulado local, un PDF sintético y el proveedor simulado. El resultado no valida la calidad real de Hacer magia. La recuperación de contraseña se verifica hasta el mensaje genérico de envío; la recepción del correo y el enlace dependen de la configuración de Supabase Auth y no se prueban aquí. Los precios se leen del entorno local que incluye la migración 026; el desplegado remoto podría tener una política distinta hasta aplicar esa migración.

Siguiente paso recomendado: revisión manual de textos, comprobación de Supabase Auth/correos en staging y evaluación pedagógica de adaptaciones reales con material autorizado, por separado.

## Resultados de esta entrega

- Ocho E2E focalizados pasaron en Chromium (cuatro recorridos por escritorio y móvil): muestra/comparación/revisión, navegación pública y precios, registro/Auth/recuperación/onboarding/primera subida sintética, reflow/teclado/contraste/movimiento reducido. La muestra no disparó IA; el análisis de la ficha de prueba utilizó `mock:default`.
- 32 pruebas focalizadas unitarias superadas (`auth`, `pricing-truth`, `entitlements`). Typecheck, lint del área modificada, build y escáner de secretos pasaron. La pasada inicial E2E mostró desbordamiento en la FAQ al 200 % y expectativas antiguas sobre la muestra; se corrigieron y la pasada final fue 8/8. No se ejecutó toda la suite.
- Axe no encontró infracciones WCAG 2 A/AA y 2.2 AA en las pantallas examinadas. Se probó ancho 320 px, texto al 200 %, colores forzados y movimiento reducido. El sistema visual incluye alternativa CSS para `prefers-reduced-transparency`; el navegador de prueba no emuló esa preferencia directamente. Estas pruebas no certifican accesibilidad completa.
- El formulario de recuperación devuelve el mensaje genérico de Supabase Auth; no se probó la recepción de correo. La demostración es una composición web representativa, no el renderer PDF de CLARO ni una adaptación real.

| Pantalla | Escritorio | Móvil |
|---|---|---|
| Landing | [Captura](landing-desktop.png) | [Captura](landing-mobile.png) |
| Comparación | [Captura](comparar-desktop.png) | [Captura](comparar-mobile.png) |
| Revisión de muestra | [Captura](revision-demo-desktop.png) | [Captura](revision-demo-mobile.png) |
| Registro | [Captura](registro-desktop.png) | [Captura](registro-mobile.png) |
| Acceso | [Captura](acceso-desktop.png) | [Captura](acceso-mobile.png) |
| Onboarding | [Captura](onboarding-desktop.png) | [Captura](onboarding-mobile.png) |
