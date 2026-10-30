-- Simulacro de 20261030001200 (concatenar sin BEGIN/COMMIT; termina en ROLLBACK).
-- Cada gasto nuevo se asienta solo (trg_asentar_gasto); el pago sale de donde
-- se pagó: efectivo de Caja, transferencia y tarjeta de Banco, Mercado Pago de
-- su saldo. Lo desconocido sigue saliendo de Caja. Todos cuadran.
DO $$
DECLARE
  v_owner uuid; v_org uuid; v_g uuid; v_ok text := '';
  v_sufijo text := substr(md5(random()::text), 1, 8);
  v_caso record;
BEGIN
  SELECT id INTO v_owner FROM auth.users ORDER BY created_at LIMIT 1;
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ Gastos', 'zz-gastos-' || v_sufijo, v_owner) RETURNING id INTO v_org;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_owner, 'owner') ON CONFLICT DO NOTHING;
  PERFORM public.ledger_plan_default(v_org);

  FOR v_caso IN SELECT * FROM (VALUES
    ('efectivo', '1.1.01'), ('transferencia', '1.1.02'), ('tarjeta', '1.1.02'), ('Debito ', '1.1.02'),
    ('mercadopago', '1.1.04'), ('cheque', '1.1.02'), ('algo raro', '1.1.01')) AS t(medio, cuenta)
  LOOP
    INSERT INTO public.expenses (org_id, user_id, amount_ars, category, description, date, payment_method)
    VALUES (v_org, v_owner, 1000, 'alquiler', 'ZZ ' || v_caso.medio, now(), v_caso.medio) RETURNING id INTO v_g;
    IF NOT EXISTS (
      SELECT 1 FROM public.ledger_entries e
        JOIN public.ledger_lines l ON l.entry_id = e.id
        JOIN public.ledger_accounts a ON a.id = l.account_id
       WHERE e.referencia_tipo = 'gasto' AND e.referencia_id = v_g AND a.codigo = v_caso.cuenta AND l.haber = 1000) THEN
      RAISE EXCEPTION 'FALLA: el gasto pagado con «%» no salió de %: %', v_caso.medio, v_caso.cuenta,
        (SELECT jsonb_agg(jsonb_build_object('cuenta', a.codigo, 'debe', l.debe, 'haber', l.haber))
           FROM public.ledger_entries e JOIN public.ledger_lines l ON l.entry_id = e.id
           JOIN public.ledger_accounts a ON a.id = l.account_id WHERE e.referencia_tipo = 'gasto' AND e.referencia_id = v_g);
    END IF;
    IF (SELECT sum(l.debe) - sum(l.haber) FROM public.ledger_entries e JOIN public.ledger_lines l ON l.entry_id = e.id
         WHERE e.referencia_tipo = 'gasto' AND e.referencia_id = v_g) <> 0 THEN
      RAISE EXCEPTION 'FALLA: el asiento del gasto «%» no cuadra', v_caso.medio;
    END IF;
    v_ok := v_ok || v_caso.medio || ' ';
  END LOOP;

  RAISE EXCEPTION 'OK %', v_ok;
END $$;
ROLLBACK;
