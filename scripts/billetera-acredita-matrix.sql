-- Simulacro de 20261015000200 (concatenar después de la migración sin
-- BEGIN/COMMIT; termina en ROLLBACK).
--   1. Un cobro de Mercado Pago liberado ayer, que entró como venta por el
--      bruto: el neto pasa a disponible y las comisiones a resultados.
--   2. Correr de nuevo no acredita dos veces.
--   3. Un cobro que se libera mañana sigue pendiente y la vista dice cuándo.
--   4. No se acredita lo que nunca se asentó a liquidar.
--   5. Un cobro del mostrador sin conciliar figura «por conciliar».
--   6. Un usuario de otro negocio no ve lo pendiente.
--   7. Lo de Exentry que Mercado Pago liberó el 31/7 ya no está pendiente.
DO $$
DECLARE v_user uuid; v_otro uuid; v_org uuid; pt1 uuid; pt2 uuid; pt3 uuid; v_s jsonb; v_n int; v_e1 uuid; v_e2 uuid; v_fee numeric; v_e1_monto numeric;
BEGIN
  SELECT id INTO v_user FROM auth.users ORDER BY created_at LIMIT 1;
  SELECT id INTO v_otro FROM auth.users WHERE id <> v_user ORDER BY created_at LIMIT 1;
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ billetera', 'zz-bi-' || substr(md5(random()::text), 1, 8), v_user) RETURNING id INTO v_org;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_user, 'owner') ON CONFLICT DO NOTHING;
  PERFORM public.ledger_plan_default(v_org);
  PERFORM public.ledger_asentar(v_org, 'ZZ venta', jsonb_build_array(
    jsonb_build_object('cuenta', '1.1.03', 'debe', 100),
    jsonb_build_object('cuenta', '4.1.01', 'haber', 100)), CURRENT_DATE - 3, 'venta', gen_random_uuid());

  INSERT INTO public.payment_transactions (org_id, source, source_id, provider, method, installments, gross_amount, provider_fee, provider_fee_iva, platform_fee, net_amount, currency, status, external_id, expected_release_at, released_at, updated_at)
  VALUES (v_org, 'ecommerce', gen_random_uuid(), 'mercadopago', 'credit', 0, 100, 8, 2, 5, 85, 'ARS', 'approved', 'zz-' || md5(random()::text), CURRENT_DATE - 1, NULL, now() - interval '2 hours')
  RETURNING id INTO pt1;
  INSERT INTO public.payment_transactions (org_id, source, source_id, provider, method, installments, gross_amount, provider_fee, provider_fee_iva, platform_fee, net_amount, currency, status, external_id, expected_release_at, released_at, updated_at)
  VALUES (v_org, 'ecommerce', gen_random_uuid(), 'mercadopago', 'credit', 0, 50, 4, 1, 0, 45, 'ARS', 'approved', 'zz-' || md5(random()::text), CURRENT_DATE + 1, NULL, now() - interval '2 hours')
  RETURNING id INTO pt2;
  INSERT INTO public.payment_transactions (org_id, source, source_id, provider, method, installments, gross_amount, provider_fee, provider_fee_iva, platform_fee, net_amount, currency, status, external_id, expected_release_at, released_at)
  VALUES (v_org, 'pos', gen_random_uuid(), 'otro', 'credit', 0, 70, 0, 0, 0, 70, 'ARS', 'pending', 'zz-' || md5(random()::text), NULL, NULL)
  RETURNING id INTO pt3;

  PERFORM public.wallet_acreditar_liberados();
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  v_s := public.wallet_saldo(v_org);
  SELECT COALESCE(sum(l.debe - l.haber), 0) INTO v_fee FROM public.ledger_lines l JOIN public.ledger_accounts a ON a.id = l.account_id
   WHERE l.org_id = v_org AND a.codigo IN ('5.2.01', '5.2.02');
  IF (v_s->>'pendiente')::numeric <> 0 OR (v_s->>'disponible')::numeric <> 85 OR v_fee <> 15 THEN
    RAISE EXCEPTION 'FALLA 1: %, comisiones %', v_s, v_fee;
  END IF;

  v_e1 := public.wallet_acreditar_cobro(pt1);
  v_e2 := public.wallet_acreditar_cobro(pt1);
  v_s := public.wallet_saldo(v_org);
  IF v_e1 IS DISTINCT FROM v_e2 OR (v_s->>'disponible')::numeric <> 85 THEN RAISE EXCEPTION 'FALLA 2: % % %', v_e1, v_e2, v_s; END IF;

  -- 4: pt2 vence hoy pero no hay nada a liquidar (la venta no se asentó).
  UPDATE public.payment_transactions SET expected_release_at = CURRENT_DATE WHERE id = pt2;
  IF public.wallet_acreditar_cobro(pt2) IS NOT NULL THEN RAISE EXCEPTION 'FALLA 4: acreditó lo que no estaba a liquidar'; END IF;
  UPDATE public.payment_transactions SET expected_release_at = CURRENT_DATE + 1 WHERE id = pt2;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM public.wallet_pendiente
   WHERE org_id = v_org AND ((tipo = 'mercado_pago' AND monto = 45 AND proxima_fecha = CURRENT_DATE + 1)
                          OR (tipo = 'por_conciliar' AND monto = 70 AND cobros = 1));
  RESET ROLE;
  IF v_n <> 2 THEN RAISE EXCEPTION 'FALLA 3/5: % filas esperadas', v_n; END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_otro, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM public.wallet_pendiente WHERE org_id = v_org;
  RESET ROLE;
  IF v_n <> 0 THEN RAISE EXCEPTION 'FALLA 6: otro negocio ve % filas', v_n; END IF;

  SELECT COALESCE(sum(l.debe - l.haber) FILTER (WHERE a.codigo = '1.1.03'), 0),
         COALESCE(sum(l.debe - l.haber) FILTER (WHERE a.codigo = '1.1.04'), 0)
    INTO v_fee, v_e1_monto
    FROM public.ledger_lines l JOIN public.ledger_accounts a ON a.id = l.account_id
   WHERE l.org_id = '026eb5d8-d21a-4a2a-9e0b-83d60ba4c285' AND a.codigo IN ('1.1.03', '1.1.04');
  IF v_fee <> 0 THEN RAISE EXCEPTION 'FALLA 7: Exentry sigue con % pendiente', v_fee; END IF;
  RAISE EXCEPTION 'OK 1-7 (Exentry: pendiente %, disponible %)', v_fee, v_e1_monto;
END $$;

ROLLBACK;
