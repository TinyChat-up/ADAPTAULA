# Adaptaula 2.0 · Etapa 3B: perfiles y Plan y cuenta

2026-10-17. Base `9f064ef` (PR #42 integrada, y #41 confirmada). Rama `codex/adaptaula-2-perfiles-cuenta`. Sin merge automático.

## Entrega

- Directorio con búsqueda por alias y filtro de curso sobre perfiles autorizados. No envía búsquedas a servicios externos ni las añade a la URL. Capacidad usada/disponible del plan real.
- Creación y edición con puntos de partida existentes; áreas e intensidades progresivas, resumen determinista y ajustes avanzados. Reutiliza creación, actualización, duplicación y borrado, sin nuevos campos del alumnado. Duplicación desactivada con explicación al alcanzar el límite; servidor sigue imponiendo la cuota.
- Lector: consulta de apoyos e historial sin formulario, duplicación ni eliminación. Un perfil ajeno o identificador inválido se resuelve como 404 antes de cargar sus adaptaciones.
- Cuenta: nombre editable (1–120 caracteres), correo y espacio; uso y disponibilidad de adaptaciones, análisis y perfiles, periodo real. Guardado confirmado y saludo actualizado. Contraseña y salida mediante Auth existente. Ninguna acción ficticia de facturación, exportación o borrado.

## Capturas

Chromium real, escritorio 1280 × 900 y móvil 390 × 844. Cuentas, perfiles y consumos de prueba sintéticos en PGlite local. La barra inferior móvil es fija: en una captura de página completa queda dibujada a la altura del primer viewport; el resto del contenido se recorre desplazando la pantalla.

| Pantalla | Escritorio | Móvil |
| --- | --- | --- |
| Directorio de perfiles | [Captura](perfiles-desktop.png) | [Captura](perfiles-mobile.png) |
| Edición progresiva | [Captura](perfil-desktop.png) | [Captura](perfil-mobile.png) |
| Plan y cuenta | [Captura](cuenta-desktop.png) | [Captura](cuenta-mobile.png) |

## Comprobaciones

Resultados finales: **82/82** pruebas focalizadas en seis archivos (incluye PGlite), **26 escenarios E2E distintos aprobados** en escritorio/móvil: 16 de perfiles existentes y 10 del directorio/cuenta, workspace vigente y editor/PDF. Las repeticiones tras correcciones no se suman. Typecheck, lint y build PASS; lint conserva un aviso previo `_id` en `tests/unit/analysis-run-auth.test.ts`. Escaneo de secretos del build PASS. No suite completa.

El workspace comprueba creación de un perfil desde el material y vuelta con selección conservada, SHA del original y parada honesta del proveedor simulado ante un visual no corroborado. El editor utiliza una versión sintética determinista y descarga un PDF real de la revisión guardada. Esto no valida la adaptación de materiales reales mediante IA.

Comandos:

```sh
node_modules/.bin/vitest run tests/unit/account-name.test.ts tests/unit/profiles.test.ts tests/unit/auth.test.ts tests/unit/boundaries.test.ts tests/unit/entitlements.test.ts tests/db/schema.test.ts
node_modules/.bin/playwright test --config /workspace/adaptaula-setup/stage3b.playwright.config.mts profiles-account-stage3.spec.ts profiles.spec.ts
node_modules/.bin/playwright test --config /workspace/adaptaula-setup/stage3b.playwright.config.mts profiles-account-stage3.spec.ts document-workspace.spec.ts sheet-editor.spec.ts --grep 'perfiles:|cuenta:|workspace:|editar, deshacer'
node_modules/.bin/next typegen
node_modules/.bin/tsc --noEmit
node_modules/.bin/eslint
node_modules/.bin/next build
```

Configuración aislada fuera de Git: Next 3131, Supabase simulado/PGlite 54431 con migraciones reales, Chromium del sistema, STANDARD/PREMIUM `mock:default`, imágenes desactivadas. Se reutiliza el arnés del repositorio, sin servicios remotos.

La verificación comprueba límites y aislamiento con RLS real de las migraciones en PGlite; cuenta con reservas sintéticas de análisis, sin adaptaciones añadidas, para comprobar que no se confunden contadores. La acción de nombre ignora IDs/columnas inyectados, exige sesión, valida en servidor y no anuncia éxito si no retorna una fila. Incluye estados vacíos, dos cursos, duplicación, edición y recuperación tras recarga, solo lectura, logout, teclado, axe, movimiento reducido, colores forzados y reflujo a 320 px/texto 200 %.

Defectos reproducidos durante la entrega: identificador de perfil inválido provocaba error de la consulta del historial en vez de 404; selector de áreas desbordaba con texto ampliado; enlace inicial a recuperación de contraseña redirigía al inicio por existir sesión. Se corrigen validando primero el perfil, acotando el grid/texto y utilizando `/reset-password`, protegido por la sesión existente. También se corrigieron carreras de navegación del arnés (esperar URL antes de reutilizarla o navegar tras logout) y una aserción que esperaba el nombre del preset en un resumen que solo incluye dimensiones; no se cambia el resumen para satisfacer la prueba.

Un intento adicional con el recorrido heredado `teacher-workflow.spec.ts` se interrumpió al esperar el antiguo encabezado «Actividades detectadas», que el workspace actual no muestra con esa estructura. No se cuenta como prueba pasada ni se modificó el producto para satisfacerlo. Se utiliza el recorrido vigente de 2A (`document-workspace.spec.ts`) y el del editor/PDF (`sheet-editor.spec.ts`) para comprobar la continuidad actual. La actualización completa de ese spec histórico queda fuera de 3B.

## Límites

- Mismo modelo de perfiles; sin diagnósticos, campos médicos ni texto libre nuevo sobre menores. Sin historial/versionado de cambios de perfil ni autoguardado. La duplicación copia apoyos y pide ajuste docente, no validación automática.
- Búsqueda local sobre perfiles cargados, no paginación nueva. El acceso desde un perfil ofrece los seis materiales analizados recientes existentes; el enlace a biblioteca no mantiene una selección de perfil a través de toda navegación. No se amplía ese contrato.
- La contraseña usa la ruta y validaciones existentes de Supabase Auth. No se prueba entrega de correo ni configuración Auth remota; el nombre de cuenta vive en `profiles`, no sincroniza metadatos de identidad del proveedor.
- No certificación WCAG completa ni validación pedagógica de Hacer magia real. Sin cambios en renderer, editor, comparador, cuotas, precios, políticas RLS, originales ni borradores. Sin migraciones, Stripe, APIs de pago o Supabase remoto.
- Etapa 4 pendiente: precios/límites objetivos en `ADAPTAULA_2.md`; requieren entrega y migración propias. No están activados.
