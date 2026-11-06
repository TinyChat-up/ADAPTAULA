# Materiales del piloto: bancos y particiones

Los bancos viven en la memoria compartida del proyecto (Google Drive). Aquí solo se recogen recuentos y reglas, nunca su contenido. **Ningún material entra en el repositorio**: los PDF se suben a staging desde la interfaz, y el control de privacidad bloquea `materiales/` y `MAT-###` en Git.

| Banco | Qué contiene (consultado el 2026-11-06) |
|---|---|
| **Banco general** (`Adaptaula_banco_general.xlsx`, carpeta «Banco de originales verificados 2026-10-28») | 60 materiales con original verificado y SHA-256. Derechos: 42 A, 17 B y 1 C. Partición propuesta: 52 de desarrollo y 8 de «reserva evaluación no ciega». Incluye MAT-007 y MAT-024 (desarrollo, derechos A). |
| **Banco de materiales y pilotos** (ESO y Primaria 3.º–6.º, v1.0, 27-10-2026) | 26 recursos de INTEF y CeDeC localizados, **sin original descargado**, 12 pilotos y 9 casos A/B/C. Pilotos recomendados: M006 (Lengua 2.º ESO), M027 (Matemáticas 3.º ESO) y M019 (Ciencias 6.º Primaria), que forman los casos T01–T09. |

## Particiones

| Partición | Para qué | Qué materiales | Regla |
|---|---|---|---|
| **Desarrollo** | Iterar: ver fallos, ajustar prompts o reglas | Desarrollo del banco general | Se puede mirar todo. Un cambio motivado por un caso se registra con su ID. |
| **Regresión** | Detectar empeoramientos tras cada cambio | Conjunto **fijo**: MAT-007 y MAT-024 con perfiles A/B/C, más las tres fichas sintéticas del repositorio (`v22-regression-abc`) | No se modifica para «aprobar». Se repite entero tras cada cambio de planificador, reglas o generador, y se comparan los resultados con los anteriores. |
| **Evaluación independiente** | Medir la calidad real, una sola vez por versión | Materiales del banco de pilotos aún **no inspeccionados**, cuando se descarguen y se verifiquen sus derechos | No se abren ni se usan para ajustar nada hasta la evaluación final. Los 8 de «reserva no ciega» ya se han visto: sirven como reserva, **no** como evaluación independiente. |

Además:
- **Familias.** Dos materiales de la misma familia o dependencia (columna «Familia y dependencia» del banco general) van siempre a la misma partición.
- **Derechos.** Solo se suben a staging materiales con derechos **A**. Los B (pendientes de permiso) y los C quedan fuera hasta aclararlo.
- **Alumnado.** Los perfiles son los ficticios A/B/C. Ningún dato real de alumnado entra en staging.
- **Limpieza.** Al cerrar la campaña se borran de staging los materiales subidos (README § 7).
