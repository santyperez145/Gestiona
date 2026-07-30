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
