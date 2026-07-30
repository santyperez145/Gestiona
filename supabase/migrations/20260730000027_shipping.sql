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

-- ═══════════════════════════════════════════════════════════════════════════
-- ⚠️ COLISIÓN CON `20260523000075_logistics.sql`
--
-- Esa migración de mayo ya creó `shipping_zones` y `shipping_rates` para una
-- feature de logística que nunca se conectó a ninguna pantalla (`carriers` y
-- `shipments`, del mismo archivo, siguen sin un solo uso en el código).
--
-- `shipping_zones` quedó compatible de casualidad: ya tiene `provinces`.
-- `shipping_rates` NO: usa `carrier_id` (FK a `carriers`) donde este modelo usa
-- `carrier` (texto), y `base_cost`/`cost_per_kg`/`estimated_days` donde usa
-- `price`/`price_per_extra_kg`/`delivery_days_*`.
--
-- Como `CREATE TABLE IF NOT EXISTS` no hace nada si la tabla existe, la primera
-- versión de esta migración se aplicaba en silencio y después fallaba al crear
-- el índice: `column "carrier" does not exist`.
--
-- Esta sección reconcilia el esquema antes de seguir. Si la tabla vieja está
-- vacía se rehace con la forma nueva; si tiene datos NO se toca el contenido:
-- se le agregan las columnas y se relaja lo que impide insertar. Nunca se borra
-- información.
-- ═══════════════════════════════════════════════════════════════════════════

DO $reconciliar$
DECLARE
  v_es_vieja boolean;
  v_filas    bigint;
BEGIN
  -- ¿Existe `shipping_rates` con la forma vieja (carrier_id y sin carrier)?
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='shipping_rates' AND column_name='carrier_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='shipping_rates' AND column_name='carrier'
  ) INTO v_es_vieja;

  IF NOT v_es_vieja THEN
    RETURN;  -- o no existe, o ya está en la forma nueva
  END IF;

  EXECUTE 'SELECT count(*) FROM public.shipping_rates' INTO v_filas;

  IF v_filas = 0 THEN
    -- Vacía y sin uso: se rehace limpia en vez de arrastrar columnas muertas.
    RAISE NOTICE 'shipping_rates estaba en la forma vieja de logistics y vacía: se recrea.';

    -- `calculate_shipping_cost()` lee base_cost/cost_per_kg/carrier_id de la
    -- forma vieja: al recrear la tabla quedaría roto en silencio. Está sin uso
    -- en todo el código (igual que `carriers` y `shipments`, del mismo archivo),
    -- y el modelo de cotización que sí se usa es `quote_store_shipping()`.
    DROP FUNCTION IF EXISTS public.calculate_shipping_cost(uuid, uuid, uuid, numeric, numeric);
    DROP FUNCTION IF EXISTS public.calculate_shipping_cost(uuid, uuid, uuid, numeric);

    DROP TABLE public.shipping_rates;
  ELSE
    -- Con datos: se conserva todo y se adapta. Quedan columnas legacy sin uso,
    -- que es mucho mejor que perder tarifas cargadas.
    RAISE NOTICE 'shipping_rates tiene % filas: se adapta sin borrar nada.', v_filas;
    ALTER TABLE public.shipping_rates
      ADD COLUMN IF NOT EXISTS carrier text NOT NULL DEFAULT 'propio',
      ADD COLUMN IF NOT EXISTS service text NOT NULL DEFAULT 'domicilio',
      ADD COLUMN IF NOT EXISTS price numeric(12,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS price_per_extra_kg numeric(12,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS delivery_days_min int,
      ADD COLUMN IF NOT EXISTS delivery_days_max int;

    -- El modelo nuevo no usa `carrier_id`, así que no puede seguir siendo
    -- obligatorio o ningún insert nuevo entraría.
    BEGIN
      ALTER TABLE public.shipping_rates ALTER COLUMN carrier_id DROP NOT NULL;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    -- Traducción de los valores que ya estaban cargados
    UPDATE public.shipping_rates
       SET price              = COALESCE(NULLIF(price, 0), base_cost, 0),
           price_per_extra_kg = COALESCE(NULLIF(price_per_extra_kg, 0), cost_per_kg, 0),
           delivery_days_max  = COALESCE(delivery_days_max, estimated_days)
     WHERE price = 0;
  END IF;
END
$reconciliar$;

-- `shipping_zones` de logistics ya trae `provinces`, así que sólo faltan las
-- columnas nuevas. La UNIQUE va aparte: `seed_default_shipping_zones()` la
-- necesita para su ON CONFLICT.
ALTER TABLE IF EXISTS public.shipping_zones
  ADD COLUMN IF NOT EXISTS sort_order int NOT NULL DEFAULT 0;

DO $uniq$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='shipping_zones'
  ) THEN
    RETURN;  -- la crea el CREATE TABLE de abajo, con la UNIQUE incluida
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'shipping_zones_org_id_name_key'
  ) THEN
    RETURN;
  END IF;

  -- Sólo se puede agregar si no hay nombres repetidos por organización
  IF EXISTS (
    SELECT 1 FROM public.shipping_zones GROUP BY org_id, name HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Hay zonas de envío con el mismo nombre en una organización. Renombralas y volvé a correr esto.';
  END IF;

  ALTER TABLE public.shipping_zones
    ADD CONSTRAINT shipping_zones_org_id_name_key UNIQUE (org_id, name);
END
$uniq$;

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

-- Las políticas de `20260523000075_logistics.sql` sobre estas tablas siguen
-- vivas si la tabla no se recreó. Las políticas son ADITIVAS (se evalúan con
-- OR), así que la vieja `org_zones` — que da acceso total a cualquier miembro —
-- dejaría a un vendedor editar zonas y tarifas por más que la nueva restrinja
-- la escritura a owner/admin.
DROP POLICY IF EXISTS "org_zones" ON public.shipping_zones;
DROP POLICY IF EXISTS "org_rates" ON public.shipping_rates;

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
