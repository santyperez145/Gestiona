-- ============================================================
-- TIENDANUBE INTEGRATION
-- ============================================================

CREATE TABLE IF NOT EXISTS public.tiendanube_connections (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  store_id        text NOT NULL,
  access_token    text NOT NULL,
  store_name      text,
  store_url       text,
  connected_at    timestamptz NOT NULL DEFAULT now(),
  last_sync_products_at  timestamptz,
  last_sync_orders_at    timestamptz,
  sync_products   boolean NOT NULL DEFAULT true,
  sync_orders     boolean NOT NULL DEFAULT true,
  UNIQUE(org_id, store_id)
);

ALTER TABLE public.tiendanube_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tiendanube_connections_org" ON public.tiendanube_connections
  FOR ALL USING (
    org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid())
  );

-- Track external IDs to avoid duplicate imports
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS tiendanube_id text;
ALTER TABLE public.sales    ADD COLUMN IF NOT EXISTS tiendanube_order_id text;

-- Unique constraint needed for upsert onConflict support
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_tiendanube_unique ON public.products(org_id, tiendanube_id) WHERE tiendanube_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sales_tiendanube ON public.sales(org_id, tiendanube_order_id) WHERE tiendanube_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tiendanube_conn_org ON public.tiendanube_connections(org_id);
