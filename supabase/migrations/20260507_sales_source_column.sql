-- Add source column to sales table
-- Values: 'manual' | 'pos' | 'tiendanube' | 'api' | 'presupuesto'

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'pos', 'tiendanube', 'api', 'presupuesto'));

-- Back-fill existing rows
UPDATE public.sales SET source = 'manual' WHERE source IS NULL OR source = '';

CREATE INDEX IF NOT EXISTS sales_source_idx ON public.sales(org_id, source);
