-- Product tags for flexible labeling (e.g. "nuevo", "importado", "oferta", "temporada")
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS tags text[] DEFAULT '{}';

-- GIN index for fast array containment queries
CREATE INDEX IF NOT EXISTS products_tags_idx ON public.products USING gin (tags)
  WHERE tags IS NOT NULL AND array_length(tags, 1) > 0;
