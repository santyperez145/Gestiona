-- Verificación real de F3.14. Crea un tenant ZZ dentro de una transacción,
-- ejecuta los RPC con roles authenticated/anon reales y revierte todo.

BEGIN;

CREATE TEMP TABLE zz_finance_surface_ctx (
  org_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  outsider_id uuid NOT NULL,
  platform_actor_id uuid NOT NULL
);
GRANT SELECT ON zz_finance_surface_ctx TO authenticated, anon;

DO $setup$
DECLARE
  v_owner uuid;
  v_outsider uuid;
  v_platform_actor uuid;
  v_org uuid;
  v_supplier uuid;
BEGIN
  SELECT m.user_id INTO v_owner
  FROM public.memberships m
  JOIN auth.users u ON u.id = m.user_id
  WHERE m.role IN ('owner', 'admin')
  ORDER BY CASE WHEN m.role = 'owner' THEN 0 ELSE 1 END, m.joined_at
  LIMIT 1;

  SELECT u.id INTO v_outsider
  FROM auth.users u
  WHERE u.id <> v_owner
  LIMIT 1;

  SELECT pa.user_id INTO v_platform_actor
  FROM public.platform_admins pa
  WHERE pa.role IN ('superadmin', 'finance')
  ORDER BY CASE WHEN pa.role = 'superadmin' THEN 0 ELSE 1 END
  LIMIT 1;

  IF v_owner IS NULL OR v_outsider IS NULL OR v_platform_actor IS NULL THEN
    RAISE EXCEPTION 'La verificación necesita owner, outsider y staff finance/superadmin reales';
  END IF;

  INSERT INTO public.organizations(name, slug, owner_user_id)
  VALUES ('ZZ Finance Product Surface', 'zz-finance-product-surface-' || substr(gen_random_uuid()::text, 1, 8), v_owner)
  RETURNING id INTO v_org;

  INSERT INTO public.memberships(org_id, user_id, role)
  VALUES (v_org, v_owner, 'owner');
  PERFORM public.seed_default_permissions(v_org);

  INSERT INTO public.suppliers(org_id, name, active)
  VALUES (v_org, 'ZZ Proveedor Finance', true)
  RETURNING id INTO v_supplier;

  INSERT INTO public.purchase_orders(
    org_id, order_number, supplier_id, supplier_name, status, currency
  ) VALUES (
    v_org, 'ZZ-PO-FINANCE-1', v_supplier, 'ZZ Proveedor Finance', 'draft', 'ARS'
  );

  INSERT INTO public.supplier_debts(
    org_id, supplier_id, supplier_name, description, amount_ars, paid_ars, status
  ) VALUES (
    v_org, v_supplier, 'ZZ Proveedor Finance', 'ZZ obligación', 123, 0, 'pending'
  );

  INSERT INTO public.ledger_entries(org_id, numero, fecha, descripcion, moneda, created_by)
  VALUES (v_org, 1, CURRENT_DATE, 'ZZ asiento Finance', 'ARS', v_owner);

  INSERT INTO public.ocr_documents(
    org_id, uploaded_by, filename, file_url, file_size, mime_type, ocr_status
  ) VALUES (
    v_org, v_owner, 'zz-precursor.pdf', 'zz/private/precursor.pdf', 100, 'application/pdf', 'pending'
  );

  INSERT INTO zz_finance_surface_ctx VALUES (v_org, v_owner, v_outsider, v_platform_actor);
END;
$setup$;

SET LOCAL ROLE authenticated;

DO $owner_before$
DECLARE
  v_ctx zz_finance_surface_ctx%ROWTYPE;
  v_access record;
  v_status text;
  v_blocked boolean := false;
BEGIN
  SELECT * INTO v_ctx FROM zz_finance_surface_ctx;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_ctx.owner_id, 'role', 'authenticated')::text, true);

  SELECT * INTO v_access FROM public.product_surface_access(v_ctx.org_id, 'finance');
  IF v_access.status <> 'available' OR v_access.allowed OR NOT v_access.can_request
     OR v_access.blocker <> 'product_not_enabled' THEN
    RAISE EXCEPTION 'Estado inicial inesperado: %', row_to_json(v_access);
  END IF;

  v_status := public.request_product_access(v_ctx.org_id, 'finance');
  IF v_status <> 'requested' THEN
    RAISE EXCEPTION 'La solicitud no quedó requested: %', v_status;
  END IF;

  SELECT * INTO v_access FROM public.product_surface_access(v_ctx.org_id, 'finance');
  IF v_access.status <> 'requested' OR v_access.allowed OR v_access.can_request THEN
    RAISE EXCEPTION 'La solicitud no cambió el gate correctamente: %', row_to_json(v_access);
  END IF;

  BEGIN
    PERFORM * FROM public.finance_core_snapshot(v_ctx.org_id);
  EXCEPTION WHEN insufficient_privilege THEN
    v_blocked := true;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'El snapshot se leyó antes de habilitar Finance';
  END IF;

  v_blocked := false;
  BEGIN
    EXECUTE 'SELECT count(*) FROM public.organization_product_access';
  EXCEPTION WHEN insufficient_privilege THEN
    v_blocked := true;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'authenticated pudo leer la tabla cruda de entitlements';
  END IF;
END;
$owner_before$;

RESET ROLE;

DO $platform_enable$
DECLARE
  v_ctx zz_finance_surface_ctx%ROWTYPE;
  v_status text;
BEGIN
  SELECT * INTO v_ctx FROM zz_finance_surface_ctx;
  v_status := public.platform_product_access_set(
    v_ctx.org_id, 'finance', true, v_ctx.platform_actor_id,
    'Habilitación controlada para verificar el piloto Finance'
  );
  IF v_status <> 'enabled' THEN
    RAISE EXCEPTION 'Platform no habilitó Finance: %', v_status;
  END IF;
END;
$platform_enable$;

SET LOCAL ROLE authenticated;

DO $owner_enabled$
DECLARE
  v_ctx zz_finance_surface_ctx%ROWTYPE;
  v_access record;
  v_snapshot record;
BEGIN
  SELECT * INTO v_ctx FROM zz_finance_surface_ctx;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_ctx.owner_id, 'role', 'authenticated')::text, true);

  SELECT * INTO v_access FROM public.product_surface_access(v_ctx.org_id, 'finance');
  IF NOT v_access.allowed OR v_access.status <> 'enabled' OR v_access.blocker IS NOT NULL THEN
    RAISE EXCEPTION 'Owner habilitado no obtuvo acceso: %', row_to_json(v_access);
  END IF;

  SELECT * INTO v_snapshot FROM public.finance_core_snapshot(v_ctx.org_id);
  IF v_snapshot.suppliers_count <> 1
     OR v_snapshot.open_purchase_orders <> 1
     OR v_snapshot.open_payables_count <> 1
     OR v_snapshot.open_payables_ars <> 123
     OR v_snapshot.ledger_entries_count <> 1
     OR v_snapshot.precursor_ocr_documents <> 1 THEN
    RAISE EXCEPTION 'El snapshot no leyó el Core compartido: %', row_to_json(v_snapshot);
  END IF;

  UPDATE public.role_permissions
  SET can_view = false
  WHERE org_id = v_ctx.org_id AND role = 'admin' AND module = 'finance';

  SELECT * INTO v_access FROM public.product_surface_access(v_ctx.org_id, 'finance');
  IF v_access.allowed OR v_access.blocker <> 'module_permission_denied' THEN
    RAISE EXCEPTION 'finance.view=false no bloqueó la superficie: %', row_to_json(v_access);
  END IF;

  UPDATE public.role_permissions
  SET can_view = true
  WHERE org_id = v_ctx.org_id AND role = 'admin' AND module = 'finance';
END;
$owner_enabled$;

DO $outsider$
DECLARE
  v_ctx zz_finance_surface_ctx%ROWTYPE;
  v_blocked boolean := false;
BEGIN
  SELECT * INTO v_ctx FROM zz_finance_surface_ctx;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_ctx.outsider_id, 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM * FROM public.product_surface_access(v_ctx.org_id, 'finance');
  EXCEPTION WHEN insufficient_privilege THEN
    v_blocked := true;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'Un outsider pudo consultar el producto Finance';
  END IF;

  v_blocked := false;
  BEGIN
    PERFORM public.request_product_access(v_ctx.org_id, 'finance');
  EXCEPTION WHEN insufficient_privilege THEN
    v_blocked := true;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'Un outsider pudo solicitar el producto Finance';
  END IF;
END;
$outsider$;

RESET ROLE;

DO $platform_disable$
DECLARE
  v_ctx zz_finance_surface_ctx%ROWTYPE;
  v_status text;
  v_events integer;
BEGIN
  SELECT * INTO v_ctx FROM zz_finance_surface_ctx;
  v_status := public.platform_product_access_set(
    v_ctx.org_id, 'finance', false, v_ctx.platform_actor_id,
    'Cierre controlado del acceso usado para la verificación'
  );
  IF v_status <> 'available' THEN
    RAISE EXCEPTION 'Platform no deshabilitó Finance: %', v_status;
  END IF;

  SELECT count(*) INTO v_events
  FROM public.organization_product_access_events
  WHERE org_id = v_ctx.org_id AND product_key = 'finance';
  IF v_events <> 3 THEN
    RAISE EXCEPTION 'Se esperaban 3 eventos append-only y hay %', v_events;
  END IF;
END;
$platform_disable$;

SET LOCAL ROLE anon;
DO $anon$
DECLARE
  v_ctx zz_finance_surface_ctx%ROWTYPE;
  v_blocked boolean := false;
BEGIN
  SELECT * INTO v_ctx FROM zz_finance_surface_ctx;
  BEGIN
    PERFORM * FROM public.product_surface_access(v_ctx.org_id, 'finance');
  EXCEPTION WHEN insufficient_privilege OR undefined_function THEN
    v_blocked := true;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'anon pudo ejecutar product_surface_access';
  END IF;
END;
$anon$;
RESET ROLE;

ROLLBACK;

SELECT
  count(*) FILTER (WHERE name LIKE 'ZZ Finance Product Surface%') AS organizaciones_zz,
  (SELECT count(*) FROM public.organization_product_access_events e
    JOIN public.organizations o ON o.id = e.org_id
    WHERE o.name LIKE 'ZZ Finance Product Surface%') AS eventos_zz
FROM public.organizations;
