-- D5.25b / la analítica no se enciende antes de informarla.
--
-- La política publicada de la única tienda real todavía no describe visitas,
-- UTM ni retención. Nerqia no puede editarla/publicarla en nombre del merchant.
-- Se agrega un opt-in auditable owner/admin y una guarda de contenido mínimo.

BEGIN;

ALTER TABLE public.ecommerce_stores
  ADD COLUMN IF NOT EXISTS first_party_analytics_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS analytics_disclosure_accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS analytics_disclosure_accepted_by uuid
    REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.store_analytics_disclosure_ready(p_store_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.store_pages p
    WHERE p.store_id = p_store_id
      AND p.slug = 'politica-de-privacidad'
      AND p.status = 'published'
      AND lower(p.content) LIKE '%visitas de 30 minutos%'
      AND lower(p.content) LIKE '%utm%'
      AND lower(p.content) LIKE '%ip%'
      AND lower(p.content) LIKE '%url completa%'
      AND lower(p.content) LIKE '%13 meses%'
  );
$$;

REVOKE ALL ON FUNCTION public.store_analytics_disclosure_ready(uuid)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.set_store_first_party_analytics(
  p_org_id uuid,
  p_enabled boolean,
  p_acknowledged boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_role text;
  v_store record;
  v_previous boolean;
BEGIN
  IF v_actor IS NULL OR p_org_id IS NULL THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501';
  END IF;

  SELECT m.role INTO v_role
  FROM public.memberships m
  WHERE m.org_id = p_org_id AND m.user_id = v_actor
  LIMIT 1;
  IF v_role IS NULL OR v_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Sólo owner o admin puede decidir esta medición'
      USING ERRCODE = '42501';
  END IF;

  SELECT id, name, first_party_analytics_enabled
  INTO v_store
  FROM public.ecommerce_stores
  WHERE org_id = p_org_id
  LIMIT 1
  FOR UPDATE;
  IF v_store.id IS NULL THEN
    RAISE EXCEPTION 'La organización todavía no tiene tienda' USING ERRCODE = '22023';
  END IF;

  IF p_enabled AND NOT p_acknowledged THEN
    RAISE EXCEPTION 'Debés confirmar la información publicada antes de activar'
      USING ERRCODE = '22023';
  END IF;
  IF p_enabled AND NOT public.store_analytics_disclosure_ready(v_store.id) THEN
    RAISE EXCEPTION 'La política publicada todavía no informa visita, UTM, minimización y retención'
      USING ERRCODE = '22023';
  END IF;

  v_previous := v_store.first_party_analytics_enabled;
  UPDATE public.ecommerce_stores
  SET first_party_analytics_enabled = p_enabled,
      analytics_disclosure_accepted_at = CASE
        WHEN p_enabled THEN COALESCE(analytics_disclosure_accepted_at, now())
        ELSE analytics_disclosure_accepted_at
      END,
      analytics_disclosure_accepted_by = CASE
        WHEN p_enabled THEN COALESCE(analytics_disclosure_accepted_by, v_actor)
        ELSE analytics_disclosure_accepted_by
      END
  WHERE id = v_store.id;

  IF v_previous IS DISTINCT FROM p_enabled THEN
    INSERT INTO public.audit_logs (
      org_id, user_id, action, entity_type, entity_id, entity_label,
      old_values, new_values, severity, metadata
    ) VALUES (
      p_org_id, v_actor,
      CASE WHEN p_enabled THEN 'store.analytics.enable' ELSE 'store.analytics.disable' END,
      'ecommerce_store', v_store.id, v_store.name,
      jsonb_build_object('first_party_analytics_enabled', v_previous),
      jsonb_build_object('first_party_analytics_enabled', p_enabled),
      'info',
      jsonb_build_object(
        'disclosure_acknowledged', p_acknowledged,
        'retention_months', 13,
        'attribution_model', 'first_observed'
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'enabled', p_enabled,
    'changed', v_previous IS DISTINCT FROM p_enabled
  );
END;
$$;

REVOKE ALL ON FUNCTION public.set_store_first_party_analytics(uuid, boolean, boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_store_first_party_analytics(uuid, boolean, boolean)
  TO authenticated;

-- Encapsula la implementación de D5.25. La versión unchecked queda privada y
-- el nombre público sólo registra después del opt-in del comercio.
DO $$
BEGIN
  IF to_regprocedure('public.record_store_visit_unchecked(text,text,jsonb)') IS NULL THEN
    ALTER FUNCTION public.record_store_visit(text, text, jsonb)
      RENAME TO record_store_visit_unchecked;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.record_store_visit_unchecked(text, text, jsonb)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.record_store_visit(
  p_slug text,
  p_visit_token text,
  p_attribution jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_enabled boolean;
BEGIN
  SELECT s.first_party_analytics_enabled INTO v_enabled
  FROM public.ecommerce_stores s
  WHERE lower(s.slug) = lower(p_slug) AND s.is_active
  LIMIT 1;

  IF v_enabled IS NULL THEN
    RAISE EXCEPTION 'Tienda no encontrada o inactiva';
  END IF;
  IF NOT v_enabled THEN
    RETURN jsonb_build_object(
      'ok', true,
      'tracked', false,
      'reason', 'privacy_disclosure_required'
    );
  END IF;

  RETURN public.record_store_visit_unchecked(
    p_slug, p_visit_token, p_attribution
  ) || jsonb_build_object('tracked', true);
END;
$$;

REVOKE ALL ON FUNCTION public.record_store_visit(text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_store_visit(text, text, jsonb)
  TO anon, authenticated;

COMMENT ON FUNCTION public.set_store_first_party_analytics(uuid, boolean, boolean) IS
  'Owner/admin activa o pausa medición first-party después de publicar y reconocer la divulgación mínima; deja auditoría.';
COMMENT ON FUNCTION public.record_store_visit(text, text, jsonb) IS
  'Registra visita sólo si el merchant activó medición con política publicada; de lo contrario no escribe.';

DO $$
BEGIN
  IF has_function_privilege(
    'anon', 'public.record_store_visit_unchecked(text,text,jsonb)', 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Verificación falló: anon puede saltar el opt-in';
  END IF;
  IF has_function_privilege(
    'anon', 'public.set_store_first_party_analytics(uuid,boolean,boolean)', 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Verificación falló: anon puede activar analítica';
  END IF;
  IF NOT has_function_privilege(
    'authenticated', 'public.set_store_first_party_analytics(uuid,boolean,boolean)', 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Verificación falló: owner no puede activar analítica';
  END IF;
END;
$$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260904000050', 'store_analytics_disclosure')
ON CONFLICT DO NOTHING;

COMMIT;
