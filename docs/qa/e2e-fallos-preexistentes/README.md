# Fallos E2E anteriores a la integración del agente V2.2

Detectados al pasar la suite E2E completa para la [PR #79](https://github.com/TinyChat-up/ADAPTAULA/pull/79) (2026-11-04). **No los introduce esa PR.** Los dos fallan igual sobre `main` `11ab50e`: lo comprobé haciendo checkout de `main` y ejecutando cada prueba sola en escritorio. Se corrigen en una entrega aparte.

Entorno: Chromium 1243, `LANG=C.UTF-8`, `pnpm test:e2e` contra `tests/e2e/fake-supabase.mjs` (migraciones reales sobre PGlite).

| Prueba | Proyectos | Síntoma | Origen probable |
|---|---|---|---|
| `tests/e2e/materials.spec.ts:110` · «cada análisis nuevo consume una unidad de la cuota mensual…» | Escritorio y móvil | Tras «Volver a analizar», `analysisUnits` se queda en 1 y no llega a 2 (línea 130, 15 s de espera) | Reanálisis con copia del análisis fijado (#77, `0c58edd`, `b8d891f`). La prueba espera que el reanálisis explícito gaste una unidad |
| `tests/e2e/materials.spec.ts:179` · «listado, filtros y borrado (con el archivo)» | Escritorio y móvil | No aparece el botón «Restaurar en la biblioteca» (línea 212; 60 s) | Retirada y restauración de materiales de #77; la prueba o la pantalla no están al día |

Efecto añadido: `materials.spec.ts` se ejecuta en serie (`mode: "serial"`), así que un fallo deja sin ejecutar las pruebas siguientes del archivo. Para cubrirlas sin ellos:

```bash
pnpm exec playwright test tests/e2e/materials.spec.ts --grep-invert "cada análisis nuevo consume|listado, filtros y borrado"
```

En esa ocasión, 28/28 correctas.

Siguiente acción: decidir el comportamiento esperado de la cuota en un reanálisis explícito, revisar el flujo de retirada y restauración (#77) y actualizar la prueba o el código. Validar con la E2E de materiales en escritorio y móvil.
