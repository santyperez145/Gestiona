-- P1-03 — Blueprint y Provisioning.
--
-- El Business Profiler ya sabía configurar settings, tipos y atributos. El
-- CRM, los permisos, las ubicaciones y las capabilities también tenían sus
-- propias autoridades idempotentes, pero nadie las coordinaba. Este Blueprint
-- es la capa de orquestación: muestra el estado deseado y su diff, ejecuta un
-- checklist observable y conserva un intento fallido sin dejar medio negocio
-- configurado.

CREATE TABLE IF NOT EXISTS public.organization_blueprints (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  industry_code    text NOT NULL REFERENCES public.industry_presets(code) ON UPDATE CASCADE,
  profile_version  integer NOT NULL CHECK (profile_version > 0),
  schema_version   integer NOT NULL DEFAULT 1 CHECK (schema_version > 0),
  blueprint_hash   text NOT NULL CHECK (blueprint_hash ~ '^[0-9a-f]{64}$'),
  desired_state    jsonb NOT NULL CHECK (jsonb_typeof(desired_state) = 'object'),
  status           text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'applied', 'superseded')),
  created_by       uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at       timestamptz NOT NULL DEFAULT now(),
  applied_at       timestamptz,
  UNIQUE (org_id, blueprint_hash)
);

CREATE TABLE IF NOT EXISTS public.provisioning_runs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  blueprint_id        uuid NOT NULL REFERENCES public.organization_blueprints(id) ON DELETE RESTRICT,
  idempotency_key     uuid NOT NULL,
  requested_by        uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  status              text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  progress_percent    integer NOT NULL DEFAULT 0 CHECK (progress_percent BETWEEN 0 AND 100),
  current_step        text,
  attempt_count       integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  result              jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(result) = 'object'),
  error               jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(error) = 'object'),
  compensation_status text NOT NULL DEFAULT 'none'
    CHECK (compensation_status IN ('none', 'not_required', 'transaction_rollback')),
  started_at          timestamptz,
  completed_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS public.provisioning_steps (
  run_id               uuid NOT NULL REFERENCES public.provisioning_runs(id) ON DELETE CASCADE,
  step_key             text NOT NULL,
  step_order           integer NOT NULL CHECK (step_order > 0),
  label                text NOT NULL,
  status               text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'skipped', 'compensated')),
  attempts             integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  result               jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(result) = 'object'),
  error                jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(error) = 'object'),
  compensation_status  text NOT NULL DEFAULT 'none'
    CHECK (compensation_status IN ('none', 'not_required', 'transaction_rollback')),
  started_at           timestamptz,
  completed_at         timestamptz,
  PRIMARY KEY (run_id, step_key),
  UNIQUE (run_id, step_order)
);

CREATE INDEX IF NOT EXISTS organization_blueprints_org_created_idx
  ON public.organization_blueprints(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS provisioning_runs_org_created_idx
  ON public.provisioning_runs(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS provisioning_steps_run_order_idx
  ON public.provisioning_steps(run_id, step_order);

ALTER TABLE public.organization_blueprints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provisioning_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provisioning_steps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS organization_blueprints_member_read ON public.organization_blueprints;
CREATE POLICY organization_blueprints_member_read
  ON public.organization_blueprints FOR SELECT TO authenticated
  USING (public.is_org_member(org_id, auth.uid()));

DROP POLICY IF EXISTS provisioning_runs_member_read ON public.provisioning_runs;
CREATE POLICY provisioning_runs_member_read
  ON public.provisioning_runs FOR SELECT TO authenticated
  USING (public.is_org_member(org_id, auth.uid()));

DROP POLICY IF EXISTS provisioning_steps_member_read ON public.provisioning_steps;
CREATE POLICY provisioning_steps_member_read
  ON public.provisioning_steps FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.provisioning_runs run
      WHERE run.id = provisioning_steps.run_id
        AND public.is_org_member(run.org_id, auth.uid())
    )
  );

REVOKE ALL ON public.organization_blueprints FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.provisioning_runs FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.provisioning_steps FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.organization_blueprints TO authenticated, service_role;
GRANT SELECT ON public.provisioning_runs TO authenticated, service_role;
GRANT SELECT ON public.provisioning_steps TO authenticated, service_role;

DROP TRIGGER IF EXISTS trg_provisioning_runs_updated_at ON public.provisioning_runs;
CREATE TRIGGER trg_provisioning_runs_updated_at
BEFORE UPDATE ON public.provisioning_runs
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- El preview no escribe. La pantalla puede mostrar exactamente qué se desea y
-- qué autoridades necesitan reconciliación antes de confirmar.
CREATE OR REPLACE FUNCTION public.business_blueprint_preview(
  p_org_id uuid,
  p_industry_code text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_actor uuid := auth.uid();
  v_preset public.industry_presets;
  v_desired jsonb;
  v_hash text;
  v_changes jsonb := '[]'::jsonb;
  v_profile_ready boolean;
  v_settings_ready boolean;
  v_location_ready boolean;
  v_pipeline_ready boolean;
  v_permissions_ready boolean;
  v_capabilities_ready boolean;
  v_missing_types integer;
  v_permission_rows integer;
  v_pipeline_stages integer;
  v_enabled_capabilities integer;
BEGIN
  IF v_actor IS NULL OR NOT public.has_org_role(p_org_id, v_actor, ARRAY['owner','admin']) THEN
    RAISE EXCEPTION 'Unauthorized: requires organization owner or admin'
      USING ERRCODE = '42501';
  END IF;

  SELECT preset.* INTO v_preset
  FROM public.industry_presets preset
  WHERE preset.code = p_industry_code AND preset.active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Business profile not found or inactive'
      USING ERRCODE = '22023';
  END IF;

  v_desired := jsonb_build_object(
    'schema_version', 1,
    'industry', jsonb_build_object(
      'code', v_preset.code,
      'name', v_preset.name,
      'profile_version', v_preset.profile_version,
      'product_type_templates', v_preset.product_type_templates
    ),
    'settings', jsonb_build_object(
      'industry_code', v_preset.code,
      'ai_tone', v_preset.ai_tone,
      'defaults', v_preset.default_settings
    ),
    'role_permissions', jsonb_build_object(
      'authority', 'seed_default_permissions',
      'minimum_rows_v1', 60
    ),
    'capabilities', jsonb_build_array('catalog.products', 'inventory.core'),
    'location', jsonb_build_object(
      'name', 'Casa central',
      'is_main', true,
      'create_only_when_empty', true
    ),
    'crm', jsonb_build_object(
      'pipeline', 'Pipeline Principal',
      'stages', jsonb_build_array(
        'Prospecto', 'Calificado', 'Propuesta', 'Negociación',
        'Cierre Ganado', 'Cierre Perdido'
      )
    ),
    'checklist', jsonb_build_array(
      'business_profile', 'role_permissions', 'capabilities',
      'main_location', 'crm_pipeline'
    )
  );

  v_hash := encode(
    extensions.digest(convert_to(v_desired::text, 'UTF8'), 'sha256'::text),
    'hex'
  );

  SELECT EXISTS (
    SELECT 1 FROM public.organization_business_profiles profile
    WHERE profile.org_id = p_org_id
      AND profile.industry_code = v_preset.code
      AND profile.profile_version = v_preset.profile_version
  ) INTO v_profile_ready;

  SELECT EXISTS (
    SELECT 1 FROM public.settings setting
    WHERE setting.org_id = p_org_id AND setting.industry_code = v_preset.code
  ) INTO v_settings_ready;

  SELECT count(*) INTO v_missing_types
  FROM jsonb_array_elements(v_preset.product_type_templates) template
  WHERE NOT EXISTS (
    SELECT 1 FROM public.product_types product_type
    WHERE product_type.org_id = p_org_id
      AND product_type.slug = template->>'slug'
  );

  SELECT EXISTS (
    SELECT 1 FROM public.locations location
    WHERE location.org_id = p_org_id AND location.active AND location.is_main
  ) INTO v_location_ready;

  SELECT count(*) INTO v_permission_rows
  FROM public.role_permissions permission WHERE permission.org_id = p_org_id;
  v_permissions_ready := v_permission_rows >= 60;

  SELECT count(*) INTO v_pipeline_stages
  FROM public.crm_pipelines pipeline
  JOIN public.crm_stages stage ON stage.pipeline_id = pipeline.id
  WHERE pipeline.org_id = p_org_id
    AND pipeline.name = 'Pipeline Principal';
  v_pipeline_ready := v_pipeline_stages >= 6;

  SELECT count(*) INTO v_enabled_capabilities
  FROM public.organization_capabilities capability
  WHERE capability.org_id = p_org_id
    AND capability.capability_key IN ('catalog.products', 'inventory.core')
    AND capability.status = 'enabled';
  v_capabilities_ready := v_enabled_capabilities = 2;

  IF NOT (v_profile_ready AND v_settings_ready AND v_missing_types = 0) THEN
    v_changes := v_changes || '"business_profile"'::jsonb;
  END IF;
  IF NOT v_permissions_ready THEN
    v_changes := v_changes || '"role_permissions"'::jsonb;
  END IF;
  IF NOT v_capabilities_ready THEN
    v_changes := v_changes || '"capabilities"'::jsonb;
  END IF;
  IF NOT v_location_ready THEN
    v_changes := v_changes || '"main_location"'::jsonb;
  END IF;
  IF NOT v_pipeline_ready THEN
    v_changes := v_changes || '"crm_pipeline"'::jsonb;
  END IF;

  RETURN jsonb_build_object(
    'blueprint_hash', v_hash,
    'desired_state', v_desired,
    'current_state', jsonb_build_object(
      'profile_ready', v_profile_ready,
      'settings_ready', v_settings_ready,
      'missing_product_types', v_missing_types,
      'role_permission_rows', v_permission_rows,
      'capabilities_enabled', v_enabled_capabilities,
      'main_location_ready', v_location_ready,
      'pipeline_stage_count', v_pipeline_stages
    ),
    'changes', v_changes,
    'ready', jsonb_array_length(v_changes) = 0
  );
END;
$fn$;

-- Una key determinística permite que el onboarding reintente el mismo payload
-- después de un timeout sin crear otra corrida. La versión del preset forma
-- parte del intent, así una evolución real produce otro Blueprint.
CREATE OR REPLACE FUNCTION public.business_blueprint_intent_uuid(p_intent text)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = public
AS $fn$
  SELECT (
    substr(md5(p_intent), 1, 8) || '-' ||
    substr(md5(p_intent), 9, 4) || '-' ||
    substr(md5(p_intent), 13, 4) || '-' ||
    substr(md5(p_intent), 17, 4) || '-' ||
    substr(md5(p_intent), 21, 12)
  )::uuid;
$fn$;

CREATE OR REPLACE FUNCTION public.provision_business_blueprint(
  p_org_id uuid,
  p_industry_code text,
  p_idempotency_key uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_actor uuid := auth.uid();
  v_preview jsonb;
  v_desired jsonb;
  v_hash text;
  v_profile_version integer;
  v_blueprint_id uuid;
  v_run public.provisioning_runs;
  v_run_id uuid;
  v_profile jsonb;
  v_result jsonb;
  v_current_step text;
  v_current_order integer := 0;
  v_rows integer;
  v_location_id uuid;
  v_location_created boolean := false;
  v_pipeline_id uuid;
  v_error_message text;
  v_error_detail text;
  v_error_hint text;
  v_error_state text;
  v_error jsonb;
BEGIN
  IF v_actor IS NULL OR NOT public.has_org_role(p_org_id, v_actor, ARRAY['owner','admin']) THEN
    RAISE EXCEPTION 'Unauthorized: requires organization owner or admin'
      USING ERRCODE = '42501';
  END IF;
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'Idempotency key is required' USING ERRCODE = '22023';
  END IF;

  -- Serializa dos confirmaciones simultáneas de la misma organización. Las
  -- autoridades inferiores también son idempotentes, pero el diff y el run
  -- deben describir una sola transición coherente.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_org_id::text, 17012026));

  v_preview := public.business_blueprint_preview(p_org_id, p_industry_code);
  v_desired := v_preview->'desired_state';
  v_hash := v_preview->>'blueprint_hash';
  v_profile_version := (v_desired#>>'{industry,profile_version}')::integer;

  INSERT INTO public.organization_blueprints (
    org_id, industry_code, profile_version, schema_version,
    blueprint_hash, desired_state, created_by
  ) VALUES (
    p_org_id, p_industry_code, v_profile_version, 1,
    v_hash, v_desired, v_actor
  )
  ON CONFLICT (org_id, blueprint_hash) DO NOTHING;

  SELECT blueprint.id INTO v_blueprint_id
  FROM public.organization_blueprints blueprint
  WHERE blueprint.org_id = p_org_id AND blueprint.blueprint_hash = v_hash;

  SELECT run.* INTO v_run
  FROM public.provisioning_runs run
  WHERE run.org_id = p_org_id AND run.idempotency_key = p_idempotency_key
  FOR UPDATE;

  IF FOUND THEN
    IF v_run.blueprint_id <> v_blueprint_id THEN
      RAISE EXCEPTION 'Idempotency key was already used with a different Blueprint'
        USING ERRCODE = '22023';
    END IF;
    IF v_run.status = 'succeeded' THEN
      RETURN v_run.result || jsonb_build_object('replayed', true);
    END IF;
    v_run_id := v_run.id;
  ELSE
    INSERT INTO public.provisioning_runs (
      org_id, blueprint_id, idempotency_key, requested_by
    ) VALUES (
      p_org_id, v_blueprint_id, p_idempotency_key, v_actor
    ) RETURNING id INTO v_run_id;
  END IF;

  INSERT INTO public.provisioning_steps (run_id, step_key, step_order, label)
  VALUES
    (v_run_id, 'business_profile', 1, 'Aplicar perfil, settings y tipos'),
    (v_run_id, 'role_permissions', 2, 'Completar permisos por rol'),
    (v_run_id, 'capabilities', 3, 'Activar capacidades base'),
    (v_run_id, 'main_location', 4, 'Resolver ubicación principal'),
    (v_run_id, 'crm_pipeline', 5, 'Crear pipeline comercial')
  ON CONFLICT (run_id, step_key) DO NOTHING;

  UPDATE public.provisioning_steps
  SET status = 'pending', result = '{}'::jsonb, error = '{}'::jsonb,
      compensation_status = 'none', started_at = NULL, completed_at = NULL
  WHERE run_id = v_run_id;

  UPDATE public.provisioning_runs
  SET status = 'running', progress_percent = 0, current_step = NULL,
      attempt_count = attempt_count + 1, result = '{}'::jsonb,
      error = '{}'::jsonb, compensation_status = 'none',
      started_at = now(), completed_at = NULL
  WHERE id = v_run_id;

  -- PL/pgSQL abre un subtransaction para este bloque. Si cualquier paso
  -- falla, PostgreSQL revierte TODOS los cambios de dominio del intento; el
  -- bloque EXCEPTION exterior conserva run + checklist como evidencia y retry.
  BEGIN
    v_current_step := 'business_profile'; v_current_order := 1;
    UPDATE public.provisioning_steps
    SET status = 'running', attempts = attempts + 1, started_at = now()
    WHERE run_id = v_run_id AND step_key = v_current_step;
    UPDATE public.provisioning_runs
    SET current_step = v_current_step, progress_percent = 5 WHERE id = v_run_id;
    v_profile := public.configure_business_profile(p_org_id, p_industry_code);
    UPDATE public.provisioning_steps
    SET status = 'succeeded', result = v_profile,
        compensation_status = 'not_required', completed_at = now()
    WHERE run_id = v_run_id AND step_key = v_current_step;
    UPDATE public.provisioning_runs SET progress_percent = 20 WHERE id = v_run_id;

    v_current_step := 'role_permissions'; v_current_order := 2;
    UPDATE public.provisioning_steps
    SET status = 'running', attempts = attempts + 1, started_at = now()
    WHERE run_id = v_run_id AND step_key = v_current_step;
    UPDATE public.provisioning_runs
    SET current_step = v_current_step, progress_percent = 25 WHERE id = v_run_id;
    PERFORM public.seed_default_permissions(p_org_id);
    SELECT count(*) INTO v_rows FROM public.role_permissions WHERE org_id = p_org_id;
    UPDATE public.provisioning_steps
    SET status = 'succeeded', result = jsonb_build_object('permission_rows', v_rows),
        compensation_status = 'not_required', completed_at = now()
    WHERE run_id = v_run_id AND step_key = v_current_step;
    UPDATE public.provisioning_runs SET progress_percent = 40 WHERE id = v_run_id;

    v_current_step := 'capabilities'; v_current_order := 3;
    UPDATE public.provisioning_steps
    SET status = 'running', attempts = attempts + 1, started_at = now()
    WHERE run_id = v_run_id AND step_key = v_current_step;
    UPDATE public.provisioning_runs
    SET current_step = v_current_step, progress_percent = 45 WHERE id = v_run_id;
    INSERT INTO public.organization_capabilities (
      org_id, capability_key, status, source, reason, enabled_at, disabled_at, updated_by
    )
    SELECT p_org_id, catalog.capability_key, 'enabled', 'blueprint',
           'Capability base declarada por Blueprint', now(), NULL, v_actor
    FROM public.capability_catalog catalog
    WHERE catalog.capability_key IN ('catalog.products', 'inventory.core')
      AND catalog.active
    ON CONFLICT (org_id, capability_key) DO NOTHING;
    SELECT count(*) INTO v_rows
    FROM public.organization_capabilities capability
    WHERE capability.org_id = p_org_id
      AND capability.capability_key IN ('catalog.products', 'inventory.core')
      AND capability.status = 'enabled';
    UPDATE public.provisioning_steps
    SET status = 'succeeded', result = jsonb_build_object(
          'enabled', v_rows,
          'preserved_platform_overrides', 2 - v_rows
        ), compensation_status = 'not_required', completed_at = now()
    WHERE run_id = v_run_id AND step_key = v_current_step;
    UPDATE public.provisioning_runs SET progress_percent = 60 WHERE id = v_run_id;

    v_current_step := 'main_location'; v_current_order := 4;
    UPDATE public.provisioning_steps
    SET status = 'running', attempts = attempts + 1, started_at = now()
    WHERE run_id = v_run_id AND step_key = v_current_step;
    UPDATE public.provisioning_runs
    SET current_step = v_current_step, progress_percent = 65 WHERE id = v_run_id;
    SELECT location.id INTO v_location_id
    FROM public.locations location
    WHERE location.org_id = p_org_id AND location.active
    ORDER BY location.is_main DESC, location.created_at, location.id
    LIMIT 1;
    IF v_location_id IS NULL THEN
      INSERT INTO public.locations (org_id, name, is_main, active)
      VALUES (p_org_id, 'Casa central', true, true)
      RETURNING id INTO v_location_id;
      v_location_created := true;
    ELSIF NOT EXISTS (
      SELECT 1 FROM public.locations location
      WHERE location.id = v_location_id AND location.is_main
    ) THEN
      UPDATE public.locations SET is_main = true WHERE id = v_location_id;
    END IF;
    UPDATE public.provisioning_steps
    SET status = 'succeeded', result = jsonb_build_object(
          'location_id', v_location_id, 'created', v_location_created
        ), compensation_status = 'not_required', completed_at = now()
    WHERE run_id = v_run_id AND step_key = v_current_step;
    UPDATE public.provisioning_runs SET progress_percent = 80 WHERE id = v_run_id;

    v_current_step := 'crm_pipeline'; v_current_order := 5;
    UPDATE public.provisioning_steps
    SET status = 'running', attempts = attempts + 1, started_at = now()
    WHERE run_id = v_run_id AND step_key = v_current_step;
    UPDATE public.provisioning_runs
    SET current_step = v_current_step, progress_percent = 85 WHERE id = v_run_id;
    v_pipeline_id := public.seed_crm_pipeline(p_org_id);
    SELECT count(*) INTO v_rows FROM public.crm_stages WHERE pipeline_id = v_pipeline_id;
    UPDATE public.provisioning_steps
    SET status = 'succeeded', result = jsonb_build_object(
          'pipeline_id', v_pipeline_id, 'stage_count', v_rows
        ), compensation_status = 'not_required', completed_at = now()
    WHERE run_id = v_run_id AND step_key = v_current_step;

    UPDATE public.organization_blueprints
    SET status = 'superseded'
    WHERE org_id = p_org_id AND id <> v_blueprint_id AND status = 'applied';
    UPDATE public.organization_blueprints
    SET status = 'applied', applied_at = COALESCE(applied_at, now())
    WHERE id = v_blueprint_id;

    v_result := jsonb_build_object(
      'status', 'succeeded',
      'run_id', v_run_id,
      'blueprint_id', v_blueprint_id,
      'blueprint_hash', v_hash,
      'progress_percent', 100,
      'replayed', false,
      'profile', v_profile,
      'location_id', v_location_id,
      'pipeline_id', v_pipeline_id
    );
    UPDATE public.provisioning_runs
    SET status = 'succeeded', progress_percent = 100, current_step = NULL,
        result = v_result, error = '{}'::jsonb,
        compensation_status = 'not_required', completed_at = now()
    WHERE id = v_run_id;
    RETURN v_result;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS
      v_error_message = MESSAGE_TEXT,
      v_error_detail = PG_EXCEPTION_DETAIL,
      v_error_hint = PG_EXCEPTION_HINT,
      v_error_state = RETURNED_SQLSTATE;
  END;

  -- El subtransaction anterior ya deshizo settings, tipos, permisos,
  -- capabilities, ubicación y pipeline. Acá sólo se documenta la compensación.
  v_error := jsonb_strip_nulls(jsonb_build_object(
    'step', v_current_step,
    'sqlstate', v_error_state,
    'message', v_error_message,
    'detail', NULLIF(v_error_detail, ''),
    'hint', NULLIF(v_error_hint, '')
  ));

  UPDATE public.provisioning_steps
  SET attempts = attempts + CASE WHEN step_order <= v_current_order THEN 1 ELSE 0 END,
      status = CASE
        WHEN step_order < v_current_order THEN 'compensated'
        WHEN step_order = v_current_order THEN 'failed'
        ELSE 'skipped'
      END,
      error = CASE WHEN step_order = v_current_order THEN v_error ELSE '{}'::jsonb END,
      compensation_status = CASE
        WHEN step_order <= v_current_order THEN 'transaction_rollback'
        ELSE 'none'
      END,
      completed_at = CASE WHEN step_order <= v_current_order THEN now() ELSE NULL END
  WHERE run_id = v_run_id;

  v_result := jsonb_build_object(
    'status', 'failed',
    'run_id', v_run_id,
    'blueprint_id', v_blueprint_id,
    'blueprint_hash', v_hash,
    'progress_percent', GREATEST(0, (v_current_order - 1) * 20),
    'replayed', false,
    'compensation', 'transaction_rollback',
    'error', v_error
  );
  UPDATE public.provisioning_runs
  SET status = 'failed',
      progress_percent = GREATEST(0, (v_current_order - 1) * 20),
      current_step = v_current_step, result = v_result, error = v_error,
      compensation_status = 'transaction_rollback', completed_at = now()
  WHERE id = v_run_id;
  RETURN v_result;
END;
$fn$;

-- Onboarding queda dentro de la misma orquestación. Su key depende del intent
-- y de la versión del perfil, por lo que un retry de red reusa la corrida pero
-- un cambio real del formulario o del preset produce otra.
CREATE OR REPLACE FUNCTION public.complete_business_onboarding(
  p_org_id uuid,
  p_business_name text,
  p_primary_color text,
  p_industry_code text,
  p_onboarding_goal text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_actor uuid := auth.uid();
  v_name text := NULLIF(btrim(p_business_name), '');
  v_profile_version integer;
  v_key uuid;
  v_provisioning jsonb;
BEGIN
  IF v_actor IS NULL OR NOT public.has_org_role(p_org_id, v_actor, ARRAY['owner','admin']) THEN
    RAISE EXCEPTION 'Unauthorized: requires organization owner or admin'
      USING ERRCODE = '42501';
  END IF;
  IF v_name IS NULL OR length(v_name) > 120 THEN
    RAISE EXCEPTION 'Business name must contain between 1 and 120 characters';
  END IF;
  IF p_primary_color IS NULL OR p_primary_color !~ '^#[0-9A-Fa-f]{6}$' THEN
    RAISE EXCEPTION 'Primary color must be a six-digit hex color';
  END IF;
  IF p_onboarding_goal IS NULL OR p_onboarding_goal NOT IN ('pos','online','explore') THEN
    RAISE EXCEPTION 'Invalid onboarding goal';
  END IF;

  SELECT preset.profile_version INTO v_profile_version
  FROM public.industry_presets preset
  WHERE preset.code = p_industry_code AND preset.active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Business profile not found or inactive';
  END IF;

  v_key := public.business_blueprint_intent_uuid(concat_ws('|',
    'onboarding-v1', v_actor::text, p_org_id::text, p_industry_code,
    v_profile_version::text, v_name, upper(p_primary_color), p_onboarding_goal
  ));
  v_provisioning := public.provision_business_blueprint(
    p_org_id, p_industry_code, v_key
  );
  IF v_provisioning->>'status' <> 'succeeded' THEN
    RETURN v_provisioning;
  END IF;

  UPDATE public.organizations
  SET name = v_name,
      primary_color = upper(p_primary_color),
      onboarding_completed = true,
      onboarding_goal = p_onboarding_goal,
      updated_at = now()
  WHERE id = p_org_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Organization not found';
  END IF;

  UPDATE public.settings
  SET business_name = v_name,
      primary_color = upper(p_primary_color),
      updated_at = now()
  WHERE org_id = p_org_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Organization settings not found';
  END IF;

  RETURN jsonb_build_object(
    'status', 'succeeded',
    'org_id', p_org_id,
    'business_name', v_name,
    'onboarding_goal', p_onboarding_goal,
    'profile', v_provisioning->'profile',
    'provisioning', v_provisioning
  );
END;
$fn$;

-- El navegador deja de saltarse la orquestación. Esta función queda como
-- autoridad interna reutilizada por Blueprint y onboarding.
REVOKE ALL ON FUNCTION public.business_blueprint_intent_uuid(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.configure_business_profile(uuid, text) FROM authenticated;
REVOKE ALL ON FUNCTION public.business_blueprint_preview(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.provision_business_blueprint(uuid, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.complete_business_onboarding(uuid, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.business_blueprint_preview(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.provision_business_blueprint(uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_business_onboarding(uuid, text, text, text, text) TO authenticated;

DO $verification$
BEGIN
  IF has_table_privilege('authenticated', 'public.organization_blueprints', 'INSERT')
     OR has_table_privilege('authenticated', 'public.provisioning_runs', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.provisioning_steps', 'DELETE') THEN
    RAISE EXCEPTION 'Authenticated can bypass Blueprint provisioning';
  END IF;
  IF has_function_privilege('authenticated', 'public.configure_business_profile(uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Authenticated can bypass the Blueprint with configure_business_profile';
  END IF;
END;
$verification$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260828000140', 'el_perfil_se_convierte_en_blueprint')
ON CONFLICT DO NOTHING;
