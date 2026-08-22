-- Verificacion destructiva-cero del Business Profiler.
--
-- Ejecutar con:
--   npx supabase db query --linked --file supabase/verificaciones/20260822_business_profiler.sql
--
-- El bloque interior fuerza un rollback por subtransaccion. Prueba el camino
-- real de owner/admin, la idempotencia, la proteccion de tipos propios y que
-- onboarding se complete atomicamente. La ultima asercion cuenta los restos.

DO $verification$
DECLARE
  v_owner uuid;
  v_outsider uuid;
  v_org uuid;
  v_original_org_name text;
  v_original_business_name text;
  v_original_industry text;
  v_original_exchange_rate numeric;
  v_types_before integer;
  v_attributes_before integer;
  v_profiles_before integer;
  v_result jsonb;
  v_second_result jsonb;
  v_count integer;
  v_unauthorized boolean := false;
BEGIN
  SELECT m.user_id, m.org_id
  INTO v_owner, v_org
  FROM public.memberships m
  JOIN public.settings s ON s.org_id = m.org_id
  WHERE m.role IN ('owner', 'admin')
    AND NOT EXISTS (
      SELECT 1 FROM public.product_types pt
      WHERE pt.org_id = m.org_id
        AND pt.slug IN ('tecnologia', 'producto-general')
    )
  ORDER BY (m.role = 'owner') DESC
  LIMIT 1;
  IF v_owner IS NULL OR v_org IS NULL THEN
    RAISE EXCEPTION 'verification requires an owner/admin org without profiler test slugs';
  END IF;

  SELECT u.id INTO v_outsider
  FROM auth.users u
  WHERE u.id <> v_owner
    AND NOT public.is_org_member(v_org, u.id)
  LIMIT 1;
  IF v_outsider IS NULL THEN
    RAISE EXCEPTION 'verification requires a user outside the chosen organization';
  END IF;

  SELECT o.name INTO v_original_org_name
  FROM public.organizations o WHERE o.id = v_org;
  SELECT s.business_name, s.industry_code, s.exchange_rate
  INTO v_original_business_name, v_original_industry, v_original_exchange_rate
  FROM public.settings s WHERE s.org_id = v_org;
  SELECT count(*) INTO v_types_before
  FROM public.product_types WHERE org_id = v_org;
  SELECT count(*) INTO v_attributes_before
  FROM public.attribute_definitions WHERE org_id = v_org;
  SELECT count(*) INTO v_profiles_before
  FROM public.organization_business_profiles WHERE org_id = v_org;

  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_owner, 'role', 'authenticated')::text,
    true
  );

  BEGIN
    v_result := public.configure_business_profile(v_org, 'tecnologia');
    v_second_result := public.configure_business_profile(v_org, 'tecnologia');

    IF (v_result->>'types_created')::integer <> 1
       OR (v_result->>'attributes_created')::integer <> 4 THEN
      RAISE EXCEPTION 'first profile application created an unexpected shape: %', v_result;
    END IF;
    IF (v_second_result->>'types_created')::integer <> 0
       OR (v_second_result->>'attributes_created')::integer <> 0 THEN
      RAISE EXCEPTION 'profile retry was not idempotent: %', v_second_result;
    END IF;

    SELECT count(*) INTO v_count
    FROM public.product_types pt
    JOIN public.attribute_definitions ad ON ad.product_type_id = pt.id
    WHERE pt.org_id = v_org
      AND pt.slug = 'tecnologia'
      AND pt.source = 'business_profile'
      AND pt.template_code = 'tecnologia:tecnologia'
      AND ad.org_id = v_org;
    IF v_count <> 4 THEN
      RAISE EXCEPTION 'profile type does not expose the four declared attributes: %', v_count;
    END IF;

    INSERT INTO public.product_types (org_id, name, slug, description)
    VALUES (v_org, 'ZZ tipo propio', 'producto-general', 'No debe ser sobrescrito');
    v_result := public.configure_business_profile(v_org, 'otro');

    IF (v_result->>'custom_conflicts')::integer <> 1 THEN
      RAISE EXCEPTION 'custom conflict was not reported: %', v_result;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.product_types
      WHERE org_id = v_org AND slug = 'producto-general'
        AND source = 'custom' AND name = 'ZZ tipo propio'
        AND template_code IS NULL AND template_version IS NULL
    ) THEN
      RAISE EXCEPTION 'business profile overwrote a custom product type';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM public.attribute_definitions ad
      JOIN public.product_types pt ON pt.id = ad.product_type_id
      WHERE pt.org_id = v_org AND pt.slug = 'producto-general'
    ) THEN
      RAISE EXCEPTION 'business profile attached attributes to a custom conflict';
    END IF;

    v_result := public.complete_business_onboarding(
      v_org, 'ZZ Perfil verificacion', '#123abc', 'tecnologia', 'pos'
    );
    IF v_result->>'business_name' <> 'ZZ Perfil verificacion' THEN
      RAISE EXCEPTION 'onboarding RPC returned an unexpected business name: %', v_result;
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM public.organizations o
      JOIN public.settings s ON s.org_id = o.id
      JOIN public.organization_business_profiles bp ON bp.org_id = o.id
      WHERE o.id = v_org
        AND o.name = 'ZZ Perfil verificacion'
        AND o.primary_color = '#123ABC'
        AND o.onboarding_completed
        AND o.onboarding_goal = 'pos'
        AND s.business_name = 'ZZ Perfil verificacion'
        AND s.primary_color = '#123ABC'
        AND s.industry_code = 'tecnologia'
        AND s.exchange_rate IS NOT DISTINCT FROM v_original_exchange_rate
        AND bp.industry_code = 'tecnologia'
    ) THEN
      RAISE EXCEPTION 'atomic onboarding state is incomplete or changed an unrelated setting';
    END IF;

    PERFORM set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', v_outsider, 'role', 'authenticated')::text,
      true
    );
    BEGIN
      PERFORM public.configure_business_profile(v_org, 'perfumes');
    EXCEPTION WHEN OTHERS THEN
      v_unauthorized := position('Unauthorized' in SQLERRM) > 0;
    END;
    IF NOT v_unauthorized THEN
      RAISE EXCEPTION 'user outside the organization was not blocked';
    END IF;

    -- Revierte todas las altas y cambios del ensayo, incluidos los claims.
    RAISE EXCEPTION USING ERRCODE = 'ZX001', MESSAGE = 'rollback verification data';
  EXCEPTION WHEN SQLSTATE 'ZX001' THEN
    NULL;
  END;

  SELECT count(*) INTO v_count
  FROM public.product_types WHERE org_id = v_org;
  IF v_count <> v_types_before THEN
    RAISE EXCEPTION 'verification left product types: before %, after %', v_types_before, v_count;
  END IF;
  SELECT count(*) INTO v_count
  FROM public.attribute_definitions WHERE org_id = v_org;
  IF v_count <> v_attributes_before THEN
    RAISE EXCEPTION 'verification left attributes: before %, after %', v_attributes_before, v_count;
  END IF;
  SELECT count(*) INTO v_count
  FROM public.organization_business_profiles WHERE org_id = v_org;
  IF v_count <> v_profiles_before THEN
    RAISE EXCEPTION 'verification left a business profile: before %, after %', v_profiles_before, v_count;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.organizations
    WHERE id = v_org AND name IS DISTINCT FROM v_original_org_name
  ) OR EXISTS (
    SELECT 1 FROM public.settings
    WHERE org_id = v_org
      AND (
        business_name IS DISTINCT FROM v_original_business_name
        OR industry_code IS DISTINCT FROM v_original_industry
        OR exchange_rate IS DISTINCT FROM v_original_exchange_rate
      )
  ) THEN
    RAISE EXCEPTION 'verification did not restore organization/settings state';
  END IF;

  RAISE NOTICE 'business profiler verification passed: first apply=1 type/4 attrs, retry=0, custom preserved, onboarding atomic, outsider blocked, leftovers=0';
END
$verification$;
