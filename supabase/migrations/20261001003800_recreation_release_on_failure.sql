-- «Hacer magia» (motor de recreación): una adaptación que falla definitivamente no consume ni retiene la unidad del plan.
-- Solo amplía el caso «cerrada» de release_adaptation_entitlement; no borra ni cambia datos.

create or replace function public.release_adaptation_entitlement(p_adaptation uuid, p_reason text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_a public.adaptations;
  v_e public.adaptation_entitlements;
begin
  select * into v_a from public.adaptations a where a.id = p_adaptation for update;
  if not found then
    raise exception 'adaptation_not_found' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_a.workspace_id::text || ':adaptation', 0));
  select * into v_e from public.adaptation_entitlements e where e.adaptation_id = p_adaptation for update;
  if not found then
    return jsonb_build_object('released', false, 'reason', 'not_reserved');
  end if;
  if v_e.state = 'released' then
    return jsonb_build_object('released', true, 'duplicate', true);
  end if;
  if v_e.state = 'consumed' or v_a.delivered_at is not null then
    return jsonb_build_object('released', false, 'reason', 'delivered');
  end if;
  -- ADR-053: a «Hacer magia» of the recreation engine that failed for good (no automatic retry left) gives its unit back too.
  if v_a.status <> 'cancelled' and not (v_a.status = 'failed' and v_a.pipeline_versions ? 'engine') then
    return jsonb_build_object('released', false, 'reason', 'not_closed');
  end if;
  perform public.refund_quota(v_e.reserve_key);
  update public.adaptation_entitlements e set state = 'released', released_at = now(), release_reason = left(coalesce(p_reason, 'cancelled'), 60) where e.adaptation_id = p_adaptation;
  return jsonb_build_object('released', true, 'duplicate', false);
end;
$$;
