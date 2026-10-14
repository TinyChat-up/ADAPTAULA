# Endurecimiento de procedencia y rechazo de recortes de escaneo no verificados

Esta PR corrige dos defectos reproducidos en `main` (`1929849`): el productor podía recortar bytes precargados de otro original bajo el SHA de una revisión anterior, y el localizador podía aceptar acuerdo de visión sin ancla de actividad. Ahora se verifica la fuente efectiva y se exige asociación con la zona de la actividad.

Se retira íntegramente el localizador experimental de escaneos de esta PR. **La fase 8.2B.6 permanece pendiente**: la unicidad geométrica no verifica identidad pedagógica. Los falsos positivos de «figura única» solo pertenecían al experimento de #30; no se ha comprobado la existencia de activos inseguros en producción.

- Lectores, pins y productor rechazan procedencia ausente/incompleta, evidencia scan, referencias incoherentes y rutas/recetas/identidades incorrectas antes de leer bytes. La selección humana admite evidencia explícitamente null; los automáticos requieren evidencia completa, motor conocido y ancla.
- `auto_visuals@v5` evita decisiones cacheadas anteriores. Se conservan selección humana, localización anclada con texto, revisión histórica y rutas pre-017; se restringe expresamente visión sin ancla. No se borran activos ni se modifica RLS/SQL.
- Se elimina infraestructura de scan redundante. Se conservan adversarios como evidencia histórica y regresiones de SHA, procedencia, RLS, caché, corrección humana y exportación. Los controles son de aplicación, sin revocar acceso autorizado del propietario a objetos históricos.

Validación: **149 pruebas focalizadas (11 archivos), 3 PDF Chromium y typecheck PASS**; lint sin errores, un aviso previo. Dos regresiones comprobadas fallando contra main. Sin suite completa, build, llamadas pagadas, OCR, modelos nuevos, SQL remoto, migraciones ni cambios comerciales. Sin validación de producción ni carga máxima en Vercel.

[Informe de alcance, evidencias y límites](docs/qa/pr30/README.md). Recomendación técnica: **MERGE exclusivamente como endurecimiento de procedencia**, sin declarar terminada 8.2B.6.
