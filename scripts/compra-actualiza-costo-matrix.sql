-- Simulacro de 20261014001700 (concatenar después de la migración sin
-- BEGIN/COMMIT; termina en ROLLBACK). Negocio ZZ sin cotización cargada.
--   1. Compra en pesos sin cotización: un producto sin costo adopta el costo
--      en pesos y los valores en dólares quedan en 0 (no los pesos).
--   2. Producto que lleva el costo en dólares + compra en pesos con
--      cotización: el costo en dólares pasa a ser el de la compra convertido.
--   3. Compra en dólares de un producto que lleva el costo en pesos: el costo
--      en pesos es el de la compra a la cotización.
--   4. Con actualizar_costos=false el costo no cambia.
--   (1 también: la fecha elegida es la misma vista desde Argentina — 001800.)
DO $$
DECLARE
  v_user uuid; v_org uuid; p_nuevo uuid; p_usd uuid; p_ars uuid; v_r jsonb;
BEGIN
  SELECT id INTO v_user FROM auth.users ORDER BY created_at LIMIT 1;
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ costos', 'zz-costo-' || substr(md5(random()::text), 1, 8), v_user) RETURNING id INTO v_org;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_user, 'owner') ON CONFLICT DO NOTHING;
  UPDATE public.settings SET exchange_rate = 0 WHERE org_id = v_org;
  INSERT INTO public.products (org_id, user_id, name) VALUES (v_org, v_user, 'ZZ Nuevo') RETURNING id INTO p_nuevo;
  INSERT INTO public.products (org_id, user_id, name, cost_usd, total_cost_usd, cost_currency) VALUES (v_org, v_user, 'ZZ Importado', 2, 2, 'USD') RETURNING id INTO p_usd;
  INSERT INTO public.products (org_id, user_id, name, cost_ars, cost_currency) VALUES (v_org, v_user, 'ZZ Local', 900, 'ARS') RETURNING id INTO p_ars;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- 1
  v_r := public.registrar_compra(v_org, jsonb_build_object('fecha', '2026-10-14', 'items', jsonb_build_array(jsonb_build_object('producto_id', p_nuevo, 'cantidad', 2, 'costo_unitario', 1500))));
  RESET ROLE;
  IF (SELECT cost_ars || '|' || cost_currency FROM public.products WHERE id = p_nuevo) <> '1500.00|ARS'
     OR (SELECT total_usd + unit_cost_usd + exchange_rate FROM public.purchases WHERE compra_id = (v_r->>'compra_id')::uuid) <> 0
     OR (SELECT total_ars FROM public.purchases WHERE compra_id = (v_r->>'compra_id')::uuid) <> 3000
     OR (v_r->>'costos_actualizados')::int <> 1
     OR (SELECT (date AT TIME ZONE 'America/Argentina/Buenos_Aires')::date FROM public.purchases WHERE compra_id = (v_r->>'compra_id')::uuid) <> DATE '2026-10-14' THEN
    RAISE EXCEPTION 'FALLA 1: % / %', v_r, (SELECT cost_ars || '|' || cost_currency FROM public.products WHERE id = p_nuevo); END IF;
  SET LOCAL ROLE authenticated;

  -- 2
  v_r := public.registrar_compra(v_org, jsonb_build_object('cotizacion', 1000, 'items', jsonb_build_array(jsonb_build_object('producto_id', p_usd, 'cantidad', 1, 'costo_unitario', 3000))));
  RESET ROLE;
  IF (SELECT cost_usd FROM public.products WHERE id = p_usd) <> 3 OR (SELECT total_cost_usd FROM public.products WHERE id = p_usd) <> 3 THEN
    RAISE EXCEPTION 'FALLA 2: %', (SELECT cost_usd FROM public.products WHERE id = p_usd); END IF;
  SET LOCAL ROLE authenticated;

  -- 3
  v_r := public.registrar_compra(v_org, jsonb_build_object('moneda', 'USD', 'cotizacion', 1200, 'items', jsonb_build_array(jsonb_build_object('producto_id', p_ars, 'cantidad', 1, 'costo_unitario', 3.5))));
  RESET ROLE;
  IF (SELECT cost_ars FROM public.products WHERE id = p_ars) <> 4200 OR (SELECT cost_currency FROM public.products WHERE id = p_ars) <> 'ARS' THEN
    RAISE EXCEPTION 'FALLA 3: %', (SELECT cost_ars FROM public.products WHERE id = p_ars); END IF;
  SET LOCAL ROLE authenticated;

  -- 4
  v_r := public.registrar_compra(v_org, jsonb_build_object('actualizar_costos', false, 'items', jsonb_build_array(jsonb_build_object('producto_id', p_ars, 'cantidad', 1, 'costo_unitario', 9999))));
  RESET ROLE;
  IF (SELECT cost_ars FROM public.products WHERE id = p_ars) <> 4200 OR (v_r->>'costos_actualizados')::int <> 0 THEN RAISE EXCEPTION 'FALLA 4'; END IF;
  RAISE EXCEPTION 'OK 1-4';
END $$;

ROLLBACK;
