# Perfil pedagógico V3: primera entrega

Esta entrega guarda información declarada por el docente sin cambiar el planificador ni generar nuevas actividades. No es una autorización para modificar objetivos. La autorización curricular y su alcance por ficha se resolverán en otra entrega, antes de Hacer magia.

## Uso y contrato

El formulario conserva el curso de escolarización y las tarjetas funcionales existentes. Añade áreas opcionales del catálogo educativo existente, cada una con nivel orientativo independiente (`reference_grade`, `null` si no está valorado), hasta cinco aprendizajes en «Qué sabe hacer» y cinco en «Qué necesita aprender o reforzar» (180 caracteres por idea). La información debe ser educativa y no contener nombres, diagnósticos ni datos médicos: el texto libre no puede garantizar por sí solo que se haya respetado esta indicación.

La versión 3 de `functional_profile` añade `pedagogy: { areas, response_preferences, adaptation_preferences }`. Las preferencias son opciones declaradas, no órdenes de transformar actividades; seleccionar «Curricular» no autoriza cambios de objetivos. Nada de `pedagogy` entra en el contexto del planificador. Fortalezas, barreras, apoyos y comportamiento anterior se conservan.

Los perfiles V1 y V2 se leen sin rellenar datos nuevos ni inferir niveles. Si solo se editan los datos anteriores se conserva la compatibilidad anterior. Al incorporar datos nuevos se guarda V3; editar, duplicar o cambiar apoyos conserva los datos V3. El trigger bloquea escrituras de clientes antiguos que reducirían la versión y borrarían información. Los perfiles existentes y las adaptaciones históricas no se migran ni reescriben.

## Migración y despliegue futuro

`20261001003600_pedagogical_profile_guard.sql` cambia la función del trigger de 032: permite V2→V3 y rechaza descensos V2→V1 y V3→V1/V2. La 032 no se altera. Se ha probado exclusivamente en PGlite local y no se ha aplicado remotamente.

Antes de autorizar un despliegue: comprobar historial y esquema efectivos, copia de seguridad, dependencias y que todos los lectores estén preparados para V3. Aplicar 036 antes de habilitar escrituras V3; no permitir que un despliegue antiguo que solo lee V1/V2 reciba tráfico después de crear perfiles V3. Para un rollback, mantener lectores compatibles con V3 y no degradar ni borrar los datos. Verificar RLS y conflictos en el entorno correspondiente. No asumir que cambiar Git aplica migraciones a Supabase.

## Comprobaciones y límites

Las pruebas focalizadas cubren lectura y validación V1/V2/V3, contextos del planificador, conservación al cambiar tarjetas, duplicación mediante repositorio, conflictos de edición, RLS entre espacios y migración repetida en PGlite. No se ejecutan E2E ni se usa IA de pago; la experiencia en navegador y la accesibilidad con tecnologías de apoyo quedan pendientes de comprobación. Las pruebas locales no acreditan comportamiento en producción ni eficacia pedagógica. Los nuevos datos todavía no influyen en la ficha generada.

Resultado local: 27 pruebas focalizadas correctas en cinco archivos; typecheck correcto; lint sin errores (un aviso previo ajeno). El build estándar se bloqueó porque el `node_modules` compartido del entorno es un enlace externo al directorio del proyecto; la comprobación alternativa con webpack también quedó bloqueada por la descarga de Inter y Outfit desde Google Fonts. No se cambiaron las fuentes del producto. La rama tiene desactivado el despliegue Git de Vercel en `vercel.json`.
