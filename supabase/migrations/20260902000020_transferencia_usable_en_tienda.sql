-- Transferencia usable en la tienda (Commerce-first).
--
-- El default cobra sin Mercado Pago. Si el medio está marcado pero el pedido
-- no expone CBU/alias, el comprador ve «te vamos a escribir» y la primera
-- venta no cierra sola. Los datos ya viven en settings; acá salen al RPC
-- seguro del pedido y el readiness de activación deja de contar
-- «transferencia» como cobro listo sin CBU ni alias.

-- ── Pedido público: datos para transferir ─────────────────────────────────
-- CREATE OR REPLACE no puede cambiar el RETURNS TABLE: hay que dropear.
DROP FUNCTION IF EXISTS public.get_store_order_secure(text, text, text, text);

CREATE FUNCTION public.get_store_order_secure(
  p_slug text,
  p_order_number text,
  p_access_token text DEFAULT NULL,
  p_email text DEFAULT NULL
)
RETURNS TABLE (
  order_number text,
  customer_name text,
  customer_email text,
  items jsonb,
  subtotal numeric,
  shipping_cost numeric,
  total numeric,
  payment_method text,
  payment_status text,
  fulfillment_status text,
  shipping_address jsonb,
  created_at timestamptz,
  access_token text,
  bank_holder text,
  bank_name text,
  bank_cbu text,
  bank_alias text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_email text := lower(btrim(COALESCE(p_email, '')));
BEGIN
  IF v_email <> '' AND NOT public.rate_limit_publico(
    'store_order_access',
    lower(COALESCE(p_slug, '?')) || ':' || COALESCE(p_order_number, '?'),
    8,
    interval '10 minutes'
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    o.order_number,
    o.customer_name,
    o.customer_email,
    o.items,
    o.subtotal,
    o.shipping_cost,
    o.total,
    o.payment_method,
    o.payment_status,
    o.fulfillment_status,
    o.shipping_address,
    o.created_at,
    o.public_access_token::text,
    NULLIF(btrim(COALESCE(st.bank_holder, '')), ''),
    NULLIF(btrim(COALESCE(st.bank_name, '')), ''),
    NULLIF(btrim(COALESCE(st.bank_cbu, '')), ''),
    NULLIF(btrim(COALESCE(st.bank_alias, '')), '')
  FROM public.ecommerce_orders o
  JOIN public.ecommerce_stores s ON s.id = o.store_id
  LEFT JOIN public.settings st ON st.org_id = s.org_id
  WHERE lower(s.slug) = lower(p_slug)
    AND o.order_number = p_order_number
    AND (
      (
        btrim(COALESCE(p_access_token, '')) <> ''
        AND o.public_access_token::text = btrim(p_access_token)
      )
      OR EXISTS (
        SELECT 1
          FROM public.store_customers sc
         WHERE sc.id = o.store_customer_id
           AND sc.user_id = auth.uid()
      )
      OR (
        v_email <> ''
        AND lower(btrim(o.customer_email)) = v_email
      )
    )
  LIMIT 1;
END;
$function$;

COMMENT ON FUNCTION public.get_store_order_secure(text, text, text, text) IS
  'Detalle de un pedido: capacidad opaca, cuenta compradora o numero+email. Incluye CBU/alias de settings para transferencia pendiente.';

REVOKE ALL ON FUNCTION public.get_store_order_secure(text, text, text, text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_store_order_secure(text, text, text, text)
  TO anon, authenticated;

-- ── Activación: transferencia sin CBU no es cobro listo ───────────────────
CREATE OR REPLACE VIEW public.organization_activation_readiness AS
WITH product_signals AS (
  SELECT
    p.org_id,
    COUNT(*) FILTER (
      WHERE p.is_active IS DISTINCT FROM false
        AND COALESCE(p.sale_price_ars, 0) > 0
    ) AS catalog_products_count,
    COUNT(*) FILTER (
      WHERE p.is_active IS DISTINCT FROM false
        AND COALESCE(p.sale_price_ars, 0) > 0
        AND COALESCE(p.stock, 0) > 0
    ) AS sellable_stock_products_count
  FROM public.products p
  GROUP BY p.org_id
), chosen_store AS (
  SELECT DISTINCT ON (s.org_id)
    s.org_id,
    s.id AS store_id,
    s.slug,
    s.is_active,
    s.published_at,
    s.payment_methods,
    s.shipping_mode,
    s.pickup_enabled,
    s.pickup_address
  FROM public.ecommerce_stores s
  ORDER BY s.org_id, s.is_active DESC, s.created_at ASC, s.id ASC
), legal_signals AS (
  SELECT
    p.org_id,
    COUNT(DISTINCT p.slug) FILTER (
      WHERE p.slug IN ('politica-de-privacidad', 'terminos-y-condiciones')
        AND p.status = 'published'
        AND btrim(COALESCE(p.content, '')) <> ''
        AND lower(p.content) NOT LIKE '%completá acá%'
        AND lower(p.content) NOT LIKE '%completa aca%'
        AND lower(p.content) NOT LIKE '%mi tienda online%'
        AND lower(p.content) NOT LIKE '%[completar]%'
        AND lower(p.content) NOT LIKE '%lorem ipsum%'
    ) = 2 AS legal_ready
  FROM public.store_pages p
  GROUP BY p.org_id
), payment_signals AS (
  SELECT
    c.org_id,
    bool_or(
      c.provider = 'mercadopago'
      AND c.access_token IS NOT NULL
      AND (c.expires_at IS NULL OR c.expires_at > now())
    ) AS mercadopago_ready
  FROM public.payment_connections c
  GROUP BY c.org_id
), bank_signals AS (
  SELECT
    st.org_id,
    (
      NULLIF(btrim(COALESCE(st.bank_cbu, '')), '') IS NOT NULL
      OR NULLIF(btrim(COALESCE(st.bank_alias, '')), '') IS NOT NULL
    ) AS bank_transfer_ready
  FROM public.settings st
), shipping_signals AS (
  SELECT
    z.org_id,
    bool_or(z.is_active AND r.id IS NOT NULL) AS has_active_rate
  FROM public.shipping_zones z
  LEFT JOIN public.shipping_rates r
    ON r.zone_id = z.id
   AND r.org_id = z.org_id
   AND r.is_active
  GROUP BY z.org_id
), fiscal_signals AS (
  SELECT
    c.org_id,
    CASE
      WHEN c.cuit IS NULL OR btrim(c.cuit) = '' OR COALESCE(c.punto_venta, 0) <= 0
        THEN 'falta_datos_fiscales'
      WHEN c.modo = 'propio' AND (c.certificate IS NULL OR c.private_key IS NULL)
        THEN 'falta_certificado_propio'
      WHEN c.modo <> 'propio' AND NOT EXISTS (
        SELECT 1
        FROM public.afip_platform_credentials p
        WHERE p.certificate IS NOT NULL AND p.private_key IS NOT NULL
      ) THEN 'falta_plataforma'
      WHEN c.modo <> 'propio' AND NOT COALESCE(c.delegacion_verificada, false)
        THEN 'falta_delegar'
      WHEN c.modo = 'propio' AND NOT EXISTS (
        SELECT 1
        FROM public.invoices i
        WHERE i.org_id = c.org_id
          AND NULLIF(btrim(COALESCE(i.cae, '')), '') IS NOT NULL
      ) THEN 'falta_verificar_ciclo'
      ELSE 'listo'
    END AS fiscal_status
  FROM public.afip_credentials c
), pos_sales AS (
  SELECT
    s.org_id,
    COUNT(*) AS pos_sales_total,
    MIN(s.date) AS first_pos_sale_at
  FROM public.sales s
  WHERE s.source = 'pos'
  GROUP BY s.org_id
), online_sales AS (
  SELECT
    e.org_id,
    COUNT(*) FILTER (
      WHERE e.payment_status IN ('paid', 'partial', 'refunded')
    ) AS online_orders_total,
    MIN(e.created_at) FILTER (
      WHERE e.payment_status IN ('paid', 'partial', 'refunded')
    ) AS first_online_sale_at
  FROM public.ecommerce_orders e
  GROUP BY e.org_id
)
SELECT
  o.id AS org_id,
  o.onboarding_goal,
  (
    btrim(COALESCE(o.name, '')) <> ''
    AND lower(btrim(o.name)) NOT IN ('mi negocio', 'mi negocio workspace')
  ) AS identity_ready,
  COALESCE(ps.catalog_products_count, 0) AS catalog_products_count,
  COALESCE(ps.sellable_stock_products_count, 0) AS sellable_stock_products_count,
  (COALESCE(ps.catalog_products_count, 0) > 0) AS catalog_ready,
  (COALESCE(ps.sellable_stock_products_count, 0) > 0) AS stock_ready,
  (cs.store_id IS NOT NULL) AS store_exists,
  (COALESCE(cs.is_active, false) AND NULLIF(btrim(COALESCE(cs.slug, '')), '') IS NOT NULL) AS online_channel_ready,
  COALESCE(ls.legal_ready, false) AS legal_ready,
  COALESCE(pay.mercadopago_ready, false) AS mercadopago_ready,
  (
    'efectivo' = ANY(COALESCE(cs.payment_methods, ARRAY[]::text[]))
    OR (
      'transferencia' = ANY(COALESCE(cs.payment_methods, ARRAY[]::text[]))
      AND COALESCE(bk.bank_transfer_ready, false)
    )
    OR (
      'mercadopago' = ANY(COALESCE(cs.payment_methods, ARRAY[]::text[]))
      AND COALESCE(pay.mercadopago_ready, false)
    )
  ) AS online_payment_ready,
  (
    (
      COALESCE(cs.pickup_enabled, false)
      AND NULLIF(btrim(COALESCE(cs.pickup_address, '')), '') IS NOT NULL
    )
    OR COALESCE(cs.shipping_mode, 'flat') <> 'zones'
    OR COALESCE(ship.has_active_rate, false)
  ) AS online_shipping_ready,
  COALESCE(fs.fiscal_status, 'falta_datos_fiscales') AS fiscal_status,
  (COALESCE(fs.fiscal_status, 'falta_datos_fiscales') = 'listo') AS fiscal_ready,
  COALESCE(pos.pos_sales_total, 0) AS pos_sales_total,
  pos.first_pos_sale_at,
  COALESCE(online.online_orders_total, 0) AS online_orders_total,
  online.first_online_sale_at,
  cs.published_at AS store_published_at
FROM public.organizations o
LEFT JOIN product_signals ps ON ps.org_id = o.id
LEFT JOIN chosen_store cs ON cs.org_id = o.id
LEFT JOIN legal_signals ls ON ls.org_id = o.id
LEFT JOIN payment_signals pay ON pay.org_id = o.id
LEFT JOIN bank_signals bk ON bk.org_id = o.id
LEFT JOIN shipping_signals ship ON ship.org_id = o.id
LEFT JOIN fiscal_signals fs ON fs.org_id = o.id
LEFT JOIN pos_sales pos ON pos.org_id = o.id
LEFT JOIN online_sales online ON online.org_id = o.id
WHERE public.is_org_member(o.id, auth.uid())
   OR public.is_platform_admin(auth.uid());

ALTER VIEW public.organization_activation_readiness SET (security_invoker = false);
REVOKE ALL ON public.organization_activation_readiness FROM PUBLIC, anon;
GRANT SELECT ON public.organization_activation_readiness TO authenticated;

COMMENT ON VIEW public.organization_activation_readiness IS
  'Hitos hacia la primera venta. Transferencia exige CBU/alias; retiro exige dirección. Nunca credenciales ni importes.';

DO $verify$
BEGIN
  IF NOT has_function_privilege(
    'anon',
    'public.get_store_order_secure(text,text,text,text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'anon no puede usar get_store_order_secure';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'get_store_order_secure'
      AND pg_get_function_result(p.oid) ILIKE '%bank_cbu%'
  ) THEN
    RAISE EXCEPTION 'get_store_order_secure no expone bank_cbu';
  END IF;
END;
$verify$;
