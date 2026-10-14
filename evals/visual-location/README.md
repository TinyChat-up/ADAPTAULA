# Prototipo · verificación de propuestas de ubicación de figuras (Fase 8.2B.7)

Prototipo aislado; ningún módulo de `src/` lo importa. No llama a modelos ni a OCR real. Propuesta completa:
[docs/proposals/LOCALIZACION_FIGURAS_ESCANEOS.md](../../docs/proposals/LOCALIZACION_FIGURAS_ESCANEOS.md).

| Archivo | Qué es |
| --- | --- |
| `contract.ts` | Contrato tipado; 11 cribas de candidato y 3 controles semánticos no verificables |
| `verify.ts` | Prefiltro determinista; `candidate` sirve solo para diagnóstico, `crop` permanece nulo |
| `fixtures.ts` | 11 hojas sintéticas rasterizadas; cajas OCR simuladas desde el vector, perfectamente alineadas salvo pérdidas artificiales |
| `harness.ts` | Propuestas guionizadas; separa métricas de candidato y de aceptación, con denominadores explícitos |

```bash
pnpm exec vitest run tests/unit/visual-location-prototype.test.ts tests/unit/visual-location-adversarial.test.ts
```

Cuatro pruebas adversariales demostraron aceptaciones indebidas del contrato anterior. Ahora los candidatos geométricos no son
recortes aprobados. Las cifras miden fixtures con los que se ajustó el prefiltro: no estiman precisión real ni prueban OCR real.
