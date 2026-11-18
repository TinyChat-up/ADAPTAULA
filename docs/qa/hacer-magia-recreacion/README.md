# «Hacer magia» con el motor de recreación (ADR-053)

El motor de recreación (PR #99, #100, #101) pasa a ser el funcionamiento de «Hacer magia», detrás de un indicador y **apagado por defecto**. Sin migraciones remotas, despliegues ni llamadas de pago.

## Qué cambia y qué no

- **Misma adaptación**: estados, trabajos duraderos, cuota (una unidad, consumida una vez al entregar), versiones, `ai_runs`, PDF y permisos son los existentes. Las adaptaciones históricas no se tocan: llevan su motor fijado (sin `engine` = el de siempre).
- **Dentro de las etapas** (`src/lib/adaptation/recreation/stages.ts`):
  - planificación: Claude diseña la ficha nueva, el servidor la verifica (una reparación) y el plan con soluciones se guarda **solo en servidor** (`recreation_plans`);
  - generación: imágenes (original · código · OpenAI por las puertas del producto), ficha, materiales, versión sin respuestas, entrega.
- **Pantalla**: al terminar, `/app/adaptaciones/[id]` muestra la ficha, los materiales y «Qué hemos adaptado / Por qué así / Cómo utilizarlo». Abrir, recargar, imprimir o descargar **no llama a ninguna IA** (lee lo guardado con el RLS del usuario).
- **Tarjeta de creación**: con el indicador encendido para el workspace desaparecen el tipo de adaptación y «Revisar antes de crear»: un solo camino. El alcance lo fija el servidor (metodológico: conserva aprendizajes, nivel y exigencia).
- **Sin respuestas visibles**: la versión guardada lleva `answer_key` vacío (un disparador lo exige); las respuestas están en `recreation_internals` (RLS sin políticas ni permisos).

## Indicador

`HACER_MAGIA_ENGINE` = `off` (defecto) | `pilot` (solo `HACER_MAGIA_RECREATION_WORKSPACES`, ids separados por comas) | `on` (todos). Decide el motor al **crear** cada adaptación automática.

## Pasos exactos para probarlo (requieren tu autorización)

1. Revisar y aplicar la migración `20261001003700_recreation_engine.sql` al proyecto Supabase (solo local hasta ahora).
2. Variables en el entorno elegido (Preview recomendado): `HACER_MAGIA_ENGINE=pilot` y `HACER_MAGIA_RECREATION_WORKSPACES=<tu workspace>`.
3. Para las ilustraciones (si no, la ficha sale sin imágenes generadas): `FLAG_AI_IMAGES_ENABLED=true`, el piloto de imágenes de tu workspace (`AI_IMAGES_PILOT_*`), plan Max con `image_generation` y `monthly_images` suficiente (hasta 8 por adaptación), y `AI_MODEL_IMAGE_QUALITY` configurado.
4. Claves de Anthropic y OpenAI ya presentes; modelos por alias (`AI_MODEL_STANDARD`).
5. Subir una ficha, elegir perfil y pulsar «Hacer magia». Coste esperado por adaptación: plan ≤ 0,6 $ (tope) + ilustraciones ≤ 1,2 $ (tope); estimado real 0,6–0,9 $.

## Límites y decisiones

- **No se ha ejecutado ninguna prueba en esta entrega** (a petición): ni unidad, ni E2E. Sí se pasó el typecheck. Hay una prueba de integración escrita (`tests/db/magic-recreation.test.ts`, 14 casos: recorrido completo, cuota, aislamiento por rol y workspace, sin llamadas al abrir) que pasó una vez antes de añadir la pantalla; **hay que volver a ejecutarla** junto con `pnpm check` y la E2E antes de activar.
- «Revisar antes de crear» sigue siendo el recorrido de siempre cuando el indicador está apagado.
- Regenerar = pulsar «Hacer magia» otra vez (nueva adaptación y unidad). No hay edición, comparación ni regeneración en el sitio de una ficha recreada.
- Una ficha con una imagen necesaria ausente se entrega con aviso y consume la unidad (su texto aún dice «puedes regenerarla»: ajustar).
- No se reutilizan recortes del original (opción A): solo código (B) y OpenAI (C).
- La planificación (Claude) y la generación (imágenes, 3 tarjetas a la vez) son dos peticiones de ≤ 300 s; si una se corta, se retoma y reutiliza las imágenes ya aprobadas.
- Con proveedor `mock` el motor se niega (no hay simulación en desarrollo).
