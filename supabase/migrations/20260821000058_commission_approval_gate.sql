-- Comisión de plataforma: propuesta, aprobación y vigencia auditables.
--
-- Producción tenía una regla base activa de 0,5% mientras PAGOS.md y ROADMAP
-- decían que el pricing seguía sin aprobar. La infraestructura de split estaba
-- funcionando, por lo que una venta nueva habría cobrado esa diferencia.
-- Preservamos el porcentaje como propuesta, pero deja de aplicarse hasta que
-- staff Finance registre motivo, versión de términos, tratamiento fiscal y
-- ventana de vigencia.

ALTER TABLE public.platform_commission_rules
  ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS change_reason text,
  ADD COLUMN IF NOT EXISTS proposed_by uuid,
  ADD COLUMN IF NOT EXISTS proposed_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by uuid,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS terms_version text,
  ADD COLUMN IF NOT EXISTS tax_treatment text,
  ADD COLUMN IF NOT EXISTS tax_rate_pct numeric(6,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS effective_from timestamptz,
  ADD COLUMN IF NOT EXISTS effective_until timestamptz;

DO $constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'platform_commission_rules_approval_status_check'
  ) THEN
    ALTER TABLE public.platform_commission_rules
      ADD CONSTRAINT platform_commission_rules_approval_status_check
      CHECK (approval_status IN ('draft', 'approved', 'retired'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'platform_commission_rules_tax_treatment_check'
  ) THEN
    ALTER TABLE public.platform_commission_rules
      ADD CONSTRAINT platform_commission_rules_tax_treatment_check
      CHECK (tax_treatment IS NULL OR tax_treatment IN ('included', 'added'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'platform_commission_rules_tax_rate_check'
  ) THEN
    ALTER TABLE public.platform_commission_rules
      ADD CONSTRAINT platform_commission_rules_tax_rate_check
      CHECK (tax_rate_pct >= 0 AND tax_rate_pct <= 100);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'platform_commission_rules_effective_window_check'
  ) THEN
    ALTER TABLE public.platform_commission_rules
      ADD CONSTRAINT platform_commission_rules_effective_window_check
      CHECK (effective_until IS NULL OR effective_from IS NULL OR effective_until > effective_from);
  END IF;
END
$constraints$;

COMMENT ON COLUMN public.platform_commission_rules.approval_status IS
  'draft no cobra; approved puede cobrar dentro de su vigencia; retired conserva historia sin aplicar.';
COMMENT ON COLUMN public.platform_commission_rules.terms_version IS
  'Versión de los términos comerciales aceptados por el comercio que informan la comisión.';
COMMENT ON COLUMN public.platform_commission_rules.tax_treatment IS
  'included: el monto de split incluye el impuesto; added: el impuesto se adiciona. Debe validarlo un contador.';

-- Ningún porcentaje histórico queda habilitado en la primera aplicación. La
-- guarda del libro evita que reejecutar esta migración idempotente retire una
-- regla que Finance haya aprobado después.
DO $deactivate_unapproved_legacy_rules$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE version = '20260821000058'
  ) THEN
    UPDATE public.platform_commission_rules
    SET approval_status = 'draft',
        is_active = false,
        approved_by = NULL,
        approved_at = NULL,
        effective_from = NULL,
        effective_until = NULL,
        change_reason = COALESCE(
          NULLIF(btrim(change_reason), ''),
          'Regla preexistente importada; requiere decisión comercial, fiscal y contractual.'
        ),
        updated_at = now();
  END IF;
END
$deactivate_unapproved_legacy_rules$;

CREATE OR REPLACE FUNCTION public.guard_platform_commission_rule_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();

  IF TG_OP = 'INSERT' OR ROW(
    NEW.plan_id, NEW.org_id, NEW.percent, NEW.fixed,
    NEW.max_per_transaction, NEW.min_per_transaction, NEW.applies_to
  ) IS DISTINCT FROM ROW(
    OLD.plan_id, OLD.org_id, OLD.percent, OLD.fixed,
    OLD.max_per_transaction, OLD.min_per_transaction, OLD.applies_to
  ) THEN
    NEW.approval_status := 'draft';
    NEW.is_active := false;
    NEW.approved_by := NULL;
    NEW.approved_at := NULL;
    NEW.terms_version := NULL;
    NEW.tax_treatment := NULL;
    NEW.tax_rate_pct := 0;
    NEW.effective_from := NULL;
    NEW.effective_until := NULL;
    NEW.proposed_at := now();
    NEW.proposed_by := auth.uid();
  END IF;

  IF NEW.approval_status <> 'approved' THEN
    NEW.is_active := false;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_platform_commission_rule_lifecycle
  ON public.platform_commission_rules;
CREATE TRIGGER trg_platform_commission_rule_lifecycle
BEFORE INSERT OR UPDATE ON public.platform_commission_rules
FOR EACH ROW EXECUTE FUNCTION public.guard_platform_commission_rule_lifecycle();

-- Guardar siempre crea/reabre un borrador. La UI nunca puede activar una regla
-- escribiendo la tabla ni reutilizar una aprobación anterior para otro precio.
CREATE OR REPLACE FUNCTION public.save_platform_commission_rule(
  p_plan_id uuid,
  p_org_id uuid,
  p_percent numeric,
  p_fixed numeric,
  p_max_per_transaction numeric,
  p_min_per_transaction numeric,
  p_applies_to text,
  p_change_reason text,
  p_rule_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_rule public.platform_commission_rules;
BEGIN
  IF v_actor IS NULL OR NOT public.has_platform_role(ARRAY['finance'], v_actor) THEN
    RAISE EXCEPTION 'Unauthorized: requires platform finance role';
  END IF;
  IF p_percent IS NULL OR p_percent < 0 OR p_percent > 100
     OR p_fixed IS NULL OR p_fixed < 0
     OR COALESCE(p_min_per_transaction, 0) < 0
     OR (p_max_per_transaction IS NOT NULL AND p_max_per_transaction < 0) THEN
    RAISE EXCEPTION 'Invalid commission amounts';
  END IF;
  IF p_max_per_transaction IS NOT NULL
     AND COALESCE(p_min_per_transaction, 0) > p_max_per_transaction THEN
    RAISE EXCEPTION 'Minimum cannot be greater than maximum';
  END IF;
  IF p_applies_to NOT IN ('online', 'pos', 'all') THEN
    RAISE EXCEPTION 'Invalid commission channel';
  END IF;
  IF NULLIF(btrim(COALESCE(p_change_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Change reason is required';
  END IF;

  IF p_rule_id IS NULL THEN
    INSERT INTO public.platform_commission_rules (
      plan_id, org_id, percent, fixed, max_per_transaction,
      min_per_transaction, applies_to, is_active, approval_status,
      change_reason, proposed_by, proposed_at
    ) VALUES (
      p_plan_id, p_org_id, p_percent, p_fixed, p_max_per_transaction,
      COALESCE(p_min_per_transaction, 0), p_applies_to, false, 'draft',
      btrim(p_change_reason), v_actor, now()
    )
    RETURNING * INTO v_rule;
  ELSE
    UPDATE public.platform_commission_rules
    SET plan_id = p_plan_id,
        org_id = p_org_id,
        percent = p_percent,
        fixed = p_fixed,
        max_per_transaction = p_max_per_transaction,
        min_per_transaction = COALESCE(p_min_per_transaction, 0),
        applies_to = p_applies_to,
        change_reason = btrim(p_change_reason),
        proposed_by = v_actor,
        proposed_at = now()
    WHERE id = p_rule_id
    RETURNING * INTO v_rule;

    IF v_rule.id IS NULL THEN
      RAISE EXCEPTION 'Commission rule not found';
    END IF;
  END IF;

  RETURN to_jsonb(v_rule);
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_platform_commission_rule(
  p_rule_id uuid,
  p_terms_version text,
  p_tax_treatment text,
  p_tax_rate_pct numeric,
  p_effective_from timestamptz,
  p_effective_until timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_rule public.platform_commission_rules;
  v_start timestamptz := COALESCE(p_effective_from, now());
BEGIN
  IF v_actor IS NULL OR NOT public.has_platform_role(ARRAY['finance'], v_actor) THEN
    RAISE EXCEPTION 'Unauthorized: requires platform finance role';
  END IF;
  IF NULLIF(btrim(COALESCE(p_terms_version, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Terms version is required';
  END IF;
  IF p_tax_treatment NOT IN ('included', 'added') THEN
    RAISE EXCEPTION 'Tax treatment must be included or added';
  END IF;
  IF p_tax_rate_pct IS NULL OR p_tax_rate_pct < 0 OR p_tax_rate_pct > 100 THEN
    RAISE EXCEPTION 'Invalid tax rate';
  END IF;
  IF p_effective_until IS NOT NULL AND p_effective_until <= v_start THEN
    RAISE EXCEPTION 'Effective until must be after effective from';
  END IF;

  UPDATE public.platform_commission_rules
  SET approval_status = 'approved',
      is_active = true,
      approved_by = v_actor,
      approved_at = now(),
      terms_version = btrim(p_terms_version),
      tax_treatment = p_tax_treatment,
      tax_rate_pct = p_tax_rate_pct,
      effective_from = v_start,
      effective_until = p_effective_until
  WHERE id = p_rule_id
    AND approval_status = 'draft'
    AND NULLIF(btrim(COALESCE(change_reason, '')), '') IS NOT NULL
  RETURNING * INTO v_rule;

  IF v_rule.id IS NULL THEN
    RAISE EXCEPTION 'Only a documented draft can be approved';
  END IF;

  RETURN to_jsonb(v_rule);
END;
$$;

CREATE OR REPLACE FUNCTION public.retire_platform_commission_rule(
  p_rule_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_rule public.platform_commission_rules;
BEGIN
  IF v_actor IS NULL OR NOT public.has_platform_role(ARRAY['finance'], v_actor) THEN
    RAISE EXCEPTION 'Unauthorized: requires platform finance role';
  END IF;
  IF NULLIF(btrim(COALESCE(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Retirement reason is required';
  END IF;

  UPDATE public.platform_commission_rules
  SET approval_status = 'retired',
      is_active = false,
      effective_until = COALESCE(
        effective_until,
        CASE
          WHEN effective_from IS NULL THEN now()
          ELSE GREATEST(now(), effective_from + interval '1 microsecond')
        END
      ),
      change_reason = concat_ws(' · ', NULLIF(change_reason, ''), 'Retirada: ' || btrim(p_reason))
  WHERE id = p_rule_id
  RETURNING * INTO v_rule;

  IF v_rule.id IS NULL THEN
    RAISE EXCEPTION 'Commission rule not found';
  END IF;

  RETURN to_jsonb(v_rule);
END;
$$;

-- La tabla queda de lectura. Toda mutación pasa por los RPC auditables.
REVOKE INSERT, UPDATE, DELETE ON public.platform_commission_rules FROM authenticated;
GRANT SELECT ON public.platform_commission_rules TO authenticated;

REVOKE ALL ON FUNCTION public.save_platform_commission_rule(
  uuid, uuid, numeric, numeric, numeric, numeric, text, text, uuid
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.approve_platform_commission_rule(
  uuid, text, text, numeric, timestamptz, timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.retire_platform_commission_rule(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_platform_commission_rule(
  uuid, uuid, numeric, numeric, numeric, numeric, text, text, uuid
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_platform_commission_rule(
  uuid, text, text, numeric, timestamptz, timestamptz
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.retire_platform_commission_rule(uuid, text) TO authenticated;

-- Sólo una regla aprobada y dentro de su vigencia puede llegar a Mercado Pago
-- como marketplace_fee/application_fee. Espejo de `resolvePlatformRule()` y
-- `platformFeeFor()` en src/lib/paymentFees.ts.
CREATE OR REPLACE FUNCTION public.platform_commission_amount(
  p_org_id uuid,
  p_gross numeric,
  p_channel text DEFAULT 'online'
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rule record;
  v_plan uuid;
  v_fee numeric := 0;
BEGIN
  IF p_gross IS NULL OR p_gross <= 0 THEN RETURN 0; END IF;

  SELECT o.plan_id INTO v_plan FROM public.organizations o WHERE o.id = p_org_id;

  SELECT r.percent, r.fixed, r.max_per_transaction, r.min_per_transaction,
         r.tax_treatment, r.tax_rate_pct
  INTO v_rule
  FROM public.platform_commission_rules r
  WHERE r.is_active
    AND r.approval_status = 'approved'
    AND r.effective_from IS NOT NULL
    AND r.effective_from <= now()
    AND (r.effective_until IS NULL OR r.effective_until > now())
    AND (r.applies_to = 'all' OR r.applies_to = p_channel)
    AND (r.org_id IS NULL OR r.org_id = p_org_id)
    AND (r.plan_id IS NULL OR r.plan_id = v_plan)
  ORDER BY
    (r.org_id IS NOT NULL)::int * 4
    + (r.plan_id IS NOT NULL)::int * 2
    + (r.applies_to <> 'all')::int DESC
  LIMIT 1;

  IF v_rule.percent IS NULL AND v_rule.fixed IS NULL THEN RETURN 0; END IF;

  v_fee := p_gross * COALESCE(v_rule.percent, 0) / 100.0 + COALESCE(v_rule.fixed, 0);
  IF v_rule.max_per_transaction IS NOT NULL THEN
    v_fee := LEAST(v_fee, v_rule.max_per_transaction);
  END IF;
  IF COALESCE(v_rule.min_per_transaction, 0) > 0 THEN
    v_fee := GREATEST(v_fee, v_rule.min_per_transaction);
  END IF;
  -- Piso y techo limitan la tarifa comercial. Sólo un tratamiento aprobado
  -- como `added` suma el impuesto por encima de esa base.
  IF v_rule.tax_treatment = 'added' THEN
    v_fee := v_fee * (1 + COALESCE(v_rule.tax_rate_pct, 0) / 100.0);
  END IF;

  RETURN round(LEAST(v_fee, p_gross), 2);
END;
$$;

REVOKE ALL ON FUNCTION public.platform_commission_amount(uuid, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.platform_commission_amount(uuid, numeric, text) TO service_role;

DO $verify$
DECLARE
  v_actor uuid;
  v_org uuid := gen_random_uuid();
  v_rule uuid;
  v_saved jsonb;
  v_amount numeric;
  v_old_claims text := current_setting('request.jwt.claims', true);
BEGIN
  SELECT user_id INTO v_actor
  FROM public.platform_admins
  WHERE role = 'superadmin'
  LIMIT 1;
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'No platform superadmin available for commission verification';
  END IF;

  INSERT INTO public.organizations (id, name, slug, owner_user_id)
  VALUES (v_org, 'ZZ COMMISSION APPROVAL', 'zz-commission-' || substr(v_org::text, 1, 8), v_actor);

  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_actor, 'role', 'authenticated')::text,
    false
  );

  v_saved := public.save_platform_commission_rule(
    NULL, v_org, 5, 0, NULL, 0, 'online',
    'ZZ verifica que un borrador no cobre', NULL
  );
  v_rule := (v_saved->>'id')::uuid;

  SELECT public.platform_commission_amount(v_org, 1000, 'online') INTO v_amount;
  IF v_amount <> 0 THEN
    RAISE EXCEPTION 'Draft commission charged %', v_amount;
  END IF;

  PERFORM public.approve_platform_commission_rule(
    v_rule, 'ZZ-terms-v1', 'included', 21, now(), NULL
  );
  SELECT public.platform_commission_amount(v_org, 1000, 'online') INTO v_amount;
  IF v_amount <> 50 THEN
    RAISE EXCEPTION 'Approved commission expected 50, got %', v_amount;
  END IF;

  PERFORM public.retire_platform_commission_rule(v_rule, 'ZZ cambia tratamiento fiscal');
  UPDATE public.platform_commission_rules
  SET approval_status = 'draft',
      change_reason = 'ZZ verifica impuesto adicionado'
  WHERE id = v_rule;
  PERFORM public.approve_platform_commission_rule(
    v_rule, 'ZZ-terms-v2', 'added', 21, now(), NULL
  );
  SELECT public.platform_commission_amount(v_org, 1000, 'online') INTO v_amount;
  IF v_amount <> 60.50 THEN
    RAISE EXCEPTION 'Tax-added commission expected 60.50, got %', v_amount;
  END IF;

  PERFORM public.save_platform_commission_rule(
    NULL, v_org, 7, 0, NULL, 0, 'online',
    'ZZ editar invalida aprobación anterior', v_rule
  );
  SELECT public.platform_commission_amount(v_org, 1000, 'online') INTO v_amount;
  IF v_amount <> 0 THEN
    RAISE EXCEPTION 'Edited commission kept charging %', v_amount;
  END IF;

  IF has_table_privilege('authenticated', 'public.platform_commission_rules', 'UPDATE') THEN
    RAISE EXCEPTION 'authenticated can still update commission rules directly';
  END IF;

  DELETE FROM public.platform_commission_rules WHERE id = v_rule;
  DELETE FROM public.organizations WHERE id = v_org;
  PERFORM set_config('request.jwt.claims', COALESCE(v_old_claims, ''), false);
END
$verify$;

SELECT
  (SELECT count(*) FROM public.organizations WHERE name = 'ZZ COMMISSION APPROVAL')
  +
  (SELECT count(*) FROM public.platform_commission_rules WHERE change_reason LIKE 'ZZ %')
  AS commission_approval_remainders;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260821000058', 'commission_approval_gate') ON CONFLICT DO NOTHING;
