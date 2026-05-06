CREATE TABLE public.tiendanube_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE UNIQUE,
  store_id text NOT NULL,
  access_token text NOT NULL,
  store_name text,
  store_url text,
  default_category_id text,
  price_mode text NOT NULL DEFAULT 'sale_price_ars',
  markup_percent numeric NOT NULL DEFAULT 0,
  sync_stock boolean NOT NULL DEFAULT true,
  sync_images boolean NOT NULL DEFAULT true,
  publish_status text NOT NULL DEFAULT 'visible',
  last_sync_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.tiendanube_integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org admins read integration" ON public.tiendanube_integrations
  FOR SELECT TO authenticated
  USING (has_org_role(org_id, auth.uid(), ARRAY['owner','admin']));
CREATE POLICY "Org admins insert integration" ON public.tiendanube_integrations
  FOR INSERT TO authenticated
  WITH CHECK (has_org_role(org_id, auth.uid(), ARRAY['owner','admin']));
CREATE POLICY "Org admins update integration" ON public.tiendanube_integrations
  FOR UPDATE TO authenticated
  USING (has_org_role(org_id, auth.uid(), ARRAY['owner','admin']))
  WITH CHECK (has_org_role(org_id, auth.uid(), ARRAY['owner','admin']));
CREATE POLICY "Org admins delete integration" ON public.tiendanube_integrations
  FOR DELETE TO authenticated
  USING (has_org_role(org_id, auth.uid(), ARRAY['owner','admin']));

CREATE TRIGGER trg_tiendanube_integrations_updated
  BEFORE UPDATE ON public.tiendanube_integrations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS tiendanube_product_id text;
CREATE INDEX IF NOT EXISTS idx_products_tn ON public.products(tiendanube_product_id);

CREATE TABLE public.tiendanube_sync_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  product_name text,
  action text NOT NULL,
  status text NOT NULL,
  tiendanube_product_id text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.tiendanube_sync_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members read sync log" ON public.tiendanube_sync_log
  FOR SELECT TO authenticated
  USING (is_org_member(org_id, auth.uid()));
CREATE POLICY "Org admins insert sync log" ON public.tiendanube_sync_log
  FOR INSERT TO authenticated
  WITH CHECK (has_org_role(org_id, auth.uid(), ARRAY['owner','admin']));

CREATE INDEX idx_tn_log_org_date ON public.tiendanube_sync_log(org_id, created_at DESC);