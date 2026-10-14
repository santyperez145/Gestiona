-- Simulacro de 20261014000800 (concatenar después de la migración sin
-- BEGIN/COMMIT; termina en ROLLBACK). Negocio ZZ con «Origen» y «Destino».
-- Origen tiene 2 ventas, 1 deuda, $100 a favor, 1 actividad del CRM (tabla en
-- cascada) y está en dos segmentos; Destino ya está en uno de ellos.
--   1. Un vendedor no puede combinar.
--   2. Un cliente de otro negocio se rechaza.
--   3. Combinar mueve ventas, deuda, saldo y la actividad, con el nombre nuevo.
--   4. El segmento compartido no se duplica y el otro pasa al destino.
--   5. La ficha de origen ya no existe y el saldo quedó en el destino.
DO $$
DECLARE
  v_user uuid; v_vend uuid; v_org uuid; v_org2 uuid; v_a uuid; v_b uuid; v_ajeno uuid; s1 uuid; s2 uuid; v_r jsonb;
BEGIN
  SELECT id INTO v_user FROM auth.users ORDER BY created_at LIMIT 1;
  SELECT id INTO v_vend FROM auth.users WHERE id <> v_user ORDER BY created_at LIMIT 1;
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ fusionar', 'zz-fus-' || substr(md5(random()::text), 1, 8), v_user) RETURNING id INTO v_org;
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ otro', 'zz-fus2-' || substr(md5(random()::text), 1, 8), v_user) RETURNING id INTO v_org2;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_user, 'owner'), (v_org, v_vend, 'vendedor'), (v_org2, v_user, 'owner') ON CONFLICT DO NOTHING;
  INSERT INTO public.customers (org_id, user_id, name) VALUES (v_org, v_user, 'ZZ Origen') RETURNING id INTO v_a;
  INSERT INTO public.customers (org_id, user_id, name) VALUES (v_org, v_user, 'ZZ Destino') RETURNING id INTO v_b;
  INSERT INTO public.customers (org_id, user_id, name) VALUES (v_org2, v_user, 'ZZ Ajeno') RETURNING id INTO v_ajeno;
  INSERT INTO public.sales (org_id, user_id, product_name, customer_id, customer_name) VALUES
    (v_org, v_user, 'ZZ venta 1', v_a, 'ZZ Origen'), (v_org, v_user, 'ZZ venta 2', v_a, 'ZZ Origen');
  INSERT INTO public.debts (org_id, user_id, customer_id, customer_name, amount_ars, paid_ars, remaining_ars, status, date, description)
    VALUES (v_org, v_user, v_a, 'ZZ Origen', 50, 0, 50, 'pending', now(), 'ZZ deuda');
  INSERT INTO public.saldo_a_favor_movimientos (org_id, customer_id, customer_name, monto_ars, motivo) VALUES (v_org, v_a, 'ZZ Origen', 100, 'Anticipo');
  INSERT INTO public.crm_activities (org_id, customer_id, activity_type, subject) VALUES (v_org, v_a, 'note', 'ZZ llamada');
  INSERT INTO public.customer_segments (org_id, name) VALUES (v_org, 'ZZ seg 1') RETURNING id INTO s1;
  INSERT INTO public.customer_segments (org_id, name) VALUES (v_org, 'ZZ seg 2') RETURNING id INTO s2;
  INSERT INTO public.customer_segment_members (segment_id, customer_id) VALUES (s1, v_a), (s2, v_a), (s1, v_b);

  -- 1
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_vend, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.fusionar_clientes(v_org, v_a, v_b);
    RAISE EXCEPTION 'FALLA 1: un vendedor combinó';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  -- 2
  BEGIN
    PERFORM public.fusionar_clientes(v_org, v_ajeno, v_b);
    RAISE EXCEPTION 'FALLA 2: aceptó un cliente de otro negocio';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;

  -- 3
  v_r := public.fusionar_clientes(v_org, v_a, v_b);
  RESET ROLE;
  IF (SELECT count(*) FROM public.sales WHERE customer_id = v_b AND customer_name = 'ZZ Destino') <> 2
     OR (SELECT count(*) FROM public.debts WHERE customer_id = v_b AND customer_name = 'ZZ Destino') <> 1
     OR (SELECT count(*) FROM public.crm_activities WHERE customer_id = v_b) <> 1 THEN
    RAISE EXCEPTION 'FALLA 3: %', v_r; END IF;

  -- 4
  IF (SELECT count(*) FROM public.customer_segment_members WHERE customer_id = v_b) <> 2
     OR (SELECT count(*) FROM public.customer_segment_members WHERE segment_id = s1) <> 1 THEN
    RAISE EXCEPTION 'FALLA 4: segmentos %', v_r; END IF;

  -- 5
  IF EXISTS (SELECT 1 FROM public.customers WHERE id = v_a) OR public.saldo_a_favor(v_org, v_b) <> 100 THEN
    RAISE EXCEPTION 'FALLA 5: %', v_r; END IF;
  RAISE EXCEPTION 'OK 1-5 %', v_r;
END $$;

ROLLBACK;
