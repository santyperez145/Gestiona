-- Comprobantes de controlador fiscal: exclusión con factura electrónica. Datos ZZ; ROLLBACK.
BEGIN;
DO $$
DECLARE
  v_org uuid := gen_random_uuid(); v_owner uuid; v_viewer uuid; v_product uuid := gen_random_uuid();
  v_tx uuid := gen_random_uuid(); v_tx2 uuid := gen_random_uuid(); v_result jsonb; v_denied boolean;
BEGIN
  SELECT user_id INTO v_owner FROM public.memberships WHERE role = 'owner' ORDER BY joined_at LIMIT 1;
  SELECT id INTO v_viewer FROM auth.users WHERE id <> v_owner ORDER BY created_at LIMIT 1;
  INSERT INTO public.organizations(id, name, slug, owner_user_id) VALUES (v_org, 'ZZ Controlador', 'zz-controlador-' || v_org, v_owner);
  INSERT INTO public.memberships(org_id, user_id, role) VALUES (v_org, v_owner, 'owner'), (v_org, v_viewer, 'viewer');
  INSERT INTO public.settings(org_id, user_id, afip_tipo_emisor, tax_iva_percent, tax_prices_include_iva, exchange_rate)
  VALUES (v_org, v_owner, 'responsable_inscripto', 21, false, 1)
  ON CONFLICT (org_id) DO UPDATE SET afip_tipo_emisor = 'responsable_inscripto';
  INSERT INTO public.products(id, org_id, user_id, name, sale_price_ars, tax_rate, maneja_stock) VALUES (v_product, v_org, v_owner, 'ZZ P', 121, 21, false);
  INSERT INTO public.sale_transactions(id, org_id, created_by, source) VALUES (v_tx, v_org, v_owner, 'pos'), (v_tx2, v_org, v_owner, 'pos');
  PERFORM set_config('gestiona.sale_transaction_id', v_tx::text, true);
  INSERT INTO public.sales(org_id, user_id, product_id, product_name, quantity, unit_price_ars, total_ars, payment_method, paid, source, sale_transaction_id)
  VALUES (v_org, v_owner, v_product, 'ZZ P', 1, 121, 121, 'efectivo', true, 'pos', v_tx);
  PERFORM set_config('gestiona.sale_transaction_id', v_tx2::text, true);
  INSERT INTO public.sales(org_id, user_id, product_id, product_name, quantity, unit_price_ars, total_ars, payment_method, paid, source, sale_transaction_id)
  VALUES (v_org, v_owner, v_product, 'ZZ P', 1, 121, 121, 'efectivo', true, 'pos', v_tx2);
  PERFORM set_config('gestiona.sale_transaction_id', '', true);

  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_viewer, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_denied := false;
  BEGIN PERFORM public.reservar_comprobante_controlador(v_org, v_tx, 'epson_tm_t900fa'); EXCEPTION WHEN insufficient_privilege THEN v_denied := true; END;
  ASSERT v_denied, 'Un viewer reservó un comprobante';
  v_denied := false;
  BEGIN INSERT INTO public.fiscal_controller_documents(org_id, sale_transaction_id, modelo, created_by) VALUES (v_org, v_tx, 'epson_tm_t900fa', v_viewer);
  EXCEPTION WHEN insufficient_privilege THEN v_denied := true; END;
  ASSERT v_denied, 'Escritura directa permitida';

  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  v_result := public.reservar_comprobante_controlador(v_org, v_tx, 'epson_tm_t900fa');
  ASSERT (v_result->>'ok')::boolean AND v_result->>'estado' = 'reservado', 'Reserva: ' || v_result;
  ASSERT (public.reservar_comprobante_controlador(v_org, v_tx, 'epson_tm_t900fa')->>'ok')::boolean, 'Reintento de reserva';
  v_result := public.facturar_venta_pos(v_org, v_tx);
  ASSERT NOT (v_result->>'ok')::boolean AND v_result->>'motivo' LIKE '%controlador fiscal%', 'ARCA sobre ticket reservado: ' || v_result;

  v_result := public.confirmar_comprobante_controlador(v_org, v_tx, 'b', '00000123', 121);
  ASSERT (v_result->>'ok')::boolean, 'Confirmación';
  ASSERT (public.confirmar_comprobante_controlador(v_org, v_tx, 'B', '00000123', 121)->>'ok')::boolean, 'Confirmación idempotente';
  v_result := public.reservar_comprobante_controlador(v_org, v_tx, 'epson_tm_t900fa');
  ASSERT NOT (v_result->>'ok')::boolean AND v_result->>'numero' = '00000123', 'Re-reserva de emitido: ' || v_result;
  PERFORM public.liberar_comprobante_controlador(v_org, v_tx);
  ASSERT (SELECT estado FROM public.fiscal_controller_documents WHERE sale_transaction_id = v_tx) = 'emitido', 'Se liberó un emitido';

  -- Ticket con factura electrónica: no se puede reservar en el controlador.
  v_result := public.facturar_venta_pos(v_org, v_tx2);
  ASSERT (v_result->>'ok')::boolean, 'Factura ARCA del segundo ticket: ' || v_result;
  v_result := public.reservar_comprobante_controlador(v_org, v_tx2, 'epson_tm_t900fa');
  ASSERT NOT (v_result->>'ok')::boolean AND v_result->>'motivo' LIKE '%factura electrónica%', 'Reserva sobre facturado: ' || v_result;

  -- Reserva liberada vuelve a permitir ARCA.
  DELETE FROM public.invoices WHERE sale_transaction_id = v_tx2;
  RESET ROLE;
  ASSERT (SELECT count(*) FROM public.fiscal_controller_documents WHERE org_id = v_org) = 1, 'Filas inesperadas';
  RAISE NOTICE 'OK: permisos, reserva idempotente, exclusión con ARCA en ambos sentidos, confirmación y liberación';
END;
$$;
ROLLBACK;
SELECT count(*) AS remaining_synthetic_organizations FROM public.organizations WHERE slug LIKE 'zz-controlador-%';
