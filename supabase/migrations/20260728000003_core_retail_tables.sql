-- ============================================================================
-- Tablas de features core que el código usaba pero nunca se crearon
-- ============================================================================
-- Detectadas auditando todos los .from("tabla") contra el esquema real.
-- Cubre: fidelidad, lotes/vencimientos, devoluciones, items de bundles y
-- seguimientos de CRM. Las features fuera de alcance (competencia,
-- franquicias, precios dinámicos, RFQ, motor de precios) se eliminan aparte.

-- ── Fidelidad ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.loyalty_programs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name           TEXT NOT NULL DEFAULT 'Programa de fidelidad',
  description    TEXT,
  points_per_peso NUMERIC(10,4) NOT NULL DEFAULT 1,
  min_redemption INTEGER NOT NULL DEFAULT 100,
  expiry_days    INTEGER,
  is_active      BOOLEAN NOT NULL DEFAULT true,
  terms          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id)
);

CREATE TABLE IF NOT EXISTS public.loyalty_tiers (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  min_points INTEGER NOT NULL DEFAULT 0,
  max_points INTEGER,
  multiplier NUMERIC(6,3) NOT NULL DEFAULT 1,
  color      TEXT NOT NULL DEFAULT '#888888',
  icon       TEXT NOT NULL DEFAULT '★',
  benefits   TEXT[],
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.loyalty_rewards (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  description    TEXT,
  reward_type    TEXT NOT NULL DEFAULT 'discount',
  points_cost    INTEGER NOT NULL DEFAULT 0,
  discount_value NUMERIC(12,2),
  stock_limit    INTEGER,
  redeemed_count INTEGER NOT NULL DEFAULT 0,
  valid_from     DATE,
  valid_to       DATE,
  is_active      BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.loyalty_members (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  customer_id     UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  current_points  INTEGER NOT NULL DEFAULT 0,
  lifetime_points INTEGER NOT NULL DEFAULT 0,
  tier_id         UUID REFERENCES public.loyalty_tiers(id) ON DELETE SET NULL,
  enrolled_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_activity   TIMESTAMPTZ,
  UNIQUE (org_id, customer_id)
);

CREATE TABLE IF NOT EXISTS public.loyalty_transactions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  member_id        UUID NOT NULL REFERENCES public.loyalty_members(id) ON DELETE CASCADE,
  transaction_type TEXT NOT NULL DEFAULT 'earn',
  points           INTEGER NOT NULL DEFAULT 0,
  balance_after    INTEGER NOT NULL DEFAULT 0,
  description      TEXT NOT NULL DEFAULT '',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Lotes y vencimientos ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.product_batches (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  product_id       UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  lot_number       TEXT NOT NULL,
  expiry_date      DATE,
  manufacture_date DATE,
  quantity         INTEGER NOT NULL DEFAULT 0,
  reserved_qty     INTEGER NOT NULL DEFAULT 0,
  unit_cost        NUMERIC(14,4),
  status           TEXT NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active','expired','depleted','quarantine')),
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.batch_movements (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  batch_id      UUID NOT NULL REFERENCES public.product_batches(id) ON DELETE CASCADE,
  movement_type TEXT NOT NULL,
  quantity      INTEGER NOT NULL DEFAULT 0,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Devoluciones (portal RMA) ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.return_reasons (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  requires_photo BOOLEAN NOT NULL DEFAULT false,
  is_active      BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.return_requests (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  rma_number     TEXT NOT NULL,
  customer_id    UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  customer_name  TEXT NOT NULL,
  customer_email TEXT,
  product_id     UUID REFERENCES public.products(id) ON DELETE SET NULL,
  product_name   TEXT NOT NULL,
  quantity       INTEGER NOT NULL DEFAULT 1,
  condition      TEXT NOT NULL DEFAULT 'unopened',
  resolution     TEXT,
  refund_amount  NUMERIC(14,2),
  refund_method  TEXT,
  status         TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','approved','rejected','received','refunded','cancelled')),
  reason_id      UUID REFERENCES public.return_reasons(id) ON DELETE SET NULL,
  reason_text    TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at    TIMESTAMPTZ
);

-- ── Items de bundles / combos ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.product_bundle_items (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  bundle_id  UUID NOT NULL REFERENCES public.product_bundles(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  quantity   INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (bundle_id, product_id)
);

-- ── Seguimientos de CRM ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.crm_followups (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  customer_id    UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  customer_name  TEXT NOT NULL,
  customer_email TEXT,
  customer_phone TEXT,
  follow_up_date DATE NOT NULL,
  notes          TEXT,
  status         TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','done','cancelled')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Índices ─────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_loyalty_members_org ON public.loyalty_members(org_id, current_points DESC);
CREATE INDEX IF NOT EXISTS idx_loyalty_tx_member   ON public.loyalty_transactions(member_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_batches_org         ON public.product_batches(org_id, expiry_date);
CREATE INDEX IF NOT EXISTS idx_batch_mov_batch     ON public.batch_movements(batch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_returns_org         ON public.return_requests(org_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bundle_items_bundle ON public.product_bundle_items(bundle_id);
CREATE INDEX IF NOT EXISTS idx_followups_org       ON public.crm_followups(org_id, status, follow_up_date);

-- ── updated_at ──────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_loyalty_prog_updated ON public.loyalty_programs;
CREATE TRIGGER trg_loyalty_prog_updated BEFORE UPDATE ON public.loyalty_programs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS trg_followups_updated ON public.crm_followups;
CREATE TRIGGER trg_followups_updated BEFORE UPDATE ON public.crm_followups
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── RLS: leen los miembros de la org, escriben owner/admin ─────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'loyalty_programs','loyalty_tiers','loyalty_rewards','loyalty_members',
    'loyalty_transactions','product_batches','batch_movements',
    'return_reasons','return_requests','product_bundle_items','crm_followups'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "org read %1$s" ON public.%1$I', t);
    EXECUTE format(
      'CREATE POLICY "org read %1$s" ON public.%1$I FOR SELECT TO authenticated USING (public.is_org_member(org_id, auth.uid()))', t);
    EXECUTE format('DROP POLICY IF EXISTS "admin write %1$s" ON public.%1$I', t);
    EXECUTE format(
      'CREATE POLICY "admin write %1$s" ON public.%1$I FOR ALL TO authenticated USING (public.has_org_role(org_id, auth.uid(), ARRAY[''owner'',''admin''])) WITH CHECK (public.has_org_role(org_id, auth.uid(), ARRAY[''owner'',''admin'']))', t);
  END LOOP;
END $$;
