# Max: decisión docente y apoyos funcionales

Base `origin/main` `33be83c` (#67–#71 integradas). Rama `codex/max-apoyos-opt-in`. Sin migraciones ni cambios remotos, sin generación pagada y sin modificar precios, modelos, prompts o CLARO.

## Comportamiento

- En el material analizado, junto a «Hacer magia», aparece **Crear con apoyos visuales** únicamente para un rol de escritura con Max efectivo, función habilitada, backend/workspace del piloto y proveedores configurados. Desmarcada por defecto. Usa `workspace_usage` con la sesión del miembro: esta RPC exige identidad incluso al rol de servicio.
- Muestra imágenes restantes y el menor entre cupo restante y límite efectivo por adaptación (con el techo defensivo existente). El cupo agotado deja el control desactivado. No reserva imágenes por marcarlo; la reserva atómica existente ocurre antes de generar cada ilustración.
- La acción valida el booleano y el servicio vuelve a comprobar disponibilidad y cupo. Rechazos específicos de imágenes, sin confundirlos con el cupo de adaptaciones. «Revisar antes de crear» mantiene el flujo habitual y no activa este añadido.
- La elección `visual_supports.requested=true` queda en `context_snapshot` y su fingerprint. Ausente = sin consentimiento, incluidos trabajos históricos. `illustrationAvailability` consulta ese contexto persistido y el workspace antes de construir dependencias de generación: cubre también la vía de preparación visual fuera de «Hacer magia». El consentimiento no evita las comprobaciones de plan, flag, cuota, presupuesto, idempotencia, revisión, SHA y Storage privado.
- La pantalla de adaptación confirma la elección, sin afirmar que se haya generado ninguna imagen. El panel docente existente sigue mostrando procedencia, finalidad y aviso de revisión de los recursos realmente aprobados. Las imágenes de adaptaciones ya entregadas no se borran por carecer de la nueva elección.

## Qué apoyo se intenta

| Recurso | Criterio conservador | Consumo |
| --- | --- | --- |
| Ejemplo análogo + barra exacta | Opt-in, apoyo de representación/sentido numérico/ejemplos, operación literal única de suma/resta de fracciones propias con mismo denominador. Hasta un ejemplo, con otros operandos y resultado no equivalente al evaluado. Se excluyen respuestas conocidas del resto de la ficha, también equivalencias de fracciones | Sin API ni cuota de imagen |
| Escena contextual | Opt-in y barrera funcional pertinente, problema verbal sin figura ya asociada ni otro recurso resuelto. Hasta una escena adicional, sin cantidades/operaciones/resultados, mediante brief y revisión existentes | Cada ilustración aprobada consume una imagen |
| Representaciones y ejecución existentes | SVG/VisualSpec y pasos existentes conservan su política actual, también sin opt-in. No se dibuja una respuesta a una tarea de representación | Sin cuota de imagen |
| Incompatible o sin ayuda verificable | Se omite el nuevo apoyo opcional. Una figura imprescindible no resuelta sigue bloqueando la entrega | No se fuerza una imagen para consumir cupo |

La selección de escena es una heurística acotada, no una garantía semántica. No se promete una imagen por ficha ni una mejora del aprendizaje demostrada. Un perfil de apoyo alto no cambia el nivel curricular. El helper de ejemplo no interpreta problemas narrativos ni operaciones con distintos denominadores; esos casos mantienen sus apoyos previos. No se incorpora un generador nuevo de organizadores ni un renderer alternativo.

Las imágenes rechazadas devuelven cuota conforme al servicio existente, pero sus llamadas pueden costar dinero. Los límites de tres por adaptación y presupuesto defensivo previo no cambian.

## Evidencias y reproducción local

- `tests/unit/visual-supports-opt-in.test.ts`: elección/fingerprint, matemática, conservación e idempotencia, comparación/ambigüedad rechazadas, respuesta equivalente de otra actividad, escena opcional rechazada y aprobada.
- `tests/unit/illustration-consent-gate.test.ts`: legado, booleanos falsos o malformados, workspace ajeno y flag.
- `tests/unit/visual-support-offer.test.ts`: Free/Pro, Max efectivo, agotamiento, aislamiento y proveedor ausente.
- `tests/db/visual-supports-consent.test.ts`: migraciones reales en PGlite, rechazo de creación, rol/workspace, contexto persistido y solicitud repetida.
- `tests/pdf/visual-supports-opt-in.test.ts`: el helper de producto construye el apoyo que imprime CLARO. PDFs antes/después y en grises; ejercicio intacto, sin respuesta evaluada. Las otras 75 regresiones PDF existentes comprueban también figuras, fases B/C, maquetación y los pares sintéticos de escenas.
- `tests/e2e/max-visuals.spec.ts`: función oculta en entorno desactivado, recursos aprobados sintéticos, permisos y PDF.
- `tests/e2e/visual-supports-configured.spec.ts`: control real en escritorio/móvil, teclado y persistencia. Exige `E2E_VISUAL_SUPPORT_STATE` (storageState ficticio), `E2E_VISUAL_SUPPORT_CONFIG` (JSON local con workspace/material), `E2E_BASE_URL` loopback y servidor separado configurado con el workspace Max y credenciales **ficticias**. Intercepta `/run` antes de llegar a proveedores. No reutilizar sesiones reales ni activar este ensayo en producción.

Los PDFs de esta entrega se generan desde el código nuevo; las escenas de las regresiones existentes son dibujos manuales. Ninguno constituye una imagen generada por una API ni una validación docente.

| Comprobación local | Resultado |
| --- | --- |
| Unidad y BD, suite completa | 1.991 correctas, 13 omitidas |
| Regresión focalizada de inserción visual e integración | 32/32 |
| PDF real, suite completa | 76/76; también 76/76 al ejecutar `smoke:pdf` |
| Control Max configurado, escritorio/móvil | 2/2; teclado y consentimiento persistido, `/run` interceptado |
| Typecheck / lint / build | Correctos; lint con un aviso previo `_id` sin usar en `analysis-run-auth.test.ts` |
| Raster / descarga de PDF desde traza aislada | Correctos localmente; Vercel pendiente |
| Secretos | Sin coincidencias en los artefactos inspeccionados; solo valores ficticios locales cargados |
| E2E completa | 134 correctas, 2 omitidas (Checkout Max requiere configuración específica), escritorio/móvil, 20,3 min; sin reintentos |
| IA generativa pagada / producción | NO EJECUTADO |

Se ejecutan los binarios instalados (`node node_modules/vitest/vitest.mjs run`, `node node_modules/next/dist/bin/next build`, `node node_modules/eslint/bin/eslint.js`, `node node_modules/typescript/bin/tsc --noEmit`) por el fallo del lanzador pnpm del entorno. Para E2E se arrancan manualmente `tests/e2e/fake-supabase.mjs` y `next dev` con `.next-e2e`, proveedores mock y las credenciales públicas ficticias de `playwright.config.ts`; se ejecuta Playwright con `E2E_BASE_URL=http://localhost:3100 E2E_CHROMIUM_PATH=/usr/bin/chromium`. No se debilitan reglas para superar las verificaciones.

Capturas reales: [escritorio](capturas/escritorio.png), [móvil](capturas/movil.png), [PDF con apoyo](capturas/pdf-con-apoyo.png) y [sin apoyo](capturas/pdf-sin-apoyo.png). PDF descargables: [sin apoyo](pdf/fracciones-sin-apoyo.pdf), [con ejemplo y figura](pdf/fracciones-con-apoyo.pdf), [en grises](pdf/fracciones-con-apoyo-grises.pdf). El ejemplo enseña 5/6 − 1/6, resultado 4/6, ante el ejercicio 3/4 − 1/4; la respuesta del ejercicio no aparece en el PDF. El título se ha ajustado a «Resta de fracciones» en el fixture de esta entrega.

## Ensayo manual posterior

1. Integrar y desplegar solo tras la decisión del fundador. No hay migración nueva. Conserva la configuración segura del piloto y el cupo real del entorno.
2. Abrir un material sintético analizado, elegir un perfil con la necesidad funcional correspondiente y comprobar que la opción empieza desmarcada.
3. Con la opción apagada, no puede iniciar ilustraciones premium. Las representaciones deterministas habituales siguen disponibles.
4. Para el caso exacto soportado, usar «Calcula: 3/4 - 1/4.» y apoyo en representaciones matemáticas. Comparar ejemplo, figura, actividad y PDF; no hay llamada de imagen por ese ejemplo.
5. Para una escena de problema verbal, autorizar por separado el coste de ambos proveedores antes de pulsar «Hacer magia». El resultado puede ser un rechazo u omisión legítimos. No repetir automáticamente ni forzar aprobación.
6. Revisar finalidad, claridad en grises, ausencia de respuestas y asociación al ejercicio antes de imprimir. No marcar automáticamente como validado por un docente.

Pendiente: validar ilustraciones reales y su utilidad con revisión docente autorizada. No se ha ejecutado la prueba manual ni se afirma el estado de configuración o las cuotas de producción.
