import { PGlite } from '@electric-sql/pglite';
/** Test fixture only. Not a migration, seed, subscription upgrade or commercial entitlement. */
export async function enableLocalMaxImageProposal(db: PGlite) {
  if (!(db instanceof PGlite)) throw new Error('El piloto solo configura una BD PGlite en memoria.');
  await db.query(`update public.plans set monthly_images=5,
    features=features || '{"image_generation":true,"illustrations_per_adaptation":3,"illustration_budget_usd":0.5}'::jsonb
    where slug='max' and features->>'commercial_policy'='2026-10-v2'`);
}
