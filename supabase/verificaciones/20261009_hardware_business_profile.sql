-- Ejecutar después de la migración, primero en Supabase Preview.
-- Toda escritura se limita a organizaciones ZZ nuevas. Usa un owner existente
-- como identidad, sin modificar su organización ni crear usuarios de Auth.
-- No crea ventas, productos, pagos ni facturas; no llama funciones externas.
-- El rollback de subtransacción permite comprobar restos=0 antes del ROLLBACK
-- exterior, que también restaura los claims y cualquier cambio del ensayo.

BEGIN;

DO $verification$
DECLARE
  v_owner uuid;
  v_outsider uuid;
  v_org uuid := gen_random_uuid();
  v_custom_org uuid := gen_random_uuid();
  v_custom_type uuid := gen_random_uuid();
  v_key uuid := gen_random_uuid();
  v_preview jsonb;
  v_first jsonb;
  v_replay jsonb;
  v_repeat jsonb;
  v_conflict jsonb;
  v_count integer;
  v_resto integer;
  v_blocked boolean;
BEGIN
  SELECT membership.user_id INTO v_owner
  FROM public.memberships membership
  JOIN auth.users account ON account.id = membership.user_id
  WHERE membership.role = 'owner'
    AND membership.suspendido_por_plan IS NOT TRUE
  ORDER BY membership.joined_at, membership.id
  LIMIT 1;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'La verificación de Ferretería necesita una identidad owner existente';
  END IF;
  SELECT account.id INTO v_outsider
  FROM auth.users account
  WHERE account.id <> v_owner
  ORDER BY account.created_at, account.id
  LIMIT 1;
  IF v_outsider IS NULL THEN
    RAISE EXCEPTION 'La verificación de Ferretería necesita otra identidad para viewer y aislamiento tenant';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.provision_business_blueprint(uuid,text,uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.provision_business_blueprint(uuid,text,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'El ACL del Blueprint permite un acceso incorrecto';
  END IF;

  BEGIN
    INSERT INTO public.organizations(id, name, slug, owner_user_id)
    VALUES
      (v_org, 'ZZ Ferretería reversible', 'zz-ferreteria-' || v_org::text, v_owner),
      (v_custom_org, 'ZZ Ferretería tipo propio', 'zz-ferreteria-custom-' || v_custom_org::text, v_owner);
    INSERT INTO public.memberships(org_id, user_id, role)
    VALUES
      (v_org, v_owner, 'owner'),
      (v_org, v_outsider, 'viewer'),
      (v_custom_org, v_owner, 'owner');
    INSERT INTO public.settings(org_id, user_id, business_name)
    VALUES
      (v_org, v_owner, 'ZZ Ferretería reversible'),
      (v_custom_org, v_owner, 'ZZ Ferretería tipo propio')
    ON CONFLICT (org_id) DO NOTHING;

    PERFORM set_config('request.jwt.claims',
      jsonb_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
    v_preview := public.business_blueprint_preview(v_org, 'ferreteria');
    IF v_preview#>>'{desired_state,industry,code}' IS DISTINCT FROM 'ferreteria'
       OR jsonb_array_length(v_preview#>'{desired_state,industry,product_type_templates}') IS DISTINCT FROM 1
       OR v_preview#>>'{desired_state,industry,product_type_templates,0,slug}' IS DISTINCT FROM 'articulo-ferreteria'
       OR jsonb_array_length(v_preview#>'{desired_state,industry,product_type_templates,0,attributes}') IS DISTINCT FROM 4 THEN
      RAISE EXCEPTION 'El Blueprint no expone el preset Ferretería de un tipo y cuatro atributos: %', v_preview;
    END IF;

    v_first := public.provision_business_blueprint(v_org, 'ferreteria', v_key);
    v_replay := public.provision_business_blueprint(v_org, 'ferreteria', v_key);
    IF v_first->>'status' IS DISTINCT FROM 'succeeded'
       OR v_first->>'replayed' IS DISTINCT FROM 'false'
       OR v_first#>>'{profile,types_created}' IS DISTINCT FROM '1'
       OR v_first#>>'{profile,attributes_created}' IS DISTINCT FROM '4'
       OR v_replay->>'status' IS DISTINCT FROM 'succeeded'
       OR v_replay->>'replayed' IS DISTINCT FROM 'true'
       OR v_replay->>'run_id' IS DISTINCT FROM v_first->>'run_id' THEN
      RAISE EXCEPTION 'Alta/replay de Ferretería no fue idempotente: %, %', v_first, v_replay;
    END IF;
    SELECT count(*) INTO v_count FROM public.provisioning_runs
    WHERE org_id = v_org AND idempotency_key = v_key AND status = 'succeeded';
    IF v_count <> 1 THEN
      RAISE EXCEPTION 'Replay dejó % corridas para una key', v_count;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.settings setting
      JOIN public.organization_business_profiles profile ON profile.org_id = setting.org_id
      WHERE setting.org_id = v_org AND setting.industry_code = 'ferreteria'
        AND profile.industry_code = 'ferreteria' AND profile.profile_version = 1
    ) THEN
      RAISE EXCEPTION 'Settings y perfil no reflejan el Blueprint aplicado';
    END IF;
    SELECT count(*) INTO v_count FROM public.product_types
    WHERE org_id = v_org AND slug = 'articulo-ferreteria'
      AND name = 'Artículo de ferretería' AND source = 'business_profile'
      AND template_code = 'ferreteria:articulo-ferreteria'
      AND template_version = 1 AND maneja_stock;
    IF v_count <> 1 THEN
      RAISE EXCEPTION 'El alta no dejó un único tipo Ferretería con stock';
    END IF;
    SELECT count(*) INTO v_count
    FROM public.attribute_definitions attribute
    JOIN public.product_types product_type ON product_type.id = attribute.product_type_id
    WHERE product_type.org_id = v_org AND product_type.slug = 'articulo-ferreteria'
      AND attribute.org_id = v_org
      AND attribute.slug IN ('modelo-referencia', 'material', 'medida', 'presentacion');
    IF v_count <> 4 THEN
      RAISE EXCEPTION 'El tipo no conservó sus cuatro atributos descriptivos';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.attribute_definitions attribute
      JOIN public.product_types product_type ON product_type.id = attribute.product_type_id
      WHERE product_type.org_id = v_org AND product_type.slug = 'articulo-ferreteria'
        AND attribute.slug = 'presentacion' AND attribute.data_type = 'select'
        AND attribute.options = '["Unidad","Caja","Paquete","Blíster","Juego","Bobina","Envase"]'::jsonb
    ) THEN
      RAISE EXCEPTION 'Presentación perdió sus opciones declarativas';
    END IF;

    -- Una confirmación nueva del mismo preset tampoco duplica la estructura.
    v_repeat := public.provision_business_blueprint(v_org, 'ferreteria', gen_random_uuid());
    IF v_repeat->>'status' IS DISTINCT FROM 'succeeded'
       OR v_repeat#>>'{profile,types_created}' IS DISTINCT FROM '0'
       OR v_repeat#>>'{profile,attributes_created}' IS DISTINCT FROM '0' THEN
      RAISE EXCEPTION 'Una nueva key duplicó tipos o atributos: %', v_repeat;
    END IF;

    -- Un viewer de la propia ZZ no configura ni siquiera reusando una key
    -- exitosa. Su membresía sólo existe en este ensayo reversible.
    PERFORM set_config('request.jwt.claims',
      jsonb_build_object('sub', v_outsider, 'role', 'authenticated')::text, true);
    v_blocked := false;
    BEGIN
      PERFORM public.provision_business_blueprint(v_org, 'ferreteria', v_key);
    EXCEPTION WHEN insufficient_privilege THEN
      v_blocked := true;
    END;
    IF NOT v_blocked THEN
      RAISE EXCEPTION 'Un viewer pudo configurar o reproducir un Blueprint';
    END IF;
    v_blocked := false;
    BEGIN
      PERFORM public.business_blueprint_preview(v_org, 'ferreteria');
    EXCEPTION WHEN insufficient_privilege THEN
      v_blocked := true;
    END;
    IF NOT v_blocked THEN
      RAISE EXCEPTION 'Un viewer pudo previsualizar la configuración';
    END IF;
    -- El mismo usuario viewer en la primera ZZ no tiene ninguna membresía en
    -- la segunda: ni el conocimiento del org_id/key autoriza acceso cruzado.
    v_blocked := false;
    BEGIN
      PERFORM public.provision_business_blueprint(v_custom_org, 'ferreteria', v_key);
    EXCEPTION WHEN insufficient_privilege THEN
      v_blocked := true;
    END;
    IF NOT v_blocked THEN
      RAISE EXCEPTION 'Una identidad ajena al tenant pudo aplicar/reproducir el Blueprint';
    END IF;
    v_blocked := false;
    BEGIN
      PERFORM public.business_blueprint_preview(v_custom_org, 'ferreteria');
    EXCEPTION WHEN insufficient_privilege THEN
      v_blocked := true;
    END;
    IF NOT v_blocked THEN
      RAISE EXCEPTION 'Una identidad ajena al tenant pudo leer el preview';
    END IF;
    IF EXISTS (SELECT 1 FROM public.provisioning_runs WHERE org_id = v_custom_org)
       OR EXISTS (SELECT 1 FROM public.organization_blueprints WHERE org_id = v_custom_org) THEN
      RAISE EXCEPTION 'Los accesos rechazados dejaron una configuración en el tenant ajeno';
    END IF;

    -- El Blueprint respeta un tipo propio con el mismo slug y sus atributos.
    PERFORM set_config('request.jwt.claims',
      jsonb_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
    INSERT INTO public.product_types(id, org_id, name, slug, description, source, maneja_stock)
    VALUES (v_custom_type, v_custom_org, 'ZZ Tipo propio', 'articulo-ferreteria', 'No debe reemplazarse', 'custom', false);
    INSERT INTO public.attribute_definitions(org_id, product_type_id, name, slug, data_type)
    VALUES (v_custom_org, v_custom_type, 'ZZ Atributo propio', 'zz-propio', 'text');
    v_conflict := public.provision_business_blueprint(v_custom_org, 'ferreteria', gen_random_uuid());
    IF v_conflict->>'status' IS DISTINCT FROM 'succeeded'
       OR v_conflict#>>'{profile,custom_conflicts}' IS DISTINCT FROM '1'
       OR v_conflict#>>'{profile,types_created}' IS DISTINCT FROM '0'
       OR v_conflict#>>'{profile,attributes_created}' IS DISTINCT FROM '0' THEN
      RAISE EXCEPTION 'El Blueprint no respetó el tipo propio: %', v_conflict;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.product_types
      WHERE id = v_custom_type AND org_id = v_custom_org
        AND source = 'custom' AND name = 'ZZ Tipo propio'
        AND description = 'No debe reemplazarse' AND maneja_stock IS FALSE
        AND template_code IS NULL AND template_version IS NULL
    ) THEN
      RAISE EXCEPTION 'El preset reemplazó datos del tipo propio';
    END IF;
    SELECT count(*) INTO v_count FROM public.attribute_definitions
    WHERE org_id = v_custom_org AND product_type_id = v_custom_type;
    IF v_count <> 1 OR NOT EXISTS (
      SELECT 1 FROM public.attribute_definitions
      WHERE org_id = v_custom_org AND product_type_id = v_custom_type AND slug = 'zz-propio'
    ) THEN
      RAISE EXCEPTION 'El preset añadió o reemplazó atributos del tipo propio';
    END IF;
    IF EXISTS (SELECT 1 FROM public.products WHERE org_id IN (v_org, v_custom_org)) THEN
      RAISE EXCEPTION 'El perfil creó productos sin una carga explícita';
    END IF;

    RAISE EXCEPTION USING ERRCODE = 'ZX001', MESSAGE = 'rollback hardware verification data';
  EXCEPTION WHEN SQLSTATE 'ZX001' THEN
    NULL;
  END;

  SELECT
    (SELECT count(*) FROM public.organizations WHERE id IN (v_org, v_custom_org))
    + (SELECT count(*) FROM public.memberships WHERE org_id IN (v_org, v_custom_org))
    + (SELECT count(*) FROM public.settings WHERE org_id IN (v_org, v_custom_org))
    + (SELECT count(*) FROM public.product_types WHERE org_id IN (v_org, v_custom_org))
    + (SELECT count(*) FROM public.attribute_definitions WHERE org_id IN (v_org, v_custom_org))
    + (SELECT count(*) FROM public.organization_business_profiles WHERE org_id IN (v_org, v_custom_org))
    + (SELECT count(*) FROM public.organization_blueprints WHERE org_id IN (v_org, v_custom_org))
    + (SELECT count(*) FROM public.provisioning_runs WHERE org_id IN (v_org, v_custom_org))
    + (SELECT count(*) FROM public.locations WHERE org_id IN (v_org, v_custom_org))
    + (SELECT count(*) FROM public.crm_pipelines WHERE org_id IN (v_org, v_custom_org))
    + (SELECT count(*) FROM public.role_permissions WHERE org_id IN (v_org, v_custom_org))
    + (SELECT count(*) FROM public.organization_capabilities WHERE org_id IN (v_org, v_custom_org))
    + (SELECT count(*) FROM public.organization_product_access WHERE org_id IN (v_org, v_custom_org))
  INTO v_resto;
  IF v_resto <> 0 THEN
    RAISE EXCEPTION 'La verificación Ferretería dejó % filas técnicas', v_resto;
  END IF;
  RAISE NOTICE 'Ferretería: owner=1 tipo/4 atributos, replay=1 run, repetición=0 duplicados, viewer/tenant bloqueados, tipo propio intacto, restos=0';
END;
$verification$;

ROLLBACK;
