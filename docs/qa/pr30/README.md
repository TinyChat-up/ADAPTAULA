# PR #30 — Endurecimiento de procedencia y rechazo de recortes de escaneo no verificados

Revisión y cierre de alcance: 2026-10-14. Rama `claude/fase-8-2b6-escaneos`, base `main` en `1929849`, referencia de la auditoría `d9f61a0`. La PR se propone exclusivamente como corrección de seguridad/procedencia. **La fase funcional 8.2B.6 permanece pendiente.** No se ha consultado producción ni comprobado si existen activos inseguros desplegados.

## 1. Qué existía en main y qué introdujo el experimento

| Hallazgo | Alcance demostrado | Corrección / valor frente a main |
|---|---|---|
| `produceVisualAsset(..., preloaded)` no contrastaba los bytes con `source_sha256` del localizador efectivo | **Main.** PGlite reproduce que `create_visual_locator` devuelve una revisión activa anterior y el productor acepta bytes diferentes de igual geometría. La nueva aserción falla contra `1929849` | Verificar SHA antes de reutilizar o producir cualquier instancia |
| Una hipótesis de visión podía hacer superar el umbral sin ancla de actividad | **Main.** La prueba existente de una barra sin `activityIds` aceptaba el acuerdo de visión. La nueva expectativa de rechazo falla contra `1929849`; no se llama al proveedor | Exigir ancla y pertenencia a su zona en el localizador y en evidencia persistida; `auto_visuals@v5` evita decisiones cacheadas previas |
| Aceptación de letras, decoración, regiones ajenas o etiquetas incompletas por «única figura» a 0,75 | **Solo implementación experimental de PR #30**, `71b6080` / `ccfbf3e`, nunca incorporada a la base revisada | Eliminar por completo `auto/scan.ts`; páginas sin texto quedan fuera del localizador automático y de corroboración de forma; no se consulta visión para ellas |
| Reutilización de activos con `evidence.scan` | La ausencia de validación de procedencia estaba en **main**, pero **este formato scan solo lo escribía el experimento de #30**. El activo inseguro de la prueba es sintético, no un hallazgo en producción | Cierre preventivo de listado, vista, bytes, pins y reintento; conservar filas/objetos para trazabilidad |
| Procedencia ausente o referencias incoherentes | **Endurecimiento defensivo.** Main no proyectaba evidencia ni el localizador del pin. `d9f61a0` los consultaba, pero su filtro negativo permitía omisiones. Veinte de 24 pruebas iniciales fallaban en d9; algunas usan adaptadores deliberadamente defectuosos | Validación positiva de localizador y enlace activo–localizador–receta–ruta. No se afirma que usuarios normales puedan insertar esas filas: FK, inmutabilidad, RLS y escritura de servicio ya limitan esa posibilidad |

No se demuestra un acceso entre workspaces ni explotación remota. Se demuestra un defecto de integridad del original, aceptación sin asociación independiente y ausencia de controles defensivos de procedencia. La puntuación 0,75 no se convierte en garantía semántica.

## 2. Contrato final: rechazo por defecto

- Todo recorte requiere localizador presente, identificadores, versión, huellas, página, coordenadas y geometría válidos. La consulta del pin obtiene su localizador completo con el mismo cliente y RLS.
- **Humano:** método `human`, evidencia explícitamente `null` y sin confianza automática. Es el contrato real del esquema; `undefined` no equivale a una selección confirmada. Siguen funcionando PDF e imágenes.
- **Automático:** PDF, confianza válida, versión de motor conocida (v1–v5), señales completas, `placement: true`, `clean: true` y ancla de actividad. Cualquier propiedad `scan`, incluso `null`, se rechaza. Evidencia ausente, vacía, mal formada, motor desconocido o PNG automático: rechazo antes de leer bytes.
- Cada instancia debe referenciar ese localizador, tener identidad lógica y receta vigentes, id/hash válidos y la ruta privada esperada. Se conserva el formato de ruta anterior a la migración 017. Un pin exige su id y SHA exactos, sin sustituirlo por otra instancia.
- Listado rápido, vista, bytes, pin y productor comparten estas comprobaciones. Los SHA del original y del PNG se verifican en sus respectivos puntos; un PNG válido no prueba por sí solo de qué original procede.
- Sin texto se rechaza antes de recorrer los píxeles. También se rechaza la visión sin ancla aunque la página tenga texto: es una restricción deliberada respecto a main. Las vías ancladas conservan geometría y reconstrucción existentes.
- La nueva versión evita resultados cacheados antiguos, pero no sustituye los controles del lector. Una corrección humana crea otra revisión; el pin inseguro anterior sigue bloqueado.

## 3. Simplificación y pruebas conservadas

Se elimina el módulo scan, sus tipos/señales/versionado y el despacho paralelo al localizador existente. Se eliminan las dos suites que repetían el rechazo del localizador desactivado y se agrupan las integraciones de scan y procedencia. El generador de célula pasa de 114 a 21 líneas: solo rasteriza una ficha sintética conocida, sin combinatoria de ruido/decoración. El fixture de activo experimental se inserta directamente en PGlite: no desactiva triggers ni altera filas inmutables.

Se conservan:

- `visual-provenance.test.ts`: 26 casos de procedencia incompleta, enlaces incorrectos, pins exactos y controles positivos; prueba que no se leen bytes al rechazar.
- Integración PGlite: SHA precargado, caché anterior, activos scan heredados, corrección humana, RLS y cambio de original; decoración C y actividad ajena I recorren servicios reales con proveedores simulados. El caso I comprueba bloqueo de Hacer magia y ausencia de descarga.
- Regresiones existentes del localizador anclado, instancias, permisos y exportación. El acuerdo de visión sin ancla cambia expresamente a rechazo; la figura con ancla y visión simulada sigue aceptándose.
- Un PDF de célula seleccionada manualmente, junto con fracciones automáticas y selección tabular. La disposición/renderer no cambian.
- Los fixtures A–J y su pequeño generador como **evidencia histórica reproducible**, no diez ejecuciones equivalentes del rechazo incondicional. [Resultados sobre ccfbf3e y d9f61a0](results.json): el campo `after` corresponde a la primera auditoría, no al contrato actual v5.

| Evidencia histórica | Fallo del experimento |
|---|---|
| [A](A.png), [B](B.png), [C](C.png) | Mayúscula, signo y logotipo aceptados como figura |
| [D](D.png), [E](E.png) | Consigna unida y dos gráficos conectados aceptados como una región |
| [F](F.png), [G](G.png) | Figura cortada sustituida por un logo; formulario confundido con esquema |
| [H](H.png) | Rotación/sombra/ruido: falta evidencia independiente; no prueba por sí solo imagen equivocada |
| [I](I.png), [J](J.png) | Actividad ajena; etiquetas imprescindibles omitidas |

## 4. Verificación del cierre

- **149 pruebas focalizadas PASS en 11 archivos**: `visual-provenance`, `automatic-visuals`, `visual-raster`, `visual-boundaries`, `boundaries`; db `scan-visuals`, `automatic-visuals`, `visual-instances`, `visual-locators`, `pdf-export`, `magic-visual-policy`.
- **3 PDF Chromium PASS**: `scan-visuals` (manual), `automatic-visuals` y `table-choice-substitution`.
- Typecheck PASS; lint sin errores, un aviso previo en `analysis-run-auth.test.ts`; diff sin errores de espacios.
- Dos regresiones reproducidas fallando contra main (`1929849`): original precargado equivocado y acuerdo de visión sin ancla. Los cambios de trabajo se restauraron después de esa comprobación. No se suman esos fallos esperados ni repeticiones al total final.
- Sin suite completa, build, OCR, modelos nuevos, llamadas pagadas, SQL remoto, migraciones ni cambios comerciales.

## 5. Límites

La fase 8.2B.6 sigue pendiente de evidencia independiente de identidad/asociación, integridad y etiquetas. No se certifican páginas híbridas, capas OCR falsas, toda selección humana, escaneos reales ni carga máxima en Vercel. La caché de 200 ppp se libera entre páginas, pero no se presenta como un benchmark de producción.

**No se ha comprobado la existencia de activos inseguros en producción.** El bloqueo scan es preventivo. Tampoco se recuperan descargas o cachés previas. Los controles descritos operan en los servicios de la aplicación; la RLS de Storage sigue autorizando por pertenencia al workspace, no evalúa semántica del recorte. No se revocan los permisos del propietario para inspeccionar sus objetos históricos ni se cambia SQL.

## 6. Recomendación y publicación

**MERGE técnico como endurecimiento de seguridad y procedencia.** Todas las correcciones de producción que quedan aportan valor respecto a main: fuente correcta, asociación con actividad, rechazo de procedencia incompleta, integridad de referencias y protección preventiva ante activos del experimento. Las pruebas añadidas cubren esas rutas y sus controles positivos; no sostienen una capacidad de escaneo automática.

Antes de integrar debe reflejarse ese alcance en el título y descripción de #30. [Texto preparado](PR_DESCRIPTION.md). La API de GitHub devuelve `Forbidden` desde este entorno; Git HTTPS sí permite publicar la rama. No se afirma que los metadatos remotos se hayan actualizado hasta verificarlo. No se crea otra PR ni se hace merge.
