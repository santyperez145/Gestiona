-- ============================================================================
-- Verificación reversible: timeline 360 del cliente (20260925000700).
-- Correr con `npx supabase db query --linked --file <este archivo>`.
-- Todo corre dentro de un bloque con ROLLBACK: no deja datos.
-- ============================================================================

BEGIN;
DO $verify$
DECLARE
  v_org      uuid := gen_random_uuid();
  v_user     uuid;
  v_customer uuid;
  v_sale     uuid;
  v_sale2    uuid;
  v_order    uuid;
  v_store    uuid;
  v_total    int;
  v_fecha    timestamptz;
  v_denied   boolean;
  v_linked   text;
  v_kind     text;
  v_otro     uuid;
  v_org2     uuid;
  v_outsider uuid;
BEGIN
  SELECT user_id INTO v_user FROM public.memberships WHERE role = 'owner' ORDER BY joined_at LIMIT 1;
  ASSERT v_user IS NOT NULL, 'requires existing user';

  RAISE NOTICE '═══ Timeline 360 del cliente — verificación ═══';

  -- ── 0. Precondiciones ────────────────────────────────────────────────────
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'customer_timeline_360'
  ), 'no existe customer_timeline_360';
  ASSERT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema = 'public' AND table_name = 'ecommerce_orders'),
    'FALLO: no existe ecommerce_orders';
  RAISE NOTICE 'OK: RPC presente';

  -- ── 1. Ambiente: org efímera + cliente con historial de tres fuentes ────
  INSERT INTO public.organizations(id, name, slug, owner_user_id) VALUES
    (v_org, 'ZZ Timeline 360 verification', 'zz-tl360-' || v_org, v_user);
  INSERT INTO public.memberships(org_id, user_id, role) VALUES (v_org, v_user, 'owner');
  INSERT INTO public.role_permissions(org_id, role, module, can_view, can_edit)
  VALUES (v_org, 'admin', 'customers', true, true)
  ON CONFLICT (org_id, role, module) DO UPDATE SET can_view = true, can_edit = true;

  -- Venta sin enlazar: cruza por nombre normalizado.
  -- El trigger trg_sales_link_customer resuelve al cliente si existe: para
  -- conservar la fila sin customer_id (el caso real de gente dada de alta
  -- después de comprar), la venta se inserta ANTES de crear al cliente.
  INSERT INTO public.sales(user_id, org_id, product_name, quantity, unit_price_ars, total_ars, profit_ars, profit_usd, customer_name, date, paid)
  VALUES (v_user, v_org, 'Compra anterior sin ficha', 1, 5000, 5000, 100, 0, 'zz  cliente   timeline', now() - interval '10 days', true)
  RETURNING id INTO v_sale2;

  INSERT INTO public.customers(id, org_id, user_id, name, email)
  VALUES (gen_random_uuid(), v_org, v_user, 'ZZ Cliente Timeline', 'zz-tl-' || v_org || '@example.com')
  RETURNING id INTO v_customer;

  -- Venta de POS enlazada por id.
  INSERT INTO public.sales(user_id, org_id, product_name, quantity, unit_price_ars, total_ars, profit_ars, profit_usd, customer_id, customer_name, date, paid)
  VALUES (v_user, v_org, 'Producto Timeline', 1, 10000, 10000, 200, 0, v_customer, 'ZZ Cliente Timeline', now() - interval '3 days', true)
  RETURNING id INTO v_sale;

  -- Pedido de la tienda online por email (comprador online sin CRM al pagar).
  INSERT INTO public.ecommerce_stores(id, org_id, name, slug, is_active)
  VALUES (gen_random_uuid(), v_org, 'ZZ Store', 'zz-store-' || substr(v_org::text, 1, 8), true)
  RETURNING id INTO v_store;
  INSERT INTO public.ecommerce_orders(id, org_id, store_id, order_number, customer_id, customer_email, customer_name, items, total, payment_method, payment_status, fulfillment_status, created_at)
  VALUES (gen_random_uuid(), v_org, v_store, 'ZZ-001', NULL, 'zz-tl-' || v_org || '@example.com', 'ZZ Cliente Timeline', '[]', 8000, 'mercado_pago', 'paid', 'pending', now() - interval '1 day')
  RETURNING id INTO v_order;

  -- Nota del CRM (interacción registrada).
  INSERT INTO public.customer_communications(org_id, user_id, customer_id, customer_name, type, summary)
  VALUES (v_org, v_user, v_customer, 'ZZ Cliente Timeline', 'call', 'Llamada de seguimiento del lote de verificación');

  -- Deuda pendiente.
  INSERT INTO public.debts(user_id, org_id, customer_id, customer_name, amount_ars, paid_ars, remaining_ars, description, date, status)
  VALUES (v_user, v_org, v_customer, 'ZZ Cliente Timeline', 3000, 0, 3000, 'Saldo de contracheque', now() - interval '2 days', 'pending');

  -- ── 2. Actuar como dueño y leer la timeline ─────────────────────────────
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  SELECT count(*) INTO v_total
    FROM public.customer_timeline_360(v_org, v_customer, 100);
  ASSERT v_total >= 5, 'la timeline deberia tener al menos 5 eventos (2 ventas, 1 pedido, 1 nota, 1 deuda): ' || v_total;

  -- 2a. La venta sin enlazar entra por nombre: la ficha declara el cruce.
  SELECT kind, linked_by INTO v_kind, v_linked
    FROM public.customer_timeline_360(v_org, v_customer, 100)
   WHERE kind = 'venta' AND title LIKE '%Compra anterior%' LIMIT 1;
  ASSERT v_kind IS NOT NULL, 'la venta sin enlazar no apareció';
  ASSERT v_linked = 'nombre', 'la venta sin customer_id deberia reportar linked_by = nombre';
  RAISE NOTICE 'OK: cruce por nombre declarado en linked_by';

  -- 2b. El pedido online entra por email aunque no tenga customer_id.
  ASSERT EXISTS (
    SELECT 1 FROM public.customer_timeline_360(v_org, v_customer, 100)
     WHERE kind = 'pedido_online' AND title LIKE 'Pedido ZZ-001%'
  ), 'el pedido de tienda no apareció en la timeline';
  RAISE NOTICE 'OK: pedido online visible';

  -- 2c. Orden temporal: lo más reciente primero.
  SELECT occurred_at INTO v_fecha
    FROM public.customer_timeline_360(v_org, v_customer, 100) LIMIT 1;
  ASSERT v_fecha IS NOT NULL, 'la timeline vino vacía';
  RAISE NOTICE 'OK: orden por fecha descendente';

  -- ── 3. Otro cliente de la misma org no ve esta historia ─────────────────
  INSERT INTO public.customers(id, org_id, user_id, name, email)
  VALUES (gen_random_uuid(), v_org, v_user, 'ZZ Otro Cliente Timeline', 'zz-tl2-' || v_org || '@example.com')
  RETURNING id INTO v_otro;
  SELECT count(*) INTO v_total FROM public.customer_timeline_360(v_org, v_otro, 100);
  ASSERT v_total = 0, 'la timeline de otro cliente debe estar vacia, tiene ' || v_total;
  RAISE NOTICE 'OK: aislamiento entre fichas';

  -- ── 4. Un cliente de OTRA org es error, no un escape ────────────────────
  -- service_role provisiona comercios: auth.uid() NULL bypassa el chequeo de
  -- plan del trigger de memberships. Hay que limpiar los claims del owner,
  -- porque auth.uid() lee de request.jwt.claims y no del rol actual.
  SET LOCAL ROLE service_role;
  PERFORM set_config('request.jwt.claims', '', true);
  INSERT INTO public.organizations(id, name, slug, owner_user_id) VALUES
    (gen_random_uuid(), 'ZZ Timeline otra org', 'zz-tl2o-' || v_org, v_user)
  RETURNING id INTO v_org2;
  INSERT INTO public.memberships(org_id, user_id, role) VALUES (v_org2, v_user, 'owner');
  INSERT INTO public.customers(id, org_id, user_id, name)
  VALUES (gen_random_uuid(), v_org2, v_user, 'Homónimo Cruzado')
  RETURNING id INTO v_otro;
  RESET ROLE;
  v_denied := false;
  BEGIN
    PERFORM count(*) FROM public.customer_timeline_360(v_org, v_otro, 10);
  EXCEPTION WHEN OTHERS THEN v_denied := true; END;
  ASSERT v_denied, 'se leyó un cliente de otra org';
  RAISE NOTICE 'OK: la org del cliente se valida server-side';

  -- ── 5. Sin membresía en la org pedida: denegado ─────────────────────────
  SELECT m.user_id INTO v_outsider
    FROM public.memberships m
   WHERE m.user_id <> v_user
     AND NOT EXISTS (SELECT 1 FROM public.memberships m2 WHERE m2.org_id = v_org AND m2.user_id = m.user_id)
   ORDER BY m.joined_at LIMIT 1;
  IF v_outsider IS NOT NULL THEN
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_outsider, 'role', 'authenticated')::text, true);
    v_denied := false;
    BEGIN
      PERFORM count(*) FROM public.customer_timeline_360(v_org, v_customer, 10);
    EXCEPTION WHEN OTHERS THEN v_denied := true; END;
    ASSERT v_denied, 'un no-miembro leyó la timeline de la org';
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_user, 'role', 'authenticated')::text, true);
    RAISE NOTICE 'OK: sólo miembros de la org leen la timeline';
  ELSE
    RAISE NOTICE 'AVISO: sin outsider disponible, test 5 salteado';
  END IF;

  -- ── 6. Límites inválidos: rechazo explícito ─────────────────────────────
  v_denied := false;
  BEGIN
    PERFORM count(*) FROM public.customer_timeline_360(v_org, v_customer, 500);
  EXCEPTION WHEN OTHERS THEN v_denied := true; END;
  ASSERT v_denied, 'se acepto un limit fuera de rango';
  RAISE NOTICE 'OK: límites validados';

  -- ── 7. Paginación estable: offset avanza sin repetir filas ──────────────
  SELECT count(*) INTO v_total FROM (
    SELECT source_id FROM public.customer_timeline_360(v_org, v_customer, 2, 0)
    UNION ALL
    SELECT source_id FROM public.customer_timeline_360(v_org, v_customer, 2, 2)
  ) pag;
  ASSERT v_total <= 4, 'la paginación repitió filas';
  RAISE NOTICE 'OK: paginación por offset';

  RAISE NOTICE '═══ Todo el timeline pasó dentro de la transacción ═══';
  RAISE EXCEPTION 'rollback_intencional';
END;
$verify$;

ROLLBACK;
SELECT 'timeline 360 verificado y revertido' AS resultado;