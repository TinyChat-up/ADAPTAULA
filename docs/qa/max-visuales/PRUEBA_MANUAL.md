# Guía de ensayo Max · no ejecutar pagos sin autorización

## 1. Preparación local autorizada (sin coste de modelos)

1. Partir de esta rama y usar dependencias instaladas. Las migraciones 024 y 026 originales permanecen intactas.
2. `pnpm exec vitest run tests/unit/max-image-pilot.test.ts tests/unit/illustrations.test.ts tests/unit/magic-illustrations.test.ts tests/db/illustrations.test.ts`.
3. `pnpm exec vitest run --config vitest.pdf.config.mts tests/pdf/max-visuals.test.ts tests/pdf/pedagogical-layout.test.ts`.
4. Arrancar el entorno ficticio de `playwright.config.ts`, con todos los modelos de texto simulados y `FLAG_AI_IMAGES_ENABLED=false`; ejecutar `pnpm exec playwright test tests/e2e/max-visuals.spec.ts`. Las imágenes del test son dibujos manuales, guardados como filas y objetos privados ficticios. Las claves de su script son exclusivamente las conocidas del servidor falso.
5. La E2E asigna Max a su cuenta ficticia con un ID `pilot-local-*`, configura la propuesta de cinco solo en PGlite y restaura el catálogo al terminar. No llama a Stripe, OpenAI, Anthropic ni Supabase remoto. La generación queda probada en las pruebas de servicio y BD con dependencias controladas; la E2E prueba lectura, finalidad, permisos y PDF.
6. Revisar las seis parejas de PDF y la variante monocroma. Comprobar números, marcas, etiquetas, claridad del ejemplo y espacio de respuesta. No marcar «validado por un docente» por haber pasado tests.

## 2. Preparar un entorno aislado (sin activarlo todavía)

Hace falta aprobación comercial de la propuesta y autorización específica antes de configurar cualquier servicio remoto.

- Identificar proyecto Supabase y despliegue que sean exclusivamente de pruebas; comprobar aislamiento de producción, migraciones, RLS y bucket privado.
- La propuesta para **ese catálogo de pruebas** es `monthly_images=5`, `image_generation=true`, `illustrations_per_adaptation=3`, `illustration_budget_usd=0.5` en Max. No se proporciona una migración que altere instalaciones existentes. Conservar el catálogo y las condiciones comerciales de producción.
- Utilizar una sola cuenta/workspace ficticios de Max. No conceder privilegios a cuentas reales ni usar suscripciones Stripe reales. El fixture PGlite es el ejemplo ejecutable local; no es un script de despliegue remoto.
- Configurar mediante gestor de secretos, sin chat ni Git:
  - `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`.
  - `AI_MODEL_IMAGE_QUALITY` con el identificador que se confirme disponible; los alias actuales no se han cambiado.
  - `AI_IMAGES_PILOT_MODE=local` para backend loopback, o `staging` para un proyecto `https://<ref>.supabase.co` aislado.
  - `AI_IMAGES_PILOT_SUPABASE_URL`, idéntica a `NEXT_PUBLIC_SUPABASE_URL`.
  - `AI_IMAGES_PILOT_WORKSPACE_ID`, UUID del único workspace ficticio autorizado.
  - `FLAG_AI_IMAGES_ENABLED=true` **solo tras la autorización**. `VERCEL_ENV=production` bloquea siempre esta ruta.
- Antes de gastar, confirmar plan efectivo y configuración. No basta con poner el flag: se comprueban plan Max, cuota, revisión, presupuesto y almacenamiento. No activar contratación ni imágenes en precios.
- El servidor exige STANDARD real para brief/revisión; no acepta presentar una revisión del proveedor simulado como revisión real.

## 3. Confirmar el modelo (metadatos, sin generación)

La consulta oficial de documentación estuvo bloqueada por la red en esta sesión. El SDK instalado reconoce los IDs actuales, pero eso no acredita acceso de la cuenta ni generación correcta.

Con autorización para consultar el proveedor y el secreto ya configurado:

```bash
node --import tsx scripts/staging/check-image-model.mjs --inspect-model
```

No usa automáticamente archivos `.env`. Sin `--inspect-model` no conecta. Devuelve PASS/FAIL/NO EJECUTADO, ID y estado HTTP, sin credenciales ni cuerpos de error. Un PASS confirma que la cuenta puede recuperar ese ID; **no** confirma todavía que pueda generar imágenes ni valida su precio.

Verificar las tarifas vigentes y parámetros en las fuentes oficiales antes de aprobar gasto:
- https://developers.openai.com/api/docs/guides/image-generation
- https://developers.openai.com/api/docs/models
- https://openai.com/api/pricing/

## 4. Ensayo real mínimo, separado y pendiente de autorización

Propuesta: **una ilustración sintética de célula animal**, como máximo **dos llamadas de imagen**, una de brief y hasta dos revisiones. Se reutiliza `evals/illustrations/run.ts`, no otro pipeline. No procesa materiales privados, no modifica la BD y no descuenta la cuota de un usuario: es una evaluación de la imagen; la integración de cuota se valida por separado.

Una vez autorizado el gasto y verificadas las claves/modelos:

```bash
# Ejecutar únicamente después de autorización expresa para este ensayo.
node --conditions=react-server --env-file-if-exists=.env.local --import tsx evals/illustrations/run.ts --budget 0.50 --yes
```

- La autorización debe cubrir ambos proveedores (brief/revisión y generación). No ejecutado aquí.
- Sin `--yes` no genera. No permite presupuesto superior a 0,50 USD. Comprueba el ID del modelo con metadatos antes de generar.
- Se crea un marcador exclusivo **antes** de la primera llamada generativa. Otro proceso o un ensayo interrumpido no se relanza silenciosamente. Revisar costes/resultados antes de archivar un marcador y autorizar otro intento.
- Detener ante modelo no disponible, rechazo del brief, falta de cuota, presupuesto, tiempo insuficiente o revisión incorrecta. No añadir intentos para conseguir una imagen más bonita.
- Resultados locales: `evals/results/illustrations/…`. El marcador de inicio distingue ejecución iniciada de terminada. No subir automáticamente PNG, prompts o resultados a Git; revisar antes cualquier publicación, incluso con datos sintéticos.
- Revisar 1/2/3 sobre las partes correctas, ausencia de pared/cloroplastos, edad, impresión en grises, texto alternativo y ausencia de respuestas. La imagen mock histórica no lleva esos marcadores: es un caso negativo conocido, no un resultado aprobado pedagógicamente.
- Solo si la imagen es correcta, preparar un PDF CLARO fijando bytes y SHA mediante la misma infraestructura. Comparar con la ficha sin apoyo cuando siga siendo resoluble; una actividad que exige esa imagen queda bloqueada sin ella.

## 5. Coste estimado y significado de «cinco imágenes»

Las tarifas y tamaños de salida no se han revalidado en el proveedor. Estimaciones defensivas actuales del código:

| Recurso | Estimación de admisión |
|---|---:|
| VisualSpec / ejemplo calculado | 0 USD de API de imagen |
| Brief o revisión | 0,03 USD por llamada |
| Imagen | 0,08 USD por llamada |
| Una ilustración, primer intento | 0,14 USD |
| Una ilustración, dos intentos | 0,25 USD |
| Techo defensivo por adaptación | 0,50 USD, hasta 3 ilustraciones aprobadas |

Son estimaciones para decidir si se inicia una llamada, no precios garantizados ni facturas. Cinco ilustraciones aprobadas sin incidencias equivaldrían a unos 0,70–1,25 USD bajo esos supuestos. **No es un máximo mensual:** las rechazadas devuelven cuota, pero sus llamadas se pagan. Hay que sumar intentos rechazados, interrupciones y otros pasos de la adaptación. La cuota existente cuenta aprobadas; no se cambia esa semántica para ocultar costes.

Configurar además el control de gasto que ofrezca cada proveedor y reconciliar `ai_runs` con su facturación. No realizar un nuevo ensayo si el anterior tiene un coste desconocido sin revisar.

## 6. Desactivación

Desactivar el flag y retirar la configuración del piloto. No iniciar trabajos nuevos. Verificar el resultado de los ya iniciados y sus costes; apagar un flag no anula una llamada ya admitida. Los documentos entregados conservan sus activos privados y SHA; no borrar objetos para simular una reversión. La restauración del catálogo remoto requiere autorización y revisión de sus referencias; esta entrega no la ejecuta.
