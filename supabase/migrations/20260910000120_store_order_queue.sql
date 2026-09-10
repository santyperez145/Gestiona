-- C23: filter the complete store history before paging; never expose tokens.
BEGIN;

CREATE INDEX IF NOT EXISTS ecommerce_orders_store_queue_idx
  ON public.ecommerce_orders (org_id, store_id, created_at DESC, id DESC);

CREATE OR REPLACE FUNCTION public.store_order_queue(
  p_org_id uuid,
  p_store_id uuid,
  p_query text DEFAULT '',
  p_view text DEFAULT 'todas',
  p_sort text DEFAULT 'recientes',
  p_medio text DEFAULT 'todos',
  p_page integer DEFAULT 1,
  p_amount numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_query text := lower(regexp_replace(normalize(btrim(coalesce(p_query, '')), NFD), U&'[\0300-\036f]', '', 'g'));
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR p_org_id IS NULL
    OR NOT EXISTS (SELECT 1 FROM public.memberships WHERE org_id = p_org_id AND user_id = auth.uid())
    OR NOT coalesce(public.has_permission(p_org_id, 'ecommerce', 'view'), false)
  THEN
    RAISE EXCEPTION 'No autorizado para consultar pedidos' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ecommerce_stores WHERE id = p_store_id AND org_id = p_org_id) THEN
    RAISE EXCEPTION 'Tienda no disponible' USING ERRCODE = '42501';
  END IF;
  IF char_length(coalesce(p_query, '')) > 200
    OR p_view IS NULL OR p_view NOT IN ('todas', 'retirar', 'despachar', 'atrasados', 'pago', 'enviadas', 'entregadas', 'canceladas')
    OR p_sort IS NULL OR p_sort NOT IN ('recientes', 'antiguos', 'mayor', 'menor')
    OR p_medio IS NULL OR p_medio NOT IN ('todos', 'transferencia', 'efectivo', 'digital')
    OR p_page IS NULL OR p_page < 1
  THEN
    RAISE EXCEPTION 'Filtros invalidos' USING ERRCODE = '22023';
  END IF;

  WITH scoped AS MATERIALIZED (
    SELECT o.id, o.created_at, o.total, o.fulfillment_status,
      o.payment_status IN ('pending', 'failed') AS unpaid,
      o.payment_status = 'paid' AND o.fulfillment_status IN ('pending', 'unfulfilled', 'processing') AS awaiting,
      lower(btrim(coalesce(o.carrier, ''))) = 'retiro'
        OR lower(btrim(coalesce(o.shipping_service, ''))) = 'sucursal' AS pickup,
      (p_medio = 'todos'
        OR (p_medio = 'digital' AND lower(btrim(o.payment_method)) IN ('gestiona_pay', 'mercadopago'))
        OR (p_medio IN ('transferencia', 'efectivo') AND lower(btrim(o.payment_method)) = p_medio))
      AND (v_query = '' OR (p_amount IS NOT NULL AND abs(o.total - p_amount) < 0.005)
        OR EXISTS (
          SELECT 1 FROM unnest(ARRAY[o.order_number, o.customer_name, o.customer_email, o.customer_phone, o.tracking_number]) field
          WHERE strpos(lower(regexp_replace(normalize(coalesce(field, ''), NFD), U&'[\0300-\036f]', '', 'g')), v_query) > 0
        )) AS matches
    FROM public.ecommerce_orders o
    WHERE o.org_id = p_org_id AND o.store_id = p_store_id
  ), classified AS MATERIALIZED (
    SELECT *, ARRAY['todas']::text[]
      || CASE WHEN awaiting AND pickup THEN ARRAY['retirar'] ELSE '{}'::text[] END
      || CASE WHEN awaiting AND NOT pickup THEN ARRAY['despachar'] ELSE '{}'::text[] END
      || CASE WHEN awaiting AND created_at < now() - interval '24 hours' THEN ARRAY['atrasados'] ELSE '{}'::text[] END
      || CASE WHEN unpaid THEN ARRAY['pago'] ELSE '{}'::text[] END
      || CASE fulfillment_status WHEN 'shipped' THEN ARRAY['enviadas'] WHEN 'delivered' THEN ARRAY['entregadas']
           WHEN 'cancelled' THEN ARRAY['canceladas'] ELSE '{}'::text[] END AS views
    FROM scoped WHERE matches
  ), filtered AS MATERIALIZED (
    SELECT * FROM classified WHERE p_view = ANY(views)
  ), totals AS (
    SELECT count(*) AS total, least(p_page::bigint, greatest(1, (count(*) + 49) / 50)) AS page FROM filtered
  ), paged AS (
    SELECT f.id, row_number() OVER (ORDER BY
      CASE WHEN p_sort = 'mayor' AND p_view <> 'atrasados' THEN f.total END DESC,
      CASE WHEN p_sort = 'menor' AND p_view <> 'atrasados' THEN f.total END ASC,
      CASE WHEN p_sort = 'antiguos' OR p_view = 'atrasados' THEN f.created_at END ASC,
      f.created_at DESC, f.id DESC) AS position
    FROM filtered f
    ORDER BY position
    LIMIT 50 OFFSET (SELECT (page - 1) * 50 FROM totals)
  ), rows AS (
    SELECT p.position, jsonb_build_object(
      'id', o.id, 'order_number', o.order_number, 'customer_name', o.customer_name,
      'customer_email', o.customer_email, 'customer_phone', o.customer_phone,
      'total', o.total, 'subtotal', o.subtotal, 'shipping_cost', o.shipping_cost,
      'discount_amount', o.discount_amount, 'coupon_code', o.coupon_code,
      'coupon_discount_ars', o.coupon_discount_ars, 'tax_amount', o.tax_amount,
      'payment_status', o.payment_status, 'payment_method', o.payment_method,
      'fulfillment_status', o.fulfillment_status, 'tracking_number', o.tracking_number,
      'shipping_address', o.shipping_address, 'items', o.items, 'notes', o.notes,
      'shipped_at', o.shipped_at, 'delivered_at', o.delivered_at, 'created_at', o.created_at,
      'carrier', o.carrier, 'shipping_service', o.shipping_service
    ) AS value
    FROM paged p JOIN public.ecommerce_orders o ON o.id = p.id
      AND o.org_id = p_org_id AND o.store_id = p_store_id
  )
  SELECT jsonb_build_object(
    'rows', coalesce((SELECT jsonb_agg(value ORDER BY position) FROM rows), '[]'::jsonb),
    'total', totals.total, 'page', totals.page, 'page_size', 50,
    'store_total', (SELECT count(*) FROM scoped),
    'attention', (SELECT count(*) FROM scoped WHERE awaiting OR unpaid),
    'counts', (SELECT jsonb_object_agg(view, (SELECT count(*) FROM classified WHERE view = ANY(views)))
      FROM unnest(ARRAY['todas', 'retirar', 'despachar', 'atrasados', 'pago', 'enviadas', 'entregadas', 'canceladas']) view)
  ) INTO v_result FROM totals;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.store_order_queue(uuid, uuid, text, text, text, text, integer, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.store_order_queue(uuid, uuid, text, text, text, text, integer, numeric) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
