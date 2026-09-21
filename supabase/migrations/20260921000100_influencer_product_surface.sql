-- Nerqia Influencers como producto independiente: entitlement, solicitud y
-- decisión auditada. Corrige el seed previo, que agregaba la fila pero no
-- enseñaba los RPC a reconocer el producto.

INSERT INTO public.organization_product_access(org_id, product_key, status)
SELECT organization.id, 'influencers', 'available'
FROM public.organizations organization
ON CONFLICT (org_id, product_key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.product_surface_access(
  p_org_id uuid,
  p_product_key text
)
RETURNS TABLE (
  product_key text,
  status text,
  allowed boolean,
  can_request boolean,
  blocker text,
  requested_at timestamptz,
  decided_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_status text;
  v_requested_at timestamptz;
  v_decided_at timestamptz;
  v_role text;
  v_capability_key text;
  v_resolution record;
  v_allowed boolean := false;
  v_permission boolean := false;
BEGIN
  IF p_product_key NOT IN ('business', 'finance', 'influencers') THEN
    RAISE EXCEPTION 'Producto no reconocido' USING ERRCODE = '22023';
  END IF;

  SELECT membership.role::text INTO v_role
  FROM public.memberships membership
  WHERE membership.org_id = p_org_id AND membership.user_id = auth.uid();
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'No sos miembro de esta organización' USING ERRCODE = '42501';
  END IF;

  SELECT access.status, access.requested_at, access.decided_at
    INTO v_status, v_requested_at, v_decided_at
  FROM public.organization_product_access access
  WHERE access.org_id = p_org_id AND access.product_key = p_product_key;

  IF p_product_key = 'influencers' THEN
    v_permission := public.has_permission(p_org_id, 'influencers', 'view');
    v_allowed := COALESCE(v_status = 'enabled' AND v_permission, false);
  ELSE
    v_capability_key := CASE
      WHEN p_product_key = 'finance' THEN 'finance.documents'
      ELSE 'catalog.products'
    END;
    SELECT * INTO v_resolution
    FROM public.organization_capability_access(p_org_id, v_capability_key, 'view');
    v_allowed := COALESCE(v_resolution.allowed, false);
    v_permission := v_resolution.blocker IS DISTINCT FROM 'module_permission_denied';
  END IF;

  RETURN QUERY SELECT
    p_product_key,
    COALESCE(v_status, 'available'),
    v_allowed,
    COALESCE(
      p_product_key IN ('finance', 'influencers')
      AND v_status = 'available'
      AND v_role IN ('owner', 'admin'),
      false
    ),
    CASE
      WHEN NOT v_permission THEN 'module_permission_denied'
      WHEN NOT v_allowed THEN 'product_not_enabled'
      ELSE NULL
    END,
    v_requested_at,
    v_decided_at;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.request_product_access(
  p_org_id uuid,
  p_product_key text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_role text;
  v_previous text;
BEGIN
  IF p_product_key NOT IN ('finance', 'influencers') THEN
    RAISE EXCEPTION 'Este producto no admite solicitudes' USING ERRCODE = '22023';
  END IF;

  SELECT membership.role::text INTO v_role
  FROM public.memberships membership
  WHERE membership.org_id = p_org_id AND membership.user_id = auth.uid();
  IF v_role IS NULL OR v_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Sólo owner o admin pueden solicitar un producto' USING ERRCODE = '42501';
  END IF;

  SELECT access.status INTO v_previous
  FROM public.organization_product_access access
  WHERE access.org_id = p_org_id AND access.product_key = p_product_key
  FOR UPDATE;
  IF v_previous IS NULL THEN RAISE EXCEPTION 'El producto no está disponible para esta organización'; END IF;
  IF v_previous IN ('requested', 'enabled') THEN RETURN v_previous; END IF;

  UPDATE public.organization_product_access
  SET status = 'requested', requested_at = now(), requested_by = auth.uid(), updated_at = now()
  WHERE org_id = p_org_id AND product_key = p_product_key;

  INSERT INTO public.organization_product_access_events(
    org_id, product_key, event_type, previous_status, next_status, actor_id, actor_surface
  ) VALUES (p_org_id, p_product_key, 'requested', v_previous, 'requested', auth.uid(), 'tenant');
  RETURN 'requested';
END;
$fn$;

CREATE OR REPLACE FUNCTION public.platform_product_access_set(
  p_org_id uuid,
  p_product_key text,
  p_enabled boolean,
  p_actor uuid,
  p_reason text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_previous text;
  v_next text := CASE WHEN p_enabled THEN 'enabled' ELSE 'available' END;
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_actor_role text;
BEGIN
  IF p_product_key NOT IN ('finance', 'influencers') THEN
    RAISE EXCEPTION 'Producto no reconocido' USING ERRCODE = '22023';
  END IF;
  SELECT admin.role INTO v_actor_role FROM public.platform_admins admin WHERE admin.user_id = p_actor;
  IF v_actor_role IS NULL
     OR (p_product_key = 'finance' AND v_actor_role NOT IN ('superadmin', 'finance'))
     OR (p_product_key = 'influencers' AND v_actor_role <> 'superadmin') THEN
    RAISE EXCEPTION 'El actor no puede administrar este producto' USING ERRCODE = '42501';
  END IF;
  IF v_reason IS NULL OR char_length(v_reason) < 10 OR char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'La decisión requiere un motivo de 10 a 500 caracteres' USING ERRCODE = '22023';
  END IF;

  SELECT access.status INTO v_previous
  FROM public.organization_product_access access
  WHERE access.org_id = p_org_id AND access.product_key = p_product_key
  FOR UPDATE;
  IF v_previous IS NULL THEN RAISE EXCEPTION 'La organización o el producto no existen'; END IF;
  IF v_previous = v_next THEN RETURN v_next; END IF;

  UPDATE public.organization_product_access
  SET status = v_next, decided_at = now(), decided_by = p_actor,
      decision_reason = v_reason, updated_at = now()
  WHERE org_id = p_org_id AND product_key = p_product_key;

  INSERT INTO public.organization_product_access_events(
    org_id, product_key, event_type, previous_status, next_status,
    actor_id, actor_surface, reason
  ) VALUES (
    p_org_id, p_product_key,
    CASE WHEN p_enabled THEN 'enabled' ELSE 'disabled' END,
    v_previous, v_next, p_actor, 'platform', v_reason
  );
  INSERT INTO public.admin_audit_logs(admin_user_id, action, target_org_id, details)
  VALUES (
    p_actor,
    CASE WHEN p_enabled THEN 'productAccessEnabled' ELSE 'productAccessDisabled' END,
    p_org_id,
    jsonb_build_object('product_key', p_product_key, 'previous_status', v_previous,
      'next_status', v_next, 'reason', v_reason)
  );
  RETURN v_next;
END;
$fn$;

REVOKE ALL ON FUNCTION public.product_surface_access(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.request_product_access(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.platform_product_access_set(uuid, text, boolean, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.product_surface_access(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_product_access(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_product_access_set(uuid, text, boolean, uuid, text) TO service_role;
