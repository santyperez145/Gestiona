-- Verificación destructiva-cero de cohortes de activación.
--
-- Ejecutar con:
--   npm run db -- --file supabase/verificaciones/20260821_cohortes_activacion.sql
--
-- El bloque interior fuerza un rollback por subtransacción. La última
-- aserción comprueba además que no quede el evento ZZ implícito del ensayo.

DO $verification$
DECLARE
  v_staff uuid;
  v_outsider uuid;
  v_org uuid;
  v_first_sale timestamptz;
  v_key uuid := gen_random_uuid();
  v_id uuid;
  v_count integer;
  v_minutes integer;
  v_outsider_blocked boolean := false;
BEGIN
  SELECT user_id INTO v_staff
  FROM public.platform_admins
  WHERE role IN ('superadmin', 'support')
  ORDER BY (role = 'superadmin') DESC
  LIMIT 1;
  IF v_staff IS NULL THEN
    RAISE EXCEPTION 'verification requires support staff';
  END IF;

  SELECT id INTO v_outsider
  FROM auth.users u
  WHERE NOT EXISTS (
    SELECT 1 FROM public.platform_admins p WHERE p.user_id = u.id
  )
  LIMIT 1;
  IF v_outsider IS NULL THEN
    RAISE EXCEPTION 'verification requires a non-staff user';
  END IF;

  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_staff, 'role', 'authenticated')::text,
    true
  );

  SELECT org_id, first_target_sale_at
  INTO v_org, v_first_sale
  FROM public.platform_activation_cohort_members
  ORDER BY activated ASC, org_created_at ASC
  LIMIT 1;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'verification requires an organization';
  END IF;

  BEGIN
    PERFORM public.record_activation_intervention(
      v_org, v_key, 'catalog', 'data_import', 17, 'resolved', NULL
    );
    PERFORM public.record_activation_intervention(
      v_org, v_key, 'catalog', 'data_import', 17, 'resolved', NULL
    );

    SELECT count(*), COALESCE(sum(minutes_spent), 0)
    INTO v_count, v_minutes
    FROM public.activation_interventions
    WHERE actor_user_id = v_staff AND idempotency_key = v_key;
    IF v_count <> 1 OR v_minutes <> 17 THEN
      RAISE EXCEPTION 'idempotency failed: count %, minutes %', v_count, v_minutes;
    END IF;

    SELECT activation_intervention_count, activation_intervention_minutes
    INTO v_count, v_minutes
    FROM public.platform_activation_cohort_members
    WHERE org_id = v_org;
    IF (v_first_sale IS NULL AND (v_count <> 1 OR v_minutes <> 17))
       OR (v_first_sale IS NOT NULL AND (v_count <> 0 OR v_minutes <> 0)) THEN
      RAISE EXCEPTION 'cohort time boundary failed: count %, minutes %, first sale %', v_count, v_minutes, v_first_sale;
    END IF;

    SELECT id INTO v_id
    FROM public.activation_interventions
    WHERE actor_user_id = v_staff AND idempotency_key = v_key;
    PERFORM public.void_activation_intervention(v_id);
    PERFORM public.void_activation_intervention(v_id);

    IF NOT EXISTS (
      SELECT 1 FROM public.platform_activation_interventions
      WHERE id = v_id AND NOT is_active AND voided_at IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'voided event is not auditable';
    END IF;

    SELECT activation_intervention_count, activation_intervention_minutes
    INTO v_count, v_minutes
    FROM public.platform_activation_cohort_members
    WHERE org_id = v_org;
    IF v_count <> 0 OR v_minutes <> 0 THEN
      RAISE EXCEPTION 'voided event still affects cohort: count %, minutes %', v_count, v_minutes;
    END IF;

    PERFORM set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', v_outsider, 'role', 'authenticated')::text,
      true
    );
    BEGIN
      PERFORM public.record_activation_intervention(
        v_org, gen_random_uuid(), 'general', 'training', 5, 'no_change', now()
      );
    EXCEPTION WHEN OTHERS THEN
      v_outsider_blocked := position('Unauthorized' in SQLERRM) > 0;
    END;
    IF NOT v_outsider_blocked THEN
      RAISE EXCEPTION 'non-staff RPC was not blocked';
    END IF;
    IF EXISTS (SELECT 1 FROM public.platform_activation_cohorts) THEN
      RAISE EXCEPTION 'non-staff can read platform cohorts';
    END IF;

    -- Revierte intervención, anulación y claims del bloque interior.
    RAISE EXCEPTION USING ERRCODE = 'ZX001', MESSAGE = 'rollback verification data';
  EXCEPTION WHEN SQLSTATE 'ZX001' THEN
    NULL;
  END;

  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_staff, 'role', 'authenticated')::text,
    true
  );
  IF EXISTS (
    SELECT 1 FROM public.activation_interventions WHERE idempotency_key = v_key
  ) THEN
    RAISE EXCEPTION 'verification left intervention rows';
  END IF;

  RAISE NOTICE 'activation cohort verification passed: idempotent=1, minutes=17, voided excluded, outsider blocked, leftovers=0';
END
$verification$;
