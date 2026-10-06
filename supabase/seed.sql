-- Adaptaula · datos iniciales (idempotente: se puede ejecutar varias veces)

-- ---------------------------------------------------------------------------
-- Etapas y cursos
-- ---------------------------------------------------------------------------

insert into public.stages (slug, name, sort_order) values
  ('primaria', 'Educación Primaria', 10),
  ('eso', 'ESO', 20),
  ('bachillerato', 'Bachillerato', 30)
on conflict (slug) do nothing;

insert into public.grades (slug, stage_slug, name, sort_order, typical_age_min, typical_age_max) values
  ('1-primaria', 'primaria', '1.º de Primaria', 11, 6, 7),
  ('2-primaria', 'primaria', '2.º de Primaria', 12, 7, 8),
  ('3-primaria', 'primaria', '3.º de Primaria', 13, 8, 9),
  ('4-primaria', 'primaria', '4.º de Primaria', 14, 9, 10),
  ('5-primaria', 'primaria', '5.º de Primaria', 15, 10, 11),
  ('6-primaria', 'primaria', '6.º de Primaria', 16, 11, 12),
  ('1-eso', 'eso', '1.º de ESO', 21, 12, 13),
  ('2-eso', 'eso', '2.º de ESO', 22, 13, 14),
  ('3-eso', 'eso', '3.º de ESO', 23, 14, 15),
  ('4-eso', 'eso', '4.º de ESO', 24, 15, 16),
  ('1-bachillerato', 'bachillerato', '1.º de Bachillerato', 31, 16, 17),
  ('2-bachillerato', 'bachillerato', '2.º de Bachillerato', 32, 17, 18)
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------------
-- Asignaturas (LOMLOE; una misma asignatura puede existir en varias etapas)
-- ---------------------------------------------------------------------------

insert into public.subjects (slug, name, stage_slugs, sort_order) values
  ('lengua-castellana', 'Lengua Castellana y Literatura', array['primaria', 'eso', 'bachillerato'], 10),
  ('matematicas', 'Matemáticas', array['primaria', 'eso', 'bachillerato'], 20),
  ('ingles', 'Inglés', array['primaria', 'eso', 'bachillerato'], 30),
  ('lengua-cooficial', 'Lengua cooficial y Literatura', array['primaria', 'eso', 'bachillerato'], 40),
  ('conocimiento-medio', 'Conocimiento del Medio Natural, Social y Cultural', array['primaria'], 50),
  ('educacion-artistica', 'Educación Artística', array['primaria'], 60),
  ('educacion-fisica', 'Educación Física', array['primaria', 'eso', 'bachillerato'], 70),
  ('valores-civicos', 'Educación en Valores Cívicos y Éticos', array['primaria', 'eso'], 80),
  ('biologia-geologia', 'Biología y Geología', array['eso'], 90),
  ('fisica-quimica', 'Física y Química', array['eso'], 100),
  ('geografia-historia', 'Geografía e Historia', array['eso'], 110),
  ('tecnologia-digitalizacion', 'Tecnología y Digitalización', array['eso'], 120),
  ('plastica', 'Educación Plástica, Visual y Audiovisual', array['eso'], 130),
  ('musica', 'Música', array['primaria', 'eso'], 140),
  ('frances', 'Francés (segunda lengua extranjera)', array['primaria', 'eso', 'bachillerato'], 150),
  ('latin', 'Latín', array['eso', 'bachillerato'], 160),
  ('economia', 'Economía', array['eso', 'bachillerato'], 170),
  ('filosofia', 'Filosofía', array['bachillerato'], 180),
  ('historia-espana', 'Historia de España', array['bachillerato'], 190),
  ('historia-filosofia', 'Historia de la Filosofía', array['bachillerato'], 200),
  ('matematicas-ccss', 'Matemáticas Aplicadas a las Ciencias Sociales', array['bachillerato'], 210),
  ('fisica', 'Física', array['bachillerato'], 220),
  ('quimica', 'Química', array['bachillerato'], 230),
  ('biologia', 'Biología', array['bachillerato'], 240),
  ('geologia-ambientales', 'Geología y Ciencias Ambientales', array['bachillerato'], 250),
  ('dibujo-tecnico', 'Dibujo Técnico', array['bachillerato'], 260),
  ('tecnologia-ingenieria', 'Tecnología e Ingeniería', array['bachillerato'], 270),
  ('griego', 'Griego', array['bachillerato'], 280),
  ('historia-arte', 'Historia del Arte', array['bachillerato'], 290),
  ('geografia', 'Geografía', array['bachillerato'], 300),
  ('literatura-universal', 'Literatura Universal', array['bachillerato'], 310),
  ('otra', 'Otra asignatura', array['primaria', 'eso', 'bachillerato'], 999)
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------------
-- Planes (valores iniciales de docs/PRODUCT.md; se ajustan sin desplegar)
-- Los IDs de precio de Stripe se rellenan en la Fase 6.
-- ---------------------------------------------------------------------------

insert into public.plans (
  slug, name, monthly_price_cents, annual_price_cents,
  monthly_adaptations, monthly_images, max_profiles, max_classes, features, sort_order
) values
  ('free', 'Free', 0, 0, 5, 0, 2, 0, '{
    "multi_profile": false, "max_profiles_per_job": 1,
    "monthly_analyses": 10, "monthly_block_revisions": 20, "premium_escalations_per_month": 0,
    "max_pages_per_material": 5, "max_file_mb": 15,
    "history_days": 30, "templates": "basic",
    "advanced_editor": false, "comparison": "basic",
    "ai_base_tier": "ECONOMY", "image_generation": false, "priority_processing": false
  }'::jsonb, 10),
  ('pro', 'Pro', 999, 9900, 75, 0, 30, 10, '{
    "multi_profile": true, "max_profiles_per_job": 6,
    "monthly_analyses": 100, "monthly_block_revisions": 400, "premium_escalations_per_month": 5,
    "max_pages_per_material": 15, "max_file_mb": 20,
    "history_days": null, "templates": "all",
    "advanced_editor": true, "comparison": "full",
    "ai_base_tier": "STANDARD", "image_generation": false, "priority_processing": false
  }'::jsonb, 20),
  ('max', 'Max', 1799, 17900, 150, 50, 100, 30, '{
    "multi_profile": true, "max_profiles_per_job": 30,
    "monthly_analyses": 250, "monthly_block_revisions": 800, "premium_escalations_per_month": 20,
    "max_pages_per_material": 25, "max_file_mb": 25,
    "history_days": null, "templates": "all",
    "advanced_editor": true, "comparison": "full",
    "ai_base_tier": "STANDARD", "image_generation": true, "priority_processing": true
  }'::jsonb, 30)
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------------
-- Ajustes operativos
-- ---------------------------------------------------------------------------

insert into public.app_settings (key, value) values
  ('ai.paused', 'false'::jsonb)
on conflict (key) do nothing;
