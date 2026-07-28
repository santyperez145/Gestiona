-- `product_variants` no tenía código de barras, pero la importación desde
-- Tiendanube (y las etiquetas por variante) lo necesitan: el upsert fallaba
-- con "column barcode does not exist" y ninguna variante se importaba.
-- Idempotente.

ALTER TABLE public.product_variants
  ADD COLUMN IF NOT EXISTS barcode text;

CREATE INDEX IF NOT EXISTS product_variants_barcode_idx
  ON public.product_variants(org_id, barcode)
  WHERE barcode IS NOT NULL;
