# QA — Recuperación fiel de figuras originales (fichas 03, 06 y 07)

Fecha: 2026-10-22 · Motor `auto_visuals@v6` · ADR-039 · Sin llamadas de pago, sin generación de imágenes, sin OCR, sin servicios remotos.

## Problema de partida

En la prueba real v3, las figuras de tres fichas no se recuperaban del original y la ficha quedaba bloqueada:
- **03**, polígono en L con medidas y «?», y rectángulo B;
- **06**, planta con letras A–D y líneas indicadoras;
- **07**, ciclo del agua con cuatro cajas y flechas numeradas 1–4.

Hubo dos causas:
1. Una figura genérica no tenía firma determinista. Sin modelo de visión su confianza máxima era 0,60, por debajo del umbral de aceptación (0,75).
2. El motor leía mal estas páginas:
   - las líneas de dos columnas se mezclaban;
   - las medidas, los «?» y el texto de las cajas dejaban el recorte «sucio»;
   - una figura impresa *antes* de su consigna quedaba fuera de la zona de su actividad;
   - el rectángulo B, un contorno vacío, no era candidato.

## Comparación con las fichas reales (local, fuera de Git)

Los originales están en el *scratchpad* de la sesión, verificados por SHA-256, y no se suben al repositorio. El análisis real de la v3 no se conservó, así que la redacción del análisis de cada figura se escribió a mano para la prueba. Por eso esto **no** prueba aún la salida real del analizador.

| Figura | Marcas encontradas en el recorte | Confianza | Recorte (px a 200 ppp) | Ancho físico | Píxeles = original | PDF incrusta sin reescalar | Misma hoja que su consigna |
|---|---|---|---|---|---|---|---|
| 03 A · contorno en L | 4 medidas (8, 3, 7 y 5 cm) y dos «?» | 0,90 | 594 × 476 | 75 mm | sí | sí | sí |
| 03 B · rectángulo | 2 medidas (6 y 7 cm) | 0,90 | 415 × 427 | 53 mm | sí | sí | sí |
| 06 · planta | A, B, C y D, con sus líneas indicadoras | 0,90 | 862 × 795 | 109 mm | sí | sí | sí |
| 07 · ciclo del agua | 1, 2, 3 y 4, con las cuatro cajas y sus flechas | 0,90 | 1468 × 909 | 186 mm | sí | sí | sí |

La figura 07 es más ancha que la columna de CLARO. El renderer la reduce de forma proporcional (≈ 86 %) sin recortarla. La revisión visual de los cuatro recortes y de las fichas adaptadas no muestra ningún vértice, flecha, número ni etiqueta cortados.

## Pruebas automatizadas, con láminas sintéticas propias

- `tests/unit/marked-figures.test.ts` (14 pruebas):
  - marcas derivadas del análisis;
  - los tres casos prioritarios aceptados con todas sus marcas dentro del recorte;
  - casos adversariales que siguen sin aceptarse:
    - figura atribuida a la actividad siguiente;
    - dos figuras gemelas;
    - etiqueta lejos de su línea;
    - etiqueta ausente;
    - solución dentro del dibujo (con una solución debajo, el recorte la excluye);
    - figura diminuta;
    - página equivocada;
    - PDF sin capa de texto;
    - figura sin marcas nombradas.
- `tests/db/marked-figures.test.ts` (7 pruebas sobre las migraciones reales en PGlite):
  - localizador `auto` v6 con identidad y fidelidad verificadas y pedagogía sin verificar;
  - recurso privado nombrado por su SHA;
  - original modificado: no se usa el recurso antiguo, y en la versión nueva falta B (`marks_incomplete`);
  - evidencia manipulada (`legible: false`): no se usa;
  - RLS entre espacios de trabajo;
  - el navegador no puede crear localizadores automáticos;
  - «Hacer magia» resuelve la necesidad como `exact_original_visual` sin llamar al generador de imágenes.
- `tests/pdf/marked-figures.test.ts` (3 pruebas con Chromium). Cada figura:
  - tiene un recorte idéntico byte a byte a la región del original;
  - se incrusta en el PDF con el mismo tamaño en píxeles;
  - queda en la misma hoja que su consigna.

## Casos sin resolver

- **Redacción del análisis.** Sin marcas nombradas (letras, flechas numeradas, medidas), una figura genérica sigue igual de incierta que antes. Validado con la salida real del analizador en [VALIDACION-REAL.md](VALIDACION-REAL.md): las cuatro figuras se recuperan tras ampliar el parser de marcas.
- **Figura delante de una actividad posterior.** Si no es la primera de su columna, no se atribuye a esa actividad, porque el motor no puede saber de cuál es.
- **Figuras gemelas o marcas repetidas** en la misma zona: siguen inciertas.
- **Escaneos y PDF sin capa de texto:** la identidad no es verificable sin OCR, que sigue desactivado.
- **Validez pedagógica:** nunca se declara automáticamente. El docente sigue viendo el aviso.
