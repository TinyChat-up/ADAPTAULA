# Fuente de la hoja

Inter 4.1, tres caras estáticas (400, 600, 700) en WOFF2, copiadas sin modificar de la release oficial `Inter-4.1.zip` de <https://github.com/rsms/inter> (carpeta `web/`). Licencia: SIL Open Font License 1.1 (`LICENSE.txt`).

| Fichero | Peso | sha-256 |
|---|---|---|
| `Inter-Regular.woff2` | 400 | `e06f6b1bc553aaea4e4668023ed0ab0a147129c3107f511bc7d03d361b0ae085` |
| `Inter-SemiBold.woff2` | 600 | `5cb7103e4e605989afebc03d989c79201e54b21b5183db33981f70db9178a301` |
| `Inter-Bold.woff2` | 700 | `fa888127b6da015b65569f0351f3b5c391ad928904951f1c20e9f8462a8d95ea` |

sha-256 de `Inter-4.1.zip`: `9883fdd4a49d4fb66bd8177ba6625ef9a64aa45899767dde3d36aa425756b11e`.

Las mismas sumas están fijadas en `src/lib/render/print/sheet-assets.ts`: si un fichero cambia, la impresión falla en lugar de cambiar el documento en silencio. Cambiar la fuente es una versión nueva del renderer. No se usa la fuente variable porque Chromium la incrusta en el PDF como Type3.
