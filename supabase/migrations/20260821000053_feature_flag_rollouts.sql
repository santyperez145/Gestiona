-- P0.5 — controles de lanzamiento sin staging.
--
-- El deploy va directo a producción. Sin un interruptor por comercio, un bug
-- en una superficie sensible (por ejemplo el Checkout Brick) sólo tiene dos
-- salidas malas: dejar expuestos a todos los comercios o revertir todo el
-- deploy. Este registro permite apagar el flujo riesgoso y conservar el
-- fallback de MercadoPago, sin exponer configuración interna al navegador.
--
-- El primer consumidor es `checkout_brick`. No se crea un framework abstracto
-- sin uso: la misma infraestructura podrá servir otros rollouts cuando tengan
-- un contrato de Core y un fallback explícito.

CREATE TABLE IF NOT EXISTS public.feature_flag_overrides (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flag_key    text NOT NULL CHECK (flag_key ~ '^[a-z][a-z0-9_]{2,63}$'),
  org_id      uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  enabled     boolean NOT NULL,
  updated_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reason      text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (reason IS NULL OR char_length(reason) <= 500)
);

-- Postgres considera distintos dos NULL en un unique compuesto. Las dos
-- partial indexes expresan exactamente las dos clases de alcance: una regla
-- global por flag y una regla por comercio y flag.
CREATE UNIQUE INDEX IF NOT EXISTS feature_flag_overrides_global_key
  ON public.feature_flag_overrides(flag_key) WHERE org_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS feature_flag_overrides_org_key
  ON public.feature_flag_overrides(flag_key, org_id) WHERE org_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS feature_flag_overrides_org_idx
  ON public.feature_flag_overrides(org_id, flag_key) WHERE org_id IS NOT NULL;

ALTER TABLE public.feature_flag_overrides ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.feature_flag_overrides FROM PUBLIC, anon, authenticated;

-- Lee el override del comercio antes que el global. Es service_role-only: una
-- pantalla pública no necesita conocer qué experimentos existen ni su alcance.
CREATE OR REPLACE FUNCTION public.feature_flag_habilitada(
  p_flag_key text,
  p_org_id uuid DEFAULT NULL,
  p_default boolean DEFAULT true
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_enabled boolean;
BEGIN
  IF p_org_id IS NOT NULL THEN
    SELECT enabled INTO v_enabled
    FROM public.feature_flag_overrides
    WHERE flag_key = p_flag_key AND org_id = p_org_id;
    IF FOUND THEN RETURN v_enabled; END IF;
  END IF;

  SELECT enabled INTO v_enabled
  FROM public.feature_flag_overrides
  WHERE flag_key = p_flag_key AND org_id IS NULL;
  RETURN COALESCE(v_enabled, p_default);
END;
$fn$;

-- Cambia un override y deja la auditoría en la misma transacción. Un guardado
-- sin evidencia sería peor que no tener UI: luego nadie podría explicar por
-- qué una tienda vio un checkout distinto.
CREATE OR REPLACE FUNCTION public.platform_feature_flag_configurar(
  p_flag_key text,
  p_org_id uuid,
  p_enabled boolean,
  p_actor uuid,
  p_actor_email text DEFAULT NULL,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_id uuid;
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.platform_admins
    WHERE user_id = p_actor AND role = 'superadmin'
  ) THEN
    RAISE EXCEPTION 'Sólo un superadmin puede cambiar controles de lanzamiento'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_flag_key NOT IN ('checkout_brick') THEN
    RAISE EXCEPTION 'Control de lanzamiento no reconocido: %', p_flag_key;
  END IF;
  IF v_reason IS NOT NULL AND char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'La justificación supera los 500 caracteres';
  END IF;

  -- Serializa el select/update/insert de los índices partial. Sin este lock,
  -- dos operadores podrían insertar el mismo alcance global simultáneamente.
  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_flag_key || ':' || COALESCE(p_org_id::text, 'global'), 0
  ));

  SELECT id INTO v_id
  FROM public.feature_flag_overrides
  WHERE flag_key = p_flag_key AND org_id IS NOT DISTINCT FROM p_org_id
  FOR UPDATE;

  IF v_id IS NULL THEN
    INSERT INTO public.feature_flag_overrides (
      flag_key, org_id, enabled, updated_by, reason
    ) VALUES (
      p_flag_key, p_org_id, p_enabled, p_actor, v_reason
    ) RETURNING id INTO v_id;
  ELSE
    UPDATE public.feature_flag_overrides
    SET enabled = p_enabled,
        updated_by = p_actor,
        reason = v_reason,
        updated_at = now()
    WHERE id = v_id;
  END IF;

  INSERT INTO public.admin_audit_logs (
    admin_user_id, admin_email, action, target_org_id, details
  ) VALUES (
    p_actor, p_actor_email, 'featureFlagSet', p_org_id,
    jsonb_build_object('flag_key', p_flag_key, 'enabled', p_enabled, 'reason', v_reason)
  );

  RETURN jsonb_build_object(
    'ok', true, 'id', v_id, 'flag_key', p_flag_key,
    'org_id', p_org_id, 'enabled', p_enabled
  );
END;
$fn$;

CREATE OR REPLACE FUNCTION public.platform_feature_flag_eliminar(
  p_flag_key text,
  p_org_id uuid,
  p_actor uuid,
  p_actor_email text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_deleted_count bigint := 0;
  v_deleted boolean := false;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.platform_admins
    WHERE user_id = p_actor AND role = 'superadmin'
  ) THEN
    RAISE EXCEPTION 'Sólo un superadmin puede cambiar controles de lanzamiento'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_flag_key NOT IN ('checkout_brick') THEN
    RAISE EXCEPTION 'Control de lanzamiento no reconocido: %', p_flag_key;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_flag_key || ':' || COALESCE(p_org_id::text, 'global'), 0
  ));

  DELETE FROM public.feature_flag_overrides
  WHERE flag_key = p_flag_key AND org_id IS NOT DISTINCT FROM p_org_id;
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  v_deleted := v_deleted_count > 0;

  INSERT INTO public.admin_audit_logs (
    admin_user_id, admin_email, action, target_org_id, details
  ) VALUES (
    p_actor, p_actor_email, 'featureFlagCleared', p_org_id,
    jsonb_build_object('flag_key', p_flag_key, 'deleted', v_deleted)
  );

  RETURN jsonb_build_object(
    'ok', true, 'flag_key', p_flag_key,
    'org_id', p_org_id, 'deleted', v_deleted
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.feature_flag_habilitada(text, uuid, boolean)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.platform_feature_flag_configurar(text, uuid, boolean, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.platform_feature_flag_eliminar(text, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.feature_flag_habilitada(text, uuid, boolean)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.platform_feature_flag_configurar(text, uuid, boolean, uuid, text, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.platform_feature_flag_eliminar(text, uuid, uuid, text)
  TO service_role;

COMMENT ON TABLE public.feature_flag_overrides IS
  'Overrides auditados de controles de lanzamiento. El alcance por organización prevalece sobre el global.';

-- Verificación sin dejar datos ZZ ni filas de auditoría: prueba la precedencia
-- del lector directamente y borra las reglas temporales antes de terminar.
DO $verify$
DECLARE
  v_org uuid;
  v_left integer;
BEGIN
  SELECT id INTO v_org FROM public.organizations LIMIT 1;

  DELETE FROM public.feature_flag_overrides WHERE flag_key = 'zz_flag_rollout_verify';

  INSERT INTO public.feature_flag_overrides(flag_key, org_id, enabled)
  VALUES ('zz_flag_rollout_verify', NULL, false);
  IF public.feature_flag_habilitada('zz_flag_rollout_verify', v_org, true) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'El override global de feature flag no se aplicó';
  END IF;

  IF v_org IS NOT NULL THEN
    INSERT INTO public.feature_flag_overrides(flag_key, org_id, enabled)
    VALUES ('zz_flag_rollout_verify', v_org, true);
    IF public.feature_flag_habilitada('zz_flag_rollout_verify', v_org, false) IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'El override por organización no prevalece sobre el global';
    END IF;
  END IF;

  DELETE FROM public.feature_flag_overrides WHERE flag_key = 'zz_flag_rollout_verify';

  SELECT count(*) INTO v_left
  FROM public.feature_flag_overrides
  WHERE flag_key = 'zz_flag_rollout_verify';
  IF v_left <> 0 THEN
    RAISE EXCEPTION 'Feature flags dejó % filas ZZ', v_left;
  END IF;
END;
$verify$;

DO $rls$
BEGIN
  IF has_table_privilege('anon', 'public.feature_flag_overrides', 'SELECT')
     OR has_table_privilege('authenticated', 'public.feature_flag_overrides', 'SELECT') THEN
    RAISE EXCEPTION 'feature_flag_overrides quedó legible desde el navegador';
  END IF;
END;
$rls$;
