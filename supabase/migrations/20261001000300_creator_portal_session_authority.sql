BEGIN;

-- Per-schema REVOKE cannot subtract PostgreSQL's global PUBLIC default.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;

REVOKE ALL ON FUNCTION public.recompute_contract_signed(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.creator_campaigns() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.creator_campaigns() TO authenticated;

-- Legacy ALL policies allowed any member and the original author to mutate.
DROP POLICY IF EXISTS org_members_manage_exchanges ON public.influencer_exchanges;
DROP POLICY IF EXISTS users_manage_own_exchanges ON public.influencer_exchanges;
DROP POLICY IF EXISTS creator_exchange_brand_read ON public.influencer_exchanges;
DROP POLICY IF EXISTS creator_exchange_brand_insert ON public.influencer_exchanges;
DROP POLICY IF EXISTS creator_exchange_brand_update ON public.influencer_exchanges;
DROP POLICY IF EXISTS creator_exchange_brand_delete ON public.influencer_exchanges;
CREATE POLICY creator_exchange_brand_read ON public.influencer_exchanges
  FOR SELECT TO authenticated USING (public.can_manage_influencers(org_id, 'view'));
CREATE POLICY creator_exchange_brand_insert ON public.influencer_exchanges
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid() AND public.can_manage_influencers(org_id, 'create'));
CREATE POLICY creator_exchange_brand_update ON public.influencer_exchanges
  FOR UPDATE TO authenticated USING (public.can_manage_influencers(org_id, 'edit'))
  WITH CHECK (public.can_manage_influencers(org_id, 'edit'));
CREATE POLICY creator_exchange_brand_delete ON public.influencer_exchanges
  FOR DELETE TO authenticated USING (public.can_manage_influencers(org_id, 'delete'));
REVOKE ALL ON TABLE public.influencer_exchanges FROM PUBLIC, anon;
REVOKE UPDATE ON TABLE public.influencer_exchanges FROM authenticated;
-- Identity, tenancy and submitted evidence are changed exclusively by RPCs.
GRANT UPDATE (influencer_name,influencer_instagram,influencer_followers,product_id,
  product_name,quantity,product_value_ars,exchange_type,status,expected_posts,
  actual_posts,notes,delivery_date,goal_notes,sales_generated_ars,discount_code)
  ON public.influencer_exchanges TO authenticated;

CREATE UNIQUE INDEX IF NOT EXISTS influencers_creator_org_identity ON public.influencers(id,org_id);
DO $constraint$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.influencer_exchanges'::regclass
    AND conname = 'influencer_exchanges_creator_org_fk') THEN
    ALTER TABLE public.influencer_exchanges ADD CONSTRAINT influencer_exchanges_creator_org_fk
      FOREIGN KEY(influencer_id,org_id) REFERENCES public.influencers(id,org_id);
  END IF;
END
$constraint$;

CREATE OR REPLACE FUNCTION public.creator_exchanges()
RETURNS TABLE (
  id uuid, org_name text, product_name text, quantity integer, status text,
  exchange_type text, expected_posts integer, actual_posts integer,
  content_url text, content_submitted_at timestamptz, delivery_date timestamptz,
  goal_notes text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT e.id, o.name, e.product_name, e.quantity, e.status, e.exchange_type,
    e.expected_posts, e.actual_posts, e.content_url, e.content_submitted_at,
    e.delivery_date, e.goal_notes
  FROM public.influencer_exchanges e
  JOIN public.influencers i ON i.id = e.influencer_id AND i.org_id = e.org_id
  JOIN public.organizations o ON o.id = e.org_id
  JOIN public.creator_accounts a ON a.user_id = auth.uid()
  JOIN auth.users u ON u.id = a.user_id AND lower(u.email) = lower(a.email)
    AND u.email_confirmed_at IS NOT NULL
  WHERE lower(i.email) = lower(a.email)
  ORDER BY e.created_at DESC, e.id;
END
$function$;

CREATE OR REPLACE FUNCTION public.creator_submit_exchange_content(
  p_exchange_id uuid, p_content_url text, p_actual_posts integer
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE v_exchange public.influencer_exchanges%ROWTYPE; v_url text := btrim(p_content_url);
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501';
  END IF;
  SELECT e.* INTO v_exchange
  FROM public.influencer_exchanges e
  JOIN public.influencers i ON i.id = e.influencer_id AND i.org_id = e.org_id
  JOIN public.creator_accounts a ON a.user_id = auth.uid()
  JOIN auth.users u ON u.id = a.user_id AND lower(u.email) = lower(a.email)
    AND u.email_confirmed_at IS NOT NULL
  WHERE e.id = p_exchange_id AND lower(i.email) = lower(a.email)
  FOR UPDATE OF e;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'exchange_access_denied' USING ERRCODE = '42501';
  END IF;
  IF v_exchange.status IN ('cumplido', 'cancelado', 'rechazado', 'completado', 'finalizado', 'completed', 'cancelled') THEN
    RAISE EXCEPTION 'exchange_closed' USING ERRCODE = '55000';
  END IF;
  IF v_url IS NULL OR length(v_url) > 2048
    OR v_url !~ '^https://[A-Za-z0-9][A-Za-z0-9.-]*(:[0-9]{1,5})?(/[^[:space:]]*)?$'
    OR p_actual_posts IS NULL OR p_actual_posts < 1 OR p_actual_posts > 1000 THEN
    RAISE EXCEPTION 'exchange_content_invalid' USING ERRCODE = '22023';
  END IF;
  IF v_exchange.content_url = v_url AND v_exchange.actual_posts = p_actual_posts THEN RETURN true; END IF;
  IF NOT public.rate_limit_consumir('creator_exchange_content', auth.uid()::text, 20, interval '1 day') THEN
    RAISE EXCEPTION 'exchange_rate_limited' USING ERRCODE = '53400';
  END IF;
  UPDATE public.influencer_exchanges SET content_url = v_url,
    actual_posts = p_actual_posts, content_submitted_at = now(), updated_at = now()
  WHERE id = v_exchange.id;
  -- Declared publication is evidence for the brand, not automatic approval.
  RETURN true;
END
$function$;

CREATE OR REPLACE FUNCTION public.brand_link_creator_exchange(p_exchange_id uuid, p_influencer_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE v_exchange public.influencer_exchanges%ROWTYPE;
BEGIN
  SELECT * INTO v_exchange FROM public.influencer_exchanges WHERE id = p_exchange_id FOR UPDATE;
  IF NOT FOUND OR NOT public.can_manage_influencers(v_exchange.org_id, 'edit') THEN
    RAISE EXCEPTION 'exchange_access_denied' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.influencers
    WHERE id = p_influencer_id AND org_id = v_exchange.org_id AND btrim(coalesce(email, '')) <> '') THEN
    RAISE EXCEPTION 'exchange_creator_invalid' USING ERRCODE = '22023';
  END IF;
  IF v_exchange.influencer_id = p_influencer_id THEN RETURN true; END IF;
  IF v_exchange.content_submitted_at IS NOT NULL THEN
    RAISE EXCEPTION 'exchange_already_submitted' USING ERRCODE = '55000';
  END IF;
  UPDATE public.influencer_exchanges SET influencer_id = p_influencer_id, updated_at = now()
  WHERE id = v_exchange.id;
  RETURN true;
END
$function$;

REVOKE ALL ON FUNCTION public.creator_exchanges() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.creator_submit_exchange_content(uuid,text,integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.brand_link_creator_exchange(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.creator_exchanges(),
  public.creator_submit_exchange_content(uuid,text,integer),
  public.brand_link_creator_exchange(uuid,uuid) TO authenticated;

-- No CASCADE: an unexpected dependent object must abort the migration.
DROP FUNCTION IF EXISTS public.get_creator_earnings(text);
DROP FUNCTION IF EXISTS public.request_creator_withdrawal(text,numeric);
DROP FUNCTION IF EXISTS public.list_creator_withdrawals(text);
DROP FUNCTION IF EXISTS public.get_influencer_portal(text);
DROP FUNCTION IF EXISTS public.submit_influencer_content(text,uuid,text,integer);

DELETE FROM public.security_function_contracts WHERE function_name IN (
  'get_creator_earnings','request_creator_withdrawal','list_creator_withdrawals',
  'get_influencer_portal','submit_influencer_content','recompute_contract_signed'
);
INSERT INTO public.security_function_contracts
  (function_name,identity_arguments,audience,rationale,definition_hash,reviewed_on)
SELECT p.proname, pg_get_function_identity_arguments(p.oid), 'authenticated_delegate',
  CASE WHEN p.proname = 'brand_link_creator_exchange' THEN
    'Vinculacion explicita de un perfil de la misma organizacion por owner/admin con influencers.view/edit; bloquea reasignar entregas.'
  ELSE 'Solo canjes ligados por influencer_id y org_id al email confirmado de la sesion; sin tokens ni aprobacion automatica.' END,
  md5(pg_get_functiondef(p.oid)), current_date
FROM pg_proc p WHERE p.oid IN (
  'public.creator_exchanges()'::regprocedure,
  'public.creator_submit_exchange_content(uuid,text,integer)'::regprocedure,
  'public.brand_link_creator_exchange(uuid,uuid)'::regprocedure
)
ON CONFLICT(function_name,identity_arguments) DO UPDATE SET
  rationale = EXCLUDED.rationale, definition_hash = EXCLUDED.definition_hash, reviewed_on = EXCLUDED.reviewed_on;

NOTIFY pgrst, 'reload schema';
COMMIT;
