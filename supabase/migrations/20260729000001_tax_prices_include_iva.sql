-- ============================================================================
-- tax_prices_include_iva: si los precios de lista ya incluyen IVA
-- ============================================================================
-- En retail argentino el precio al público incluye IVA, así que el débito
-- fiscal se extrae del total (total × 21/121) en vez de sumarse encima.
-- Default true = comportamiento correcto para venta al público.

ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS tax_prices_include_iva BOOLEAN NOT NULL DEFAULT true;
