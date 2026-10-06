-- Adaptaula · 011 · Minimización de datos: se elimina learner_profiles.contextual_tags
-- La columna nunca ha tenido uso: ninguna pantalla la pide, ningún contrato la lee, no se envía a la IA y el MVP
-- de adaptación no la necesita (el perfil funcional ya describe las necesidades). Conservarla "por si acaso" solo
-- invita a guardar etiquetas diagnósticas de menores. Al borrarla desaparece también su permiso de UPDATE.

alter table public.learner_profiles drop column if exists contextual_tags;
