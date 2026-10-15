# Qué debe revisar un especialista antes del lanzamiento

Este documento lo prepara el equipo técnico. Recoge las preguntas abiertas, no las respuestas. Los textos de `/privacidad` y
`/terminos` son **borradores** y no garantizan el cumplimiento.

Contexto para la revisión:
- [AUDITORIA_DATOS.md](AUDITORIA_DATOS.md): qué hace realmente el producto.
- [FINALIDADES_Y_CORPUS.md](FINALIDADES_Y_CORPUS.md): diseño de finalidades, autorizaciones y corpus.

## A · Protección de datos (RGPD, LOPDGDD y normativa educativa)

1. **Roles.**
   - Para un docente que se registra por su cuenta: ¿Adaptaula es responsable de los datos de su cuenta y **encargado** respecto
     a los datos del alumnado (alias y necesidades funcionales) y a los que contengan sus fichas? ¿O hay corresponsabilidad?
     ¿Puede un docente actuar como responsable fuera del marco de su centro?
   - Para un centro: confirmar que el centro o la administración educativa es responsable y Adaptaula encargado, y revisar el
     contrato de encargo (art. 28) con instrucciones, subencargados, devolución y borrado y auditorías.
2. **Bases jurídicas.** Determinar la base de:
   - la finalidad A;
   - el registro de la autorización de B (consentimiento o interés legítimo con oposición);
   - los registros técnicos (`ai_runs`, `audit_logs`).
3. **Perfiles funcionales de menores.** Las necesidades funcionales («apoyo en la lectura», «atención sostenida») ¿pueden
   considerarse datos de salud (art. 9) en algún caso? ¿Bastan el alias y la ausencia de diagnósticos? ¿Hace falta EIPD (art. 35)?
4. **Disposición adicional 23.ª de la LOE y normativa autonómica** sobre datos del alumnado y uso de plataformas por el profesorado.
5. **Información (arts. 13 y 14).** Completar en el borrador: responsable, contacto y DPD, finalidades, bases jurídicas, plazos,
   destinatarios, transferencias y derechos. Informar a los titulares de datos que aparezcan en las fichas: ¿quién lo hace y cómo?
6. **Plazos** de conservación de originales, adaptaciones, registros técnicos, cuentas eliminadas y evidencias de autorización tras
   una retirada. Hoy no existe ningún job que aplique retenciones ([auditoría §3](AUDITORIA_DATOS.md#3-conservación-y-borrado)).
7. **Derechos.** Hoy no existen borrado de cuenta, exportación ni borrado de adaptaciones en la aplicación. ¿Qué mínimo exige el
   lanzamiento?
8. **Subencargados y transferencias** (Anthropic, OpenAI, Supabase, Vercel, Stripe y correo). Verificar contratos firmados,
   regiones, mecanismo de transferencia y conservación del lado del proveedor (§6 de la propuesta). Valorar si hay que solicitar
   retención cero o residencia en la UE antes de tratar fichas que puedan contener datos de menores.
9. **Metadatos de los ficheros subidos.** Hoy no se eliminan. ¿Debe limpiarse el original o basta con avisar?
10. **Seudonimización frente a anonimización.** Confirmar el criterio: códigos en lugar de nombres = dato personal. Así, el corpus
    excluye cualquier dato de terceros.
11. **Reglamento de IA de la UE.** ¿Algún uso de Adaptaula entra en los supuestos de alto riesgo del ámbito educativo (anexo III)?
    ¿Qué obligaciones de transparencia aplican al contenido generado?

## B · Propiedad intelectual (TRLPI)

1. **Finalidad A.** Analizar y adaptar una ficha de terceros a petición del docente supone reproducir y transformar la obra.
   - ¿Qué cubre la excepción de ilustración con fines educativos y en qué límites? ¿Cómo deben formularse los términos («debes
     tener derecho a usar el material»)?
   - ¿Qué responsabilidad asume Adaptaula como prestador?
2. **Finalidad B.** Incorporar una ficha a un corpus interno de evaluación.
   - ¿Qué licencia mínima hace falta y de quién?
   - ¿Basta la declaración del docente para material propio?
   - ¿Cómo se verifica razonablemente la autoría?
   - ¿Aplican las excepciones de minería de textos y datos y con qué condiciones (reserva de derechos, conservación)?
3. **Finalidad C.** Entrenamiento o ajuste fino: licencia, reserva de derechos de los titulares y obligaciones de transparencia
   sobre datos de entrenamiento (Reglamento de IA).
4. **Materiales del centro y editoriales.** ¿Puede un centro licenciar materiales de su profesorado? ¿Qué ocurre con los
   cuadernos comerciales que los docentes suben habitualmente?
5. **Contenido generado.** Titularidad de las adaptaciones y de las ilustraciones generadas, y las condiciones de los proveedores
   sobre la salida.

## C · Producto y términos

1. Texto definitivo del aviso de contribución (borrador en la propuesta §3) y del canal de retirada.
2. Condiciones de pago, cancelación, garantías, limitación de responsabilidad y ley aplicable (pendientes en `/terminos`).
3. Confirmar que no hace falta banner de cookies mientras solo existan cookies técnicas, y revisar `/cookies`.
4. Revisar que el borrador no promete nada que el producto no hace: no hay exportación, ni borrado de cuenta, ni retenciones
   automáticas.

## D · Datos que el equipo debe aportar al especialista

**PENDIENTES:**
- identidad jurídica del titular de Adaptaula y dirección;
- correo de contacto para privacidad;
- DPD, si lo hubiera;
- contratos y DPA con los proveedores;
- configuración real de las cuentas (regiones, retención y ZDR);
- plan comercial con centros.
