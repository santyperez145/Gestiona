-- F3.14 — Gestiona Finance: acceso por producto y superficie sobre el mismo Core.
--
-- Un permiso de módulo responde "qué puede hacer esta persona". Un entitlement
-- responde "qué producto contrató o está piloteando esta organización". Mezclar
-- ambas cosas en role_permissions haría que un admin de tenant pudiera habilitar
-- un producto comercial; mezclarlo con feature flags haría que un rollout técnico
-- se convirtiera en pricing. Esta tabla conserva los dos límites separados.

CREATE TABLE IF NOT EXISTS public.organization_product_access (
  org_id          uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  product_key     text NOT NULL CHECK (product_key IN ('business', 'finance')),
  status          text NOT NULL CHECK (status IN ('available', 'requested', 'enabled')),
  requested_at    timestamptz,
  requested_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at      timestamptz,
  decided_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decision_reason text CHECK (decision_reason IS NULL OR char_length(decision_reason) <= 500),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, product_key),
  CHECK (product_key <> 'business' OR status = 'enabled')
);

CREATE TABLE IF NOT EXISTS public.organization_product_access_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  product_key   text NOT NULL CHECK (product_key IN ('business', 'finance')),
  event_type    text NOT NULL CHECK (event_type IN ('requested', 'enabled', 'disabled')),
  previous_status text CHECK (previous_status IS NULL OR previous_status IN ('available', 'requested', 'enabled')),
  next_status   text NOT NULL CHECK (next_status IN ('available', 'requested', 'enabled')),
  actor_id      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_surface text NOT NULL CHECK (actor_surface IN ('tenant', 'platform', 'system')),
  reason        text CHECK (reason IS NULL OR char_length(reason) <= 500),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS organization_product_access_status_idx
  ON public.organization_product_access(product_key, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS organization_product_access_events_org_idx
  ON public.organization_product_access_events(org_id, product_key, created_at DESC);

ALTER TABLE public.organization_product_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_product_access_events ENABLE ROW LEVEL SECURITY;

-- Ninguna tabla viaja al navegador. El tenant usa RPCs mínimos; Platform pasa
-- por platform-admin-action. Así los cambios no dependen de un toggle de UI.
REVOKE ALL ON public.organization_product_access FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.organization_product_access_events FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.seed_organization_product_access()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
  INSERT INTO public.organization_product_access(org_id, product_key, status)
  VALUES
    (NEW.id, 'business', 'enabled'),
    (NEW.id, 'finance', 'available')
  ON CONFLICT (org_id, product_key) DO NOTHING;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_seed_organization_product_access ON public.organizations;
CREATE TRIGGER trg_seed_organization_product_access
AFTER INSERT ON public.organizations
FOR EACH ROW EXECUTE FUNCTION public.seed_organization_product_access();

INSERT INTO public.organization_product_access(org_id, product_key, status)
SELECT id, 'business', 'enabled' FROM public.organizations
ON CONFLICT (org_id, product_key) DO NOTHING;

INSERT INTO public.organization_product_access(org_id, product_key, status)
SELECT id, 'finance', 'available' FROM public.organizations
ON CONFLICT (org_id, product_key) DO NOTHING;

-- Estado mínimo de una superficie. No expone pricing, notas internas ni otros
-- productos. La membresía y finance.view se revalidan en el servidor.
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
  v_can_view boolean := false;
BEGIN
  IF p_product_key NOT IN ('business', 'finance') THEN
    RAISE EXCEPTION 'Producto no reconocido'
      USING ERRCODE = '22023';
  END IF;

  SELECT m.role::text INTO v_role
  FROM public.memberships m
  WHERE m.org_id = p_org_id AND m.user_id = auth.uid();

  IF v_role IS NULL THEN
    RAISE EXCEPTION 'No sos miembro de esta organización'
      USING ERRCODE = '42501';
  END IF;

  SELECT opa.status, opa.requested_at, opa.decided_at
    INTO v_status, v_requested_at, v_decided_at
  FROM public.organization_product_access opa
  WHERE opa.org_id = p_org_id AND opa.product_key = p_product_key;

  IF p_product_key = 'business' THEN
    v_can_view := true;
  ELSE
    v_can_view := public.has_permission(p_org_id, 'finance', 'view');
  END IF;

  RETURN QUERY SELECT
    p_product_key,
    COALESCE(v_status, 'available'),
    COALESCE(v_status = 'enabled' AND v_can_view, false),
    COALESCE(
      p_product_key = 'finance'
      AND v_status = 'available'
      AND v_role IN ('owner', 'admin'),
      false
    ),
    CASE
      WHEN v_status IS DISTINCT FROM 'enabled' THEN 'product_not_enabled'
      WHEN NOT v_can_view THEN 'module_permission_denied'
      ELSE NULL
    END,
    v_requested_at,
    v_decided_at;
END;
$fn$;

-- El tenant sólo solicita. No puede autoaprobarse ni alterar el producto base.
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
  IF p_product_key <> 'finance' THEN
    RAISE EXCEPTION 'Sólo Finance admite solicitudes en este piloto'
      USING ERRCODE = '22023';
  END IF;

  SELECT m.role::text INTO v_role
  FROM public.memberships m
  WHERE m.org_id = p_org_id AND m.user_id = auth.uid();

  -- En SQL, `NULL NOT IN (...)` también devuelve NULL y un IF no entra. La
  -- nulidad se comprueba explícitamente para que alguien sin membership no
  -- pueda convertir una disponibilidad comercial en solicitud.
  IF v_role IS NULL OR v_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Sólo owner o admin pueden solicitar un producto'
      USING ERRCODE = '42501';
  END IF;

  SELECT status INTO v_previous
  FROM public.organization_product_access
  WHERE org_id = p_org_id AND product_key = p_product_key
  FOR UPDATE;

  IF v_previous IS NULL THEN
    RAISE EXCEPTION 'El producto no está disponible para esta organización';
  END IF;
  IF v_previous IN ('requested', 'enabled') THEN
    RETURN v_previous;
  END IF;

  UPDATE public.organization_product_access
  SET status = 'requested', requested_at = now(), requested_by = auth.uid(), updated_at = now()
  WHERE org_id = p_org_id AND product_key = p_product_key;

  INSERT INTO public.organization_product_access_events(
    org_id, product_key, event_type, previous_status, next_status,
    actor_id, actor_surface
  ) VALUES (
    p_org_id, p_product_key, 'requested', v_previous, 'requested',
    auth.uid(), 'tenant'
  );

  RETURN 'requested';
END;
$fn$;

-- Autoridad de Control Plane. Aunque la Edge Function usa service_role, la
-- base vuelve a comprobar actor y rol para que un bug en el handler no alcance.
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
BEGIN
  IF p_product_key <> 'finance' THEN
    RAISE EXCEPTION 'Sólo Finance se administra desde este flujo'
      USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.platform_admins
    WHERE user_id = p_actor AND role IN ('superadmin', 'finance')
  ) THEN
    RAISE EXCEPTION 'El actor no puede administrar productos'
      USING ERRCODE = '42501';
  END IF;
  IF v_reason IS NULL OR char_length(v_reason) < 10 OR char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'La decisión requiere un motivo de 10 a 500 caracteres'
      USING ERRCODE = '22023';
  END IF;

  SELECT status INTO v_previous
  FROM public.organization_product_access
  WHERE org_id = p_org_id AND product_key = p_product_key
  FOR UPDATE;

  IF v_previous IS NULL THEN
    RAISE EXCEPTION 'La organización o el producto no existen';
  END IF;
  IF v_previous = v_next THEN
    RETURN v_next;
  END IF;

  UPDATE public.organization_product_access
  SET status = v_next,
      decided_at = now(),
      decided_by = p_actor,
      decision_reason = v_reason,
      updated_at = now()
  WHERE org_id = p_org_id AND product_key = p_product_key;

  INSERT INTO public.organization_product_access_events(
    org_id, product_key, event_type, previous_status, next_status,
    actor_id, actor_surface, reason
  ) VALUES (
    p_org_id, p_product_key,
    CASE WHEN p_enabled THEN 'enabled' ELSE 'disabled' END,
    v_previous, v_next, p_actor, 'platform', v_reason
  );

  INSERT INTO public.admin_audit_logs(
    admin_user_id, action, target_org_id, details
  ) VALUES (
    p_actor,
    CASE WHEN p_enabled THEN 'productAccessEnabled' ELSE 'productAccessDisabled' END,
    p_org_id,
    jsonb_build_object(
      'product_key', p_product_key,
      'previous_status', v_previous,
      'next_status', v_next,
      'reason', v_reason
    )
  );

  RETURN v_next;
END;
$fn$;

-- Proyección agregada de los dominios compartidos. Finance no inventa sus
-- propios proveedores, compras, obligaciones ni asientos, y el navegador no
-- arma un join transversal.
CREATE OR REPLACE FUNCTION public.finance_core_snapshot(p_org_id uuid)
RETURNS TABLE (
  suppliers_count bigint,
  open_purchase_orders bigint,
  open_payables_count bigint,
  open_payables_ars numeric,
  ledger_entries_count bigint,
  precursor_ocr_documents bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_access record;
BEGIN
  SELECT * INTO v_access
  FROM public.product_surface_access(p_org_id, 'finance');

  IF NOT COALESCE(v_access.allowed, false) THEN
    RAISE EXCEPTION 'Finance no está habilitado para esta sesión'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY SELECT
    (SELECT count(*) FROM public.suppliers s WHERE s.org_id = p_org_id AND s.active),
    (SELECT count(*) FROM public.purchase_orders po WHERE po.org_id = p_org_id AND po.status NOT IN ('received', 'cancelled')),
    (SELECT count(*) FROM public.supplier_debts sd WHERE sd.org_id = p_org_id AND sd.status IN ('pending', 'partial')),
    (SELECT COALESCE(sum(sd.remaining_ars), 0) FROM public.supplier_debts sd WHERE sd.org_id = p_org_id AND sd.status IN ('pending', 'partial')),
    (SELECT count(*) FROM public.ledger_entries le WHERE le.org_id = p_org_id),
    (SELECT count(*) FROM public.ocr_documents od WHERE od.org_id = p_org_id);
END;
$fn$;

REVOKE ALL ON FUNCTION public.seed_organization_product_access() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.product_surface_access(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.request_product_access(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.platform_product_access_set(uuid, text, boolean, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finance_core_snapshot(uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.product_surface_access(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_product_access(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finance_core_snapshot(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_product_access_set(uuid, text, boolean, uuid, text) TO service_role;

COMMENT ON TABLE public.organization_product_access IS
  'Entitlements por producto, separados de permisos de usuario y feature flags de rollout.';
COMMENT ON FUNCTION public.finance_core_snapshot(uuid) IS
  'Snapshot agregado de los dominios compartidos; no crea un Core paralelo para Finance.';

DO $guard$
BEGIN
  IF has_table_privilege('anon', 'public.organization_product_access', 'SELECT')
     OR has_table_privilege('authenticated', 'public.organization_product_access', 'SELECT')
     OR has_table_privilege('authenticated', 'public.organization_product_access', 'INSERT') THEN
    RAISE EXCEPTION 'organization_product_access quedó expuesta al navegador';
  END IF;
  IF has_function_privilege('anon', 'public.product_surface_access(uuid,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.request_product_access(uuid,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.platform_product_access_set(uuid,text,boolean,uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Una función de acceso por producto quedó con privilegios incorrectos';
  END IF;
END;
$guard$;

INSERT INTO supabase_migrations.schema_migrations(version, name)
VALUES ('20260822000008', 'finance_product_surface')
ON CONFLICT DO NOTHING;
