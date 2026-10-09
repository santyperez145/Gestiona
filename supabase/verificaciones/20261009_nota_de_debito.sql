-- Nota de Débito. Datos ZZ; CAE simulado sólo dentro del ROLLBACK.
BEGIN;
DO $$
DECLARE v_org uuid := gen_random_uuid(); v_owner uuid; v_inv uuid; v_nd uuid; v_denied boolean; v_row public.invoices%ROWTYPE;
BEGIN
  SELECT user_id INTO v_owner FROM public.memberships WHERE role = 'owner' ORDER BY joined_at LIMIT 1;
  INSERT INTO public.organizations(id, name, slug, owner_user_id) VALUES (v_org, 'ZZ ND', 'zz-nd-' || v_org, v_owner);
  INSERT INTO public.memberships(org_id, user_id, role) VALUES (v_org, v_owner, 'owner');
  INSERT INTO public.afip_credentials(org_id, cuit, punto_venta, environment, tipo_emisor, razon_social, domicilio)
  VALUES (v_org, '20123456786', 1, 'homologacion', 'responsable_inscripto', 'ZZ', 'ZZ 1');
  INSERT INTO public.invoices(org_id, number, customer_name, issue_date, due_date, status, currency, subtotal, tax_pct, tax_amount, total, tipo_comprobante, condicion_iva_receptor, afip_status, created_by)
  VALUES (v_org, 'ZZ-1', 'ZZ Cliente', CURRENT_DATE, CURRENT_DATE, 'draft', 'ARS', 100, 21, 21, 121, 6, 5, 'pending', v_owner) RETURNING id INTO v_inv;
  INSERT INTO public.invoice_items(invoice_id, description, quantity, unit_price, total, tax_rate, tax_amount) VALUES (v_inv, 'ZZ', 1, 100, 100, 21, 21);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_denied := false;
  BEGIN PERFORM public.emitir_nota_debito(v_inv, 'ZZ interés', 12.1); EXCEPTION WHEN raise_exception THEN v_denied := true; END;
  ASSERT v_denied, 'ND sobre factura sin CAE';
  RESET ROLE;
  UPDATE public.invoices SET afip_status = 'processing' WHERE id = v_inv;
  UPDATE public.invoices SET afip_status = 'authorized', cae = '99999999999999', numero_afip = 999999, cae_vencimiento = CURRENT_DATE + 10 WHERE id = v_inv;
  SET LOCAL ROLE authenticated;
  v_nd := public.emitir_nota_debito(v_inv, 'ZZ interés por mora', 12.1);
  RESET ROLE;
  SELECT * INTO v_row FROM public.invoices WHERE id = v_nd;
  ASSERT v_row.tipo_comprobante = 7 AND v_row.nota_debito_de = v_inv AND v_row.total = 12.1 AND v_row.subtotal = 10 AND v_row.tax_amount = 2.1 AND v_row.afip_status = 'pending',
    'ND mal formada';
  RAISE NOTICE 'OK: requiere CAE, tipo B→7, desglose 21%%, asociada';
END;
$$;
ROLLBACK;
SELECT count(*) AS remaining_synthetic_organizations FROM public.organizations WHERE slug LIKE 'zz-nd-%';
