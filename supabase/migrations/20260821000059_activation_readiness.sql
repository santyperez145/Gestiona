-- Ruta universal a la primera venta.
--
-- `onboarding_completed` sólo prueba que alguien terminó un formulario. No
-- dice si el negocio tiene catálogo, stock, canal, cobro, entrega, situación
-- fiscal ni una venta. Esta migración guarda el canal que el comercio quiere
-- activar primero y expone una única lectura segura para el propio comercio y
-- para Merchant 360. La vista devuelve conteos, booleanos y estados de acción;
-- nunca credenciales, CUIT, clientes, precios ni facturación.

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS onboarding_goal text;

UPDATE public.organizations o
SET onboarding_goal = CASE
  WHEN EXISTS (
    SELECT 1 FROM public.ecommerce_stores s WHERE s.org_id = o.id
  ) THEN 'online'
  WHEN EXISTS (
    SELECT 1 FROM public.sales v WHERE v.org_id = o.id AND v.source = 'pos'
  ) THEN 'pos'
  ELSE 'pos'
END
WHERE o.onboarding_goal IS NULL
   OR o.onboarding_goal NOT IN ('pos', 'online', 'explore');

ALTER TABLE public.organizations
  ALTER COLUMN onboarding_goal SET DEFAULT 'pos',
  ALTER COLUMN onboarding_goal SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.organizations'::regclass
      AND conname = 'organizations_onboarding_goal_check'
  ) THEN
    ALTER TABLE public.organizations
      ADD CONSTRAINT organizations_onboarding_goal_check
      CHECK (onboarding_goal IN ('pos', 'online', 'explore'));
  END IF;
END;
$$;

COMMENT ON COLUMN public.organizations.onboarding_goal IS
  'Primer canal que el comercio quiere llevar a una venta real: pos, online o explore si todavía no eligió.';

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
    s.pickup_enabled
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
    COALESCE(cs.payment_methods, ARRAY[]::text[]) && ARRAY['efectivo', 'transferencia']::text[]
    OR (
      'mercadopago' = ANY(COALESCE(cs.payment_methods, ARRAY[]::text[]))
      AND COALESCE(pay.mercadopago_ready, false)
    )
  ) AS online_payment_ready,
  (
    COALESCE(cs.pickup_enabled, false)
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
LEFT JOIN shipping_signals ship ON ship.org_id = o.id
LEFT JOIN fiscal_signals fs ON fs.org_id = o.id
LEFT JOIN pos_sales pos ON pos.org_id = o.id
LEFT JOIN online_sales online ON online.org_id = o.id
WHERE public.is_org_member(o.id, auth.uid())
   OR public.is_platform_admin(auth.uid());

-- Las tablas de credenciales mantienen RLS sin policies. La vista corre como
-- su dueño y vuelve a imponer el acceso por membresía o staff de plataforma.
ALTER VIEW public.organization_activation_readiness SET (security_invoker = false);
REVOKE ALL ON public.organization_activation_readiness FROM PUBLIC, anon;
GRANT SELECT ON public.organization_activation_readiness TO authenticated;

COMMENT ON VIEW public.organization_activation_readiness IS
  'Hitos seguros y universales hacia la primera venta para el comercio y Merchant 360. Expone sólo conteos, booleanos, fechas de activación y estados accionables; nunca credenciales, CUIT, clientes ni importes.';

DO $$
DECLARE
  v_secret_columns integer;
BEGIN
  SELECT count(*) INTO v_secret_columns
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'organization_activation_readiness'
    AND column_name IN (
      'access_token', 'refresh_token', 'api_key', 'private_key', 'certificate',
      'cuit', 'email', 'customer_name', 'customer_phone', 'customer_address'
    );

  IF v_secret_columns <> 0 THEN
    RAISE EXCEPTION 'La vista de activación expone % columnas sensibles', v_secret_columns;
  END IF;

  IF has_table_privilege('anon', 'public.organization_activation_readiness', 'SELECT') THEN
    RAISE EXCEPTION 'La activación por comercio quedó visible para anon';
  END IF;

  IF NOT has_table_privilege('authenticated', 'public.organization_activation_readiness', 'SELECT') THEN
    RAISE EXCEPTION 'Los usuarios autenticados no pueden leer su ruta de activación';
  END IF;
END;
$$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260821000059', 'activation_readiness') ON CONFLICT DO NOTHING;
