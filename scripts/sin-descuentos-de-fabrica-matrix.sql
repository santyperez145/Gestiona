-- Simulacro de 20261104000100 (concatenar sin BEGIN/COMMIT; termina en ROLLBACK).
--   1. Un negocio nuevo nace sin descuento por medio de pago en la caja.
--   2. La caja cobra el precio cargado en efectivo y en transferencia.
--   3. Un descuento que el dueño eligió se sigue aplicando.
DO $$
DECLARE
  v_owner uuid; v_org uuid;
  v_sfx text := substr(md5(random()::text), 1, 8);
  v_fila public.settings;
  v_ok text := '';
BEGIN
  SELECT id INTO v_owner FROM auth.users ORDER BY created_at LIMIT 1;
  INSERT INTO public.organizations (name, slug, owner_user_id)
  VALUES ('ZZ Sin descuentos', 'zz-sin-descuentos-' || v_sfx, v_owner) RETURNING id INTO v_org;
  INSERT INTO public.settings (org_id, user_id, business_name)
  VALUES (v_org, v_owner, 'ZZ Sin descuentos')
  ON CONFLICT (org_id) DO NOTHING;

  -- 1
  SELECT * INTO v_fila FROM public.settings WHERE org_id = v_org;
  IF v_fila.org_id IS NULL THEN
    RAISE EXCEPTION 'FALLA 1: el negocio nuevo no tiene settings';
  END IF;
  IF v_fila.discount_cash_percent IS DISTINCT FROM 0 OR v_fila.discount_transfer_percent IS DISTINCT FROM 0
     OR v_fila.discount_debit_percent IS DISTINCT FROM 0 OR v_fila.discount_credit_percent IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'FALLA 1: nace con descuentos (efectivo %, transferencia %, débito %, crédito %)',
      v_fila.discount_cash_percent, v_fila.discount_transfer_percent, v_fila.discount_debit_percent, v_fila.discount_credit_percent;
  END IF;
  v_ok := v_ok || '1 ';

  -- 2
  IF public.pos_payment_discount_pct(v_org, 'efectivo') IS DISTINCT FROM 0
     OR public.pos_payment_discount_pct(v_org, 'transferencia') IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'FALLA 2: la caja descuenta sin que el dueño lo haya elegido';
  END IF;
  v_ok := v_ok || '2 ';

  -- 3
  UPDATE public.settings SET discount_cash_percent = 10 WHERE org_id = v_org;
  IF public.pos_payment_discount_pct(v_org, 'efectivo') IS DISTINCT FROM 10 THEN
    RAISE EXCEPTION 'FALLA 3: un descuento elegido no se aplica (%)', public.pos_payment_discount_pct(v_org, 'efectivo');
  END IF;
  v_ok := v_ok || '3';

  RAISE EXCEPTION 'OK %', v_ok;
END $$;
ROLLBACK;
