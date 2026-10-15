# Corpus de mejora · registro de ejemplo

Ejemplo mínimo del registro de materiales admisibles para la evaluación interna (finalidad B). Diseño y reglas:
[docs/legal/FINALIDADES_Y_CORPUS.md](../../docs/legal/FINALIDADES_Y_CORPUS.md).

| Archivo | Qué es |
| --- | --- |
| `registry.json` | Cuatro fichas **sintéticas** escritas por el equipo (`development`, `evaluation` y `holdout`) y una contribución hipotética sin fichero que la política vigente rechaza |
| `samples/*.md` | Texto de las fichas sintéticas. Su SHA-256 está en el registro y en `.gitattributes`, que impide normalizar los finales de línea |
| `registry.ts` | Carga y valida el registro con `CorpusEntrySchema` |

Reglas:

- **Qué entra.** Solo fichas propias creadas para evaluar. No se copia nada desde producción, ni hay trabajos de alumnos,
  documentos privados o materiales de editoriales.
- **Admisión.** Es manual, y la decide `evaluateAdmission()` (`src/lib/corpus/admission.ts`). Con
  `CURRENT_CONTRIBUTION_POLICY` ninguna contribución de usuario es admisible.
- **Particiones.** No comparten bytes ni familia (`splitProblems()`).
- **Qué se registra.** Errores reproducidos y resultados esperados, solo como códigos y estados; la validación se guarda con el
  rol, nunca con el nombre de quien valida.

Pruebas: `pnpm exec vitest run tests/unit/improvement-corpus.test.ts`.
