# QA — Validación real del analizador y del recuperador de figuras (PR #55)

Fecha: 2026-10-22 · Rama `claude/figuras-originales` · Motor `auto_visuals@v6`.

Se analizaron los originales 03, 06 y 07 (SHA-256 verificado) con el modelo STANDARD configurado: `anthropic:claude-sonnet-5-5`, esfuerzo medio, prompt `material_analyzer@v3`. Después se pasó el análisis **sin tocarlo** por la cadena de producción, ejecutada en local con proveedores simulados y sin llamadas de pago:

`autoTargets` → `expectedMarks` → `prepareVisuals` (migraciones reales en PGlite) → `resolveVisuals` → `resolveMagicVisuals` → documento → CLARO → PDF con Chromium.

Los originales, los análisis completos, los recortes y las fichas impresas se quedan fuera de Git, en el *scratchpad* de la sesión.

## Coste y controles

| Ficha | Llamadas | Tokens (entrada / salida / caché leída / caché escrita) | Coste registrado |
|---|---|---|---|
| 03 | 1 | 2198 / 2435 / 0 / 5948 | 0,0436 USD |
| 06 | 1 | 2160 / 1695 / 5948 / 0 | 0,0225 USD |
| 07 | 1 | 2207 / 2128 / 5948 / 0 | 0,0269 USD |
| **Total** | **3** | | **0,0930 USD** (de 0,50 autorizados) |

El coste es una estimación con los tokens reales y la tabla de precios del producto (`src/lib/ai/costs.ts`); no es la factura del proveedor.

Controles aplicados:
- **Reintentos:** 0 reintentos del SDK (`maxRetries: 0`), 0 reparaciones y 0 regeneraciones (`singleCall`).
- **Tope de salida:** 10 000 tokens por llamada.
- **Techo de coste:** 0,15 USD por llamada, comprobado antes de cada una (techo total de 0,45 USD).
- **Sin** PREMIUM, ilustraciones, adaptación completa, revisión pedagógica de pago ni OCR externo.
- **Sin cambios** en Supabase remoto ni en producción.

## Resultado por comprobación

| # | Comprobación | 03 A · L con medidas | 03 B · rectángulo | 06 · planta A–D | 07 · ciclo 1–4 |
|---|---|---|---|---|---|
| 1 | Identifica la figura | sí | sí | sí | sí (separa los iconos como decorativos) |
| 2 | Página exacta | 1 | 1 | 1 | 1 |
| 3 | Recurso necesario (`required`) | sí | sí | sí | sí |
| 4 | Actividades vinculadas | 1, 2, 5 | 3, 4, 5 | 1, 2, 3 (no la 4, que no usa el dibujo) | 1, 2, 3 |
| 5 | Describe las marcas | las medidas y los dos «?», con su lado | sus dos medidas | «letras D (flor), C (hoja), B (tallo) y A (raíz)»; campos «A:, B:, C:, D:» | «flechas numeradas en circuito: 1 …, 2 …, 3 …, 4 …»; campos «Flecha 1, Flecha 2, …» |
| 6 | `expectedMarks()` sin intervención | sí (medidas) | sí (medidas) | **no** con el código de la PR → sí tras la corrección | **no** con el código de la PR → sí tras la corrección |
| 7 | `auto_visuals@v6` localiza la figura | sí, 0,90 | sí, 0,90 | D `low_confidence` (0,60) → sí, 0,90 | D `low_confidence` (0,60) → sí, 0,90 |
| 8 | El recorte es la figura correcta | sí | sí | sí | sí |
| 9 | Conserva marcas, líneas y flechas | 8, 3, 7 y 5 cm y «?» ×2 | 6 y 7 cm | A, B, C y D con sus líneas | 1–4, flechas y texto de las cajas |
| 10 | Se imprime legible junto a su consigna | a 75 mm, en la hoja de la actividad 1 | a 53 mm, en la hoja de la actividad 3 | a 109 mm, en la hoja de la actividad 1 | reducida a 161 mm (86 %), en la hoja de la actividad 1 |

Las cuatro figuras pasan por `«Hacer magia»` como `exact_original_visual` (`located`) y el generador de imágenes no se llama. La marca más pequeña mide, una vez impresa:
- 3,6 mm en 03;
- 4,2 mm en 06;
- 3,2 mm en 07.

Todas superan el mínimo de 1,8 mm.

## Dónde se perdía la información (06 y 07)

La información estaba en el análisis real. Se perdía en la **etapa 6**, `expectedMarks()`, que solo reconocía:
- letras como «A, B, C y D» o «A–D»;
- números como «1–4» o «del 1 al 4»;
- campos uno por línea («A:», «Flecha 1:»).

El analizador real escribe las marcas de tres formas que el parser no recogía:
- las letras enumeradas **con su parte entre paréntesis**;
- los números **al inicio de cada paso** de una enumeración;
- los **campos en línea separados por comas**, con o sin «:».

Clasificación del fallo: **D (parser)**. No es fallo del modelo, del prompt ni del esquema.

**Corrección**, en esta misma PR y sin tocar umbrales, localizador ni renderer. `marks.ts` reconoce esas tres formas con reglas acotadas:
- las letras con paréntesis solo cuentan justo después de «letra(s)»;
- los números iniciales, solo como serie 1, 2, …, n con n ≥ 2, y nunca si van seguidos de una unidad;
- los campos en línea, solo si **todo** el contexto son campos.

Nuevas pruebas negativas (`tests/unit/marked-figures.test.ts`):
- una mayúscula suelta («vitamina C (ácido)»);
- medidas tras «flechas»;
- una serie que no empieza en 1;
- campos con texto.

La salvaguarda real no cambia: cada marca esperada tiene que estar impresa **una sola vez** en ese dibujo.

**Limitación honesta.** La corrección se escribió **después** de ver estas dos salidas, así que la segunda pasada de 06 y 07 es *en muestra*. Hace falta otro análisis real (otras fichas o una repetición) para tener evidencia independiente.

## Cuatro verificaciones, por separado

- **Identidad del original:** verificada. Hay SHA-256 del original, misma caja de página y localizador ligado a ese SHA.
- **Fidelidad de los píxeles:** verificada. Cada recurso guardado coincide con su SHA-256 y es igual, byte a byte en RGBA, a la región de la página renderizada con la receta (`visual_crop@v1`, 200 ppp).
- **Legibilidad de impresión:** verificada técnicamente para la marca más pequeña. Ninguna figura se corta ni se reescala por debajo de lo legible (07 se reduce al 86 % para caber en la columna).
- **Validez pedagógica:** **no demostrada**. Ni el hash ni la confianza la prueban: el aviso al docente sigue activo.

## Problemas detectados fuera del alcance de la PR #55 (Fase B)

Aparecen en la ficha que construye el producto a partir del análisis, sin generación:
- **Ficha 07, actividad 1:** pide nombrar 4 procesos y recibe **una sola línea**. `answer_area: line` con `lines: 4` se convierte en 1 línea (`document.ts`, `case "line"`). Además, «Flecha 1, Flecha 2, …» se imprime como texto en vez de como campos etiquetados.
- **Ficha 06, actividad 1:** «A:, B:, C:, D:» se imprime como texto seguido de un recuadro vacío, en lugar de cuatro campos asociados a las letras de la figura (`activityStructure` no reconoce campos en línea).
- **Ficha 03, actividades 2 a 5:** cálculos de perímetro y área, y una comparación, con **dos o tres líneas** y sin cuadrícula. «Muestra cómo has dividido la figura» no tiene espacio para dibujar ni para calcular.
- **Paginación:**
  - en 03 y 06, con el perfil de prueba (límite de tareas visibles), una ficha de una hoja ocupa 3 y 4 hojas con mucho blanco;
  - en 06 la primera hoja solo lleva la cabecera, porque la figura y su actividad van juntas en la siguiente;
  - una actividad que compara A y B (actividad 5 de la 03) no tiene las figuras a la vista.

## Recomendación sobre la PR #55

**Fusionar**, con la corrección del parser incluida:
- el análisis real nombra las marcas en los tres documentos;
- con la corrección, el localizador recupera las cuatro figuras con píxeles idénticos, legibles y junto a su consigna;
- los casos adversariales siguen sin aceptarse;
- no cambia ningún umbral.

Hay que tener en cuenta que la segunda pasada de 06 y 07 es en muestra. Conviene confirmar con una nueva prueba real limitada, sobre otras fichas, en la fase siguiente.
