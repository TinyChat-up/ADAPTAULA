-- Reversión de la 035 (solo si fuera necesaria). Restaura `record_ai_run` con su definición ANTERIOR (la de la migración 013, tal como estaba en
-- producción el 2026-11-11, huella 9078e49a1dc49a16094859ec4eeb2584) y elimina lo que añadió la 035. No toca ninguna fila de la aplicación.
begin;
delete from supabase_migrations.schema_migrations where version = '20261001003500';
create or replace function public.record_ai_run(p_row jsonb)
returns boolean
language plpgsql
security definer
set search_path to ''
as $function$
begin
  insert into public.ai_runs (
    workspace_id, job_id, adaptation_id, material_id, purpose, model_alias, provider, model, prompt_key, prompt_version, effort,
    input_tokens, output_tokens, cached_input_tokens, cache_creation_input_tokens, estimated_cost_usd, latency_ms, status, error_code,
    attempt, schema_version, call_kind, reasoning_tokens, input_fingerprint, output_fingerprint, job_attempt
  ) values (
    (p_row ->> 'workspace_id')::uuid, (p_row ->> 'job_id')::uuid, (p_row ->> 'adaptation_id')::uuid, (p_row ->> 'material_id')::uuid,
    p_row ->> 'purpose', p_row ->> 'model_alias', p_row ->> 'provider', p_row ->> 'model', p_row ->> 'prompt_key',
    (p_row ->> 'prompt_version')::int, p_row ->> 'effort',
    coalesce((p_row ->> 'input_tokens')::int, 0), coalesce((p_row ->> 'output_tokens')::int, 0),
    coalesce((p_row ->> 'cached_input_tokens')::int, 0), coalesce((p_row ->> 'cache_creation_input_tokens')::int, 0),
    (p_row ->> 'estimated_cost_usd')::numeric, (p_row ->> 'latency_ms')::int, p_row ->> 'status', p_row ->> 'error_code',
    coalesce((p_row ->> 'attempt')::smallint, 1), (p_row ->> 'schema_version')::int, p_row ->> 'call_kind',
    (p_row ->> 'reasoning_tokens')::int, p_row ->> 'input_fingerprint', p_row ->> 'output_fingerprint', (p_row ->> 'job_attempt')::smallint
  )
  on conflict do nothing;
  return found;
end;
$function$;
revoke execute on function public.record_ai_run(jsonb) from public, anon, authenticated;
grant execute on function public.record_ai_run(jsonb) to service_role;
drop function if exists public.ai_cost_report(timestamptz, uuid);
drop function if exists public.ai_spend_summary(text);
drop function if exists public.ai_spend_settle(uuid, numeric);
drop function if exists public.ai_spend_admit(text, numeric, text, text, integer, integer, numeric);
drop function if exists public.ai_spend_committed(text);
drop table if exists public.ai_spend_reservations;
commit;
