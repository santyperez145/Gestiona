
-- Create product_variants table
CREATE TABLE public.product_variants (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  variant_name TEXT NOT NULL,
  stock INTEGER NOT NULL DEFAULT 0,
  sku TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT unique_product_variant UNIQUE (product_id, variant_name)
);

-- Enable RLS
ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Admin manages variants"
ON public.product_variants FOR ALL
TO authenticated
USING (auth.uid() = user_id AND get_user_role(auth.uid()) = 'admin')
WITH CHECK (auth.uid() = user_id AND get_user_role(auth.uid()) = 'admin');

CREATE POLICY "Authenticated read own variants"
ON public.product_variants FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Public read active variants"
ON public.product_variants FOR SELECT
TO anon
USING (active = true);

-- Add variant_id to sales
ALTER TABLE public.sales ADD COLUMN variant_id UUID REFERENCES public.product_variants(id) ON DELETE SET NULL;

-- Index for performance
CREATE INDEX idx_product_variants_product_id ON public.product_variants(product_id);
CREATE INDEX idx_sales_variant_id ON public.sales(variant_id);
