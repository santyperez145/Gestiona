BEGIN;
DO $verify$
DECLARE
  v_org   uuid := gen_random_uuid();
  v_user  uuid;
  v_sale  uuid := gen_random_uuid();
  v_prod  uuid := gen_random_uuid();
  v_entry uuid;
  v_batch uuid;
  v_status text;
  v_count int;
  v_csv   text;
  v_denied boolean;
BEGIN
  SELECT user_id INTO v_user FROM public.memberships WHERE role = 'owner' ORDER BY joined_at LIMIT 1;
  ASSERT v_user IS NOT NULL, 'requires existing user';

  -- ── Seed como postgres (la conexión admin no pasa por RLS) ────────────
  INSERT INTO public.organizations(id, name, slug, owner_user_id) VALUES
    (v_org, 'ZZ Export verification', 'zz-export-' || v_org, v_user);
  INSERT INTO public.memberships(org_id, user_id, role) VALUES (v_org, v_user, 'owner');
  DELETE FROM public.role_permissions WHERE org_id = v_org AND module = 'expenses';
  PERFORM public.ledger_plan_default(v_org);
  -- El emisor monotributo es el único que asienta venta sin corte de IVA.
  INSERT INTO public.settings(org_id, user_id, afip_tipo_emisor) VALUES (v_org, v_user, 'monotributo')
    ON CONFLICT (org_id) DO UPDATE SET afip_tipo_emisor = 'monotributo';
  INSERT INTO public.products(id, org_id, user_id, name, sale_price_ars, stock)
    VALUES (v_prod, v_org, v_user, 'ZZ Producto export', 1000, 1);
  INSERT INTO public.sales(id, org_id, user_id, date, customer_name, product_id, product_name, quantity,
      total_ars, cost_of_goods_ars, payment_method, paid)
    VALUES (v_sale, v_org, v_user, CURRENT_DATE, 'ZZ Cliente', v_prod, 'ZZ Producto export', 1, 1000, 0, 'efectivo', true);

  -- ── Sesión autenticada: el dueño ejercita las RPC reales ───────────────
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- El trigger trg_sale_ledger asienta la venta ya insertada (SECURITY
  -- DEFINER): el asiento existe sin llamar RPC restringidas.
  SELECT e.id INTO v_entry
    FROM public.ledger_entries e
   WHERE e.org_id = v_org AND e.referencia_tipo = 'venta'
     AND e.referencia_id = v_sale AND e.anulado_por IS NULL
   LIMIT 1;
  ASSERT v_entry IS NOT NULL, 'venta no asentada por el trigger';

  -- ── El lote se genera desde el libro real ──────────────────────────────
  SELECT public.finance_export_create(v_org, CURRENT_DATE, CURRENT_DATE) INTO v_batch;
  ASSERT v_batch IS NOT NULL, 'lote no generado';
  SELECT status, row_count INTO v_status, v_count
    FROM public.finance_export_batches WHERE id = v_batch;
  ASSERT v_status = 'listo', 'lote no quedo listo';
  ASSERT v_count = 2, 'el lote no copio las dos partidas';

  -- ── Idempotencia: regenerar el mismo rango reusa el lote preparado ─────
  PERFORM public.finance_export_create(v_org, CURRENT_DATE, CURRENT_DATE);
  SELECT count(*) INTO v_count FROM public.finance_export_rows WHERE batch_id = v_batch;
  ASSERT v_count = 2, 'reintento duplico partidas';

  -- ── El CSV cuadra con el libro ─────────────────────────────────────────
  v_csv := public.finance_export_batch_csv(v_batch);
  ASSERT v_csv LIKE 'asiento;fecha;%', 'CSV sin encabezado estable';
  ASSERT position('1.1.01' in v_csv) > 0, 'CSV sin cuenta activo';
  ASSERT position('4.1.01' in v_csv) > 0, 'CSV sin cuenta ingreso';

  -- ── La traza de exportación queda registrada ───────────────────────────
  PERFORM public.finance_export_mark_exported(v_batch);
  SELECT status INTO v_status FROM public.finance_export_batches WHERE id = v_batch;
  ASSERT v_status = 'exportado', 'exportacion no registrada';

  -- Un lote exportado no se reescribe: regenerar el rango crea otro lote.
  PERFORM public.finance_export_create(v_org, CURRENT_DATE, CURRENT_DATE);
  SELECT count(*) INTO v_count FROM public.finance_export_batches
    WHERE org_id = v_org AND fecha_desde = CURRENT_DATE AND fecha_hasta = CURRENT_DATE;
  ASSERT v_count = 2, 'regenerar tras exportar no creo un lote nuevo';
  SELECT status INTO v_status FROM public.finance_export_batches WHERE id = v_batch;
  ASSERT v_status = 'exportado', 'el lote exportado fue reescrito';

  -- ── Sin permiso explícito, no exporta ──────────────────────────────────
  RESET ROLE;
  -- El override explícito gobierna al owner/admin también (role_permissions
  -- con can_view=false para el rol admin de esta org).
  INSERT INTO public.role_permissions(org_id, role, module, can_view, can_create, can_edit, can_delete, can_export)
    VALUES (v_org, 'admin', 'expenses', false, true, true, true, true)
    ON CONFLICT (org_id, role, module) DO UPDATE SET can_view = false;
  SET LOCAL ROLE authenticated;
  v_denied := false;
  BEGIN
    PERFORM public.finance_export_create(v_org, CURRENT_DATE, CURRENT_DATE);
  EXCEPTION WHEN insufficient_privilege THEN v_denied := true; END;
  ASSERT v_denied, 'view denial ignored for export';

  RESET ROLE;
  SET LOCAL ROLE anon;
  v_denied := false;
  BEGIN
    PERFORM public.finance_export_create(v_org, CURRENT_DATE, CURRENT_DATE);
  EXCEPTION WHEN insufficient_privilege THEN v_denied := true; END;
  ASSERT v_denied, 'anonymous export allowed';
  RESET ROLE;

  RAISE NOTICE 'PASS: export batch lifecycle, idempotency, CSV, tenancy and permission gates';
END;
$verify$;
ROLLBACK;
SELECT count(*) AS remaining_test_organizations FROM public.organizations WHERE name = 'ZZ Export verification';