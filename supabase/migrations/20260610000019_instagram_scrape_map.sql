-- Milestone: Instagram Auto-Scrape + Places Map View
-- Adds scrape-specific metadata to the saves table.
-- Location coordinates remain in save_locations (consistent with enrich-save flow).

ALTER TABLE public.saves
  ADD COLUMN IF NOT EXISTS caption              TEXT,
  ADD COLUMN IF NOT EXISTS scrape_method        TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS category_confidence  NUMERIC(4, 3),
  ADD COLUMN IF NOT EXISTS source_username      TEXT;

-- Analytics: compare scrape vs manual save volumes per user
CREATE INDEX IF NOT EXISTS idx_saves_user_scrape ON public.saves (user_id, scrape_method);
