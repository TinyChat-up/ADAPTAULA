-- Adaptaula · 024 · Ilustraciones educativas generadas por IA para «Hacer magia» (docs/VISUAL_RESOURCES.md § Ilustraciones generadas)
--
-- Cuando una actividad necesita una imagen que el original no puede dar y que no es una representación exacta (un esquema de la
-- célula, una situación cotidiana, un proceso), el servidor genera una ilustración nueva con un modelo de imagen, la revisa con un
-- modelo de visión y solo la usa si la revisión la aprueba. Se guarda en el bucket privado `generated-assets` y se registra en
-- `generated_assets` (tabla de la migración 004, sin uso hasta ahora) con lo necesario para fijarla en un PDF y auditarla.
--
-- Compatible y aditiva:
--   · solo columnas nuevas y nulas en `generated_assets` (no hay filas antiguas que migrar);
--   · un índice único parcial que hace idempotente la generación (misma adaptación, misma necesidad, mismo brief → una fila);
--   · una fila aprobada es inmutable (el PDF fija su sha-256);
--   · un propósito más en `ai_runs`: `image_review` (la revisión por visión de la ilustración).
-- No cambia planes, precios ni cuotas: la cuota `image` (`plans.monthly_images`) y `consume_quota('image')` ya existían.

alter table public.generated_assets
  add column need_key text check (need_key ~ '^(vis|dec|act)_[0-9]{1,4}$'),
  add column brief_fingerprint text check (brief_fingerprint ~ '^[0-9a-f]{64}$'),
  add column sha256 text check (sha256 ~ '^[0-9a-f]{64}$'),
  add column mime text check (mime = 'image/png'),
  add column width int check (width between 256 and 4096),
  add column height int check (height between 256 and 4096),
  add column bytes int check (bytes > 0 and bytes <= 10485760),
  add column model_alias text check (model_alias in ('IMAGE_FAST', 'IMAGE_QUALITY')),
  add column review jsonb,
  add column attempts int check (attempts between 1 and 3);

-- Una ilustración generada se registra completa o no se registra.
alter table public.generated_assets add constraint generated_assets_illustration_complete check (
  sha256 is null
  or (need_key is not null and brief_fingerprint is not null and mime is not null and width is not null and height is not null
      and bytes is not null and model_alias is not null and review is not null and attempts is not null and type = 'illustration')
);

-- Idempotencia: una sola ilustración aprobada por adaptación, necesidad y brief (un trabajo reanudado la reutiliza, no paga dos veces).
create unique index generated_assets_need_brief_idx on public.generated_assets (adaptation_id, need_key, brief_fingerprint) where sha256 is not null;

-- Inmutable: el PDF fija su sha-256. Solo se borra en cascada con su adaptación o su espacio de trabajo.
create or replace function public.generated_assets_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.sha256 is not null then
    raise exception 'una ilustración generada no se modifica' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger generated_assets_immutable
  before update on public.generated_assets
  for each row execute function public.generated_assets_immutable();

-- La revisión por visión de una ilustración es un propósito propio en la contabilidad de IA.
alter table public.ai_runs drop constraint ai_runs_purpose_check;
alter table public.ai_runs add constraint ai_runs_purpose_check check (purpose in (
  'analyze', 'plan', 'generate', 'review', 'revise_block', 'image_brief', 'image', 'image_review', 'locate_visual', 'visual_support', 'visual_rewrite'
));
