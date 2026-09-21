-- Afiliados y referidos son canales distintos de Influencers. Se recuperan
-- sólo después de reemplazar políticas heredadas por permisos del módulo y de
-- hacer atómica la preparación de una liquidación (no mueve dinero).

DROP POLICY IF EXISTS "org_affiliates" ON public.affiliate_partners;
DROP POLICY IF EXISTS "affiliate_partners_read" ON public.affiliate_partners;
DROP POLICY IF EXISTS "affiliate_partners_create" ON public.affiliate_partners;
DROP POLICY IF EXISTS "affiliate_partners_edit" ON public.affiliate_partners;
DROP POLICY IF EXISTS "affiliate_partners_delete" ON public.affiliate_partners;
CREATE POLICY "affiliate_partners_read" ON public.affiliate_partners FOR SELECT TO authenticated
USING (public.has_permission(org_id, 'marketing', 'view'));
CREATE POLICY "affiliate_partners_create" ON public.affiliate_partners FOR INSERT TO authenticated
WITH CHECK (public.has_permission(org_id, 'marketing', 'create'));
CREATE POLICY "affiliate_partners_edit" ON public.affiliate_partners FOR UPDATE TO authenticated
USING (public.has_permission(org_id, 'marketing', 'edit')) WITH CHECK (public.has_permission(org_id, 'marketing', 'edit'));
CREATE POLICY "affiliate_partners_delete" ON public.affiliate_partners FOR DELETE TO authenticated
USING (public.has_permission(org_id, 'marketing', 'delete'));

DROP POLICY IF EXISTS "org_aff_conversions" ON public.affiliate_conversions;
DROP POLICY IF EXISTS "affiliate_conversions_read" ON public.affiliate_conversions;
DROP POLICY IF EXISTS "affiliate_conversions_create" ON public.affiliate_conversions;
DROP POLICY IF EXISTS "affiliate_conversions_edit" ON public.affiliate_conversions;
CREATE POLICY "affiliate_conversions_read" ON public.affiliate_conversions FOR SELECT TO authenticated
USING (public.has_permission(org_id, 'marketing', 'view'));
CREATE POLICY "affiliate_conversions_create" ON public.affiliate_conversions FOR INSERT TO authenticated
WITH CHECK (public.has_permission(org_id, 'marketing', 'create'));
CREATE POLICY "affiliate_conversions_edit" ON public.affiliate_conversions FOR UPDATE TO authenticated
USING (public.has_permission(org_id, 'marketing', 'edit')) WITH CHECK (public.has_permission(org_id, 'marketing', 'edit'));

DROP POLICY IF EXISTS "org_aff_payouts" ON public.affiliate_payouts;
DROP POLICY IF EXISTS "affiliate_payouts_read" ON public.affiliate_payouts;
DROP POLICY IF EXISTS "affiliate_payouts_create" ON public.affiliate_payouts;
DROP POLICY IF EXISTS "affiliate_payouts_edit" ON public.affiliate_payouts;
CREATE POLICY "affiliate_payouts_read" ON public.affiliate_payouts FOR SELECT TO authenticated
USING (public.has_permission(org_id, 'marketing', 'view'));
CREATE POLICY "affiliate_payouts_create" ON public.affiliate_payouts FOR INSERT TO authenticated
WITH CHECK (public.has_permission(org_id, 'marketing', 'edit'));
CREATE POLICY "affiliate_payouts_edit" ON public.affiliate_payouts FOR UPDATE TO authenticated
USING (public.has_permission(org_id, 'marketing', 'edit')) WITH CHECK (public.has_permission(org_id, 'marketing', 'edit'));

DROP POLICY IF EXISTS "referrals_org_access" ON public.customer_referrals;
DROP POLICY IF EXISTS "customer_referrals_read" ON public.customer_referrals;
DROP POLICY IF EXISTS "customer_referrals_create" ON public.customer_referrals;
DROP POLICY IF EXISTS "customer_referrals_edit" ON public.customer_referrals;
DROP POLICY IF EXISTS "customer_referrals_delete" ON public.customer_referrals;
CREATE POLICY "customer_referrals_read" ON public.customer_referrals FOR SELECT TO authenticated
USING (public.has_permission(org_id, 'marketing', 'view'));
CREATE POLICY "customer_referrals_create" ON public.customer_referrals FOR INSERT TO authenticated
WITH CHECK (public.has_permission(org_id, 'marketing', 'create'));
CREATE POLICY "customer_referrals_edit" ON public.customer_referrals FOR UPDATE TO authenticated
USING (public.has_permission(org_id, 'marketing', 'edit')) WITH CHECK (public.has_permission(org_id, 'marketing', 'edit'));
CREATE POLICY "customer_referrals_delete" ON public.customer_referrals FOR DELETE TO authenticated
USING (public.has_permission(org_id, 'marketing', 'delete'));

CREATE OR REPLACE FUNCTION public.affiliate_payout_prepare(p_org_id uuid, p_partner_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE v_partner public.affiliate_partners%ROWTYPE; v_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_permission(p_org_id, 'marketing', 'edit') THEN
    RAISE EXCEPTION 'No tenés permiso para preparar liquidaciones' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_partner FROM public.affiliate_partners
  WHERE id = p_partner_id AND org_id = p_org_id FOR UPDATE;
  IF v_partner.id IS NULL THEN RAISE EXCEPTION 'El afiliado no existe'; END IF;
  IF v_partner.pending_payout <= 0 THEN RAISE EXCEPTION 'El afiliado no tiene comisión liquidable' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM public.affiliate_payouts WHERE org_id = p_org_id AND partner_id = p_partner_id AND status = 'pending') THEN
    RAISE EXCEPTION 'Ya existe una liquidación pendiente para este afiliado' USING ERRCODE = '23505';
  END IF;
  INSERT INTO public.affiliate_payouts(partner_id, org_id, amount, currency, status, notes)
  VALUES (p_partner_id, p_org_id, v_partner.pending_payout, 'ARS', 'pending', 'Preparada en Nerqia; pago externo pendiente')
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.affiliate_payout_prepare(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.affiliate_payout_prepare(uuid, uuid) TO authenticated;
