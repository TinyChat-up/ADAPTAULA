# Prototipo · verificación de propuestas de ubicación de figuras (Fase 8.2B.7)

Prototipo aislado; ningún módulo de `src/` lo importa. No llama a modelos ni a OCR real. Propuesta completa:
[docs/proposals/LOCALIZACION_FIGURAS_ESCANEOS.md](../../docs/proposals/LOCALIZACION_FIGURAS_ESCANEOS.md).

| Archivo | Qué es |
| --- | --- |
| `contract.ts` | Contrato tipado de una propuesta (`FigureProposalSchema`) y del informe de verificación (11 comprobaciones; sin puntuación) |
| `verify.ts` | Verificador determinista; reutiliza `activityAnchors`, `activityZones`, `candidates` y las firmas de `shapes.ts` |
| `fixtures.ts` | 11 hojas sintéticas con verdad conocida, rasterizadas como un escaneo; capa de texto = OCR perfecto (o con pérdidas, `ocrLoss`) |
| `harness.ts` | Propuestas guionizadas (correcta, desplazada, distractor, página, cruzada) y métricas de falsos positivos, negativos y cobertura |

```bash
pnpm exec vitest run tests/unit/visual-location-prototype.test.ts
```

Las cifras miden el **contrato** sobre fixtures con los que se ajustó: no estiman precisión real.
