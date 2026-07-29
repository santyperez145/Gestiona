-- Integración con MercadoLibre: conexión OAuth y publicaciones.
--
-- Diseño de seguridad: los tokens NUNCA llegan al navegador. `meli_connections`
-- tiene RLS habilitada y ninguna policy — igual que `afip_padron_cache` — así
-- que solo las Edge Functions (service_role) los leen. La UI consulta la vista
-- `meli_connection_status`, que expone si está conectado, con qué cuenta y
-- hasta cuándo vale el token, pero nunca el token en sí.
--
-- Idempotente.

-- ── Conexión OAuth por organización ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.meli_connections (
  org_id            uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  meli_user_id      bigint,
  nickname          text,
  site_id           text NOT NULL DEFAULT 'MLA',   -- MLA = Argentina
  access_token      text,
  refresh_token     text,
  expires_at        timestamptz,
  scopes            text,
  connected_at      timestamptz NOT NULL DEFAULT now(),
  last_error        text,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.meli_connections ENABLE ROW LEVEL SECURITY;
-- Sin policies a propósito: ver el comentario de arriba.

COMMENT ON TABLE public.meli_connections IS
  'Tokens OAuth de MercadoLibre. RLS sin policies a propósito: solo service_role desde Edge Functions. La UI usa la vista meli_connection_status. NO agregar policies para authenticated: expondría los tokens al navegador.';

-- ── Estado visible para la UI, sin tokens ─────────────────────────────────
CREATE OR REPLACE VIEW public.meli_connection_status
WITH (security_invoker = true) AS
SELECT
  c.org_id,
  c.nickname,
  c.site_id,
  c.meli_user_id,
  c.connected_at,
  c.last_error,
  (c.access_token IS NOT NULL)          AS conectado,
  (c.expires_at > now())                AS token_vigente,
  c.expires_at
FROM public.meli_connections c
WHERE public.is_org_member(c.org_id, auth.uid());

GRANT SELECT ON public.meli_connection_status TO authenticated;

-- ── Publicaciones: producto local ↔ ítem de MercadoLibre ──────────────────
CREATE TABLE IF NOT EXISTS public.meli_listings (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  product_id     uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  meli_item_id   text NOT NULL,
  permalink      text,
  status         text NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active','paused','closed','under_review')),
  listing_type   text,
  last_synced_at timestamptz,
  last_error     text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, product_id),
  UNIQUE (meli_item_id)
);

CREATE INDEX IF NOT EXISTS meli_listings_org_idx ON public.meli_listings(org_id, created_at DESC);

ALTER TABLE public.meli_listings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "meli_listings_select" ON public.meli_listings;
CREATE POLICY "meli_listings_select" ON public.meli_listings
  FOR SELECT USING (public.is_org_member(org_id, auth.uid()));

DROP POLICY IF EXISTS "meli_listings_write" ON public.meli_listings;
CREATE POLICY "meli_listings_write" ON public.meli_listings
  FOR ALL USING (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin']))
  WITH CHECK (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin']));

-- ── Órdenes bajadas de MercadoLibre ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.meli_orders (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  meli_order_id  bigint NOT NULL,
  status         text,
  buyer_nickname text,
  total_ars      numeric,
  items          jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Venta creada en Gestiona a partir de esta orden, si ya se importó.
  sale_id        uuid,
  date_created   timestamptz,
  imported_at    timestamptz,
  raw            jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, meli_order_id)
);

CREATE INDEX IF NOT EXISTS meli_orders_org_idx ON public.meli_orders(org_id, date_created DESC);

ALTER TABLE public.meli_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "meli_orders_select" ON public.meli_orders;
CREATE POLICY "meli_orders_select" ON public.meli_orders
  FOR SELECT USING (public.is_org_member(org_id, auth.uid()));

DROP POLICY IF EXISTS "meli_orders_write" ON public.meli_orders;
CREATE POLICY "meli_orders_write" ON public.meli_orders
  FOR ALL USING (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin']))
  WITH CHECK (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin']));
