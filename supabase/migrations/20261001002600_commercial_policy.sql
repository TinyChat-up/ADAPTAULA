-- Política 4A. Solo catálogo local: no modifica Stripe, RLS ni consumo.
-- Conserva filas contratadas y sus IDs; workspace_plan() resuelve por plan_id
-- incluso cuando active=false. Las filas históricas salen del catálogo público.
do $$
declare
  old_plan public.plans%rowtype;
begin
  -- Serializa cambios del catálogo con nuevas referencias de suscripciones.
  lock table public.plans, public.subscriptions in share row exclusive mode;
  for old_plan in select * from public.plans where slug in ('free', 'pro', 'max') loop
    if old_plan.features ->> 'commercial_policy' = '2026-10-v2' then
      continue;
    end if;
    if exists (select 1 from public.subscriptions where plan_id = old_plan.id)
       or old_plan.stripe_price_monthly_id is not null
       or old_plan.stripe_price_annual_id is not null then
      update public.plans set slug = old_plan.slug || '-legacy-' || old_plan.id::text,
        active = false where id = old_plan.id;
    else
      -- Sin contratos asociados: se actualiza debajo manteniendo el ID.
      null;
    end if;
  end loop;

  insert into public.plans (
    slug, name, monthly_price_cents, annual_price_cents,
    monthly_adaptations, monthly_images, max_profiles, max_classes, features, sort_order
  ) values
  ('free', 'Free', 0, 0, 1, 0, 2, 0, '{
    "commercial_policy": "2026-10-v2", "multi_profile": false, "max_profiles_per_job": 1,
    "monthly_analyses": 2, "monthly_block_revisions": 20, "premium_escalations_per_month": 0,
    "max_pages_per_material": 5, "max_file_mb": 15,
    "history_days": 30, "templates": "basic",
    "advanced_editor": false, "comparison": "basic",
    "ai_base_tier": "ECONOMY", "image_generation": false, "priority_processing": false
  }'::jsonb, 10),
  ('pro', 'Pro', 2490, 0, 15, 0, 30, 10, '{
    "commercial_policy": "2026-10-v2", "multi_profile": true, "max_profiles_per_job": 6,
    "monthly_analyses": 30, "monthly_block_revisions": 400, "premium_escalations_per_month": 5,
    "max_pages_per_material": 15, "max_file_mb": 20,
    "history_days": null, "templates": "all",
    "advanced_editor": true, "comparison": "full",
    "ai_base_tier": "STANDARD", "image_generation": false, "priority_processing": false
  }'::jsonb, 20),
  ('max', 'Max', 4990, 0, 30, 0, 100, 30, '{
    "commercial_policy": "2026-10-v2", "multi_profile": true, "max_profiles_per_job": 30,
    "monthly_analyses": 50, "monthly_block_revisions": 800, "premium_escalations_per_month": 20,
    "max_pages_per_material": 25, "max_file_mb": 25,
    "history_days": null, "templates": "all",
    "advanced_editor": true, "comparison": "full",
    "ai_base_tier": "STANDARD", "image_generation": false, "priority_processing": true
  }'::jsonb, 30)
  on conflict (slug) do update set
    monthly_price_cents = excluded.monthly_price_cents,
    annual_price_cents = excluded.annual_price_cents,
    monthly_adaptations = excluded.monthly_adaptations,
    monthly_images = excluded.monthly_images,
    max_profiles = excluded.max_profiles,
    features = (public.plans.features - 'unlimited_adaptations') || excluded.features,
    active = true
  where public.plans.features ->> 'commercial_policy' is distinct from '2026-10-v2';
end $$;
