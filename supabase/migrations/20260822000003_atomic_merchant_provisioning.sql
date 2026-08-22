-- F1: alta de comercios repetible, atómica y sin exponer sesiones del owner.
--
-- La implementación anterior coordinaba cinco escrituras desde una Edge
-- Function, ignoraba errores intermedios y, si el email ya tenía una org,
-- renombraba ese negocio en vez de crear uno nuevo. Este RPC deja una sola
-- autoridad transaccional e idempotente para org + owner + plan + ajustes.

CREATE TABLE IF NOT EXISTS public.platform_organization_provisionings (
  idempotency_key uuid PRIMARY KEY,
  requested_by uuid NOT NULL,
  owner_user_id uuid NOT NULL,
  org_id uuid NOT NULL UNIQUE REFERENCES public.organizations(id) ON DELETE CASCADE,
  org_name text NOT NULL CHECK (char_length(org_name) BETWEEN 2 AND 120),
  plan_id uuid NOT NULL REFERENCES public.plans(id),
  trial_days integer NOT NULL CHECK (trial_days BETWEEN 0 AND 365),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_org_provisionings_requester
  ON public.platform_organization_provisionings (requested_by, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_org_provisionings_owner
  ON public.platform_organization_provisionings (owner_user_id, created_at DESC);

ALTER TABLE public.platform_organization_provisionings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_organization_provisionings FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.provision_platform_organization(
  p_idempotency_key uuid,
  p_owner_user_id uuid,
  p_name text,
  p_plan_id uuid DEFAULT NULL,
  p_trial_days integer DEFAULT 14
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_actor_email text := NULLIF(btrim(COALESCE(auth.jwt()->>'email', '')), '');
  v_name text := btrim(COALESCE(p_name, ''));
  v_plan public.plans;
  v_existing public.platform_organization_provisionings;
  v_org_id uuid;
  v_slug text;
  v_trial_ends_at timestamptz;
BEGIN
  IF v_actor IS NULL OR NOT public.has_platform_role(ARRAY['superadmin'], v_actor) THEN
    RAISE EXCEPTION 'Unauthorized: requires platform superadmin';
  END IF;
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'Idempotency key is required';
  END IF;
  IF p_owner_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM auth.users user_account WHERE user_account.id = p_owner_user_id
  ) THEN
    RAISE EXCEPTION 'Owner user not found';
  END IF;
  IF char_length(v_name) < 2 OR char_length(v_name) > 120 THEN
    RAISE EXCEPTION 'Organization name must contain between 2 and 120 characters';
  END IF;
  IF p_trial_days IS NULL OR p_trial_days < 0 OR p_trial_days > 365 THEN
    RAISE EXCEPTION 'Trial days must be between 0 and 365';
  END IF;

  SELECT plan.* INTO v_plan
  FROM public.plans plan
  WHERE plan.active
    AND (
      (p_plan_id IS NOT NULL AND plan.id = p_plan_id)
      OR (p_plan_id IS NULL AND plan.code = 'trial')
    )
  ORDER BY CASE WHEN plan.id = p_plan_id THEN 0 ELSE 1 END
  LIMIT 1;
  IF v_plan.id IS NULL THEN
    RAISE EXCEPTION 'Active provisioning plan not found';
  END IF;

  SELECT provisioning.* INTO v_existing
  FROM public.platform_organization_provisionings provisioning
  WHERE provisioning.idempotency_key = p_idempotency_key
  FOR UPDATE;

  IF v_existing.idempotency_key IS NOT NULL THEN
    IF v_existing.requested_by <> v_actor
       OR v_existing.owner_user_id <> p_owner_user_id
       OR v_existing.org_name <> v_name
       OR v_existing.plan_id <> v_plan.id
       OR v_existing.trial_days <> p_trial_days THEN
      RAISE EXCEPTION 'Idempotency key was already used with different provisioning data';
    END IF;
    RETURN jsonb_build_object(
      'org_id', v_existing.org_id,
      'owner_user_id', v_existing.owner_user_id,
      'idempotency_key', v_existing.idempotency_key,
      'created', false
    );
  END IF;

  -- El Core admite varias membresías, pero el alta de un comercio nuevo no
  -- reutiliza una identidad ya vinculada: todavía existen superficies públicas
  -- legacy identificadas por owner. Rechazar es seguro; renombrar otra org no.
  IF EXISTS (
    SELECT 1 FROM public.memberships membership
    WHERE membership.user_id = p_owner_user_id
  ) THEN
    RAISE EXCEPTION 'Owner already belongs to a Gestiona organization';
  END IF;

  v_trial_ends_at := now() + make_interval(days => p_trial_days);
  -- El sufijo determinístico evita que dos altas concurrentes del mismo nombre
  -- compitan por el slug; la key sigue siendo la autoridad del retry.
  v_slug := public.generate_org_slug(
    v_name || '-' || substring(p_idempotency_key::text from 1 for 8)
  );

  INSERT INTO public.organizations (
    name, slug, owner_user_id, plan_id, trial_ends_at
  ) VALUES (
    v_name, v_slug, p_owner_user_id, v_plan.id, v_trial_ends_at
  )
  RETURNING id INTO v_org_id;

  INSERT INTO public.memberships (org_id, user_id, role, invited_by)
  VALUES (v_org_id, p_owner_user_id, 'owner', v_actor);

  INSERT INTO public.subscriptions (
    org_id, plan_id, status, current_period_start, current_period_end
  ) VALUES (
    v_org_id, v_plan.id, 'trialing', now(), v_trial_ends_at
  );

  INSERT INTO public.settings (org_id, user_id, business_name)
  VALUES (v_org_id, p_owner_user_id, v_name);

  INSERT INTO public.platform_organization_provisionings (
    idempotency_key, requested_by, owner_user_id, org_id, org_name, plan_id, trial_days
  ) VALUES (
    p_idempotency_key, v_actor, p_owner_user_id, v_org_id, v_name, v_plan.id, p_trial_days
  );

  INSERT INTO public.admin_audit_logs (
    admin_user_id, admin_email, action, target_org_id, target_user_id, details
  ) VALUES (
    v_actor,
    v_actor_email,
    'provisionOrganization',
    v_org_id,
    p_owner_user_id,
    jsonb_build_object(
      'idempotency_key', p_idempotency_key,
      'plan_id', v_plan.id,
      'trial_days', p_trial_days,
      'delivery', 'email_only'
    )
  );

  RETURN jsonb_build_object(
    'org_id', v_org_id,
    'owner_user_id', p_owner_user_id,
    'idempotency_key', p_idempotency_key,
    'created', true
  );
END;
$$;

REVOKE ALL ON FUNCTION public.provision_platform_organization(uuid, uuid, text, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.provision_platform_organization(uuid, uuid, text, uuid, integer) TO authenticated;

-- Los usuarios creados por Platform esperan al RPC anterior. El trigger no
-- debe fabricarles primero un workspace genérico que luego haya que mutar.
CREATE OR REPLACE FUNCTION public.handle_new_user_create_org()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_org_id uuid;
  display_name text;
  trial_plan_id uuid;
BEGIN
  IF COALESCE(NEW.raw_user_meta_data->>'account_type', '') IN (
    'store_customer',
    'platform_invited_owner'
  ) THEN
    RETURN NEW;
  END IF;

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

  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF has_table_privilege('authenticated', 'public.platform_organization_provisionings', 'SELECT')
     OR has_table_privilege('authenticated', 'public.platform_organization_provisionings', 'INSERT')
     OR has_table_privilege('authenticated', 'public.platform_organization_provisionings', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.platform_organization_provisionings', 'DELETE') THEN
    RAISE EXCEPTION 'Authenticated can access raw platform provisionings';
  END IF;
END;
$$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260822000003', 'atomic_merchant_provisioning') ON CONFLICT DO NOTHING;
