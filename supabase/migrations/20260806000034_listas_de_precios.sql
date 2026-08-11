-- ═══════════════════════════════════════════════════════════════════════════
-- Listas de precios — una sola forma, y que se puedan crear
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Las listas de precios son la herramienta con la que un comercio vende
-- mayorista, a distribuidores o a clientes VIP sin duplicar el catálogo. Están
-- en el menú desde hace meses y **hay cero listas creadas en la base**. No es
-- que no se usen: no se pueden usar.
--
-- ── Lo que se encontró ────────────────────────────────────────────────────
--
-- 1. **Crear una lista desde /listas-precios falla.** El formulario manda
--    `active` y la columna se llama `is_active`, así que PostgREST rechaza el
--    insert entero. La página que está en el menú es la que no funciona.
--
-- 2. **Hay dos generaciones de esquema conviviendo, y nunca se cruzan.**
--
--      price_lists       discount_pct        ← Ajustes y ficha de producto
--                        discount_type/value ← /listas-precios
--
--      price_list_items  price_ars, min_qty  ← Ajustes y ficha de producto
--                        custom_price, min_quantity ← /listas-precios
--
--    El POS lee `discount_pct`. La página del menú escribe `discount_value`.
--    Una lista "Mayorista 20%" creada en /listas-precios le cobra el precio
--    completo a todo el mundo, en silencio, porque el POS mira la otra columna.
--
-- 3. **`min_quantity` existe y el UNIQUE lo hace imposible.** Hay un único por
--    (lista, producto), así que no se puede cargar "desde 6 unidades, $X" y
--    "desde 12, $Y" — que es para lo que existe la columna, y lo que hace que
--    una lista mayorista sirva.
--
-- ── Qué se elige ──────────────────────────────────────────────────────────
--
-- La forma nueva, que es más rica, más la única cosa buena que tenía la vieja:
--
--   price_lists       discount_type ∈ (none|percentage|fixed) + discount_value
--   price_list_items  custom_price (precio fijo)
--                     discount_pct (% propio del producto, pisa al de la lista)
--                     min_quantity (desde cuántas unidades aplica)
--
-- Se dropean las columnas viejas en vez de dejarlas conviviendo. Convivir es
-- justamente lo que causó esto: dos columnas que significan lo mismo terminan
-- con la mitad del código leyendo una y la otra mitad escribiendo la otra.
--
-- ⚠️ Se puede dropear sin perder nada porque las dos tablas están **vacías**
-- —verificado: 0 listas, 0 items—. Igual el traspaso está escrito, por si se
-- corre en una base que sí tenga datos.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Traspaso, por si hay datos ──────────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='price_lists'
                AND column_name='discount_pct') THEN
    UPDATE public.price_lists
       SET discount_type  = 'percentage',
           discount_value = discount_pct
     WHERE COALESCE(discount_pct, 0) > 0
       AND COALESCE(discount_type, 'none') = 'none';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='price_list_items'
                AND column_name='price_ars') THEN
    UPDATE public.price_list_items
       SET custom_price = price_ars
     WHERE price_ars IS NOT NULL AND custom_price IS NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='price_list_items'
                AND column_name='min_qty') THEN
    UPDATE public.price_list_items
       SET min_quantity = GREATEST(1, min_qty)
     WHERE COALESCE(min_qty, 0) > 1 AND COALESCE(min_quantity, 1) <= 1;
  END IF;
END $$;

-- ── 2. Una sola forma ──────────────────────────────────────────────────────

ALTER TABLE public.price_lists      DROP COLUMN IF EXISTS discount_pct;
ALTER TABLE public.price_list_items DROP COLUMN IF EXISTS price_ars;
ALTER TABLE public.price_list_items DROP COLUMN IF EXISTS min_qty;

ALTER TABLE public.price_list_items ALTER COLUMN min_quantity SET DEFAULT 1;
UPDATE public.price_list_items SET min_quantity = 1 WHERE COALESCE(min_quantity, 0) < 1;
ALTER TABLE public.price_list_items ALTER COLUMN min_quantity SET NOT NULL;

ALTER TABLE public.price_lists ALTER COLUMN discount_type  SET DEFAULT 'none';
ALTER TABLE public.price_lists ALTER COLUMN discount_value SET DEFAULT 0;

COMMENT ON COLUMN public.price_list_items.custom_price IS
  'Precio fijo para este producto en esta lista. Gana sobre cualquier porcentaje.';
COMMENT ON COLUMN public.price_list_items.discount_pct IS
  '% propio del producto en esta lista. Pisa al descuento general de la lista.';
COMMENT ON COLUMN public.price_list_items.min_quantity IS
  'Desde cuántas unidades aplica esta fila. Permite tramos: 6+, 12+, 24+.';

-- ── 3. Los tramos por cantidad, ahora posibles ─────────────────────────────
--
-- El único por (lista, producto) impedía cargar más de un tramo. Pasa a ser
-- por (lista, producto, desde cuántas unidades).

ALTER TABLE public.price_list_items
  DROP CONSTRAINT IF EXISTS price_list_items_price_list_id_product_id_key;

DROP INDEX IF EXISTS public.price_list_items_price_list_id_product_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS price_list_items_tramo_unico
  ON public.price_list_items (price_list_id, product_id, min_quantity);

-- ── 4. Invariantes ─────────────────────────────────────────────────────────

ALTER TABLE public.price_lists DROP CONSTRAINT IF EXISTS price_lists_discount_type_valido;
ALTER TABLE public.price_lists ADD CONSTRAINT price_lists_discount_type_valido
  CHECK (discount_type IN ('none', 'percentage', 'fixed'));

ALTER TABLE public.price_lists DROP CONSTRAINT IF EXISTS price_lists_descuento_razonable;
ALTER TABLE public.price_lists ADD CONSTRAINT price_lists_descuento_razonable
  CHECK (
    COALESCE(discount_value, 0) >= 0
    AND (discount_type <> 'percentage' OR COALESCE(discount_value, 0) <= 100)
  );

-- Una fila que no fija precio ni descuenta no dice nada, y hace que el POS
-- muestre el precio de lista sin explicar por qué.
ALTER TABLE public.price_list_items DROP CONSTRAINT IF EXISTS price_list_items_dice_algo;
ALTER TABLE public.price_list_items ADD CONSTRAINT price_list_items_dice_algo
  CHECK (custom_price IS NOT NULL OR discount_pct IS NOT NULL);

ALTER TABLE public.price_list_items DROP CONSTRAINT IF EXISTS price_list_items_min_quantity_positiva;
ALTER TABLE public.price_list_items ADD CONSTRAINT price_list_items_min_quantity_positiva
  CHECK (min_quantity >= 1);

-- Dos listas marcadas como default dejan indefinido qué precio se cobra.
CREATE UNIQUE INDEX IF NOT EXISTS price_lists_una_sola_default
  ON public.price_lists (org_id) WHERE is_default;

-- ── 5. La semilla, que escribía la columna que ya no está ──────────────────

CREATE OR REPLACE FUNCTION public.seed_default_price_list(p_org_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  -- La lista base no descuenta: es el precio de lista. Existe para que las
  -- otras se lean como "qué le hago al precio normal" y para que un cliente sin
  -- lista asignada tenga una.
  INSERT INTO public.price_lists (org_id, name, description, discount_type, discount_value, is_default)
  SELECT p_org_id, 'Minorista', 'Precio de lista', 'none', 0, true
   WHERE NOT EXISTS (
     SELECT 1 FROM public.price_lists WHERE org_id = p_org_id AND is_default);
END;
$function$;
