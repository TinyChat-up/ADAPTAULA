# Prototipo · verificación de propuestas de ubicación de figuras (Fase 8.2B.7)

Prototipo aislado; ningún módulo de `src/` lo importa. No llama a modelos ni a OCR real. Propuesta completa:
[docs/proposals/LOCALIZACION_FIGURAS_ESCANEOS.md](../../docs/proposals/LOCALIZACION_FIGURAS_ESCANEOS.md).

| Archivo | Qué es |
| --- | --- |
| `contract.ts` | Contrato tipado; 11 cribas de candidato y 3 controles semánticos no verificables |
| `verify.ts` | Prefiltro determinista; `candidate` sirve solo para diagnóstico, `crop` permanece nulo |
| `fixtures.ts` | 11 hojas sintéticas rasterizadas; cajas OCR simuladas desde el vector, perfectamente alineadas salvo pérdidas artificiales |
| `harness.ts` | Propuestas guionizadas; separa métricas de candidato y de aceptación, con denominadores explícitos |
| `geometry.ts` | **Fase II:** enderezado, coordenadas de vuelta al original, papel normalizado y firmas de barra, recta, esfera, polígono y cuadrícula |
| `locate-v2.ts` | **Fase II:** `locateFigure` (`figure_geometry@v2`), un localizador autónomo **sin región de entrada**. Zonas por columna, figura con sus partes y etiquetas, y decisión siempre BLOCKED |
| `geometry-cases.ts` | **Fase II:** fichas geométricas de desarrollo y reserva, por familias, con casos negativos |
| `geometry-eval.ts` | **Fase II:** `pnpm eval:geometry -- --corpus <dir>` o `-- --cases dev\|holdout`. Compara #31 con v2 por figura |

```bash
pnpm exec vitest run tests/unit/visual-location-prototype.test.ts tests/unit/visual-location-adversarial.test.ts tests/unit/figure-geometry-v2.test.ts
```

> **Fase II (2026-10-15).** Sobre las diez fichas sintéticas (desarrollo) hay 1/10 → **9/10** candidatas correctas, con 0
> erróneas. En la reserva geométrica independiente, 0/6 → **2/6**, con 1 candidata en una negativa (respuesta dibujada).
>
> **Ningún recorte se aprueba.** Informe en [docs/qa/geometria-fase2](../../docs/qa/geometria-fase2/README.md).

Cuatro pruebas adversariales demostraron aceptaciones indebidas del contrato anterior. Ahora los candidatos geométricos no son
recortes aprobados. Las cifras miden fixtures con los que se ajustó el prefiltro: no estiman precisión real ni prueban OCR real.

Corrección focalizada `figure_proposal_verifier@proto3`: `instructionLabels()` solo toma enumeraciones explícitas completas
(de al menos dos elementos) y respeta palabras completas; descarta listas ambiguas y sigue buscando otras listas válidas.
No exige «es» por «números están». No cambia firmas, geometría, umbrales ni bloqueos semánticos.
