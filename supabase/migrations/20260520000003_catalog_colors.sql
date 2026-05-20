-- Catalog color customization columns
ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS catalog_bg_color    text DEFAULT '#0E0E1C',
  ADD COLUMN IF NOT EXISTS catalog_card_color  text DEFAULT '#16163A',
  ADD COLUMN IF NOT EXISTS catalog_accent_color text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS brand_palettes      jsonb DEFAULT '[]'::jsonb;
