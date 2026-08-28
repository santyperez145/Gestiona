-- Verificación destructiva-cero de Blueprint y Provisioning.
--
-- Ejecutar con:
--   npx supabase db query --linked --file supabase/verificaciones/20260828_business_blueprint.sql
--
-- Crea una organización ZZ dentro de una subtransacción, inyecta una falla en
-- el cuarto paso y comprueba que los tres anteriores se compensen por rollback.
-- Después reintenta la misma key, prueba replay y revierte todo.

DO $verification$
DECLARE
  v_org uuid := gen_random_uuid();
  v_owner uuid;
  v_key uuid := gen_random_uuid();
  v_slug text := 'zz-blueprint-' || substr(gen_random_uuid()::text, 1, 8);
  v_outsider uuid := gen_random_uuid();
  v_preview jsonb;
  v_failed jsonb;
  v_succeeded jsonb;
  v_replayed jsonb;
  v_count integer;
  v_resto integer;
  v_blocked boolean := false;
BEGIN
  SELECT user_account.id INTO v_owner
  FROM auth.users user_account
  ORDER BY user_account.created_at
  LIMIT 1;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'La verificación necesita un usuario existente';
  END IF;

  BEGIN
    INSERT INTO public.organizations(id, name, slug, owner_user_id)
    VALUES (v_org, 'ZZ Blueprint recuperable', v_slug, v_owner);
    INSERT INTO public.memberships(org_id, user_id, role)
    VALUES (v_org, v_owner, 'owner');
    INSERT INTO public.settings(org_id, user_id, business_name)
    VALUES (v_org, v_owner, 'ZZ Blueprint recuperable')
    ON CONFLICT (org_id) DO NOTHING;

    -- Los triggers de alta son best-effort. Se vacían para que el Blueprint
    -- tenga que demostrar que reconcilia las cinco piezas por sí mismo.
    DELETE FROM public.role_permissions WHERE org_id = v_org;
    DELETE FROM public.organization_capabilities WHERE org_id = v_org;

    PERFORM set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', v_owner, 'role', 'authenticated')::text,
      true
    );
    PERFORM set_config('gestiona.zz_blueprint_fail_org', v_org::text, true);

    v_preview := public.business_blueprint_preview(v_org, 'otro');
    IF v_preview->>'ready' <> 'false'
       OR jsonb_array_length(v_preview->'changes') <> 5
       OR length(v_preview->>'blueprint_hash') <> 64 THEN
      RAISE EXCEPTION 'El preview no expuso el diff completo: %', v_preview;
    END IF;

    EXECUTE $ddl$
      CREATE FUNCTION public.zz_blueprint_fail_location()
      RETURNS trigger LANGUAGE plpgsql AS $body$
      BEGIN
        IF NEW.org_id::text = current_setting('gestiona.zz_blueprint_fail_org', true) THEN
          RAISE EXCEPTION 'ZZ falla transitoria de ubicación' USING ERRCODE = 'ZX140';
        END IF;
        RETURN NEW;
      END;
      $body$
    $ddl$;
    EXECUTE $ddl$
      CREATE TRIGGER zz_blueprint_fail_location
      BEFORE INSERT ON public.locations
      FOR EACH ROW EXECUTE FUNCTION public.zz_blueprint_fail_location()
    $ddl$;

    v_failed := public.provision_business_blueprint(v_org, 'otro', v_key);
    IF v_failed->>'status' <> 'failed'
       OR v_failed->>'compensation' <> 'transaction_rollback'
       OR v_failed#>>'{error,step}' <> 'main_location' THEN
      RAISE EXCEPTION 'La falla controlada no quedó recuperable: %', v_failed;
    END IF;

    IF EXISTS (SELECT 1 FROM public.organization_business_profiles WHERE org_id = v_org)
       OR EXISTS (SELECT 1 FROM public.product_types WHERE org_id = v_org)
       OR EXISTS (SELECT 1 FROM public.role_permissions WHERE org_id = v_org)
       OR EXISTS (SELECT 1 FROM public.organization_capabilities WHERE org_id = v_org)
       OR EXISTS (SELECT 1 FROM public.locations WHERE org_id = v_org)
       OR EXISTS (SELECT 1 FROM public.crm_pipelines WHERE org_id = v_org) THEN
      RAISE EXCEPTION 'El intento fallido dejó una configuración parcial';
    END IF;

    SELECT count(*) INTO v_count
    FROM public.provisioning_steps step
    JOIN public.provisioning_runs run ON run.id = step.run_id
    WHERE run.org_id = v_org
      AND (
        (step.step_order < 4 AND step.status = 'compensated')
        OR (step.step_order = 4 AND step.status = 'failed')
        OR (step.step_order > 4 AND step.status = 'skipped')
      );
    IF v_count <> 5 THEN
      RAISE EXCEPTION 'El checklist no explicó la compensación: % pasos', v_count;
    END IF;

    EXECUTE 'DROP TRIGGER zz_blueprint_fail_location ON public.locations';
    EXECUTE 'DROP FUNCTION public.zz_blueprint_fail_location()';

    v_succeeded := public.provision_business_blueprint(v_org, 'otro', v_key);
    v_replayed := public.provision_business_blueprint(v_org, 'otro', v_key);
    IF v_succeeded->>'status' <> 'succeeded'
       OR v_succeeded->>'replayed' <> 'false'
       OR v_replayed->>'status' <> 'succeeded'
       OR v_replayed->>'replayed' <> 'true'
       OR v_succeeded->>'run_id' IS DISTINCT FROM v_replayed->>'run_id' THEN
      RAISE EXCEPTION 'Retry/replay no fue idempotente: success %, replay %', v_succeeded, v_replayed;
    END IF;

    SELECT count(*) INTO v_count FROM public.provisioning_runs
    WHERE org_id = v_org AND idempotency_key = v_key
      AND status = 'succeeded' AND attempt_count = 2 AND progress_percent = 100;
    IF v_count <> 1 THEN
      RAISE EXCEPTION 'La key creó más de una corrida o perdió sus intentos';
    END IF;
    SELECT count(*) INTO v_count FROM public.provisioning_steps step
    JOIN public.provisioning_runs run ON run.id = step.run_id
    WHERE run.org_id = v_org AND step.status = 'succeeded';
    IF v_count <> 5 THEN
      RAISE EXCEPTION 'El checklist final no tiene cinco pasos exitosos: %', v_count;
    END IF;
    SELECT count(*) INTO v_count FROM public.locations
    WHERE org_id = v_org AND active AND is_main;
    IF v_count <> 1 THEN
      RAISE EXCEPTION 'Provisioning no resolvió una única ubicación principal: %', v_count;
    END IF;
    SELECT count(*) INTO v_count FROM public.crm_pipelines pipeline
    JOIN public.crm_stages stage ON stage.pipeline_id = pipeline.id
    WHERE pipeline.org_id = v_org AND pipeline.name = 'Pipeline Principal';
    IF v_count <> 6 THEN
      RAISE EXCEPTION 'Provisioning no creó las seis etapas CRM: %', v_count;
    END IF;
    SELECT count(*) INTO v_count FROM public.role_permissions WHERE org_id = v_org;
    IF v_count < 60 THEN
      RAISE EXCEPTION 'Provisioning dejó incompleta la matriz de permisos: %', v_count;
    END IF;
    SELECT count(*) INTO v_count FROM public.organization_capabilities
    WHERE org_id = v_org
      AND capability_key IN ('catalog.products', 'inventory.core')
      AND status = 'enabled';
    IF v_count <> 2 THEN
      RAISE EXCEPTION 'Provisioning no activó las dos capabilities base: %', v_count;
    END IF;

    PERFORM set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', v_outsider, 'role', 'authenticated')::text,
      true
    );
    BEGIN
      PERFORM public.business_blueprint_preview(v_org, 'otro');
    EXCEPTION WHEN insufficient_privilege THEN
      v_blocked := true;
    END;
    IF NOT v_blocked THEN
      RAISE EXCEPTION 'Un ajeno pudo previsualizar el Blueprint';
    END IF;

    -- Revierte organización, Blueprint, runs, steps y DDL de falla.
    RAISE EXCEPTION USING ERRCODE = 'ZX001', MESSAGE = 'rollback verification data';
  EXCEPTION WHEN SQLSTATE 'ZX001' THEN
    NULL;
  END;

  SELECT
    (SELECT count(*) FROM public.organizations WHERE id = v_org)
    + (SELECT count(*) FROM public.organization_blueprints WHERE org_id = v_org)
    + (SELECT count(*) FROM public.provisioning_runs WHERE org_id = v_org)
    + (SELECT count(*) FROM public.locations WHERE org_id = v_org)
  INTO v_resto;
  IF v_resto <> 0 OR to_regprocedure('public.zz_blueprint_fail_location()') IS NOT NULL THEN
    RAISE EXCEPTION 'La verificación dejó % restos o su trigger técnico', v_resto;
  END IF;

  RAISE NOTICE 'Blueprint verificado: diff=5, rollback atómico, retry=2, replay=1 run, checklist=5, permisos>=60, CRM=6, capabilities=2, restos=0';
END;
$verification$;
