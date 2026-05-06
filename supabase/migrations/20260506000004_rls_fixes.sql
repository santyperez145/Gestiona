-- ============================================================================
-- RLS FIXES — 2026-05-06
-- Fixes overly restrictive / missing row-level-security policies across
-- all tables that are accessed from the frontend.
-- Every statement is idempotent (DROP IF EXISTS + CREATE OR REPLACE / IF NOT EXISTS).
-- ============================================================================


-- ═══════════════════════════════════════════════════════════════════════════
-- 1. influencer_exchanges
--    OLD: owner/admin only  →  NEW: all org members (same pattern as every
--    other org-scoped table). Anyone in the org can create/manage canjes.
-- ═══════════════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "Org admins manage exchanges"  ON public.influencer_exchanges;
DROP POLICY IF EXISTS "Admin manages exchanges"      ON public.influencer_exchanges;
DROP POLICY IF EXISTS "Users manage own exchanges"   ON public.influencer_exchanges;

CREATE POLICY "org_members_manage_exchanges" ON public.influencer_exchanges
  FOR ALL TO authenticated
  USING (org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid()))
  WITH CHECK (org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid()));


-- ═══════════════════════════════════════════════════════════════════════════
-- 2. marketing_templates
--    PUBLIC templates can only be read, not updated, by non-owners.
--    likes / uses_count increments fail silently in the UI.
--    Add a permissive UPDATE policy so any authenticated user can update
--    public templates (e.g. increment likes/uses_count).
-- ═══════════════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "marketing_templates_public_update" ON public.marketing_templates;
CREATE POLICY "marketing_templates_public_update" ON public.marketing_templates
  FOR UPDATE TO authenticated
  USING (is_public = true)
  WITH CHECK (is_public = true);


-- ═══════════════════════════════════════════════════════════════════════════
-- 3. stripe_events
--    No RLS was enabled. Service-role (edge functions) bypasses RLS anyway,
--    but we should still lock the table so no authenticated user can read or
--    write event IDs directly from the client.
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE public.stripe_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "stripe_events_no_client_access" ON public.stripe_events;
CREATE POLICY "stripe_events_no_client_access" ON public.stripe_events
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (false);   -- clients never access this table; service_role bypasses RLS


-- ═══════════════════════════════════════════════════════════════════════════
-- 4. customer_notes
--    Table exists (in types.ts) but may be missing RLS policies.
--    Ensure the table + policies exist so the data-export in SettingsPage
--    and any future writes don't get blocked.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.customer_notes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  customer_name text NOT NULL,
  notes         text NOT NULL DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, customer_name)
);

ALTER TABLE public.customer_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_members_manage_customer_notes" ON public.customer_notes;
CREATE POLICY "org_members_manage_customer_notes" ON public.customer_notes
  FOR ALL TO authenticated
  USING (org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid()))
  WITH CHECK (org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid()));

CREATE INDEX IF NOT EXISTS customer_notes_org_name_idx
  ON public.customer_notes(org_id, customer_name);


-- ═══════════════════════════════════════════════════════════════════════════
-- 5. stock_history
--    StockCountPage inserts into this table (best-effort via allSettled).
--    Create it so the inserts succeed instead of being silently swallowed.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.stock_history (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  product_id   uuid REFERENCES public.products(id) ON DELETE SET NULL,
  product_name text NOT NULL,
  change       integer NOT NULL,
  new_stock    integer NOT NULL,
  reason       text,
  created_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.stock_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_members_manage_stock_history" ON public.stock_history;
CREATE POLICY "org_members_manage_stock_history" ON public.stock_history
  FOR ALL TO authenticated
  USING (org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid()))
  WITH CHECK (org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid()));

CREATE INDEX IF NOT EXISTS stock_history_org_product_idx
  ON public.stock_history(org_id, product_id, created_at DESC);


-- ═══════════════════════════════════════════════════════════════════════════
-- 6. webhook_deliveries
--    Only has SELECT policy. Service-role inserts bypass RLS, but add an
--    explicit INSERT policy for the edge-function pattern where the client
--    anon/service key is used.
--    (No change needed — service_role bypasses RLS entirely. Document only.)
-- ═══════════════════════════════════════════════════════════════════════════
-- Nothing to do: edge functions use service_role which bypasses RLS.


-- ═══════════════════════════════════════════════════════════════════════════
-- 7. admin_audit_logs
--    Only has SELECT policy for platform_admins. Inserts come from edge
--    functions via service_role (bypasses RLS). No change needed.
-- ═══════════════════════════════════════════════════════════════════════════
-- Nothing to do: edge functions use service_role which bypasses RLS.


-- ═══════════════════════════════════════════════════════════════════════════
-- 8. financial_movements / customer_payments
--    These were added in 20260505_operational_ledgers.sql with correct RLS.
--    Verify they are covered here idempotently.
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE IF EXISTS public.financial_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.customer_payments   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_members_manage_financial_movements" ON public.financial_movements;
CREATE POLICY "org_members_manage_financial_movements" ON public.financial_movements
  FOR ALL TO authenticated
  USING (org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid()))
  WITH CHECK (org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "org_members_manage_customer_payments" ON public.customer_payments;
CREATE POLICY "org_members_manage_customer_payments" ON public.customer_payments
  FOR ALL TO authenticated
  USING (org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid()))
  WITH CHECK (org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid()));
