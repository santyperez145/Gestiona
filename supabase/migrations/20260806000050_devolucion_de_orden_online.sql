-- A6 — devolver un producto de una orden online.
--
-- `returns`, `return_requests` y `return_reasons` existen desde hace tiempo y
-- están **vacías**. `returns` tiene `sale_id`: sólo conoce ventas del mostrador.
-- Una devolución de una compra online había que hacerla a mano en los dos
-- sistemas, y el stock no volvía.
--
-- ── Las tres cosas que evitan que una devolución mienta ──────────────────
--
-- **El stock vuelve por `record_stock_movement`, no escribiendo la columna.**
-- Es la regla que este repo aprendió rompiéndola tres veces. Así la devolución
-- queda en el Kardex y se audita como cualquier otro movimiento, en vez de ser
-- un número que cambió sin explicación.
--
-- **No se puede devolver más de lo que se compró.** Se cuenta lo ya devuelto de
-- esa misma orden y ese mismo producto, así que dos devoluciones parciales no
-- pueden sumar más que la línea. Sin eso, devolver dos veces infla el stock —el
-- mismo error que hacía que vender 3 bajara 6, al revés.
--
-- **Sólo se devuelve lo que se pagó.** Una orden pendiente no tiene nada que
-- reintegrar y su stock está reservado, no vendido: devolverla lo duplicaría.
--
-- ── Lo que NO hace, y por qué ────────────────────────────────────────────
--
-- **No reintegra la plata por MercadoPago.** El reintegro necesita el token del
-- comercio y una llamada a la API, y eso vive en una Edge Function, no en un
-- RPC. Acá se registra el reintegro *acordado* con su método; ejecutarlo es el
-- paso siguiente. Es preferible un registro honesto de "se acordó devolver
-- $X por transferencia" que un botón que dice que devolvió y no devolvió.
--
-- Idempotente.

ALTER TABLE public.returns
  ADD COLUMN IF NOT EXISTS ecommerce_order_id uuid
    REFERENCES public.ecommerce_orders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS returns_ecommerce_order_idx
  ON public.returns(ecommerce_order_id)
  WHERE ecommerce_order_id IS NOT NULL;

COMMENT ON COLUMN public.returns.ecommerce_order_id IS
  'Orden de la tienda online que se devuelve. Excluyente con sale_id: una fila '
  'viene del mostrador o de la tienda, nunca de las dos.';

CREATE OR REPLACE FUNCTION public.return_store_order_item(
  p_order_id      uuid,
  p_product_id    uuid,
  p_variant_id    uuid    DEFAULT NULL,
  p_qty           int     DEFAULT 1,
  p_reason        text    DEFAULT NULL,
  p_refund_method text    DEFAULT 'transferencia',
  p_notes         text    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_order      record;
  v_item       jsonb;
  v_comprados  int := 0;
  v_devueltos  int := 0;
  v_unit       numeric := 0;
  v_nombre     text;
  v_var_nombre text;
  v_return_id  uuid;
BEGIN
  IF COALESCE(p_qty, 0) < 1 THEN
    RAISE EXCEPTION 'La cantidad a devolver tiene que ser al menos 1';
  END IF;

  SELECT o.id, o.org_id, o.items, o.payment_status, o.order_number
  INTO v_order
  FROM public.ecommerce_orders o
  WHERE o.id = p_order_id;

  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Orden no encontrada';
  END IF;

  IF NOT public.has_org_role(v_order.org_id, auth.uid(), ARRAY['owner','admin','manager']) THEN
    RAISE EXCEPTION 'No tenés permiso para registrar devoluciones';
  END IF;

  -- Una orden que no se pagó no tiene nada que devolver, y su stock está
  -- reservado y no vendido: devolverla lo duplicaría.
  IF v_order.payment_status <> 'paid' THEN
    RAISE EXCEPTION 'La orden % todavía no está pagada', v_order.order_number;
  END IF;

  -- Cuánto se compró de ese producto en esa orden. Se recorre `items` porque es
  -- el detalle congelado al momento de la compra: el precio de hoy puede ser
  -- otro, y el reintegro tiene que ser por lo que la persona pagó.
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(v_order.items, '[]'::jsonb)) LOOP
    IF (v_item->>'product_id')::uuid = p_product_id
       AND COALESCE(NULLIF(v_item->>'variant_id','')::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
         = COALESCE(p_variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
    THEN
      v_comprados := v_comprados + GREATEST(COALESCE((v_item->>'quantity')::int, 0), 0);
      v_unit      := COALESCE((v_item->>'unit_price')::numeric, 0);
      v_nombre    := v_item->>'name';
    END IF;
  END LOOP;

  IF v_comprados = 0 THEN
    RAISE EXCEPTION 'Ese producto no está en la orden %', v_order.order_number;
  END IF;

  SELECT COALESCE(SUM(r.quantity), 0) INTO v_devueltos
  FROM public.returns r
  WHERE r.ecommerce_order_id = p_order_id
    AND r.product_id = p_product_id
    AND COALESCE(r.variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
      = COALESCE(p_variant_id, '00000000-0000-0000-0000-000000000000'::uuid);

  IF v_devueltos + p_qty > v_comprados THEN
    RAISE EXCEPTION
      'Se compraron % y ya se devolvieron %: no se pueden devolver % más',
      v_comprados, v_devueltos, p_qty;
  END IF;

  SELECT v.variant_name INTO v_var_nombre
  FROM public.product_variants v WHERE v.id = p_variant_id;

  INSERT INTO public.returns (
    org_id, user_id, ecommerce_order_id, product_id, variant_id,
    product_name, quantity, amount_ars, reason, refund_method, notes
  ) VALUES (
    v_order.org_id, auth.uid(), p_order_id, p_product_id, p_variant_id,
    COALESCE(v_nombre, 'Producto'), p_qty, round(v_unit * p_qty),
    p_reason, p_refund_method, p_notes
  )
  RETURNING id INTO v_return_id;

  -- El stock vuelve por la función, nunca escribiendo `products.stock`.
  PERFORM public.record_stock_movement(
    v_order.org_id, p_product_id, p_variant_id,
    COALESCE(v_nombre, 'Producto'), v_var_nombre,
    'return', p_qty,
    'ecommerce_order', p_order_id,
    NULL, v_unit,
    format('Devolución de la orden %s', v_order.order_number),
    auth.uid(), NULL
  );

  RETURN jsonb_build_object(
    'ok', true,
    'return_id', v_return_id,
    'order_number', v_order.order_number,
    'quantity', p_qty,
    'amount', round(v_unit * p_qty),
    'restantes', v_comprados - v_devueltos - p_qty
  );
END;
$$;

REVOKE ALL ON FUNCTION public.return_store_order_item(uuid, uuid, uuid, int, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.return_store_order_item(uuid, uuid, uuid, int, text, text, text) TO authenticated;

COMMENT ON FUNCTION public.return_store_order_item(uuid, uuid, uuid, int, text, text, text) IS
  'Devuelve un producto de una orden online: registra la devolucion y repone el '
  'stock por record_stock_movement. No puede devolver mas de lo comprado ni '
  'tocar una orden impaga. NO ejecuta el reintegro por MercadoPago.';
