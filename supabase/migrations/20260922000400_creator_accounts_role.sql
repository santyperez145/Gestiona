-- ============================================================================
-- Cuentas de creadores (influencers) — paridad Go-Marz
-- Un creador NO es un comercio: no necesita organización, ni membresía,
-- ni trial. El rol viaja en el metadata del signup (`account_type='creator'`)
-- y este trigger lo protege de recibir un workspace vacío.
--
-- La cuenta se vincula con el perfil de creador (influencers) por email:
-- la marca registra al creador (influencers.email) y cuando ese email se
-- registra en Nerqia como creator, el portal muestra SUS campañas, entregables
-- e ingresos — sin importar cuántas marcas lo contraten.
-- ============================================================================

-- ── Tabla de cuentas de creador ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.creator_accounts (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  display_name TEXT,
  avatar_url TEXT,
  bio TEXT CHECK (char_length(bio) <= 2000),
  phone TEXT,
  instagram TEXT,
  tiktok TEXT,
  youtube TEXT,
  onboarding_completed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_creator_accounts_email ON public.creator_accounts(email);

CREATE TRIGGER trg_creator_accounts_updated BEFORE UPDATE ON public.creator_accounts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.creator_accounts ENABLE ROW LEVEL SECURITY;

-- El creador ve y edita SOLO su fila. Es dueño de su perfil público.
CREATE POLICY creator_accounts_self ON public.creator_accounts FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

REVOKE ALL ON public.creator_accounts FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.creator_accounts TO authenticated;

-- ── El rol creator no recibe organización ni trial ──────────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user_create_org()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(NEW.raw_user_meta_data->>'account_type', '') IN (
    'store_customer',
    'platform_invited_owner',
    'creator'
  ) THEN
    RETURN NEW;
  END IF;

  -- Comercio normal: crea org + membresía owner + trial + flows.
  -- (cuerpo idéntico a la última migración que lo definió)
  DECLARE
    new_org_id uuid;
    display_name text;
    trial_plan_id uuid;
  BEGIN
    display_name := COALESCE(
      NEW.raw_user_meta_data->>'full_name',
      split_part(NEW.email, '@', 1),
      'Mi Negocio'
    );

    SELECT id INTO trial_plan_id FROM public.plans WHERE code = 'trial' LIMIT 1;

    INSERT INTO public.organizations (name, slug, owner_user_id, plan_id, trial_ends_at)
    VALUES (
      display_name || ' Workspace',
      public.generate_org_slug(display_name),
      NEW.id,
      trial_plan_id,
      now() + interval '14 days'
    )
    RETURNING id INTO new_org_id;

    INSERT INTO public.memberships (org_id, user_id, role)
    VALUES (new_org_id, NEW.id, 'owner');

    INSERT INTO public.subscriptions (org_id, plan_id, status, current_period_end)
    VALUES (new_org_id, trial_plan_id, 'trialing', now() + interval '14 days');

    INSERT INTO public.settings (org_id, user_id, business_name)
    VALUES (new_org_id, NEW.id, display_name)
    ON CONFLICT (org_id) DO NOTHING;

    PERFORM public.seed_default_automation_flows(new_org_id);
  END;

  RETURN NEW;
END;
$$;

-- ── Vincular la cuenta de creador con sus perfiles en marcas ────────────────
-- El perfil de creador (influencers) lo da de alta la marca con su email.
-- Al registrarse, la cuenta encuentra sus filas por email y quedan ligadas.
CREATE OR REPLACE FUNCTION public.creator_linked_profiles(p_user_id uuid)
RETURNS TABLE (
  id uuid,
  org_id uuid,
  org_name text,
  name text,
  instagram text,
  status text,
  commission_percent numeric
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT i.id, i.org_id, o.name, i.name, i.instagram, i.status, i.commission_percent
  FROM public.influencers i
  LEFT JOIN public.organizations o ON o.id = i.org_id
  JOIN public.creator_accounts ca ON ca.user_id = p_user_id
  WHERE lower(i.email) = lower(ca.email)
  ORDER BY i.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.creator_linked_profiles(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.creator_linked_profiles(uuid) TO authenticated;

-- ── Portal del creador autenticado: campañas y entregables por email ────────
-- Un creador puede colaborar con N marcas; ve todo en una sola bandeja.
CREATE OR REPLACE FUNCTION public.creator_campaigns()
RETURNS TABLE (
  id uuid,
  org_id uuid,
  org_name text,
  title text,
  brief text,
  channel text,
  due_date date,
  status text,
  budget_ars numeric,
  invitation_status text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id, c.org_id, o.name, c.title, c.brief, c.channel, c.due_date,
         c.status, c.budget_ars,
         (SELECT ii.status FROM public.influencer_invitations ii
          WHERE ii.campaign_id = c.id AND lower(ii.email) = lower(ca.email)
          ORDER BY ii.created_at DESC LIMIT 1)
  FROM public.influencer_campaigns c
  JOIN public.influencers i ON i.org_id = c.org_id
  JOIN public.creator_accounts ca ON ca.user_id = auth.uid()
  LEFT JOIN public.organizations o ON o.id = c.org_id
  WHERE lower(i.email) = lower(ca.email)
    AND EXISTS (SELECT 1 FROM public.influencer_campaign_creators cc
                WHERE cc.campaign_id = c.id AND cc.influencer_id = i.id)
  ORDER BY c.due_date NULLS LAST, c.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.creator_campaigns() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.creator_campaigns() TO authenticated;

-- ── Entregables del creador autenticado ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.creator_deliverables()
RETURNS TABLE (
  id uuid,
  org_name text,
  campaign_name text,
  description text,
  content_url text,
  due_date date,
  status text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT d.id, o.name, d.campaign_name, d.description, d.content_url, d.due_date, d.status
  FROM public.influencer_deliverables d
  JOIN public.influencers i ON i.id = d.influencer_id
  JOIN public.creator_accounts ca ON ca.user_id = auth.uid()
  LEFT JOIN public.organizations o ON o.id = i.org_id
  WHERE lower(i.email) = lower(ca.email)
  ORDER BY d.due_date NULLS LAST, d.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.creator_deliverables() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.creator_deliverables() TO authenticated;

-- ── Ingresos del creador autenticado (agregado de todas sus marcas) ─────────
CREATE OR REPLACE FUNCTION public.creator_earnings()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_total numeric := 0;
  v_paid numeric := 0;
  v_pending numeric := 0;
  v_sales_count integer := 0;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  WITH mis_perfiles AS (
    SELECT i.id
    FROM public.influencers i
    JOIN public.creator_accounts ca ON ca.user_id = v_user
    WHERE lower(i.email) = lower(ca.email)
  )
  SELECT COALESCE(SUM(s.commission_ars), 0), count(*) INTO v_total, v_sales_count
  FROM public.influencer_sales s
  WHERE s.influencer_id IN (SELECT id FROM mis_perfiles);

  SELECT COALESCE(SUM(p.amount_ars), 0) INTO v_paid
  FROM public.influencer_payouts p
  WHERE p.influencer_id IN (SELECT id FROM mis_perfiles);

  SELECT COALESCE(SUM(w.amount_ars), 0) INTO v_pending
  FROM public.influencer_withdrawal_requests w
  WHERE w.influencer_id IN (SELECT id FROM mis_perfiles)
    AND w.status IN ('pending', 'approved');

  RETURN jsonb_build_object(
    'total_commissions_ars', v_total,
    'total_sales_count', v_sales_count,
    'paid_ars', v_paid,
    'pending_withdrawals_ars', v_pending,
    'available_ars', GREATEST(v_total - v_paid - v_pending, 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.creator_earnings() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.creator_earnings() TO authenticated;

-- ── Perfil propio del creador: upsert ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.creator_upsert_own_profile(p_display_name text, p_bio text, p_phone text, p_instagram text, p_tiktok text, p_youtube text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  INSERT INTO public.creator_accounts (user_id, email, display_name, bio, phone, instagram, tiktok, youtube, onboarding_completed)
  VALUES (auth.uid(), (SELECT email FROM auth.users WHERE id = auth.uid()), p_display_name, p_bio, p_phone, p_instagram, p_tiktok, p_youtube, true)
  ON CONFLICT (user_id) DO UPDATE
    SET display_name = COALESCE(p_display_name, creator_accounts.display_name),
        bio = COALESCE(p_bio, creator_accounts.bio),
        phone = COALESCE(p_phone, creator_accounts.phone),
        instagram = COALESCE(p_instagram, creator_accounts.instagram),
        tiktok = COALESCE(p_tiktok, creator_accounts.tiktok),
        youtube = COALESCE(p_youtube, creator_accounts.youtube),
        onboarding_completed = true,
        updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.creator_upsert_own_profile(text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.creator_upsert_own_profile(text, text, text, text, text, text) TO authenticated;

-- ── Certificación: la tabla y el trigger existen con RLS correcto ───────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'creator_accounts') THEN
    RAISE EXCEPTION 'creator_accounts no existe';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'creator_accounts' AND policyname = 'creator_accounts_self') THEN
    RAISE EXCEPTION 'RLS de creator_accounts sin policy self';
  END IF;
END;
$$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260922000400', 'creator_accounts_role') ON CONFLICT DO NOTHING;
