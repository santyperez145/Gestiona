-- ─────────────────────────────────────────────────────────────────
-- Envíos: zonas, tarifarios y transportistas (Correo Argentino / Andreani)
--
-- Antes la tienda online tenía un único `shipping_cost` plano: el mismo precio
-- para Palermo y para Ushuaia. Eso no sirve para vender en Argentina.
--
-- Modelo:
--   shipping_zones    → agrupan provincias ("AMBA", "Patagonia")
--   shipping_rates    → precio por (zona × transportista × servicio × peso)
--   shipping_carriers → habilitación, credenciales y markup por transportista
--
-- Una tienda puede cotizar de dos maneras, por transportista:
--   mode='table' → usa su propio tarifario (shipping_rates). Funciona sin
--                  credenciales y es lo que arranca por default.
--   mode='api'   → cotiza en vivo contra el transportista y le suma el markup.
-- ─────────────────────────────────────────────────────────────────

-- ── Zonas ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.shipping_zones (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name        text NOT NULL,
  -- Códigos ISO 3166-2:AR ('AR-C' = CABA, 'AR-B' = Buenos Aires, ...)
  provinces   text[] NOT NULL DEFAULT '{}',
  sort_order  int NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, name)
);

-- ── Tarifario ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.shipping_rates (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  zone_id       uuid NOT NULL REFERENCES public.shipping_zones(id) ON DELETE CASCADE,
  carrier       text NOT NULL DEFAULT 'propio'
                CHECK (carrier IN ('correo_argentino','andreani','oca','propio','retiro')),
  -- 'sucursal' = retira en sucursal del correo; 'domicilio' = a domicilio
  service       text NOT NULL DEFAULT 'domicilio'
                CHECK (service IN ('domicilio','sucursal','express','prioritario')),
  min_weight_kg numeric(10,3) NOT NULL DEFAULT 0,
  -- NULL = sin techo (último tramo del tarifario)
  max_weight_kg numeric(10,3),
  price         numeric(12,2) NOT NULL DEFAULT 0,
  -- Se cobra por cada kg (o fracción) por encima de max_weight_kg
  price_per_extra_kg numeric(12,2) NOT NULL DEFAULT 0,
  delivery_days_min  int,
  delivery_days_max  int,
  -- Envío gratis en esta zona a partir de este subtotal (pisa el de la tienda)
  free_above    numeric(14,2),
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (max_weight_kg IS NULL OR max_weight_kg > min_weight_kg)
);

-- ── Transportistas ────────────────────────────────────────────────
-- `credentials` guarda las claves del contrato del comercio con el correo.
-- RLS lo limita a owner/admin de la org: un vendedor no tiene por qué ver el
-- contrato. Las Edge Functions lo leen con service_role.
CREATE TABLE IF NOT EXISTS public.shipping_carriers (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  carrier        text NOT NULL
                 CHECK (carrier IN ('correo_argentino','andreani','oca','propio','retiro')),
  is_enabled     boolean NOT NULL DEFAULT false,
  mode           text NOT NULL DEFAULT 'table' CHECK (mode IN ('table','api')),
  credentials    jsonb NOT NULL DEFAULT '{}',
  -- Markup del comercio sobre la tarifa del correo (packaging, manipuleo)
  markup_pct     numeric(6,2) NOT NULL DEFAULT 0,
  markup_fixed   numeric(12,2) NOT NULL DEFAULT 0,
  -- Origen del despacho: { postal_code, province, city, street }
  default_origin jsonb NOT NULL DEFAULT '{}',
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, carrier)
);

-- ── Config de envío en la tienda ──────────────────────────────────
ALTER TABLE public.ecommerce_stores
  -- 'flat'  → un precio plano (comportamiento anterior, sigue funcionando)
  -- 'zones' → cotiza contra shipping_zones/rates
  -- 'free'  → envío gratis siempre
  ADD COLUMN IF NOT EXISTS shipping_mode text NOT NULL DEFAULT 'flat'
    CHECK (shipping_mode IN ('flat','zones','free')),
  ADD COLUMN IF NOT EXISTS pickup_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pickup_address text,
  ADD COLUMN IF NOT EXISTS pickup_instructions text,
  -- Peso por default cuando un producto no lo declara, para poder cotizar igual
  ADD COLUMN IF NOT EXISTS default_item_weight_kg numeric(10,3) NOT NULL DEFAULT 0.5;

-- ── Peso y dimensiones del producto ───────────────────────────────
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS weight_kg numeric(10,3),
  ADD COLUMN IF NOT EXISTS length_cm numeric(10,2),
  ADD COLUMN IF NOT EXISTS width_cm  numeric(10,2),
  ADD COLUMN IF NOT EXISTS height_cm numeric(10,2);

-- ── Envío elegido en el pedido ────────────────────────────────────
ALTER TABLE public.ecommerce_orders
  ADD COLUMN IF NOT EXISTS shipping_zone_id uuid REFERENCES public.shipping_zones(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS shipping_service text,
  ADD COLUMN IF NOT EXISTS shipping_label text,
  ADD COLUMN IF NOT EXISTS delivery_days_min int,
  ADD COLUMN IF NOT EXISTS delivery_days_max int,
  ADD COLUMN IF NOT EXISTS shipping_quoted_at timestamptz;

-- ── Índices ───────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_ship_zones_org  ON public.shipping_zones(org_id, is_active);
CREATE INDEX IF NOT EXISTS idx_ship_rates_zone ON public.shipping_rates(zone_id, carrier, is_active);
CREATE INDEX IF NOT EXISTS idx_ship_rates_org  ON public.shipping_rates(org_id);
CREATE INDEX IF NOT EXISTS idx_ship_carriers_org ON public.shipping_carriers(org_id, is_enabled);

-- ── RLS ───────────────────────────────────────────────────────────
ALTER TABLE public.shipping_zones    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shipping_rates    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shipping_carriers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_shipping_zones" ON public.shipping_zones;
DROP POLICY IF EXISTS "org_shipping_rates" ON public.shipping_rates;
DROP POLICY IF EXISTS "org_shipping_carriers" ON public.shipping_carriers;

-- Zonas y tarifas: cualquier miembro las lee (el vendedor necesita cotizar),
-- sólo owner/admin las modifica.
CREATE POLICY "org_shipping_zones" ON public.shipping_zones
  USING (org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid()))
  WITH CHECK (org_id IN (
    SELECT org_id FROM public.memberships
    WHERE user_id = auth.uid() AND role IN ('owner','admin')
  ));

CREATE POLICY "org_shipping_rates" ON public.shipping_rates
  USING (org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid()))
  WITH CHECK (org_id IN (
    SELECT org_id FROM public.memberships
    WHERE user_id = auth.uid() AND role IN ('owner','admin')
  ));

-- Credenciales del contrato: sólo owner/admin, ni lectura para el resto.
CREATE POLICY "org_shipping_carriers" ON public.shipping_carriers
  USING (org_id IN (
    SELECT org_id FROM public.memberships
    WHERE user_id = auth.uid() AND role IN ('owner','admin')
  ))
  WITH CHECK (org_id IN (
    SELECT org_id FROM public.memberships
    WHERE user_id = auth.uid() AND role IN ('owner','admin')
  ));

-- ── Presets de zonas para Argentina ───────────────────────────────
-- Arranca una tienda con las 6 zonas que usa el mercado, sin tarifas cargadas
-- (el comercio pone sus precios). Idempotente por (org_id, name).
CREATE OR REPLACE FUNCTION public.seed_default_shipping_zones(p_org_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.shipping_zones (org_id, name, provinces, sort_order) VALUES
    (p_org_id, 'CABA',      ARRAY['AR-C'], 1),
    (p_org_id, 'GBA / Buenos Aires', ARRAY['AR-B'], 2),
    (p_org_id, 'Centro',    ARRAY['AR-S','AR-X','AR-E','AR-P'], 3),
    (p_org_id, 'Cuyo',      ARRAY['AR-M','AR-J','AR-D','AR-L'], 4),
    (p_org_id, 'NOA / NEA', ARRAY['AR-A','AR-T','AR-K','AR-G','AR-Y','AR-W','AR-N','AR-H'], 5),
    (p_org_id, 'Patagonia', ARRAY['AR-Q','AR-R','AR-U','AR-Z','AR-V'], 6)
  ON CONFLICT (org_id, name) DO NOTHING;
END;
$$;

COMMENT ON FUNCTION public.seed_default_shipping_zones IS
  'Crea las 6 zonas estándar de Argentina para una org. Sin tarifas: las carga el comercio.';
