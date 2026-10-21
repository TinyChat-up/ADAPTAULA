# Fichas originales para comprobar CLARO

Ocho documentos escritos a mano, con referencias explícitas, sin modelos ni datos personales. No son resultados de Hacer magia ni una validación docente. [Informe completo y PDFs](../../docs/qa/claro-calidad/README.md).

- `corpus.ts`: curso, objetivo, consignas, datos, figuras, rótulos, espacios y respuestas que deben quedar fuera del papel. Las respuestas del archivo son referencias de evaluación, nunca contenido del alumno.
- Desarrollo: 01, 03, 05, 06. Reserva: 02, 04, 07, 08. Congelados en `017fe9e`; reglas fijadas en `b203e69` antes de evaluar la reserva. No ampliar reglas con la reserva sin declararla de desarrollo y preparar una nueva.
- `check.ts`: comparación exacta con el oráculo manual, acotada a datos verificables. No analiza píxeles ni aprueba calidad pedagógica. No tiene conexión con la entrega o aceptación de imágenes del producto.
- `plant.ts`: dibujo sintético propio, rasterizado y fijado por SHA para el test PDF. Sus números no son evidencia legible por el evaluador; figura sujeta a revisión humana.

Ejecutar `vitest run tests/unit/claro-reference.test.ts` y `vitest run --config vitest.pdf.config.mts tests/pdf/claro-quality.test.ts`. Para incluir reserva, anteponer `CLARO_INCLUDE_RESERVE=1`; los informes/PDF quedan en `.pdf-smoke/quality-after-*`. Chromium completo local para medir rótulos; Chromium del motor CLARO para imprimir. Nunca hace llamadas IA ni consultas remotas.
