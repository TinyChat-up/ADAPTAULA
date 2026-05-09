-- Extend adaptation_feedback table
-- Replace smallint rating (1/-1) with integer rating (1-5)
-- Add structured feedback dimensions

ALTER TABLE adaptation_feedback DROP COLUMN rating;
ALTER TABLE adaptation_feedback ADD COLUMN rating integer CHECK (rating >= 1 AND rating <= 5);

ALTER TABLE adaptation_feedback ADD COLUMN IF NOT EXISTS usable text CHECK (usable IN ('yes', 'partial', 'no'));
ALTER TABLE adaptation_feedback ADD COLUMN IF NOT EXISTS positive_dimensions text[] DEFAULT '{}';
ALTER TABLE adaptation_feedback ADD COLUMN IF NOT EXISTS improvement_dimensions text[] DEFAULT '{}';
ALTER TABLE adaptation_feedback ADD COLUMN IF NOT EXISTS improvement_notes text;
