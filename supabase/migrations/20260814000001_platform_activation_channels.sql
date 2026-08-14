-- Instrumentacion de publicacion y adopcion por canal para la plataforma.
--
-- `is_active` describe el estado actual, pero no conserva cuando una tienda se
-- publico. La fecha queda nullable para no inventar historia: las tiendas
-- activas existentes se vuelven medibles cuando se publique de nuevo.

ALTER TABLE public.ecommerce_stores
  ADD COLUMN IF NOT EXISTS published_at timestamptz;

CREATE OR REPLACE FUNCTION public.capture_ecommerce_store_publication()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.is_active AND NEW.published_at IS NULL THEN
      NEW.published_at := now();
    END IF;
  ELSIF NOT OLD.is_active AND NEW.is_active AND NEW.published_at IS NULL THEN
    NEW.published_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ecommerce_store_publication ON public.ecommerce_stores;
CREATE TRIGGER trg_ecommerce_store_publication
  BEFORE INSERT OR UPDATE OF is_active ON public.ecommerce_stores
  FOR EACH ROW
  EXECUTE FUNCTION public.capture_ecommerce_store_publication();

CREATE INDEX IF NOT EXISTS ecommerce_orders_activation_idx
  ON public.ecommerce_orders(org_id, created_at)
  WHERE payment_status IN ('paid', 'partial', 'refunded');

CREATE INDEX IF NOT EXISTS sales_pos_activation_idx
  ON public.sales(org_id, date)
  WHERE source = 'pos';

-- Vista protegida: el staff de plataforma ve adopcion agregada sin acceder a
-- tablas crudas con RLS de organizacion. No expone clientes ni credenciales.
CREATE OR REPLACE VIEW public.platform_org_activation AS
WITH online AS (
  SELECT
    org_id,
    MIN(created_at) FILTER (
      WHERE payment_status IN ('paid', 'partial', 'refunded')
    ) AS first_online_order_at,
    COUNT(*) FILTER (
      WHERE payment_status IN ('paid', 'partial', 'refunded')
    ) AS online_orders_total,
    COUNT(*) FILTER (
      WHERE payment_status IN ('paid', 'partial', 'refunded')
        AND created_at >= now() - interval '30 days'
    ) AS online_orders_30d
  FROM public.ecommerce_orders
  GROUP BY org_id
), pos AS (
  SELECT
    org_id,
    MIN(date) AS first_pos_sale_at,
    COUNT(*) AS pos_sales_total,
    COUNT(*) FILTER (WHERE date >= now() - interval '30 days') AS pos_sales_30d
  FROM public.sales
  WHERE source = 'pos'
  GROUP BY org_id
)
SELECT
  o.id AS org_id,
  o.name AS org_name,
  o.slug,
  o.created_at AS org_creada,
  s.id AS store_id,
  s.slug AS store_slug,
  s.is_active AS store_is_active,
  s.published_at AS store_published_at,
  (s.published_at IS NOT NULL) AS store_publication_known,
  online.first_online_order_at,
  COALESCE(online.online_orders_total, 0) AS online_orders_total,
  COALESCE(online.online_orders_30d, 0) AS online_orders_30d,
  pos.first_pos_sale_at,
  COALESCE(pos.pos_sales_total, 0) AS pos_sales_total,
  COALESCE(pos.pos_sales_30d, 0) AS pos_sales_30d,
  (online.first_online_order_at IS NOT NULL) AS uses_online,
  (pos.first_pos_sale_at IS NOT NULL) AS uses_pos,
  (online.first_online_order_at IS NOT NULL AND pos.first_pos_sale_at IS NOT NULL) AS is_omnichannel,
  CASE
    WHEN s.published_at IS NOT NULL
    THEN ROUND(EXTRACT(epoch FROM s.published_at - o.created_at) / 86400.0, 1)
  END AS days_to_store_publish,
  CASE
    WHEN online.first_online_order_at IS NOT NULL
    THEN ROUND(EXTRACT(epoch FROM online.first_online_order_at - o.created_at) / 86400.0, 1)
  END AS days_to_first_online_order
FROM public.organizations o
LEFT JOIN public.ecommerce_stores s ON s.org_id = o.id
LEFT JOIN online ON online.org_id = o.id
LEFT JOIN pos ON pos.org_id = o.id
WHERE public.is_platform_admin(auth.uid());

REVOKE ALL ON public.platform_org_activation FROM PUBLIC;
GRANT SELECT ON public.platform_org_activation TO authenticated;

COMMENT ON VIEW public.platform_org_activation IS
  'Adopcion por canal para plataforma: publicacion instrumentada, primera orden online, '
  'ventas POS y uso omnicanal. Las fechas historicas sin evento quedan NULL.';
