ALTER TABLE adaptation_feedback
  ADD COLUMN IF NOT EXISTS adaptation_level text,
  ADD COLUMN IF NOT EXISTS ai_provider text CHECK (ai_provider IN ('gemini', 'gpt-4.1', 'nvidia'));

-- tags queda en el schema pero no se rellena — no la eliminamos para no
-- romper RLS ni queries existentes. Documentado como columna legacy.
