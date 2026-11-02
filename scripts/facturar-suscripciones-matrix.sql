-- Simulacro de 20261101000100 (concatenar sin BEGIN/COMMIT; termina en ROLLBACK).
-- Nerqia (organización emisora, CUIT 20-44648443-6, primero en monotributo) y dos
-- comercios: uno responsable inscripto con CUIT y otro sin datos fiscales.
--   1. Sin la facturación activa, el cobro queda «esperando emisor» y el pago
--      se registra igual.
--   2. No se activa con una organización que no tiene la identidad de Nerqia.
--   3. Activa: el reintento emite la factura C de servicios con el período del
--      plan, al comercio con su CUIT y condición, y emite factura.creada.
--   4. Un cobro nuevo se factura solo; uno repetido no duplica.
--   5. Un comercio sin datos fiscales recibe factura a consumidor final.
--   6. Un cobro rechazado no se factura.
--   7. Un comercio no ve ni configura nada de esto; anon no llama.
--   8. Con el emisor responsable inscripto: A al inscripto, B a consumidor
--      final, el 21 % dentro de lo cobrado.
DO $$
DECLARE
  v_admin uuid; v_otro uuid; v_nerqia uuid; v_falsa uuid; v_c1 uuid; v_c2 uuid; v_plan uuid;
  v_s1 uuid; v_s2 uuid; v_cobro1 uuid; v_cobro2 uuid; v_cobro3 uuid; v_cobro4 uuid; r jsonb; v_inv public.invoices;
  v_ok text := '';
BEGIN
  SELECT id INTO v_admin FROM auth.users ORDER BY created_at LIMIT 1;
  SELECT id INTO v_otro FROM auth.users WHERE id <> v_admin ORDER BY created_at LIMIT 1;
  INSERT INTO public.platform_admins (user_id, role) VALUES (v_admin, 'superadmin')
  ON CONFLICT (user_id) DO UPDATE SET role = 'superadmin';
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ Nerqia', 'zz-nerqia-' || substr(md5(random()::text), 1, 8), v_admin) RETURNING id INTO v_nerqia;
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ Falsa', 'zz-falsa-' || substr(md5(random()::text), 1, 8), v_admin) RETURNING id INTO v_falsa;
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ Comercio RI', 'zz-cri-' || substr(md5(random()::text), 1, 8), v_otro) RETURNING id INTO v_c1;
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ Comercio Simple', 'zz-csi-' || substr(md5(random()::text), 1, 8), v_otro) RETURNING id INTO v_c2;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_nerqia, v_admin, 'owner'), (v_falsa, v_admin, 'owner'), (v_c1, v_otro, 'owner'), (v_c2, v_otro, 'owner') ON CONFLICT DO NOTHING;
  INSERT INTO public.afip_credentials (org_id, cuit, punto_venta, environment, tipo_emisor, razon_social, domicilio)
  VALUES (v_nerqia, '20446484436', 3, 'homologacion', 'monotributo', 'ZZ Nerqia', 'ZZ 123'),
         (v_falsa, '20111111112', 1, 'homologacion', 'responsable_inscripto', 'ZZ Falsa', 'ZZ 1'),
         (v_c1, '30712345671', 1, 'homologacion', 'responsable_inscripto', 'ZZ Comercio RI SRL', 'ZZ 2');
  UPDATE public.settings SET business_name = 'ZZ Comercio RI SRL' WHERE org_id = v_c1;
  SELECT id INTO v_plan FROM public.plans ORDER BY sort_order NULLS LAST LIMIT 1;
  INSERT INTO public.subscriptions (org_id, plan_id, status) VALUES (v_c1, v_plan, 'active') RETURNING id INTO v_s1;
  INSERT INTO public.subscriptions (org_id, plan_id, status) VALUES (v_c2, v_plan, 'active') RETURNING id INTO v_s2;

  -- 1
  INSERT INTO public.saas_invoices (subscription_id, org_id, numero, monto, moneda, estado, periodo_desde, periodo_hasta, provider, mp_payment_id)
  VALUES (v_s1, v_c1, 'ZZ-1', 19900, 'ARS', 'paid', '2026-11-01 12:00-03', '2026-12-01 12:00-03', 'mercadopago', 'zz-pago-1') RETURNING id INTO v_cobro1;
  IF (SELECT estado FROM public.facturas_de_suscripcion WHERE saas_invoice_id = v_cobro1) <> 'pendiente_emisor' THEN
    RAISE EXCEPTION 'FALLA 1: %', (SELECT row_to_json(f) FROM public.facturas_de_suscripcion f WHERE saas_invoice_id = v_cobro1);
  END IF;
  v_ok := v_ok || '1 ';

  -- 2
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.platform_configurar_facturacion(v_falsa, true);
    RAISE EXCEPTION 'FALLA 2: activó con una organización sin la identidad de Nerqia';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  v_ok := v_ok || '2 ';

  -- 3
  r := public.platform_configurar_facturacion(v_nerqia, true);
  r := public.platform_reintentar_facturas_de_suscripcion();
  RESET ROLE;
  SELECT i.* INTO v_inv FROM public.invoices i JOIN public.facturas_de_suscripcion f ON f.invoice_id = i.id WHERE f.saas_invoice_id = v_cobro1;
  IF v_inv.id IS NULL OR v_inv.org_id <> v_nerqia OR v_inv.tipo_comprobante <> 11 OR v_inv.concepto <> 2
     OR v_inv.servicio_desde <> DATE '2026-11-01' OR v_inv.servicio_hasta <> DATE '2026-12-01' OR v_inv.total <> 19900
     -- IS DISTINCT FROM: con un CUIT nulo, «<>» da NULL y la condición no fallaba nunca.
     OR regexp_replace(v_inv.customer_tax_id, '\D', '', 'g') IS DISTINCT FROM '30712345671' OR v_inv.customer_name <> 'ZZ Comercio RI SRL'
     OR v_inv.condicion_iva_receptor IS DISTINCT FROM 1
     OR v_inv.afip_status <> 'pending'
     OR NOT EXISTS (SELECT 1 FROM public.domain_events e WHERE e.aggregate_id = v_inv.id AND e.event_type = 'factura.creada') THEN
    RAISE EXCEPTION 'FALLA 3: %', row_to_json(v_inv);
  END IF;
  v_ok := v_ok || '3 ';

  -- 4
  INSERT INTO public.saas_invoices (subscription_id, org_id, numero, monto, moneda, estado, periodo_desde, periodo_hasta, provider, mp_payment_id)
  VALUES (v_s1, v_c1, 'ZZ-2', 19900, 'ARS', 'paid', '2026-12-01 12:00-03', '2027-01-01 12:00-03', 'mercadopago', 'zz-pago-2') RETURNING id INTO v_cobro2;
  r := public.facturar_cobro_de_suscripcion(v_cobro2);
  IF (SELECT estado FROM public.facturas_de_suscripcion WHERE saas_invoice_id = v_cobro2) <> 'emitida'
     OR NOT (r->>'repetido')::boolean
     OR (SELECT count(*) FROM public.invoices WHERE org_id = v_nerqia) <> 2 THEN
    RAISE EXCEPTION 'FALLA 4: %', r;
  END IF;
  v_ok := v_ok || '4 ';

  -- 5
  INSERT INTO public.saas_invoices (subscription_id, org_id, numero, monto, moneda, estado, periodo_desde, periodo_hasta, provider, mp_payment_id)
  VALUES (v_s2, v_c2, 'ZZ-3', 34900, 'ARS', 'paid', '2026-11-05 12:00-03', '2026-12-05 12:00-03', 'mercadopago', 'zz-pago-3') RETURNING id INTO v_cobro3;
  SELECT i.* INTO v_inv FROM public.invoices i JOIN public.facturas_de_suscripcion f ON f.invoice_id = i.id WHERE f.saas_invoice_id = v_cobro3;
  IF v_inv.id IS NULL OR v_inv.condicion_iva_receptor <> 5 OR v_inv.customer_tax_id IS NOT NULL OR v_inv.tipo_comprobante <> 11 THEN
    RAISE EXCEPTION 'FALLA 5: %', row_to_json(v_inv);
  END IF;
  v_ok := v_ok || '5 ';

  -- 6
  INSERT INTO public.saas_invoices (subscription_id, org_id, numero, monto, moneda, estado, periodo_desde, periodo_hasta, provider, mp_payment_id)
  VALUES (v_s2, v_c2, 'ZZ-4', 34900, 'ARS', 'rejected', '2026-12-05 12:00-03', '2027-01-05 12:00-03', 'mercadopago', 'zz-pago-4') RETURNING id INTO v_cobro4;
  IF EXISTS (SELECT 1 FROM public.facturas_de_suscripcion WHERE saas_invoice_id = v_cobro4) THEN
    RAISE EXCEPTION 'FALLA 6: facturó un cobro rechazado';
  END IF;
  v_ok := v_ok || '6 ';

  -- 8. La condición del emisor puede ser cualquiera: responsable inscripto
  --    factura A al comercio inscripto y B a consumidor final, con el 21 %
  --    dentro del precio cobrado.
  UPDATE public.afip_credentials SET tipo_emisor = 'responsable_inscripto' WHERE org_id = v_nerqia;
  INSERT INTO public.saas_invoices (subscription_id, org_id, numero, monto, moneda, estado, periodo_desde, periodo_hasta, provider, mp_payment_id)
  VALUES (v_s1, v_c1, 'ZZ-5', 19900, 'ARS', 'paid', '2027-01-01 12:00-03', '2027-02-01 12:00-03', 'mercadopago', 'zz-pago-5') RETURNING id INTO v_cobro4;
  SELECT i.* INTO v_inv FROM public.invoices i JOIN public.facturas_de_suscripcion f ON f.invoice_id = i.id WHERE f.saas_invoice_id = v_cobro4;
  IF v_inv.id IS NULL OR v_inv.tipo_comprobante <> 1 OR v_inv.total <> 19900 OR v_inv.tax_amount <> 3453.72 OR v_inv.subtotal <> 16446.28 THEN
    RAISE EXCEPTION 'FALLA 8 (A): tipo % total % neto % iva % pct %', v_inv.tipo_comprobante, v_inv.total, v_inv.subtotal, v_inv.tax_amount, v_inv.tax_pct;
  END IF;
  INSERT INTO public.saas_invoices (subscription_id, org_id, numero, monto, moneda, estado, periodo_desde, periodo_hasta, provider, mp_payment_id)
  VALUES (v_s2, v_c2, 'ZZ-6', 34900, 'ARS', 'paid', '2027-01-05 12:00-03', '2027-02-05 12:00-03', 'mercadopago', 'zz-pago-6') RETURNING id INTO v_cobro4;
  SELECT i.* INTO v_inv FROM public.invoices i JOIN public.facturas_de_suscripcion f ON f.invoice_id = i.id WHERE f.saas_invoice_id = v_cobro4;
  -- 34.900 / 1,21 no da justo en centavos: el IVA absorbe el centavo (6.057,02).
  IF v_inv.id IS NULL OR v_inv.tipo_comprobante <> 6 OR v_inv.total <> 34900 OR v_inv.subtotal <> 28842.98 OR v_inv.tax_amount <> 6057.02 THEN
    RAISE EXCEPTION 'FALLA 8 (B): tipo % total % neto % iva %', v_inv.tipo_comprobante, v_inv.total, v_inv.subtotal, v_inv.tax_amount;
  END IF;
  v_ok := v_ok || '8 ';

  -- 7
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_otro, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.platform_facturacion_de_nerqia();
    RAISE EXCEPTION 'FALLA 7: un comercio vio la facturación de Nerqia';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.platform_configurar_facturacion(v_c1, false);
    RAISE EXCEPTION 'FALLA 7: un comercio configuró la facturación de Nerqia';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM 1 FROM public.facturas_de_suscripcion;
    RAISE EXCEPTION 'FALLA 7: un comercio leyó la tabla';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;
  IF has_function_privilege('anon', 'public.platform_facturacion_de_nerqia()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.facturar_cobro_de_suscripcion(uuid)', 'EXECUTE')
     OR EXISTS (SELECT 1 FROM public.audit_funciones_expuestas WHERE funcion LIKE '%suscripcion%' OR funcion LIKE 'platform_%facturacion%') THEN
    RAISE EXCEPTION 'FALLA 7: permisos';
  END IF;
  v_ok := v_ok || '7 ';

  RAISE EXCEPTION 'OK %', v_ok;
END $$;
ROLLBACK;
