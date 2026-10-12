-- Adaptaula · 023 · Política visual de «Hacer magia» (docs/VISUAL_RESOURCES.md § Política visual)
--
-- En «Hacer magia» el servidor resuelve cada necesidad visual de la ficha sin pedir nada al docente: localiza el original, lo
-- reconstruye, genera un apoyo nuevo, reescribe la actividad sin el visual o se detiene honestamente. La decisión de cada ficha
-- se guarda como artefacto auditable de la adaptación (`visual_resolution`, una vez por entrada de generación: un trabajo
-- reanudado reutiliza las decisiones y su coste) y las dos llamadas de modelo nuevas quedan en ai_runs sin contenido.
-- No cambia ninguna fila existente.

alter table public.adaptation_artifacts drop constraint adaptation_artifacts_kind_check;
alter table public.adaptation_artifacts add constraint adaptation_artifacts_kind_check check (kind in (
  'planner_draft', 'plan', 'plan_validation', 'plan_review', 'execution_report',
  'generation', 'deterministic_review', 'reviewer_findings', 'pedagogical_review', 'visual_resolution'
));

alter table public.ai_runs drop constraint ai_runs_purpose_check;
alter table public.ai_runs add constraint ai_runs_purpose_check check (purpose in (
  'analyze', 'plan', 'generate', 'review', 'revise_block', 'image_brief', 'image', 'locate_visual', 'visual_support', 'visual_rewrite'
));
