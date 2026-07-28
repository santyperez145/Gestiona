-- Proveedor preferido por producto.
-- Lo necesitan AutoRestockPage (agrupar sugerencias de reposición por proveedor)
-- y SupplierPOModal (armar la orden de compra filtrando por proveedor).
-- Idempotente: se puede reaplicar sin efectos.

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS supplier_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'products_supplier_id_fkey'
  ) THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_supplier_id_fkey
      FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS products_supplier_idx
  ON public.products(org_id, supplier_id);
