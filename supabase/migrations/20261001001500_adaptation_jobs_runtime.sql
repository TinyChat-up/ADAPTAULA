-- Adaptaula · 015 · Ejecución durable de las etapas: descubrir trabajo, reconciliar y cancelar con seguridad
-- Sin tablas nuevas: la cola es `adaptation_jobs` (013). Lo que las 013/014 no podían representar:
--   · «qué jobs puede reclamar un worker ahora» y «qué adaptaciones necesitan un job y no lo tienen» (el reconciliador);
--   · que cancelar una adaptación inutilice también sus jobs en la misma transacción: un job en cola no puede arrancar y un
--     worker que ya estaba llamando al proveedor pierde el lease, así que su resultado tardío no puede persistir, entregar ni consumir.
-- Todas las funciones: solo service_role.

-- Jobs de adaptación que un worker puede reclamar ahora: en cola y fuera de su espera, o en proceso con el lease caducado.
create or replace function public.list_claimable_adaptation_jobs(p_limit int)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('job_id', t.id, 'adaptation_id', t.adaptation_id, 'stage', t.stage) order by t.created_at), '[]'::jsonb)
  from (
    select j.id, j.adaptation_id, j.stage, j.created_at
    from public.adaptation_jobs j
    join public.adaptations a on a.id = j.adaptation_id
    where j.adaptation_id is not null
      and j.attempts < j.max_attempts
      and a.status not in ('cancelled', 'ready')
      and ((j.status = 'queued' and (j.locked_until is null or j.locked_until <= now()))
           or (j.status = 'processing' and j.locked_until <= now()))
    order by j.created_at
    limit greatest(p_limit, 0)
  ) t;
$$;

-- Adaptaciones que están en un estado que exige un job y no tienen ninguno activo. Nunca `awaiting_plan_review`, `blocked`,
-- `failed`, `cancelled` ni `ready`: esos estados esperan a una persona o han terminado.
create or replace function public.list_adaptations_needing_job(p_min_age_seconds int, p_limit int)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('adaptation_id', t.id, 'stage', t.stage) order by t.updated_at), '[]'::jsonb)
  from (
    select a.id, a.updated_at,
           case a.status when 'queued' then 'planning' else 'generation' end as stage
    from public.adaptations a
    where a.status in ('queued', 'generation_queued')
      and a.updated_at <= now() - make_interval(secs => greatest(p_min_age_seconds, 0))
      and not exists (
        select 1 from public.adaptation_jobs j
        where j.adaptation_id = a.id and j.status in ('queued', 'processing')
          and j.stage = case a.status when 'queued' then 'planning' else 'generation' end
      )
    order by a.updated_at
    limit greatest(p_limit, 0)
  ) t;
$$;

-- Cancelar: libera la reserva (014) E inutiliza los jobs activos, todo en la misma transacción. El job pasa a 'canceled':
-- ningún worker puede reclamarlo, y uno que ya lo tenía falla en su próxima escritura con fencing (lease_lost).
create or replace function public.transition_adaptation(p_adaptation uuid, p_from text, p_to text, p_failure_code text default null)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not public.adaptation_transition_allowed(p_from, p_to) then
    raise exception 'invalid_transition' using errcode = 'P0001', detail = format('%s -> %s', p_from, p_to);
  end if;
  update public.adaptations a
     set status = p_to,
         failure_code = case when p_to = 'failed' then p_failure_code when p_to in ('queued', 'generation_queued', 'planning', 'generating') then null else a.failure_code end
   where a.id = p_adaptation and a.status = p_from;
  if found and p_to = 'cancelled' then
    update public.adaptation_jobs j
       set status = 'canceled', locked_until = null, step = null, completed_at = now(), provider_call_started_at = null,
           error = coalesce(j.error, jsonb_build_object('code', 'cancelled'))
     where j.adaptation_id = p_adaptation and j.status in ('queued', 'processing');
    perform public.release_adaptation_entitlement(p_adaptation, 'cancelled');
  end if;
  return found;
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array['list_claimable_adaptation_jobs(int)', 'list_adaptations_needing_job(int, int)'] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end;
$$;
