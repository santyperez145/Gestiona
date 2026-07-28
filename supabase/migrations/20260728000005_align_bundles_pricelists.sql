-- ============================================================================
-- Alinear product_bundles / price_lists / price_list_items con lo que usa la UI
-- ============================================================================
-- Las páginas de Bundles y Listas de Precios esperaban columnas que nunca se
-- crearon (destacados, contador de vendidos, vigencia y segmentación de las
-- listas). Se agregan de forma aditiva: no se renombra ni se borra nada.

ALTER TABLE public.product_bundles
  ADD COLUMN IF NOT EXISTS featured   BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sold_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.price_lists
  ADD COLUMN IF NOT EXISTS valid_from       DATE,
  ADD COLUMN IF NOT EXISTS valid_until      DATE,
  ADD COLUMN IF NOT EXISTS applies_to       TEXT NOT NULL DEFAULT 'all'
                           CHECK (applies_to IN ('all','segment','customer')),
  ADD COLUMN IF NOT EXISTS customer_segment TEXT,
  ADD COLUMN IF NOT EXISTS discount_type    TEXT NOT NULL DEFAULT 'none'
                           CHECK (discount_type IN ('none','percentage','fixed')),
  ADD COLUMN IF NOT EXISTS discount_value   NUMERIC(12,2) NOT NULL DEFAULT 0;

-- price_list_items: la UI usa custom_price / min_quantity
ALTER TABLE public.price_list_items
  ADD COLUMN IF NOT EXISTS custom_price NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS min_quantity INTEGER NOT NULL DEFAULT 1;

-- Rellenar los nuevos campos con los valores equivalentes ya existentes
UPDATE public.price_list_items
   SET custom_price = COALESCE(custom_price, price_ars),
       min_quantity = GREATEST(COALESCE(min_quantity, 1), COALESCE(min_qty, 1))
 WHERE custom_price IS NULL OR min_quantity IS NULL;
