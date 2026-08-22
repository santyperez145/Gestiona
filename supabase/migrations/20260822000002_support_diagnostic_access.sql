-- F1: diagnóstico temporal de soporte con consentimiento del comercio.
--
-- Reemplaza la impersonación por magic link. El staff solicita un alcance
-- cerrado; un owner lo aprueba por 15/30/60 minutos y cada lectura vuelve a
-- comprobar actor, rol, expiración y revocación. El snapshot es agregado y no
-- contiene clientes, órdenes, montos, credenciales ni errores crudos.

CREATE TABLE IF NOT EXISTS public.support_diagnostic_access_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL,
  requested_by_email text,
  reason_code text NOT NULL CHECK (
    reason_code IN ('activation', 'catalog', 'integration', 'inventory', 'incident')
  ),
  requested_at timestamptz NOT NULL DEFAULT now(),
  approved_by uuid,
  approved_at timestamptz,
  expires_at timestamptz,
  revoked_by uuid,
  revoked_at timestamptz,
  last_viewed_at timestamptz,
  view_count integer NOT NULL DEFAULT 0 CHECK (view_count >= 0),
  CONSTRAINT support_diagnostic_approval_complete CHECK (
    (approved_by IS NULL AND approved_at IS NULL AND expires_at IS NULL)
    OR (approved_by IS NOT NULL AND approved_at IS NOT NULL AND expires_at IS NOT NULL)
  ),
  CONSTRAINT support_diagnostic_expiry_after_approval CHECK (
    expires_at IS NULL OR expires_at > approved_at
  ),
  CONSTRAINT support_diagnostic_staff_email_length CHECK (
    requested_by_email IS NULL OR length(requested_by_email) <= 320
  )
);

CREATE INDEX IF NOT EXISTS idx_support_diagnostic_org_requested
  ON public.support_diagnostic_access_requests (org_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_diagnostic_staff_requested
  ON public.support_diagnostic_access_requests (requested_by, requested_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS support_diagnostic_pending_unique
  ON public.support_diagnostic_access_requests (org_id, requested_by)
  WHERE approved_at IS NULL AND revoked_at IS NULL;

ALTER TABLE public.support_diagnostic_access_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.support_diagnostic_access_requests FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE VIEW public.organization_support_diagnostic_requests
WITH (security_invoker = false, security_barrier = true) AS
SELECT
  request.id,
  request.org_id,
  request.requested_by_email AS staff_email,
  request.reason_code,
  request.requested_at,
  request.approved_at,
  request.expires_at,
  request.revoked_at,
  request.last_viewed_at,
  request.view_count,
  CASE
    WHEN request.revoked_at IS NOT NULL THEN 'revoked'
    WHEN request.approved_at IS NULL THEN 'pending'
    WHEN request.expires_at <= now() THEN 'expired'
    ELSE 'active'
  END AS status
FROM public.support_diagnostic_access_requests request
WHERE public.has_org_role(request.org_id, auth.uid(), ARRAY['owner']);

CREATE OR REPLACE VIEW public.platform_support_diagnostic_requests
WITH (security_invoker = false, security_barrier = true) AS
SELECT
  request.id,
  request.org_id,
  organization.name AS org_name,
  organization.slug AS org_slug,
  request.requested_by,
  request.reason_code,
  request.requested_at,
  request.approved_at,
  request.expires_at,
  request.revoked_at,
  request.last_viewed_at,
  request.view_count,
  CASE
    WHEN request.revoked_at IS NOT NULL THEN 'revoked'
    WHEN request.approved_at IS NULL THEN 'pending'
    WHEN request.expires_at <= now() THEN 'expired'
    ELSE 'active'
  END AS status
FROM public.support_diagnostic_access_requests request
JOIN public.organizations organization ON organization.id = request.org_id
WHERE (
  request.requested_by = auth.uid()
  AND public.has_platform_role(ARRAY['support'], auth.uid())
) OR public.has_platform_role(ARRAY['superadmin'], auth.uid());

REVOKE ALL ON public.organization_support_diagnostic_requests FROM PUBLIC, anon;
REVOKE ALL ON public.platform_support_diagnostic_requests FROM PUBLIC, anon;
GRANT SELECT ON public.organization_support_diagnostic_requests TO authenticated;
GRANT SELECT ON public.platform_support_diagnostic_requests TO authenticated;

CREATE OR REPLACE FUNCTION public.request_support_diagnostic_access(
  p_org_id uuid,
  p_reason_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_email text := NULLIF(btrim(COALESCE(auth.jwt()->>'email', '')), '');
  v_request public.support_diagnostic_access_requests;
BEGIN
  IF v_actor IS NULL OR NOT public.has_platform_role(ARRAY['support'], v_actor) THEN
    RAISE EXCEPTION 'Unauthorized: requires platform support';
  END IF;
  IF p_reason_code IS NULL OR p_reason_code NOT IN (
    'activation', 'catalog', 'integration', 'inventory', 'incident'
  ) THEN
    RAISE EXCEPTION 'Invalid diagnostic reason';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = p_org_id) THEN
    RAISE EXCEPTION 'Organization not found';
  END IF;

  INSERT INTO public.support_diagnostic_access_requests (
    org_id, requested_by, requested_by_email, reason_code, requested_at
  ) VALUES (
    p_org_id, v_actor, v_email, p_reason_code, now()
  )
  ON CONFLICT (org_id, requested_by)
    WHERE approved_at IS NULL AND revoked_at IS NULL
  DO UPDATE SET
    requested_by_email = EXCLUDED.requested_by_email,
    reason_code = EXCLUDED.reason_code,
    requested_at = now()
  RETURNING * INTO v_request;

  RETURN jsonb_build_object(
    'id', v_request.id,
    'org_id', v_request.org_id,
    'reason_code', v_request.reason_code,
    'status', 'pending',
    'requested_at', v_request.requested_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_support_diagnostic_access(
  p_request_id uuid,
  p_duration_minutes integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_request public.support_diagnostic_access_requests;
BEGIN
  IF p_duration_minutes IS NULL OR p_duration_minutes NOT IN (15, 30, 60) THEN
    RAISE EXCEPTION 'Diagnostic duration must be 15, 30 or 60 minutes';
  END IF;

  SELECT * INTO v_request
  FROM public.support_diagnostic_access_requests
  WHERE id = p_request_id
  FOR UPDATE;
  IF v_request.id IS NULL THEN
    RAISE EXCEPTION 'Diagnostic request not found';
  END IF;
  IF v_actor IS NULL OR NOT public.has_org_role(v_request.org_id, v_actor, ARRAY['owner']) THEN
    RAISE EXCEPTION 'Unauthorized: requires organization owner';
  END IF;
  IF v_request.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'Diagnostic request was revoked';
  END IF;
  IF NOT public.has_platform_role(ARRAY['support'], v_request.requested_by) THEN
    RAISE EXCEPTION 'Requesting staff is no longer authorized';
  END IF;

  -- Un retry nunca extiende silenciosamente el consentimiento original.
  IF v_request.approved_at IS NULL THEN
    UPDATE public.support_diagnostic_access_requests
    SET approved_by = v_actor,
        approved_at = now(),
        expires_at = now() + make_interval(mins => p_duration_minutes)
    WHERE id = p_request_id
    RETURNING * INTO v_request;
  END IF;

  RETURN jsonb_build_object(
    'id', v_request.id,
    'org_id', v_request.org_id,
    'status', CASE WHEN v_request.expires_at <= now() THEN 'expired' ELSE 'active' END,
    'approved_at', v_request.approved_at,
    'expires_at', v_request.expires_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_support_diagnostic_access(
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_request public.support_diagnostic_access_requests;
BEGIN
  SELECT * INTO v_request
  FROM public.support_diagnostic_access_requests
  WHERE id = p_request_id
  FOR UPDATE;
  IF v_request.id IS NULL THEN
    RAISE EXCEPTION 'Diagnostic request not found';
  END IF;
  IF v_actor IS NULL OR (
    v_actor <> v_request.requested_by
    AND NOT public.has_org_role(v_request.org_id, v_actor, ARRAY['owner'])
  ) THEN
    RAISE EXCEPTION 'Unauthorized: only owner or requesting staff can revoke';
  END IF;

  IF v_request.revoked_at IS NULL THEN
    UPDATE public.support_diagnostic_access_requests
    SET revoked_by = v_actor, revoked_at = now()
    WHERE id = p_request_id
    RETURNING * INTO v_request;
  END IF;

  RETURN jsonb_build_object(
    'id', v_request.id,
    'org_id', v_request.org_id,
    'status', 'revoked',
    'revoked_at', v_request.revoked_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_support_diagnostic_snapshot(
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_request public.support_diagnostic_access_requests;
  v_organization jsonb := '{}'::jsonb;
  v_activation jsonb := '{}'::jsonb;
  v_catalog jsonb := '{}'::jsonb;
  v_stock jsonb := '{}'::jsonb;
  v_delivery jsonb := '{}'::jsonb;
  v_integrations jsonb := '[]'::jsonb;
  v_profile jsonb := '{}'::jsonb;
BEGIN
  SELECT * INTO v_request
  FROM public.support_diagnostic_access_requests
  WHERE id = p_request_id
  FOR UPDATE;
  IF v_request.id IS NULL THEN
    RAISE EXCEPTION 'Diagnostic request not found';
  END IF;
  IF v_actor IS NULL OR v_actor <> v_request.requested_by
     OR NOT public.has_platform_role(ARRAY['support'], v_actor) THEN
    RAISE EXCEPTION 'Unauthorized: diagnostic access belongs to requesting staff';
  END IF;
  IF v_request.approved_at IS NULL OR v_request.expires_at <= now()
     OR v_request.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'Diagnostic access is not active';
  END IF;

  UPDATE public.support_diagnostic_access_requests
  SET last_viewed_at = now(), view_count = view_count + 1
  WHERE id = p_request_id
  RETURNING * INTO v_request;

  SELECT jsonb_build_object(
    'id', organization.id,
    'name', organization.name,
    'slug', organization.slug,
    'onboarding_completed', organization.onboarding_completed,
    'onboarding_goal', organization.onboarding_goal,
    'created_at', organization.created_at
  ) INTO v_organization
  FROM public.organizations organization
  WHERE organization.id = v_request.org_id;

  SELECT jsonb_build_object(
    'identity_ready', readiness.identity_ready,
    'catalog_products_count', readiness.catalog_products_count,
    'catalog_ready', readiness.catalog_ready,
    'sellable_stock_products_count', readiness.sellable_stock_products_count,
    'stock_ready', readiness.stock_ready,
    'online_channel_ready', readiness.online_channel_ready,
    'online_payment_ready', readiness.online_payment_ready,
    'online_shipping_ready', readiness.online_shipping_ready,
    'fiscal_status', readiness.fiscal_status,
    'fiscal_ready', readiness.fiscal_ready,
    'pos_sales_total', readiness.pos_sales_total,
    'online_orders_total', readiness.online_orders_total,
    'first_pos_sale_at', readiness.first_pos_sale_at,
    'first_online_sale_at', readiness.first_online_sale_at
  ) INTO v_activation
  FROM public.organization_activation_readiness readiness
  WHERE readiness.org_id = v_request.org_id;

  SELECT jsonb_build_object(
    'active_products', count(*) FILTER (WHERE product.is_active),
    'missing_image', count(*) FILTER (
      WHERE product.is_active
        AND product.image_url IS NULL
        AND COALESCE(cardinality(product.image_urls), 0) = 0
    ),
    'short_description', count(*) FILTER (
      WHERE product.is_active AND length(btrim(COALESCE(product.description, ''))) < 80
    ),
    'weight_missing', count(*) FILTER (
      WHERE product.is_active AND COALESCE(product.weight_kg, 0) <= 0
    ),
    'type_unassigned', count(*) FILTER (
      WHERE product.is_active AND product.product_type_id IS NULL
    ),
    'negative_stock', count(*) FILTER (WHERE product.stock < 0)
  ) INTO v_catalog
  FROM public.products product
  WHERE product.org_id = v_request.org_id;

  SELECT jsonb_build_object(
    'products_total', accuracy.productos_total,
    'products_measured', accuracy.productos_medidos,
    'products_matching', accuracy.productos_coinciden,
    'products_mismatched', accuracy.productos_descuadrados,
    'products_without_ledger', accuracy.productos_sin_kardex,
    'products_negative', accuracy.productos_stock_negativo,
    'accuracy_pct', accuracy.precision_pct,
    'closed_counts', accuracy.conteos_cerrados,
    'last_count_at', accuracy.ultimo_conteo_at,
    'last_movement_at', accuracy.ultimo_movimiento_at
  ) INTO v_stock
  FROM public.platform_org_stock_accuracy accuracy
  WHERE accuracy.org_id = v_request.org_id;

  SELECT jsonb_build_object(
    'pending', count(*) FILTER (WHERE event.estado = 'pendiente'),
    'in_progress', count(*) FILTER (WHERE event.estado = 'en_curso'),
    'failed', count(*) FILTER (WHERE event.estado = 'fallado'),
    'discarded', count(*) FILTER (WHERE event.estado = 'descartado'),
    'oldest_open_minutes', max(EXTRACT(epoch FROM now() - event.created_at) / 60)
      FILTER (WHERE event.estado IN ('pendiente', 'en_curso', 'fallado'))
  ) INTO v_delivery
  FROM public.outbox_events event
  WHERE event.org_id = v_request.org_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'key', health.integration_key,
    'name', health.display_name,
    'has_connection', health.has_connection,
    'credential_current', health.credential_current,
    'requires_contract', health.requires_contract,
    'operational_status', health.operational_status,
    'evidence_status', health.evidence_status,
    'last_runtime_status', health.last_runtime_status,
    'last_runtime_at', health.last_runtime_at
  ) ORDER BY health.display_name), '[]'::jsonb)
  INTO v_integrations
  FROM public.platform_org_integration_health health
  WHERE health.org_id = v_request.org_id;

  SELECT jsonb_build_object(
    'industry_code', profile.industry_code,
    'profile_version', profile.profile_version,
    'configured_at', profile.configured_at,
    'product_types', (
      SELECT count(*) FROM public.product_types type
      WHERE type.org_id = v_request.org_id AND type.active
    ),
    'profile_types', (
      SELECT count(*) FROM public.product_types type
      WHERE type.org_id = v_request.org_id
        AND type.active AND type.source = 'business_profile'
    )
  ) INTO v_profile
  FROM public.organization_business_profiles profile
  WHERE profile.org_id = v_request.org_id;

  RETURN jsonb_build_object(
    'schema_version', 1,
    'generated_at', now(),
    'access', jsonb_build_object(
      'request_id', v_request.id,
      'reason_code', v_request.reason_code,
      'expires_at', v_request.expires_at,
      'view_count', v_request.view_count
    ),
    'organization', COALESCE(v_organization, '{}'::jsonb),
    'activation', COALESCE(v_activation, '{}'::jsonb),
    'business_profile', COALESCE(v_profile, '{}'::jsonb),
    'catalog_quality', COALESCE(v_catalog, '{}'::jsonb),
    'stock_accuracy', COALESCE(v_stock, '{}'::jsonb),
    'delivery_queue', COALESCE(v_delivery, '{}'::jsonb),
    'integrations', COALESCE(v_integrations, '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.request_support_diagnostic_access(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.approve_support_diagnostic_access(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.revoke_support_diagnostic_access(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_support_diagnostic_snapshot(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_support_diagnostic_access(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_support_diagnostic_access(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_support_diagnostic_access(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_support_diagnostic_snapshot(uuid) TO authenticated;

DO $$
BEGIN
  IF has_table_privilege('anon', 'public.organization_support_diagnostic_requests', 'SELECT')
     OR has_table_privilege('anon', 'public.platform_support_diagnostic_requests', 'SELECT') THEN
    RAISE EXCEPTION 'Support diagnostic views are visible to anon';
  END IF;
  IF has_table_privilege('authenticated', 'public.support_diagnostic_access_requests', 'SELECT')
     OR has_table_privilege('authenticated', 'public.support_diagnostic_access_requests', 'INSERT')
     OR has_table_privilege('authenticated', 'public.support_diagnostic_access_requests', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.support_diagnostic_access_requests', 'DELETE') THEN
    RAISE EXCEPTION 'Authenticated can access raw support diagnostic requests';
  END IF;
END;
$$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260822000002', 'support_diagnostic_access') ON CONFLICT DO NOTHING;
