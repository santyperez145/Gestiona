-- Simulacro de 20261021000100 (concatenar después de la migración sin
-- BEGIN/COMMIT; termina en ROLLBACK). Negocio ZZ con dueño y vendedor, y otro
-- negocio ajeno.
--   1. El dueño carga una Factura A válida.
--   2. El mismo comprobante del mismo proveedor no entra dos veces.
--   3. Una Factura B con alícuotas se rechaza.
--   4. Un IVA que no corresponde al neto se rechaza.
--   5. Un total que no es la suma de sus partes se rechaza.
--   6. El período no puede ser anterior a la fecha del comprobante.
--   7. El vendedor (permisos por defecto) no lee ni carga.
--   8. Otro negocio no ve el comprobante.
--   9. Un comprobante no cambia de negocio.
DO $$
DECLARE
  v_user uuid; v_vend uuid; v_otro uuid; v_org uuid; v_org2 uuid; v_id uuid; n int;
  v_ok text := '';
BEGIN
  SELECT id INTO v_user FROM auth.users ORDER BY created_at LIMIT 1;
  SELECT id INTO v_vend FROM auth.users WHERE id <> v_user ORDER BY created_at LIMIT 1;
  SELECT id INTO v_otro FROM auth.users WHERE id NOT IN (v_user, v_vend) ORDER BY created_at LIMIT 1;
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ compras', 'zz-cc-' || substr(md5(random()::text), 1, 8), v_user) RETURNING id INTO v_org;
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ ajeno', 'zz-cc2-' || substr(md5(random()::text), 1, 8), v_otro) RETURNING id INTO v_org2;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_user, 'owner'), (v_org, v_vend, 'vendedor'), (v_org2, v_otro, 'owner') ON CONFLICT DO NOTHING;

  -- 1
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO public.comprobantes_de_compra (org_id, periodo, fecha, tipo_comprobante, punto_venta, numero, cuit_emisor, razon_social_emisor, alicuotas, percepcion_iva, total)
  VALUES (v_org, '2026-09', '2026-09-05', 1, 4, 3321, '30712345671', ' ZZ Distribuidora ', '[{"tasa":21,"neto":10000,"iva":2100},{"tasa":10.5,"neto":1000,"iva":105}]', 300, 13505)
  RETURNING id INTO v_id;
  RESET ROLE;
  IF (SELECT razon_social_emisor FROM public.comprobantes_de_compra WHERE id = v_id) <> 'ZZ Distribuidora' THEN RAISE EXCEPTION 'FALLA 1'; END IF;
  v_ok := v_ok || '1 ';

  -- 2
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO public.comprobantes_de_compra (org_id, periodo, fecha, tipo_comprobante, punto_venta, numero, cuit_emisor, razon_social_emisor, alicuotas, total)
    VALUES (v_org, '2026-10', '2026-09-05', 1, 4, 3321, '30712345671', 'ZZ', '[{"tasa":21,"neto":100,"iva":21}]', 121);
    RAISE EXCEPTION 'FALLA 2: entró dos veces';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  v_ok := v_ok || '2 ';

  -- 3
  BEGIN
    INSERT INTO public.comprobantes_de_compra (org_id, periodo, fecha, tipo_comprobante, punto_venta, numero, cuit_emisor, razon_social_emisor, alicuotas, total)
    VALUES (v_org, '2026-09', '2026-09-05', 6, 4, 1, '30712345671', 'ZZ', '[{"tasa":21,"neto":100,"iva":21}]', 121);
    RAISE EXCEPTION 'FALLA 3: B con alícuotas';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  INSERT INTO public.comprobantes_de_compra (org_id, periodo, fecha, tipo_comprobante, punto_venta, numero, cuit_emisor, razon_social_emisor, total)
  VALUES (v_org, '2026-09', '2026-09-06', 6, 4, 2, '30712345671', 'ZZ', 999.99);
  v_ok := v_ok || '3 ';

  -- 4
  BEGIN
    INSERT INTO public.comprobantes_de_compra (org_id, periodo, fecha, tipo_comprobante, punto_venta, numero, cuit_emisor, razon_social_emisor, alicuotas, total)
    VALUES (v_org, '2026-09', '2026-09-05', 1, 4, 3, '30712345671', 'ZZ', '[{"tasa":21,"neto":1000,"iva":100}]', 1100);
    RAISE EXCEPTION 'FALLA 4: IVA que no corresponde';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  v_ok := v_ok || '4 ';

  -- 5
  BEGIN
    INSERT INTO public.comprobantes_de_compra (org_id, periodo, fecha, tipo_comprobante, punto_venta, numero, cuit_emisor, razon_social_emisor, alicuotas, total)
    VALUES (v_org, '2026-09', '2026-09-05', 1, 4, 4, '30712345671', 'ZZ', '[{"tasa":21,"neto":1000,"iva":210}]', 1300);
    RAISE EXCEPTION 'FALLA 5: total que no suma';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  v_ok := v_ok || '5 ';

  -- 6
  BEGIN
    INSERT INTO public.comprobantes_de_compra (org_id, periodo, fecha, tipo_comprobante, punto_venta, numero, cuit_emisor, razon_social_emisor, alicuotas, total)
    VALUES (v_org, '2026-08', '2026-09-05', 1, 4, 5, '30712345671', 'ZZ', '[{"tasa":21,"neto":1000,"iva":210}]', 1210);
    RAISE EXCEPTION 'FALLA 6: período anterior a la fecha';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  RESET ROLE;
  v_ok := v_ok || '6 ';

  -- 7
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_vend, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.comprobantes_de_compra WHERE org_id = v_org;
  IF n <> 0 THEN RESET ROLE; RAISE EXCEPTION 'FALLA 7: el vendedor ve % comprobantes', n; END IF;
  BEGIN
    INSERT INTO public.comprobantes_de_compra (org_id, periodo, fecha, tipo_comprobante, punto_venta, numero, cuit_emisor, razon_social_emisor, total)
    VALUES (v_org, '2026-09', '2026-09-06', 11, 1, 1, '20123456786', 'ZZ', 100);
    RAISE EXCEPTION 'FALLA 7: el vendedor cargó';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;
  v_ok := v_ok || '7 ';

  -- 8
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_otro, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.comprobantes_de_compra WHERE org_id = v_org;
  RESET ROLE;
  IF n <> 0 THEN RAISE EXCEPTION 'FALLA 8: otro negocio ve % comprobantes', n; END IF;
  v_ok := v_ok || '8 ';

  -- 9
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE public.comprobantes_de_compra SET org_id = v_org2 WHERE id = v_id;
    RAISE EXCEPTION 'FALLA 9: cambió de negocio';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN NULL; END;
  RESET ROLE;
  v_ok := v_ok || '9';

  RAISE EXCEPTION 'OK %', v_ok;
END $$;
ROLLBACK;
