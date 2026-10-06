-- Adaptaula · 008 · Minimización de datos: se elimina learner_profiles.notes
-- La columna nunca ha tenido uso: la interfaz no la pide, ningún contrato la lee y no se envía a la IA.
-- Eliminarla evita que alguien acabe guardando información sensible de menores en texto libre.

alter table public.learner_profiles drop column if exists notes;
