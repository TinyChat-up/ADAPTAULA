-- Adaptaula · 021 · Recurso del docente para un visual que el análisis atribuye al original (docs/VISUAL_RESOURCES.md)
-- El análisis puede describir una imagen «del original» que el docente no encuentra en el PDF (o que no se puede localizar con
-- fiabilidad). En ese caso nadie localiza una zona arbitraria ni inventa la imagen: el docente aporta la suya para ESA adaptación.
-- La respuesta se guarda en la misma tabla de 020, con la clave del visual (`vis_N`) en lugar de la de una decisión (`dec_N`).
-- Solo cambia la restricción de la clave: la función, la RLS, la inmutabilidad y los permisos de 020 siguen igual. Un visual del
-- original nunca se omite: el servidor solo acepta `provided` para estas claves.

alter table public.adaptation_visual_resources drop constraint adaptation_visual_resources_decision_id_check;
alter table public.adaptation_visual_resources
  add constraint adaptation_visual_resources_decision_id_check check (decision_id ~ '^(dec|vis)_[0-9]{1,4}$');

comment on column public.adaptation_visual_resources.decision_id is
  'dec_N: visual pedido por una decisión del plan; vis_N: visual que el análisis atribuye al original y el docente aporta porque no está o no se puede localizar.';

-- Una omisión solo tiene sentido para un apoyo pedido por el plan, nunca para un visual del original.
alter table public.adaptation_visual_resources
  add constraint adaptation_visual_resources_original_never_omitted check (resolution = 'provided' or decision_id like 'dec\_%');
