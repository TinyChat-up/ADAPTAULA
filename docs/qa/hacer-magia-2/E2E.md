# E2E de escritorio y móvil: fallos previos, causas y corrección (2026-10-22)

Continuación de [«Hacer magia» 2.0](README.md). La [PR #53](https://github.com/TinyChat-up/ADAPTAULA/pull/53) ya estaba integrada en `main` (`c1c1a96`) al empezar este bloque, así que no admite más commits. La rama `claude/hacer-magia-2` se avanzó desde `main` y estos ajustes van en ella. Integrarlos requiere una PR nueva.

**Sin llamadas de pago ni servicios remotos.** Las E2E corren contra `tests/e2e/fake-supabase.mjs`, que usa PGlite con las migraciones reales y el proveedor simulado.

## Entorno

- **Navegador.** Chromium 141.0.7390.37 (`/opt/pw-browsers/chromium`) con Playwright 1.63. Playwright 1.63 espera Chromium 153 y la configuración local usa `channel: "chrome"`, que aquí no está instalado.
- **Locale.** El contenedor no tiene locale UTF-8: `LANG` está vacío, en locale C.
- **Ruta del navegador.** `playwright.config.ts` admite ahora `E2E_CHROMIUM_PATH` para usar un Chromium ya instalado.

## Reproducción y línea base

- **Pasada A: `main` (`c1c1a96`) con sus specs y su configuración.** Se reproducen los 4 fallos iniciales: `magic-flow` y `render`, en escritorio y móvil.
- **Línea base de `main` sobre los 9 specs que fallaban en la rama.** Fallan también en `main`: `adaptation`, `magic-flow`, `materials` (listado), `pdf-preview` (once hojas), `pricing`, `profiles`, `teacher-workflow` y `visual-locator`. Todos son previos a este bloque.
- **`magic-flow` sobre `5476df9`, anterior a la PR #53, con el test corregido.** Se detiene igual (`vis_1:table_uncorroborated`), así que tampoco lo introdujo la PR #53.
- **Código implicado.** `git diff 5476df9 c1c1a96` está vacío en la descarga PDF, la ruta PDF, el nombre de fichero, los specs implicados y la configuración de Playwright. Tampoco toca las etiquetas de las etapas.

## Causas y corrección

| Fallo | Causa exacta | ¿Test o producto? | Corrección |
| --- | --- | --- | --- |
| `render`: nombre de descarga «download» | Con el locale C, Chromium no puede escribir en disco un nombre con tildes («Geografía…pdf») y propone «download». Se reproduce sin Playwright, con un Chromium lanzado a mano por CDP. Los nombres ASCII sí se conservan, y con `LANG=C.UTF-8` se conserva el nombre UTF-8 del servidor. El endpoint envía `attachment; filename="…"; filename*=UTF-8''…` y la interfaz muestra el mismo nombre. | Entorno de prueba | Playwright lanza el navegador con `LANG=C.UTF-8` si el entorno no tiene locale UTF-8. El nombre del fichero se sigue comprobando. Un helper común verifica que coinciden la cabecera `Content-Disposition` del endpoint, el texto «Descarga iniciada: …» y el nombre que propone Chromium, y que el PDF descargado se abre con páginas. |
| `magic-flow`: etapas | El test espera «Revisando el resultado»/«Lista». La interfaz dice «Comprobando el resultado»/«Ficha lista» desde `bd83d80` (2026-10-10). | Test | Se comprueban en orden las etiquetas de cada fase de la lista, sin copiar todo el texto. |
| `magic-flow`: la ficha no se entrega | El análisis simulado liga su actividad de opción única a la «Tabla de equivalencias». Una elección apoyada en una tabla solo se entrega con una actividad equivalente hecha por un modelo (ADR-023), y en las E2E no hay modelo: la parada `table_uncorroborated` / `table_source_unverifiable` es correcta. | Datos del test | El test desliga esa elección de la tabla en el análisis guardado, en los dos lados de la relación. Un test unitario comprueba que el análisis resultante sigue siendo válido. La política visual no se toca. |
| `magic-flow`: «la revisión bloquea» | Espera «La ficha necesita una revisión antes de estar lista», justo lo que `docs/UX.md` prohíbe en Hacer magia. | Test | Se comprueban la parada «No hemos podido completar automáticamente esta ficha», su motivo y «Revisar y editar». |
| `magic-flow`: texto técnico | La regla `\d+ ?%` coincidía con el zoom «100 %» del visor del original. | Test | Se excluye solo esa lectura del zoom. |
| `pricing` | Esperaba los límites anteriores a la política 4A (5 y 75 adaptaciones) y una nota de lanzamiento antigua. | Test | Los límites esperados se leen de la tabla `plans`, y la nota es la vigente. |
| `profiles` | El login se titula «Bienvenido de nuevo» desde `014afd5`. | Test | Título vigente. |
| `adaptation`, `teacher-workflow` | La cabecera editorial (`6bfd4e6`) usa como h1 el título del material, con «Adaptación · Perfil M.R.» encima. Los detalles del análisis están en un desplegable cerrado. | Test | Cabecera vigente y posición comparada con el desplegable. |
| `materials`: listado | Los filtros están en «Filtros y orden», un desplegable cerrado, desde `7248afe`. | Test | El test abre el desplegable, como haría un docente. |
| `materials`: cuota | La búsqueda de `402\|403\|429` coincidía con los dígitos aleatorios del email que aparece en la navegación. | Test | Búsqueda limitada a `main` y a números aislados. |
| `pdf-preview` | Esperaba la extensión del visor nativo de Chrome. Este Chromium headless declara `pdfViewerEnabled` pero no la carga. | Entorno | Los bytes del visor y de la descarga se comprueban siempre. La barra del visor nativo solo se prueba donde existe, y su ausencia queda anotada. |
| `visual-locator` | Hay un enlace «Localizar en el original» por cada visual sin localizar, y la copia vigente es «Imagen del documento original incluida (seleccionada en la página 2).». | Test | Se sigue el enlace de `vis_2` con la copia vigente. |
| `design-foundations` (intermitente) | El media emulado por CDP se aplica de forma asíncrona y se leía una sola vez. | Test | Se sondean los estilos calculados. |
| `render` móvil: «socket hang up» (intermitente) | Carrera de keep-alive: Node cierra un socket inactivo a los 5 s mientras un cliente lo reutiliza. | Infraestructura de test | `fake-supabase` mantiene el keep-alive más tiempo que los clientes. |
| Análisis que «no termina» (intermitente) | El primer análisis de un `next dev` en frío compila rutas y librerías PDF (47,6 s medidos) y la espera era de 45 s. Aparte, una caché `.next` compilada en otro commit dejó la app inservible tras cambiar de commit. | Infraestructura de test | `waitForAnalysis` espera 90 s, para cubrir la compilación y no la latencia del producto. Tras cambiar de commit hay que limpiar `.next`. |

**Problemas del producto:** ninguno. La cabecera es correcta, la interfaz muestra el nombre del servidor y un navegador con locale UTF-8 guarda el PDF con su nombre exacto (verificado). El docente descarga el archivo correcto.

## Resultado final

Pendiente de la última ejecución (ver el registro de desarrollo).

## Cómo ejecutarlas aquí

```bash
E2E_CHROMIUM_PATH=/opt/pw-browsers/chromium pnpm test:e2e
```

Tras cambiar de commit, borra `.next` antes de ejecutar: el servidor de desarrollo reutiliza su caché.
