-- ============================================================================
-- BUNDLE DE MIGRACIONES PENDIENTES  ·  generado el 2026-07-31
--
-- Las 5 migraciones pendientes, en orden de dependencias, en UNA transaccion.
-- Si algo falla, no queda nada aplicado a medias: se revierte todo.
--
-- Correr 00_diagnostico.sql ANTES. Todas las sentencias son idempotentes,
-- asi que volver a correr esto no rompe nada.
--
-- NO incluye 20260723000003_drop_orphaned_feature_tables.sql, que DROPEA ~75
-- tablas. Eso es destructivo e irreversible: va aparte y con backup.
-- ============================================================================

BEGIN;

-- ############################################################################
-- ## 20260730000026_platform_roles.sql
-- ############################################################################

-- ─────────────────────────────────────────────────────────────────
-- Separación de superficies: admin DE LA PLATAFORMA vs admin DE LA ORG
--
-- Hasta ahora `platform_admins` era un booleano: o tenías todo el poder
-- sobre toda la plataforma, o nada. Y peor: el front trataba a un
-- platform_admin como si fuera admin de la organización activa, mezclando
-- las dos superficies.
--
-- Esta migración:
--   1. Le da NIVELES al staff de plataforma (superadmin / support / finance).
--   2. Expone `platform_role()` para que RLS y Edge Functions decidan por nivel.
--   3. Amplía los módulos de permisos por rol de organización con los
--      dominios nuevos (ecommerce, envíos, cobros).
-- ─────────────────────────────────────────────────────────────────

-- ── 1. Niveles de staff de plataforma ────────────────────────────
ALTER TABLE public.platform_admins
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'superadmin',
  ADD COLUMN IF NOT EXISTS notes text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'platform_admins_role_check'
  ) THEN
    ALTER TABLE public.platform_admins
      ADD CONSTRAINT platform_admins_role_check
      CHECK (role IN ('superadmin', 'support', 'finance'));
  END IF;
END $$;

COMMENT ON COLUMN public.platform_admins.role IS
  'superadmin: todo. support: ver orgs/usuarios y asistir, sin tocar planes ni borrar. finance: planes, comisiones y facturación.';

-- ── 2. Nivel de plataforma consultable desde RLS / Edge Functions ─
CREATE OR REPLACE FUNCTION public.platform_role(_user_id uuid DEFAULT auth.uid())
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM public.platform_admins WHERE user_id = _user_id
$$;

-- True si el usuario es staff de plataforma con al menos uno de los roles dados.
-- `superadmin` satisface cualquier requerimiento.
CREATE OR REPLACE FUNCTION public.has_platform_role(_roles text[], _user_id uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.platform_admins
    WHERE user_id = _user_id
      AND (role = 'superadmin' OR role = ANY(_roles))
  )
$$;

-- ── 3. Módulos nuevos en la matriz de permisos por rol de org ─────
-- `seed_default_permissions` se ejecuta al crear una org (trigger de
-- 20260529000007). Se agregan los dominios que aparecieron después:
-- ecommerce, envíos, cobros/comisiones e influencers.
CREATE OR REPLACE FUNCTION public.seed_default_permissions(p_org_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  modules text[] := ARRAY[
    'sales','pos','products','customers','crm','reports',
    'expenses','purchases','invoices','inventory','analytics',
    'marketing','support','settings','team','finance',
    'ecommerce','shipping','payments','influencers'
  ];
  m text;
BEGIN
  FOREACH m IN ARRAY modules LOOP
    -- Admin: todo habilitado
    INSERT INTO public.role_permissions(org_id, role, module, can_view, can_create, can_edit, can_delete, can_export)
    VALUES (p_org_id, 'admin', m, true, true, true, true, true)
    ON CONFLICT (org_id, role, module) DO NOTHING;

    -- Vendedor: opera venta y atención; no configura ni borra.
    -- Ve pedidos del ecommerce y despachos (los tiene que preparar),
    -- pero no toca la config de la tienda, envíos ni cobros.
    INSERT INTO public.role_permissions(org_id, role, module, can_view, can_create, can_edit, can_delete, can_export)
    VALUES (p_org_id, 'vendedor', m,
      m NOT IN ('finance','payments','settings','team'),
      m IN ('sales','pos','customers','crm','support'),
      m IN ('sales','pos','customers','ecommerce'),
      false,
      m IN ('sales','customers')
    )
    ON CONFLICT (org_id, role, module) DO NOTHING;

    -- Viewer: solo lectura, sin plata ni configuración
    INSERT INTO public.role_permissions(org_id, role, module, can_view, can_create, can_edit, can_delete, can_export)
    VALUES (p_org_id, 'viewer', m,
      m NOT IN ('settings','team','finance','payments'),
      false,
      false,
      false,
      m IN ('reports','analytics')
    )
    ON CONFLICT (org_id, role, module) DO NOTHING;
  END LOOP;
END;
$$;

-- Backfill: las orgs existentes se quedaron sin filas para los módulos nuevos.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.organizations LOOP
    PERFORM public.seed_default_permissions(r.id);
  END LOOP;
END $$;


-- ############################################################################
-- ## 20260730000027_shipping.sql
-- ############################################################################

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


-- ############################################################################
-- ## 20260730000028_payment_commissions.sql
-- ############################################################################

-- ─────────────────────────────────────────────────────────────────
-- Comisiones de cobro: aranceles del medio de pago + comisión de plataforma
--
-- Cuando una tienda cobra $10.000 con MercadoPago no le entran $10.000: el
-- procesador se lleva su arancel + IVA, y la plataforma su comisión. Hasta
-- ahora nada de eso se registraba, así que ni la tienda sabía cuánto le queda
-- ni la plataforma cuánto factura.
--
--   payment_provider_fees      → aranceles del procesador (nivel plataforma)
--   platform_commission_rules  → cuánto cobra la plataforma (nuestro revenue)
--   payment_transactions       → cada cobro real con el desglose completo
-- ─────────────────────────────────────────────────────────────────

-- ── Aranceles del procesador ──────────────────────────────────────
-- Es config de PLATAFORMA, no de cada tienda: el arancel lo fija el procesador.
-- Los edita el staff con nivel `finance` cuando MercadoPago actualiza precios.
CREATE TABLE IF NOT EXISTS public.payment_provider_fees (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider      text NOT NULL
                CHECK (provider IN ('mercadopago','stripe','modo','transferencia','efectivo','otro')),
  -- 'default' matchea cualquier medio: sirve de fallback
  method        text NOT NULL DEFAULT 'default'
                CHECK (method IN ('default','credit','debit','cash','transfer','wallet')),
  -- 0 = contado / no aplica
  installments  int NOT NULL DEFAULT 0,
  percent_fee   numeric(6,3) NOT NULL DEFAULT 0,
  fixed_fee     numeric(12,2) NOT NULL DEFAULT 0,
  -- El arancel lleva IVA. Se guarda aparte porque para un responsable
  -- inscripto es crédito fiscal, no costo.
  iva_on_fee_pct numeric(6,3) NOT NULL DEFAULT 21,
  /* Días hasta la acreditación del dinero */
  release_days  int NOT NULL DEFAULT 0,
  currency      text NOT NULL DEFAULT 'ARS',
  effective_from date NOT NULL DEFAULT CURRENT_DATE,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, method, installments, currency, effective_from)
);

COMMENT ON TABLE public.payment_provider_fees IS
  'Aranceles publicados por cada procesador. Config de plataforma, editable por staff finance.';

-- ── Comisión de la plataforma ─────────────────────────────────────
-- Resolución de más específico a más general: org > plan > default.
CREATE TABLE IF NOT EXISTS public.platform_commission_rules (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL = aplica a cualquier plan
  plan_id      uuid REFERENCES public.plans(id) ON DELETE CASCADE,
  -- NULL = aplica a toda org del plan. Con valor, es un acuerdo puntual.
  org_id       uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  percent      numeric(6,3) NOT NULL DEFAULT 0,
  fixed        numeric(12,2) NOT NULL DEFAULT 0,
  -- Tope por transacción: sin esto, un ticket de $2.000.000 paga una comisión
  -- absurda y el comercio se va de la plataforma.
  max_per_transaction numeric(12,2),
  min_per_transaction numeric(12,2) NOT NULL DEFAULT 0,
  applies_to   text NOT NULL DEFAULT 'online'
               CHECK (applies_to IN ('online','pos','all')),
  is_active    boolean NOT NULL DEFAULT true,
  notes        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_commission_rules_lookup
  ON public.platform_commission_rules(is_active, org_id, plan_id);

-- ── Cobros con desglose ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.payment_transactions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  source        text NOT NULL DEFAULT 'ecommerce'
                CHECK (source IN ('ecommerce','payment_link','pos','subscription','otro')),
  /* ecommerce_orders.id | sales.id | payment_links.id, según source */
  source_id     uuid,
  provider      text NOT NULL,
  method        text NOT NULL DEFAULT 'default',
  installments  int NOT NULL DEFAULT 0,

  gross_amount  numeric(14,2) NOT NULL,
  provider_fee  numeric(14,2) NOT NULL DEFAULT 0,
  provider_fee_iva numeric(14,2) NOT NULL DEFAULT 0,
  platform_fee  numeric(14,2) NOT NULL DEFAULT 0,
  -- Lo que efectivamente le queda a la tienda
  net_amount    numeric(14,2) NOT NULL,

  currency      text NOT NULL DEFAULT 'ARS',
  status        text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','approved','rejected','refunded','charged_back')),
  -- ID del pago en el procesador. Único: hace idempotente el webhook.
  external_id   text,
  expected_release_at date,
  released_at   timestamptz,
  raw           jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, external_id)
);

CREATE INDEX IF NOT EXISTS idx_paytx_org  ON public.payment_transactions(org_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_paytx_src  ON public.payment_transactions(source, source_id);
CREATE INDEX IF NOT EXISTS idx_paytx_date ON public.payment_transactions(created_at DESC);

CREATE OR REPLACE FUNCTION public.touch_payment_tx() RETURNS TRIGGER
LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
CREATE OR REPLACE TRIGGER trg_paytx_ts BEFORE UPDATE ON public.payment_transactions
  FOR EACH ROW EXECUTE FUNCTION public.touch_payment_tx();

-- ── Revenue de la plataforma, por mes ─────────────────────────────
-- Sólo cobros aprobados: un pago rechazado no es ingreso.
CREATE OR REPLACE VIEW public.platform_revenue_monthly AS
SELECT
  DATE_TRUNC('month', created_at)::date AS month,
  currency,
  COUNT(*)                       AS transactions,
  COUNT(DISTINCT org_id)         AS active_orgs,
  SUM(gross_amount)              AS gross_processed,
  SUM(platform_fee)              AS platform_revenue,
  SUM(provider_fee + provider_fee_iva) AS provider_cost,
  SUM(net_amount)                AS merchants_net,
  ROUND(
    SUM(platform_fee) * 100.0 / NULLIF(SUM(gross_amount), 0)
  , 3)                           AS effective_take_rate
FROM public.payment_transactions
WHERE status = 'approved'
GROUP BY 1, 2;

-- ── RLS ───────────────────────────────────────────────────────────
ALTER TABLE public.payment_provider_fees      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_commission_rules  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_transactions       ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read_provider_fees"        ON public.payment_provider_fees;
DROP POLICY IF EXISTS "platform_write_provider_fees" ON public.payment_provider_fees;
DROP POLICY IF EXISTS "read_own_commission_rules" ON public.platform_commission_rules;
DROP POLICY IF EXISTS "platform_write_commission_rules" ON public.platform_commission_rules;
DROP POLICY IF EXISTS "org_read_payment_tx"       ON public.payment_transactions;

-- Aranceles: los lee cualquier usuario autenticado (la tienda tiene derecho a
-- saber cuánto le van a cobrar). Los escribe sólo staff de plataforma finance.
CREATE POLICY "read_provider_fees" ON public.payment_provider_fees
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "platform_write_provider_fees" ON public.payment_provider_fees
  FOR ALL TO authenticated
  USING (public.has_platform_role(ARRAY['finance']))
  WITH CHECK (public.has_platform_role(ARRAY['finance']));

-- Reglas de comisión: la org ve las que le aplican; el staff finance ve y edita todas.
CREATE POLICY "read_own_commission_rules" ON public.platform_commission_rules
  FOR SELECT TO authenticated
  USING (
    public.has_platform_role(ARRAY['finance','support'])
    OR org_id IS NULL
    OR org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid())
  );

CREATE POLICY "platform_write_commission_rules" ON public.platform_commission_rules
  FOR ALL TO authenticated
  USING (public.has_platform_role(ARRAY['finance']))
  WITH CHECK (public.has_platform_role(ARRAY['finance']));

-- Cobros: la org ve los propios; el staff finance ve todos. La escritura es de
-- las Edge Functions con service_role (los webhooks), nunca del cliente.
CREATE POLICY "org_read_payment_tx" ON public.payment_transactions
  FOR SELECT TO authenticated
  USING (
    public.has_platform_role(ARRAY['finance'])
    OR org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid())
  );

-- ── Aranceles iniciales de MercadoPago Argentina ──────────────────
-- Valores de referencia para que el sistema calcule desde el minuto cero.
-- MercadoPago los cambia seguido: el staff finance los ajusta desde
-- /platform/comisiones. No son un dato inmutable.
INSERT INTO public.payment_provider_fees
  (provider, method, installments, percent_fee, fixed_fee, release_days, notes)
VALUES
  ('mercadopago', 'default',  0, 6.29, 0, 0,  'Checkout Pro, acreditación inmediata'),
  ('mercadopago', 'credit',   0, 6.29, 0, 0,  'Tarjeta de crédito 1 pago'),
  ('mercadopago', 'credit',   3, 9.44, 0, 0,  'Crédito 3 cuotas'),
  ('mercadopago', 'credit',   6, 12.9, 0, 0,  'Crédito 6 cuotas'),
  ('mercadopago', 'credit',  12, 18.6, 0, 0,  'Crédito 12 cuotas'),
  ('mercadopago', 'debit',    0, 3.49, 0, 0,  'Tarjeta de débito'),
  ('mercadopago', 'wallet',   0, 4.79, 0, 0,  'Dinero en cuenta MercadoPago'),
  ('transferencia','transfer',0, 0,    0, 1,  'Transferencia bancaria directa'),
  ('efectivo',    'cash',     0, 0,    0, 0,  'Efectivo en el local'),
  ('stripe',      'default',  0, 3.5,  0, 7,  'Stripe internacional')
ON CONFLICT (provider, method, installments, currency, effective_from) DO NOTHING;

-- Regla de comisión por default: 0%. Activarla es una decisión de negocio
-- explícita, no algo que aparece solo tras aplicar una migración.
INSERT INTO public.platform_commission_rules (plan_id, org_id, percent, fixed, applies_to, notes)
SELECT NULL, NULL, 0, 0, 'online',
  'Regla base. Subí el porcentaje desde /platform/comisiones para empezar a cobrar comisión por venta online.'
WHERE NOT EXISTS (
  SELECT 1 FROM public.platform_commission_rules WHERE plan_id IS NULL AND org_id IS NULL
);


-- ############################################################################
-- ## 20260731000001_rls_hardening.sql
-- ############################################################################

-- ═══════════════════════════════════════════════════════════════════════════
-- Cierre de fugas de datos entre organizaciones
--
-- El sistema arrastraba políticas `USING (true)` de cuando era una app de un
-- solo negocio. Al volverse multi-tenant esas políticas quedaron, y cualquiera
-- con la clave anónima — que viaja en el bundle del navegador, o sea cualquier
-- visitante — podía leer datos de TODAS las organizaciones.
--
-- Lo que estaba expuesto, de peor a menos grave:
--
--   1. `settings` con SELECT USING(true), incluido TO anon.
--      La tabla tiene mp_access_token, smtp_pass, api_key, webhook_secret,
--      mp_webhook_secret, afip_ta_token y evolution_api_key. Es decir: se
--      podían leer los tokens de MercadoPago y las contraseñas SMTP de todos
--      los comercios de la plataforma. Con eso se cobra en nombre de otro y se
--      mandan mails desde su dominio.
--
--   2. `products` con SELECT USING(true).
--      Expone total_cost_usd, cost_usd, customs_fee y profit_per_unit_*: el
--      costo de importación y el margen de cada comercio, para cualquiera.
--
--   3. `payment_links` con SELECT USING(true) y UPDATE USING(true).
--      Se podían listar todos los links de pago de la plataforma (montos,
--      clientes) y además marcar cualquiera como "pago informado" sin haber
--      pagado nada.
--
--   4. `profiles` con SELECT USING(true) TO authenticated.
--      Cualquier usuario logueado leía nombre y datos de todos los usuarios de
--      todos los tenants.
--
--   5. `organizations` con SELECT USING(true) TO anon: catálogo completo de
--      clientes de la plataforma, útil para competencia y para phishing.
--
--   6. `coupons`, `product_variants`, `product_combos`, `catalog_banners` e
--      `influencers` con lecturas anónimas sin filtrar por tenant.
--
-- Criterio del arreglo: las tablas quedan cerradas al tenant, y lo que una
-- superficie pública necesita se expone por vistas/RPCs SECURITY DEFINER con
-- un WHERE explícito y sólo las columnas necesarias. La vista ES el control de
-- acceso, así que ningún WHERE de acá es opcional.
--
-- Nota sobre las vistas: se crean SIN `security_invoker`, o sea que evalúan RLS
-- como su dueño (postgres). Eso es deliberado — es el patrón "security definer
-- view". Por eso cada una filtra explícitamente y no expone columnas de costo.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
-- 1. settings — CREDENCIALES
-- ───────────────────────────────────────────────────────────────────────────

-- Se dropea por ROL, no por nombre: estas políticas se recrearon con nombres
-- distintos en cuatro migraciones a lo largo del tiempo, y acertar la lista de
-- nombres a mano es justamente cómo la fuga sobrevivió tanto. Ninguna política
-- anónima sobre `settings` es legítima: el branding público sale de la vista
-- `settings_public`, que no expone credenciales.
DO $$
DECLARE pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'settings'
      AND 'anon' = ANY(roles)
  LOOP
    EXECUTE format('DROP POLICY %I ON public.settings', pol.policyname);
    RAISE NOTICE 'settings: dropeada política anónima %', pol.policyname;
  END LOOP;
END $$;

-- Y las que no declaran rol pero tampoco filtran por tenant (aplican a public,
-- que incluye anon).
DO $$
DECLARE pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'settings'
      AND cmd = 'SELECT'
      AND (qual IS NULL OR btrim(qual) IN ('true', '(true)'))
  LOOP
    EXECUTE format('DROP POLICY %I ON public.settings', pol.policyname);
    RAISE NOTICE 'settings: dropeada política sin filtro de tenant %', pol.policyname;
  END LOOP;
END $$;

-- Las políticas de miembro de org ("Org members read settings" y
-- "Org admins manage settings", de 20260421111259) quedan como están: son las
-- correctas. Se recrea sólo si faltara, para que la migración sea autosuficiente.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'settings' AND cmd = 'SELECT'
  ) THEN
    CREATE POLICY "org_members_read_settings" ON public.settings
      FOR SELECT TO authenticated
      USING (org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid()));
  END IF;
END $$;

-- Branding público del catálogo. Sólo lo que hace falta para dibujar la
-- vidriera: ni un token, ni un margen, ni un dato bancario.
DROP VIEW IF EXISTS public.settings_public;
CREATE VIEW public.settings_public AS
SELECT
  s.id,
  s.user_id,
  s.org_id,
  s.business_name,
  s.logo_url,
  s.primary_color,
  s.secondary_color,
  s.whatsapp_number
FROM public.settings s;

COMMENT ON VIEW public.settings_public IS
  'Branding público. NUNCA agregar acá columnas de credenciales (mp_access_token, smtp_pass, api_key, webhook_secret, afip_ta_token) ni de márgenes.';

-- Parámetros de precio que el catálogo sí necesita mostrar al comprador.
-- `volume_discount_*` es la oferta mayorista que se publica; `exchange_rate` es
-- el tipo de cambio con el que se muestran precios. Quedan AFUERA a propósito
-- `customs_percent` y los `decant_margin_*`: son la estructura de margen.
DROP VIEW IF EXISTS public.catalog_settings;
CREATE VIEW public.catalog_settings AS
SELECT
  s.user_id,
  s.org_id,
  s.exchange_rate,
  s.volume_discount_threshold,
  s.volume_discount_percent
FROM public.settings s;

COMMENT ON VIEW public.catalog_settings IS
  'Parámetros de precio de cara al comprador. No incluye customs_percent ni decant_margin_*: son margen del comercio.';

GRANT SELECT ON public.settings_public  TO anon, authenticated;
GRANT SELECT ON public.catalog_settings TO anon, authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 2. products — COSTOS Y MÁRGENES
-- ───────────────────────────────────────────────────────────────────────────

-- Mismo criterio que con settings: por rol y por falta de filtro, no por nombre.
DO $$
DECLARE pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'products'
      AND (
        'anon' = ANY(roles)
        OR (cmd = 'SELECT' AND (qual IS NULL OR btrim(qual) IN ('true', '(true)')))
      )
  LOOP
    EXECUTE format('DROP POLICY %I ON public.products', pol.policyname);
    RAISE NOTICE 'products: dropeada política sin filtro de tenant %', pol.policyname;
  END LOOP;
END $$;

-- Catálogo público. Los precios de decant vienen YA CALCULADOS: antes el
-- navegador recibía total_cost_usd y los márgenes para hacer la cuenta del
-- lado del cliente, o sea que publicaba el costo de cada producto.
DROP VIEW IF EXISTS public.catalog_products;
CREATE VIEW public.catalog_products AS
SELECT
  p.id,
  p.org_id,
  p.user_id,
  p.name,
  p.brand,
  p.category,
  p.gender,
  p.description,
  p.image_url,
  p.image_urls,
  p.sale_price_ars,
  p.discount_price_ars,
  p.price_2x_ars,
  p.stock,
  p.content_ml,
  p.total_sold,
  p.featured,
  p.offer_expires_at,
  p.created_at,
  -- Espejo de calculateDecantPrice() en src/lib/supabaseStore.ts:
  --   costo proporcional al ml → a pesos → más el margen del fraccionado
  CASE WHEN COALESCE(p.content_ml, 0) > 0 THEN
    round(
      (COALESCE(p.total_cost_usd, p.cost_usd, 0) / p.content_ml) * 10
      * COALESCE(s.exchange_rate, 0)
      * (1 + COALESCE(s.decant_margin_10ml, 250) / 100.0)
    )
  END AS decant_price_10ml,
  CASE WHEN COALESCE(p.content_ml, 0) > 0 THEN
    round(
      (COALESCE(p.total_cost_usd, p.cost_usd, 0) / p.content_ml) * 5
      * COALESCE(s.exchange_rate, 0)
      * (1 + COALESCE(s.decant_margin_5ml, 350) / 100.0)
    )
  END AS decant_price_5ml,
  CASE WHEN COALESCE(p.content_ml, 0) > 0 THEN
    round(
      (COALESCE(p.total_cost_usd, p.cost_usd, 0) / p.content_ml) * 2.5
      * COALESCE(s.exchange_rate, 0)
      * (1 + COALESCE(s.decant_margin_2_5ml, 500) / 100.0)
    )
  END AS decant_price_2_5ml
FROM public.products p
LEFT JOIN public.settings s ON s.org_id = p.org_id
WHERE p.stock > 0
  AND COALESCE(p.sale_price_ars, 0) > 0
  AND COALESCE(p.is_active, true) = true;

COMMENT ON VIEW public.catalog_products IS
  'Catálogo público. NUNCA agregar columnas de costo (cost_usd, total_cost_usd, customs_fee, profit_per_unit_*): los decants ya vienen calculados justamente para no tener que exponerlas.';

-- Compat: products_public seguía siendo security_invoker y quedaba vacía al
-- cerrar la tabla. Se reapunta al catálogo saneado.
DROP VIEW IF EXISTS public.products_public;
CREATE VIEW public.products_public AS
SELECT id, user_id, org_id, name, brand, category, gender, description,
       image_url, sale_price_ars, discount_price_ars, stock
FROM public.catalog_products;

-- Variantes de productos publicados. Antes era `USING (active = true)` sin
-- filtrar por tenant: se leían las variantes de cualquier comercio.
DROP POLICY IF EXISTS "Public read active variants" ON public.product_variants;
DROP POLICY IF EXISTS "Anon read active variants"   ON public.product_variants;

DROP VIEW IF EXISTS public.catalog_product_variants;
CREATE VIEW public.catalog_product_variants AS
SELECT v.id, v.product_id, v.variant_name, v.stock, v.image_url
FROM public.product_variants v
JOIN public.catalog_products p ON p.id = v.product_id
WHERE COALESCE(v.active, true) = true;

GRANT SELECT ON public.catalog_products         TO anon, authenticated;
GRANT SELECT ON public.products_public          TO anon, authenticated;
GRANT SELECT ON public.catalog_product_variants TO anon, authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 3. payment_links — LECTURA MASIVA Y ESCRITURA ABIERTA
-- ───────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "payment_links_public_read"     ON public.payment_links;
DROP POLICY IF EXISTS "payment_links_customer_update" ON public.payment_links;
DROP POLICY IF EXISTS "payment_links_public_update"   ON public.payment_links;
DROP POLICY IF EXISTS "payment_links_public_confirm"  ON public.payment_links;

-- El link se accede por su uuid, que es el secreto. Eso no se puede expresar
-- en RLS ("sólo si ya sabés el id"), así que se resuelve con un RPC: recibe el
-- id y devuelve ese link, sin permitir enumerar el resto.
--
-- Un link vencido se devuelve igual: el comprador tiene que poder ver "esto
-- venció" en vez de un 404 confuso. Lo que no se puede es pagarlo.
CREATE OR REPLACE FUNCTION public.get_public_payment_link(p_id uuid)
RETURNS TABLE (
  id uuid, org_id uuid, quote_number text, customer_name text,
  customer_phone text, items jsonb, total_ars numeric, mp_link text,
  status text, paid_at timestamptz, notes text, expires_at date,
  created_at timestamptz,
  business_name text, logo_url text, whatsapp_number text,
  bank_cbu text, bank_alias text, bank_name text, bank_holder text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    pl.id, pl.org_id, pl.quote_number, pl.customer_name,
    pl.customer_phone, pl.items, pl.total_ars, pl.mp_link,
    pl.status, pl.paid_at, pl.notes, pl.expires_at,
    pl.created_at,
    COALESCE(s.business_name, o.name) AS business_name,
    s.logo_url, s.whatsapp_number,
    -- Datos bancarios: los necesita quien va a transferir. Se entregan sólo
    -- para ESTE link, no para toda la plataforma como antes.
    s.bank_cbu, s.bank_alias, s.bank_name, s.bank_holder
  FROM public.payment_links pl
  LEFT JOIN public.settings s      ON s.org_id = pl.org_id
  LEFT JOIN public.organizations o ON o.id = pl.org_id
  WHERE pl.id = p_id;
$$;

-- Informar una transferencia. Sólo avanza pending → pending_confirmation de
-- ESE link: antes la política de UPDATE permitía tocar cualquier fila de la
-- tabla, o sea marcar como pagado cualquier link de cualquier comercio.
CREATE OR REPLACE FUNCTION public.confirm_payment_link_transfer(p_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_updated int;
BEGIN
  UPDATE public.payment_links
     SET status = 'pending_confirmation'
   WHERE id = p_id
     AND status = 'pending'
     AND (expires_at IS NULL OR expires_at >= CURRENT_DATE);
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.get_public_payment_link(uuid)      FROM public;
REVOKE ALL ON FUNCTION public.confirm_payment_link_transfer(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_public_payment_link(uuid)      TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_payment_link_transfer(uuid) TO anon, authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 4. profiles — PII ENTRE TENANTS
-- ───────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Users can view all profiles" ON public.profiles;

DROP POLICY IF EXISTS "read_own_and_teammate_profiles" ON public.profiles;
CREATE POLICY "read_own_and_teammate_profiles" ON public.profiles
  FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    -- Compañeros de equipo: se comparte al menos una organización
    OR EXISTS (
      SELECT 1
      FROM public.memberships me
      JOIN public.memberships them ON them.org_id = me.org_id
      WHERE me.user_id = auth.uid() AND them.user_id = public.profiles.id
    )
    -- El staff de plataforma da soporte sobre cualquier cuenta
    OR public.has_platform_role(ARRAY['support', 'finance'])
  );

-- ───────────────────────────────────────────────────────────────────────────
-- 5. organizations — ENUMERACIÓN DE CLIENTES
-- ───────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Anyone can view org by slug for public catalog" ON public.organizations;

-- Un visitante sólo puede ver una organización si ésta publicó una tienda.
-- El resto de la cartera de clientes de la plataforma deja de ser listable.
DROP POLICY IF EXISTS "anon_read_orgs_with_published_store" ON public.organizations;
CREATE POLICY "anon_read_orgs_with_published_store" ON public.organizations
  FOR SELECT TO anon
  USING (EXISTS (
    SELECT 1 FROM public.ecommerce_stores st
    WHERE st.org_id = public.organizations.id AND st.is_active = true
  ));

-- ───────────────────────────────────────────────────────────────────────────
-- 6. Lecturas anónimas sin dueño
-- ───────────────────────────────────────────────────────────────────────────

-- Cupones: los códigos de descuento de todos los comercios eran legibles, así
-- que se podían usar en cualquier tienda sin que nadie los publique. La
-- validación de cupones ya ocurre server-side en el checkout, con service_role.
DROP POLICY IF EXISTS "Anon read active coupons"   ON public.coupons;
DROP POLICY IF EXISTS "Anon can read active coupons" ON public.coupons;

-- Combos, banners e influencers: no hay ninguna superficie pública que los lea
-- hoy; las políticas quedaron de la app de un solo negocio.
DROP POLICY IF EXISTS "Public read active combos"      ON public.product_combos;
DROP POLICY IF EXISTS "Public read active banners"     ON public.catalog_banners;
DROP POLICY IF EXISTS "Public read active influencers" ON public.influencers;

-- ───────────────────────────────────────────────────────────────────────────
-- 7. Red de seguridad: detectar la próxima fuga antes de que salga a prod
-- ───────────────────────────────────────────────────────────────────────────

-- Lista las políticas permisivas que dejan ver una tabla entera sin filtrar por
-- tenant. Es para auditar a mano (`SELECT * FROM public.rls_audit_open_policies`)
-- y para que una política nueva de este tipo se vea en una revisión.
CREATE OR REPLACE VIEW public.rls_audit_open_policies AS
SELECT
  schemaname,
  tablename,
  policyname,
  roles::text  AS applies_to,
  cmd          AS command,
  qual         AS using_expression
FROM pg_policies
WHERE schemaname = 'public'
  AND cmd IN ('SELECT', 'ALL', 'UPDATE', 'DELETE', 'INSERT')
  AND (
    qual IS NULL
    OR btrim(qual) = 'true'
    OR btrim(qual) = '(true)'
  );

COMMENT ON VIEW public.rls_audit_open_policies IS
  'Políticas que no filtran por tenant. Debería estar vacía salvo tablas globales legítimas (plans). Revisar antes de cada deploy.';

REVOKE ALL ON public.rls_audit_open_policies FROM anon, authenticated;

-- Las tablas globales legítimas quedan documentadas para que no confundan al
-- auditar: `plans` es el pricing público de la plataforma.
COMMENT ON TABLE public.plans IS
  'Planes de la plataforma. Lectura pública a propósito: es el pricing que se muestra en /precios.';


-- ############################################################################
-- ## 20260731000002_store_shipping_and_settlements.sql
-- ############################################################################

-- ═══════════════════════════════════════════════════════════════════════════
-- La tienda online cotiza envío por zona y registra la comisión de cada cobro
--
-- Quedaban dos cosas configuradas que la tienda nunca usaba:
--
--   1. Las zonas y tarifas de envío (20260730000027). `create_store_order`
--      cobraba `ecommerce_stores.shipping_cost`, un precio plano: lo mismo para
--      Palermo que para Ushuaia, sin importar el peso.
--   2. Los aranceles y la comisión de plataforma (20260730000028). Nadie
--      escribía en `payment_transactions`, así que el comercio no sabía cuánto
--      le quedaba de cada venta y la plataforma no sabía cuánto había facturado.
--
-- Todo el cálculo vive en la base y no en el navegador, por la misma razón que
-- el precio de los productos: es lo único que el comprador no puede manipular.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
-- 1. Peso del carrito
-- ───────────────────────────────────────────────────────────────────────────

-- Un producto sin peso declarado usa el estimado de la tienda: preferimos
-- cotizar con una aproximación antes que no cotizar y perder la venta.
CREATE OR REPLACE FUNCTION public.store_cart_weight_kg(
  p_org_id uuid,
  p_items  jsonb,
  p_default_weight numeric DEFAULT 0.5
)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(SUM(
    CASE
      WHEN COALESCE(pr.weight_kg, 0) > 0 THEN pr.weight_kg
      ELSE GREATEST(p_default_weight, 0)
    END
    * GREATEST(COALESCE((it->>'quantity')::int, 1), 0)
  ), 0)::numeric(10,3)
  FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) AS it
  LEFT JOIN public.products pr
    ON pr.id = (it->>'product_id')::uuid AND pr.org_id = p_org_id;
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- 2. Cotización por zona
-- ───────────────────────────────────────────────────────────────────────────

-- Espejo en SQL de `quoteShipping()` en src/lib/shippingCalc.ts, que está
-- testeado con 40 casos. Si cambia la regla, cambian los dos.
--
-- Reglas que importan:
--   · Los tramos de peso son [min, max): 1 kg exacto cae en el tramo de arriba.
--   · Por encima del techo más alto se cobra el excedente por kg ENTERO
--     (`ceil`), que es como cobran los correos: por kg o fracción.
--   · El umbral de envío gratis de la tarifa pisa el de la tienda.
--   · El retiro en tienda va primero: es gratis y le conviene a los dos lados.
CREATE OR REPLACE FUNCTION public.quote_store_shipping(
  p_slug          text,
  p_province      text,
  p_postal_code   text DEFAULT NULL,
  p_items         jsonb DEFAULT '[]'::jsonb
)
RETURNS TABLE (
  option_id   text,
  carrier     text,
  service     text,
  label       text,
  price       numeric,
  is_free     boolean,
  days_min    int,
  days_max    int,
  zone_id     uuid,
  zone_name   text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_store    record;
  v_zone     record;
  v_weight   numeric;
  v_subtotal numeric := 0;
  v_it       jsonb;
  v_unit     numeric;
BEGIN
  SELECT s.id, s.org_id, s.shipping_mode, s.shipping_cost, s.free_shipping_above,
         s.pickup_enabled, s.default_item_weight_kg
  INTO v_store
  FROM public.ecommerce_stores s
  WHERE lower(s.slug) = lower(p_slug) AND s.is_active;

  IF v_store.id IS NULL THEN
    RETURN;  -- tienda inexistente: sin opciones, el checkout lo informa
  END IF;

  -- Subtotal autoritativo, para evaluar el umbral de envío gratis con los
  -- precios de la base y no con lo que diga el cliente.
  FOR v_it IN SELECT * FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) LOOP
    SELECT COALESCE(NULLIF(pr.discount_price_ars, 0), pr.sale_price_ars)
    INTO v_unit
    FROM public.products pr
    WHERE pr.id = (v_it->>'product_id')::uuid AND pr.org_id = v_store.org_id;
    v_subtotal := v_subtotal + COALESCE(v_unit, 0)
                  * GREATEST(COALESCE((v_it->>'quantity')::int, 1), 0);
  END LOOP;

  -- Retiro en tienda: no depende de zona ni de peso
  IF v_store.pickup_enabled THEN
    RETURN QUERY SELECT
      'retiro'::text, 'retiro'::text, 'sucursal'::text, 'Retiro en tienda'::text,
      0::numeric, true, 0, 0, NULL::uuid, NULL::text;
  END IF;

  -- Envío gratis como política de la tienda
  IF v_store.shipping_mode = 'free' THEN
    RETURN QUERY SELECT
      'gratis'::text, 'propio'::text, 'domicilio'::text, 'Envío gratis'::text,
      0::numeric, true, NULL::int, NULL::int, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  -- Precio plano (comportamiento anterior, sigue disponible)
  IF v_store.shipping_mode = 'flat' OR v_store.shipping_mode IS NULL THEN
    RETURN QUERY SELECT
      'flat'::text, 'propio'::text, 'domicilio'::text, 'Envío a domicilio'::text,
      CASE
        WHEN v_store.free_shipping_above IS NOT NULL
         AND v_store.free_shipping_above > 0
         AND v_subtotal >= v_store.free_shipping_above THEN 0
        ELSE COALESCE(v_store.shipping_cost, 0)
      END::numeric,
      (v_store.free_shipping_above IS NOT NULL
        AND v_store.free_shipping_above > 0
        AND v_subtotal >= v_store.free_shipping_above),
      NULL::int, NULL::int, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  -- ── Modo zonas ──────────────────────────────────────────────────────────
  IF p_province IS NULL OR btrim(p_province) = '' THEN
    RETURN;  -- sin provincia no se puede resolver la zona
  END IF;

  SELECT z.id, z.name INTO v_zone
  FROM public.shipping_zones z
  WHERE z.org_id = v_store.org_id
    AND z.is_active
    AND p_province = ANY(z.provinces)
  ORDER BY z.sort_order
  LIMIT 1;

  IF v_zone.id IS NULL THEN
    RETURN;  -- provincia sin cobertura; sólo queda el retiro si estaba activo
  END IF;

  v_weight := public.store_cart_weight_kg(
    v_store.org_id, p_items, COALESCE(v_store.default_item_weight_kg, 0.5));

  RETURN QUERY
  WITH activos AS (
    SELECT r.*
    FROM public.shipping_rates r
    LEFT JOIN public.shipping_carriers c
      ON c.org_id = r.org_id AND c.carrier = r.carrier
    WHERE r.zone_id = v_zone.id
      AND r.is_active
      -- Un transportista configurado y deshabilitado no se ofrece. Si no está
      -- configurado se ofrece igual: el tarifario alcanza.
      AND COALESCE(c.is_enabled, true)
  ),
  -- Un tramo por (transportista, servicio): el que contiene el peso, o el más
  -- pesado si el carrito supera todos los techos.
  elegidos AS (
    SELECT DISTINCT ON (a.carrier, a.service)
      a.*,
      COALESCE(c.markup_pct, 0)   AS markup_pct,
      COALESCE(c.markup_fixed, 0) AS markup_fixed
    FROM activos a
    LEFT JOIN public.shipping_carriers c
      ON c.org_id = a.org_id AND c.carrier = a.carrier
    ORDER BY
      a.carrier, a.service,
      -- Primero el tramo que contiene el peso...
      (v_weight >= a.min_weight_kg
        AND (a.max_weight_kg IS NULL OR v_weight < a.max_weight_kg)) DESC,
      -- ...si ninguno, el de techo más alto
      COALESCE(a.max_weight_kg, 1e9) DESC
  ),
  calculados AS (
    SELECT
      e.carrier, e.service, e.delivery_days_min, e.delivery_days_max,
      e.free_above,
      -- Excedente por kg entero sobre el techo del tramo
      (
        e.price + CASE
          WHEN e.max_weight_kg IS NOT NULL AND v_weight > e.max_weight_kg
          THEN ceil(v_weight - e.max_weight_kg) * COALESCE(e.price_per_extra_kg, 0)
          ELSE 0
        END
      ) * (1 + e.markup_pct / 100.0) + e.markup_fixed AS bruto
    FROM elegidos e
  )
  SELECT
    (c.carrier || ':' || c.service)::text,
    c.carrier::text,
    c.service::text,
    (CASE c.carrier
       WHEN 'correo_argentino' THEN 'Correo Argentino'
       WHEN 'andreani'         THEN 'Andreani'
       WHEN 'oca'              THEN 'OCA'
       WHEN 'propio'           THEN 'Envío propio'
       ELSE c.carrier
     END
     || ' · ' ||
     CASE c.service
       WHEN 'domicilio'   THEN 'A domicilio'
       WHEN 'sucursal'    THEN 'Retiro en sucursal'
       WHEN 'express'     THEN 'Express'
       WHEN 'prioritario' THEN 'Prioritario'
       ELSE c.service
     END)::text,
    CASE WHEN gratis.si THEN 0 ELSE round(c.bruto, 2) END,
    gratis.si,
    c.delivery_days_min,
    c.delivery_days_max,
    v_zone.id,
    v_zone.name
  FROM calculados c
  CROSS JOIN LATERAL (
    SELECT (
      COALESCE(c.free_above, v_store.free_shipping_above) IS NOT NULL
      AND COALESCE(c.free_above, v_store.free_shipping_above) > 0
      AND v_subtotal >= COALESCE(c.free_above, v_store.free_shipping_above)
    ) AS si
  ) gratis
  ORDER BY 5;  -- de más barato a más caro
END;
$$;

GRANT EXECUTE ON FUNCTION public.quote_store_shipping(text, text, text, jsonb)
  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.store_cart_weight_kg(uuid, jsonb, numeric)
  TO anon, authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 3. Liquidación de un cobro
-- ───────────────────────────────────────────────────────────────────────────

-- Espejo en SQL de `computeSettlement()` en src/lib/paymentFees.ts (37 tests).
-- Idempotente por (provider, external_id): los webhooks reintentan y una
-- comisión contada dos veces es plata mal facturada.
CREATE OR REPLACE FUNCTION public.record_payment_settlement(
  p_org_id       uuid,
  p_source       text,
  p_source_id    uuid,
  p_provider     text,
  p_method       text,
  p_installments int,
  p_gross        numeric,
  p_external_id  text DEFAULT NULL,
  p_actual_fee   numeric DEFAULT NULL,
  p_currency     text DEFAULT 'ARS',
  p_status       text DEFAULT 'approved'
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_fee      record;
  v_rule     record;
  v_plan     uuid;
  v_channel  text;
  v_provfee  numeric := 0;
  v_iva      numeric := 0;
  v_platform numeric := 0;
  v_net      numeric;
  v_release  int := 0;
  v_id       uuid;
BEGIN
  IF p_gross IS NULL OR p_gross <= 0 THEN RETURN NULL; END IF;

  v_channel := CASE WHEN p_source = 'pos' THEN 'pos' ELSE 'online' END;

  -- Arancel del procesador, de más específico a más general
  SELECT f.percent_fee, f.fixed_fee, f.iva_on_fee_pct, f.release_days
  INTO v_fee
  FROM public.payment_provider_fees f
  WHERE f.provider = p_provider
    AND f.currency = p_currency
    AND f.effective_from <= CURRENT_DATE
    AND (
      (f.method = p_method AND f.installments = COALESCE(p_installments, 0))
      OR (f.method = p_method AND f.installments = 0)
      OR f.method = 'default'
    )
  ORDER BY
    (f.method = p_method AND f.installments = COALESCE(p_installments, 0)) DESC,
    (f.method = p_method) DESC,
    f.effective_from DESC
  LIMIT 1;

  -- Si el procesador informó lo que cobró de verdad, ese número gana sobre el
  -- tarifario: es el que efectivamente salió de la cuenta.
  IF p_actual_fee IS NOT NULL AND p_actual_fee >= 0 THEN
    v_provfee := round(p_actual_fee, 2);
  ELSE
    v_provfee := round(p_gross * COALESCE(v_fee.percent_fee, 0) / 100.0
                       + COALESCE(v_fee.fixed_fee, 0), 2);
  END IF;
  v_iva     := round(v_provfee * COALESCE(v_fee.iva_on_fee_pct, 0) / 100.0, 2);
  v_release := COALESCE(v_fee.release_days, 0);

  -- Comisión de plataforma: org > plan > base
  SELECT o.plan_id INTO v_plan FROM public.organizations o WHERE o.id = p_org_id;

  SELECT r.percent, r.fixed, r.max_per_transaction, r.min_per_transaction
  INTO v_rule
  FROM public.platform_commission_rules r
  WHERE r.is_active
    AND (r.applies_to = 'all' OR r.applies_to = v_channel)
    AND (r.org_id IS NULL OR r.org_id = p_org_id)
    AND (r.plan_id IS NULL OR r.plan_id = v_plan)
  ORDER BY
    (r.org_id IS NOT NULL)::int * 4
    + (r.plan_id IS NOT NULL)::int * 2
    + (r.applies_to <> 'all')::int DESC
  LIMIT 1;

  IF v_rule.percent IS NOT NULL OR v_rule.fixed IS NOT NULL THEN
    v_platform := p_gross * COALESCE(v_rule.percent, 0) / 100.0
                  + COALESCE(v_rule.fixed, 0);
    IF v_rule.max_per_transaction IS NOT NULL THEN
      v_platform := LEAST(v_platform, v_rule.max_per_transaction);
    END IF;
    IF COALESCE(v_rule.min_per_transaction, 0) > 0 THEN
      v_platform := GREATEST(v_platform, v_rule.min_per_transaction);
    END IF;
    v_platform := round(LEAST(v_platform, p_gross), 2);
  END IF;

  -- Nunca un neto negativo: sería un dato inventado que descuadra la contabilidad
  v_net := round(GREATEST(0, p_gross - v_provfee - v_iva - v_platform), 2);

  INSERT INTO public.payment_transactions (
    org_id, source, source_id, provider, method, installments,
    gross_amount, provider_fee, provider_fee_iva, platform_fee, net_amount,
    currency, status, external_id, expected_release_at, released_at
  ) VALUES (
    p_org_id, p_source, p_source_id, p_provider, COALESCE(p_method, 'default'),
    COALESCE(p_installments, 0),
    round(p_gross, 2), v_provfee, v_iva, v_platform, v_net,
    p_currency, p_status, p_external_id,
    CURRENT_DATE + v_release,
    CASE WHEN p_status = 'approved' AND v_release = 0 THEN now() ELSE NULL END
  )
  ON CONFLICT (provider, external_id) DO UPDATE
    SET status = EXCLUDED.status, updated_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_payment_settlement(
  uuid, text, uuid, text, text, int, numeric, text, numeric, text, text) FROM PUBLIC;
-- Solo service_role: la liquidación la registra el webhook, nunca el navegador.

-- ───────────────────────────────────────────────────────────────────────────
-- 4. Números de pedido sin colisión
-- ───────────────────────────────────────────────────────────────────────────

-- `create_store_order` armaba el número con 4 dígitos al azar por día. Con ~120
-- pedidos diarios la probabilidad de repetir pasa el 50% (paradoja del
-- cumpleaños), y dos pedidos con el mismo número rompen el seguimiento y la
-- página de confirmación, que busca por número.
CREATE SEQUENCE IF NOT EXISTS public.store_order_seq;

CREATE OR REPLACE FUNCTION public.next_store_order_number()
RETURNS text LANGUAGE sql VOLATILE SET search_path = public AS $$
  SELECT 'TN-' || to_char(now(), 'YYYYMMDD') || '-' ||
         lpad((nextval('public.store_order_seq') % 100000)::text, 5, '0');
$$;

-- Índice único por org: si algo vuelve a generar un duplicado, falla al insertar
-- en vez de convivir con dos pedidos indistinguibles.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ecom_orders_number
  ON public.ecommerce_orders(org_id, order_number);

-- ───────────────────────────────────────────────────────────────────────────
-- 5. La tienda necesita saber en qué modo cotiza
-- ───────────────────────────────────────────────────────────────────────────

-- `get_store_by_slug` no devolvía `shipping_mode`, así que el checkout no tenía
-- forma de saber que debía pedir provincia y cotizar por zona: siempre se
-- comportaba como precio plano, por más que la tienda tuviera zonas cargadas.
-- Agregar columnas a un RETURNS TABLE exige recrear la función.
DROP FUNCTION IF EXISTS public.get_store_by_slug(text);

CREATE OR REPLACE FUNCTION public.get_store_by_slug(p_slug text)
RETURNS TABLE (
  org_id           uuid,
  owner_user_id    uuid,
  name             text,
  description      text,
  slug             text,
  theme            text,
  primary_color    text,
  logo_url         text,
  banner_url       text,
  currency         text,
  payment_methods  text[],
  shipping_cost    numeric,
  free_shipping_above numeric,
  shipping_mode    text,
  pickup_enabled   boolean,
  pickup_address   text,
  meta_title       text,
  meta_description text,
  social_links     jsonb
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    s.org_id,
    -- El catálogo público consulta por user_id, así que se resuelve el dueño
    -- de la organización.
    (SELECT m.user_id FROM public.memberships m
      WHERE m.org_id = s.org_id AND m.role = 'owner'
      ORDER BY m.joined_at LIMIT 1) AS owner_user_id,
    s.name, s.description, s.slug, s.theme, s.primary_color,
    s.logo_url, s.banner_url, s.currency, s.payment_methods,
    s.shipping_cost, s.free_shipping_above,
    s.shipping_mode, s.pickup_enabled, s.pickup_address,
    s.meta_title, s.meta_description, s.social_links
  FROM public.ecommerce_stores s
  WHERE lower(s.slug) = lower(p_slug)
    AND s.is_active = true
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_store_by_slug(text) TO anon, authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 6. create_store_order con envío por zona
-- ───────────────────────────────────────────────────────────────────────────

-- Sumar un parámetro deja dos funciones con el mismo nombre y PostgREST no
-- sabría cuál llamar, así que se dropea la firma anterior primero (mismo
-- problema que resolvió 20260730000023 al agregar el cupón).
DROP FUNCTION IF EXISTS public.create_store_order(
  text, jsonb, text, text, text, jsonb, text, text, text);

CREATE OR REPLACE FUNCTION public.create_store_order(
  p_slug            text,
  p_items           jsonb,
  p_customer_name   text,
  p_customer_email  text,
  p_customer_phone  text,
  p_shipping        jsonb,
  p_payment_method  text,
  p_notes           text DEFAULT NULL,
  p_coupon          text DEFAULT NULL,
  -- id de opción devuelto por `quote_store_shipping` ("andreani:domicilio").
  -- NULL = la tienda cotiza plano, o se toma la opción más barata disponible.
  p_shipping_option text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_store        record;
  v_item         jsonb;
  v_prod         record;
  v_qty          int;
  v_unit         numeric;
  v_subtotal     numeric := 0;
  v_items        jsonb := '[]'::jsonb;
  v_shipping     numeric := 0;
  v_order_number text;
  v_order_id     uuid;
  v_customer_id  uuid;
  v_coupon       record;
  v_descuento    numeric := 0;
  v_coupon_code  text := NULL;
  v_opt          record;
  v_province     text;
BEGIN
  SELECT s.id, s.org_id, s.name, s.shipping_cost, s.free_shipping_above,
         s.payment_methods, s.shipping_mode, s.pickup_enabled
  INTO v_store
  FROM public.ecommerce_stores s
  WHERE lower(s.slug) = lower(p_slug) AND s.is_active;

  IF v_store.id IS NULL THEN RAISE EXCEPTION 'Tienda no encontrada o inactiva'; END IF;
  IF p_customer_name IS NULL OR btrim(p_customer_name) = '' THEN
    RAISE EXCEPTION 'El nombre es obligatorio';
  END IF;
  IF p_customer_email IS NULL OR p_customer_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'El email no es válido';
  END IF;
  IF jsonb_array_length(COALESCE(p_items, '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'El carrito está vacío';
  END IF;
  IF NOT (p_payment_method = ANY(v_store.payment_methods)) THEN
    RAISE EXCEPTION 'Medio de pago no habilitado en esta tienda';
  END IF;

  IF auth.uid() IS NOT NULL THEN
    SELECT id INTO v_customer_id
    FROM public.store_customers
    WHERE store_id = v_store.id AND user_id = auth.uid();
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty := GREATEST(1, COALESCE((v_item->>'quantity')::int, 1));

    SELECT id, name, brand, stock, sale_price_ars, discount_price_ars, image_url
    INTO v_prod
    FROM public.products
    WHERE id = (v_item->>'product_id')::uuid AND org_id = v_store.org_id;

    IF v_prod.id IS NULL THEN RAISE EXCEPTION 'Un producto del carrito ya no está disponible'; END IF;
    IF v_prod.stock < v_qty THEN
      RAISE EXCEPTION 'Sin stock suficiente de %  (quedan %)', v_prod.name, v_prod.stock;
    END IF;

    v_unit := COALESCE(NULLIF(v_prod.discount_price_ars, 0), v_prod.sale_price_ars);
    v_subtotal := v_subtotal + v_unit * v_qty;

    v_items := v_items || jsonb_build_object(
      'product_id', v_prod.id, 'name', v_prod.name, 'brand', v_prod.brand,
      'quantity', v_qty, 'unit_price', v_unit, 'total', v_unit * v_qty,
      'image_url', v_prod.image_url
    );
  END LOOP;

  -- ── Cupón, revalidado acá ───────────────────────────────────────────────
  -- No alcanza con haberlo chequeado al escribirlo: entre eso y el checkout
  -- puede haberse agotado o vencido.
  IF p_coupon IS NOT NULL AND btrim(p_coupon) <> '' THEN
    SELECT * INTO v_coupon
    FROM public.coupons
    WHERE org_id = v_store.org_id AND upper(code) = upper(btrim(p_coupon))
      AND active
      AND (valid_from IS NULL OR valid_from <= now())
      AND (valid_until IS NULL OR valid_until >= now())
      AND (max_uses IS NULL OR current_uses < max_uses)
    LIMIT 1;

    IF v_coupon.id IS NULL THEN
      RAISE EXCEPTION 'El cupón ya no es válido';
    END IF;

    IF COALESCE(v_coupon.discount_percent, 0) > 0 THEN
      v_descuento := round(v_subtotal * v_coupon.discount_percent / 100.0);
    ELSIF COALESCE(v_coupon.discount_fixed_ars, 0) > 0 THEN
      v_descuento := LEAST(v_coupon.discount_fixed_ars, v_subtotal);
    END IF;

    v_coupon_code := upper(v_coupon.code);
    UPDATE public.coupons SET current_uses = current_uses + 1 WHERE id = v_coupon.id;
  END IF;

  -- ── Envío ───────────────────────────────────────────────────────────────
  -- El precio se RECALCULA acá: el cliente manda cuál opción eligió, no cuánto
  -- cuesta. El envío gratis se evalúa sobre el subtotal ANTES del cupón — si
  -- no, un descuento podría hacer perder el beneficio y eso se siente como un
  -- castigo por usar el cupón.
  v_province := COALESCE(p_shipping->>'provincia', p_shipping->>'province', '');

  SELECT q.option_id, q.carrier, q.service, q.label, q.price,
         q.days_min, q.days_max, q.zone_id
  INTO v_opt
  FROM public.quote_store_shipping(p_slug, v_province, p_shipping->>'cp', p_items) q
  WHERE p_shipping_option IS NULL OR q.option_id = p_shipping_option
  ORDER BY
    -- Si pidió una opción puntual, gana ésa; si no, la más barata
    (q.option_id = COALESCE(p_shipping_option, q.option_id)) DESC,
    q.price
  LIMIT 1;

  IF v_opt.option_id IS NULL THEN
    IF v_store.shipping_mode = 'zones' THEN
      RAISE EXCEPTION 'No hay envío disponible para esa provincia. Elegí otra opción de entrega.';
    END IF;
    -- Modos plano/gratis siempre devuelven una opción; si no hay, es sin costo
    v_shipping := 0;
  ELSE
    v_shipping := v_opt.price;
  END IF;

  v_order_number := public.next_store_order_number();

  INSERT INTO public.ecommerce_orders (
    org_id, store_id, store_customer_id, order_number,
    customer_name, customer_email, customer_phone,
    items, subtotal, shipping_cost, discount_amount, tax_amount, total,
    coupon_code, payment_method, payment_status, fulfillment_status,
    shipping_address, billing_address, notes,
    carrier, shipping_service, shipping_label, shipping_zone_id,
    delivery_days_min, delivery_days_max, shipping_quoted_at
  ) VALUES (
    v_store.org_id, v_store.id, v_customer_id, v_order_number,
    btrim(p_customer_name), lower(btrim(p_customer_email)), p_customer_phone,
    v_items, v_subtotal, v_shipping, v_descuento, 0,
    GREATEST(0, v_subtotal - v_descuento) + v_shipping,
    v_coupon_code, p_payment_method, 'pending', 'pending',
    COALESCE(p_shipping, '{}'::jsonb), COALESCE(p_shipping, '{}'::jsonb), p_notes,
    v_opt.carrier, v_opt.service, v_opt.label, v_opt.zone_id,
    v_opt.days_min, v_opt.days_max, now()
  )
  RETURNING id INTO v_order_id;

  IF v_customer_id IS NOT NULL THEN
    UPDATE public.store_customers
    SET default_address = COALESCE(p_shipping, default_address),
        phone           = COALESCE(NULLIF(p_customer_phone, ''), phone),
        name            = COALESCE(NULLIF(btrim(p_customer_name), ''), name)
    WHERE id = v_customer_id;
  END IF;

  RETURN jsonb_build_object(
    'order_number',   v_order_number,
    'total',          GREATEST(0, v_subtotal - v_descuento) + v_shipping,
    'subtotal',       v_subtotal,
    'discount',       v_descuento,
    'shipping',       v_shipping,
    'shipping_label', v_opt.label
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_store_order(
  text, jsonb, text, text, text, jsonb, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_store_order(
  text, jsonb, text, text, text, jsonb, text, text, text, text) TO anon, authenticated;


-- ============================================================================
-- Registrar las versiones para que el CLI no las quiera aplicar de nuevo.
--
-- Va en un DO con manejo de error a proposito: si nunca usaste el CLI, esa
-- tabla no existe, y eso NO tiene que hacer fallar todo el bundle. Lo que
-- importa es el esquema; el registro es solo para que `supabase db push` no
-- reintente despues.
-- ============================================================================
DO $registro$
BEGIN
  INSERT INTO supabase_migrations.schema_migrations (version)
  SELECT v FROM (VALUES
    ('20260730000026'), ('20260730000027'), ('20260730000028'),
    ('20260731000001'), ('20260731000002')
  ) AS t(v)
  WHERE NOT EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations m WHERE m.version = t.v
  );
  RAISE NOTICE 'Versiones registradas en schema_migrations.';
EXCEPTION
  WHEN undefined_table OR undefined_schema THEN
    RAISE NOTICE 'schema_migrations no existe: se omite el registro. El esquema SI quedo aplicado.';
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'Sin permiso sobre schema_migrations: se omite el registro. El esquema SI quedo aplicado.';
END
$registro$;

COMMIT;
