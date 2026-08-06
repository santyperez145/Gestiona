-- Descuento por cantidad, general.
--
-- Hasta acá lo único que había era `products.price_2x_ars`: un precio fijo para
-- dos unidades, cargado a mano producto por producto y sólo en vapers. Sirve
-- para "llevando 2 a $36.000" y no sirve para nada más — no hay forma de decir
-- "llevando 3 o más, 15% off en todos los perfumes", que es la promoción por
-- volumen que tienen Tiendanube y MercadoLibre de fábrica.
--
-- ── Cómo se combina con lo que ya existe ──────────────────────────────────
--
-- **No se suman: por cada producto gana el mejor.** Es la misma regla que se
-- acaba de establecer para la oferta y el medio de pago, y por el mismo motivo:
-- apilar descuentos da porcentajes que nadie configuró y que el comprador no
-- puede verificar contra ningún número redondo.
--
-- Así, un vaper con 2x a $36.000 y una regla de "3+ al 15%" cobra el 2x
-- llevando dos y el 15% llevando tres, lo que sea mejor en cada caso —nunca los
-- dos.
--
-- ── Alcance de una regla ──────────────────────────────────────────────────
--
--   'todos'     — cualquier producto de la organización
--   'categoria' — los de un slug de `products.category`
--   'producto'  — uno puntual
--
-- Entre varias que apliquen gana **la de mayor descuento**, no la más
-- específica: si el comercio dejó activas dos, la intención razonable es la que
-- más le conviene al comprador, y la otra la puede desactivar.
--
-- Idempotente.

CREATE TABLE IF NOT EXISTS public.quantity_discounts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name        text NOT NULL,
  scope       text NOT NULL DEFAULT 'todos'
              CHECK (scope IN ('todos', 'categoria', 'producto')),
  /* slug de categoría o id de producto, según `scope`. NULL para 'todos'. */
  target      text,
  min_qty     int  NOT NULL CHECK (min_qty >= 2),
  discount_percent numeric(5,2) NOT NULL
              CHECK (discount_percent > 0 AND discount_percent <= 90),
  is_active   boolean NOT NULL DEFAULT true,
  starts_at   timestamptz,
  ends_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),

  -- Una regla con alcance necesita a qué aplicarse. Sin esto, un 'categoria'
  -- sin target se comportaría como 'todos' sin que nadie lo haya pedido.
  CONSTRAINT quantity_discounts_target_coherente CHECK (
    (scope = 'todos' AND target IS NULL) OR
    (scope <> 'todos' AND target IS NOT NULL AND btrim(target) <> '')
  )
);

CREATE INDEX IF NOT EXISTS quantity_discounts_activas_idx
  ON public.quantity_discounts(org_id, scope, target)
  WHERE is_active;

ALTER TABLE public.quantity_discounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "quantity_discounts_org_select" ON public.quantity_discounts;
CREATE POLICY "quantity_discounts_org_select" ON public.quantity_discounts
  FOR SELECT USING (public.is_org_member(org_id, auth.uid()));

DROP POLICY IF EXISTS "quantity_discounts_org_write" ON public.quantity_discounts;
CREATE POLICY "quantity_discounts_org_write" ON public.quantity_discounts
  FOR ALL USING (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin','manager']))
  WITH CHECK (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin','manager']));

-- ── El ahorro por volumen, combinando las dos mecánicas ────────────────────
--
-- Reemplaza a `store_promo_2x_discount` en `create_store_order`: por cada
-- producto calcula el ahorro del 2x y el de la mejor regla de cantidad, y se
-- queda con el mayor. Nunca los suma.
CREATE OR REPLACE FUNCTION public.store_volume_discount(
  p_org_id uuid,
  p_items  jsonb
)
RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
  WITH lineas AS (
    SELECT
      (it->>'product_id')::uuid                        AS product_id,
      GREATEST(COALESCE((it->>'quantity')::int, 0), 0) AS qty,
      COALESCE((it->>'unit_price')::numeric, 0)        AS unit_price
    FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) AS it
  ),
  por_producto AS (
    SELECT
      l.product_id,
      SUM(l.qty)                AS qty_total,
      SUM(l.qty * l.unit_price) AS total_normal,
      p.price_2x_ars,
      p.category
    FROM lineas l
    JOIN public.products p ON p.id = l.product_id AND p.org_id = p_org_id
    GROUP BY l.product_id, p.price_2x_ars, p.category
    HAVING SUM(l.qty) >= 2
  ),
  ahorros AS (
    SELECT
      pp.product_id,
      -- Mecánica vieja: precio fijo por par, cruzando líneas.
      CASE WHEN COALESCE(pp.price_2x_ars, 0) > 0 THEN
        GREATEST(0, floor(pp.qty_total / 2)
          * (2 * (pp.total_normal / pp.qty_total) - pp.price_2x_ars))
      ELSE 0 END AS ahorro_2x,
      -- Mecánica nueva: la mejor regla que alcance esa cantidad.
      COALESCE((
        SELECT MAX(qd.discount_percent)
        FROM public.quantity_discounts qd
        WHERE qd.org_id = p_org_id
          AND qd.is_active
          AND qd.min_qty <= pp.qty_total
          AND (qd.starts_at IS NULL OR qd.starts_at <= now())
          AND (qd.ends_at   IS NULL OR qd.ends_at   >= now())
          AND (
            qd.scope = 'todos'
            OR (qd.scope = 'categoria' AND qd.target = pp.category)
            OR (qd.scope = 'producto'  AND qd.target = pp.product_id::text)
          )
      ), 0) * pp.total_normal / 100.0 AS ahorro_cantidad
    FROM por_producto pp
  )
  SELECT COALESCE(SUM(GREATEST(a.ahorro_2x, a.ahorro_cantidad)), 0)::numeric
  FROM ahorros a;
$fn$;

REVOKE ALL ON FUNCTION public.store_volume_discount(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.store_volume_discount(uuid, jsonb) TO anon, authenticated;

COMMENT ON FUNCTION public.store_volume_discount(uuid, jsonb) IS
  'Ahorro por volumen de un carrito ya resuelto: por producto toma el MEJOR '
  'entre el precio 2x fijo y la mejor regla de quantity_discounts. Nunca los '
  'suma. Reemplaza a store_promo_2x_discount.';

COMMENT ON TABLE public.quantity_discounts IS
  'Reglas de descuento por cantidad ("llevando 3 o mas, 15% off"). Entre varias '
  'que apliquen gana la de mayor descuento.';
