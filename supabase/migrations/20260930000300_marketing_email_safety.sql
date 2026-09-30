-- Stop the legacy "Te extrañamos" digest: it emailed an admin a list of
-- customer names every morning. Existing rules stay visible, but paused.
UPDATE public.automation_flows
SET active = false
WHERE name = 'Reactivación: sin comprar 30 días'
  AND trigger_type = 'customer_inactive'
  AND action_type = 'email'
  AND action_config->>'subject' = 'Te extrañamos';

-- New organizations get an in-app alert, never an unsolicited marketing email.
CREATE OR REPLACE FUNCTION public.seed_default_automation_flows(p_org_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_org_id IS NULL THEN
    RAISE EXCEPTION 'org_id requerido';
  END IF;

  INSERT INTO public.automation_flows (
    org_id, name, trigger_type, trigger_config, action_type, action_config, active
  )
  SELECT p_org_id, 'Clientes sin comprar: aviso interno', 'customer_inactive',
    '{"days": 30}'::jsonb, 'notification',
    '{"message": "Hay clientes para revisar en el segmento inactivos."}'::jsonb, true
  WHERE NOT EXISTS (
    SELECT 1 FROM public.automation_flows
    WHERE org_id = p_org_id AND trigger_type = 'customer_inactive'
      AND action_type = 'notification'
  );

  INSERT INTO public.automation_flows (
    org_id, name, trigger_type, trigger_config, action_type, action_config, active
  )
  SELECT p_org_id, 'Stock bajo: aviso interno', 'low_stock',
    '{"threshold": 5}'::jsonb, 'notification',
    '{"message": "Hay productos con stock bajo. Revisá reposición."}'::jsonb, true
  WHERE NOT EXISTS (
    SELECT 1 FROM public.automation_flows
    WHERE org_id = p_org_id AND trigger_type = 'low_stock'
      AND action_type = 'notification'
  );

  INSERT INTO public.automation_flows (
    org_id, name, trigger_type, trigger_config, action_type, action_config, active
  )
  SELECT p_org_id, 'Sin stock: aviso interno', 'stock_out',
    '{}'::jsonb, 'notification',
    '{"message": "Un producto se quedó sin stock."}'::jsonb, true
  WHERE NOT EXISTS (
    SELECT 1 FROM public.automation_flows
    WHERE org_id = p_org_id AND trigger_type = 'stock_out'
      AND action_type = 'notification'
  );

  INSERT INTO public.automation_flows (
    org_id, name, trigger_type, trigger_config, action_type, action_config, active
  )
  SELECT p_org_id, 'Nuevo cliente: tarea de bienvenida', 'new_customer',
    '{}'::jsonb, 'create_task',
    '{"task_priority": "medium", "task_due_days": 3, "message": "Contactar nuevo cliente y dar bienvenida"}'::jsonb, true
  WHERE NOT EXISTS (
    SELECT 1 FROM public.automation_flows
    WHERE org_id = p_org_id AND trigger_type = 'new_customer'
      AND action_type = 'create_task'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.seed_default_automation_flows(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seed_default_automation_flows(uuid) TO service_role;

-- One server-side rule for campaigns and drip sequences. A previous opt-out
-- or provider suppression always wins over an opt-in on a CRM record.
CREATE OR REPLACE FUNCTION public.marketing_email_eligible(p_org_id uuid, p_email text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p_org_id IS NOT NULL
    AND NULLIF(lower(btrim(p_email)), '') IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.customers c
      WHERE c.org_id = p_org_id
        AND lower(btrim(c.email)) = lower(btrim(p_email))
        AND c.marketing_consent_at IS NOT NULL
        AND (c.marketing_opt_out_at IS NULL OR c.marketing_opt_out_at < c.marketing_consent_at)
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.customers revoked
      WHERE revoked.org_id = p_org_id
        AND lower(btrim(revoked.email)) = lower(btrim(p_email))
        AND revoked.marketing_opt_out_at IS NOT NULL
        AND (revoked.marketing_consent_at IS NULL OR revoked.marketing_opt_out_at >= revoked.marketing_consent_at)
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.email_unsubscribes u
      WHERE u.org_id = p_org_id AND lower(btrim(u.email)) = lower(btrim(p_email))
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.email_suppressions s
      WHERE s.org_id = p_org_id AND lower(btrim(s.email)) = lower(btrim(p_email))
    );
$$;

REVOKE ALL ON FUNCTION public.marketing_email_eligible(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.marketing_email_eligible(uuid, text) TO service_role;

-- Keep old unsubscribe links valid on retries. The original sender tried an
-- upsert on (campaign_id,email) without a unique constraint and ignored 42P10.
WITH ranked AS (
  SELECT id, row_number() OVER (
    PARTITION BY campaign_id, lower(btrim(email)) ORDER BY created_at, id
  ) AS position
  FROM public.email_campaign_unsubscribe_tokens
)
DELETE FROM public.email_campaign_unsubscribe_tokens t
USING ranked r
WHERE t.id = r.id AND r.position > 1;

UPDATE public.email_campaign_unsubscribe_tokens
SET email = lower(btrim(email))
WHERE email <> lower(btrim(email));

CREATE UNIQUE INDEX IF NOT EXISTS email_campaign_unsubscribe_pair_uidx
  ON public.email_campaign_unsubscribe_tokens(campaign_id, email);

CREATE OR REPLACE FUNCTION public.campaign_unsubscribe_token(p_campaign_id uuid, p_email text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org_id uuid;
  v_email text := lower(btrim(p_email));
  v_token text;
BEGIN
  IF v_email IS NULL OR v_email = '' THEN
    RAISE EXCEPTION 'email requerido';
  END IF;
  SELECT org_id INTO v_org_id FROM public.email_campaigns WHERE id = p_campaign_id;
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'campaña no encontrada';
  END IF;

  INSERT INTO public.email_campaign_unsubscribe_tokens (token, campaign_id, org_id, email)
  VALUES (encode(extensions.gen_random_bytes(32), 'hex'), p_campaign_id, v_org_id, v_email)
  ON CONFLICT (campaign_id, email) DO UPDATE
    SET expires_at = GREATEST(public.email_campaign_unsubscribe_tokens.expires_at, now() + interval '90 days')
  RETURNING token INTO v_token;
  RETURN v_token;
END;
$$;

REVOKE ALL ON FUNCTION public.campaign_unsubscribe_token(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.campaign_unsubscribe_token(uuid, text) TO service_role;

-- The browser must never acquire the campaign send lock by writing status.
ALTER TABLE public.email_campaigns
  ADD COLUMN IF NOT EXISTS sending_started_at timestamptz;

CREATE OR REPLACE FUNCTION public.claim_email_campaign(p_campaign_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
BEGIN
  UPDATE public.email_campaigns
  SET status = 'sending', sending_started_at = now()
  WHERE id = p_campaign_id AND status = 'draft'
  RETURNING id INTO v_id;
  RETURN v_id IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_email_campaign(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_email_campaign(uuid) TO service_role;

-- A CRM selection or A/B cohort is stored with the draft. Passing emails in
-- a request body would let the browser alter the audience at send time.
ALTER TABLE public.email_campaigns
  ADD COLUMN IF NOT EXISTS target_customer_ids uuid[];

COMMENT ON COLUMN public.email_campaigns.target_customer_ids IS
  'Optional saved CRM cohort; the sender still rechecks tenant, consent and suppression for every customer.';

NOTIFY pgrst, 'reload schema';
