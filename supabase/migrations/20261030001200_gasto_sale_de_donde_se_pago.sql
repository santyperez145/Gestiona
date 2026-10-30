-- Un gasto sale de donde se pagó (2026-10-30).
--
-- Mismo error que el de las ventas (20261030000900), del lado de los pagos:
-- `ledger_asentar_gasto` asentaba todo gasto que no viniera de un anticipo como
-- «Salida de caja» (1.1.01), sin mirar el medio con que se pagó. Un alquiler
-- pagado por transferencia descontaba de la caja un efectivo que nunca salió:
-- la caja del balance quedaba negativa y el banco inflado, y el arqueo no
-- coincidía con el libro.
--
-- `cuenta_de_pago` es el espejo de `cuenta_de_cobro` para lo que sale:
--     efectivo                                   → 1.1.01 Caja
--     transferencia, depósito, débito, tarjeta,
--     crédito y cheque propio                    → 1.1.02 Banco (se pagan
--                                                   desde la cuenta bancaria)
--     Mercado Pago, QR                           → 1.1.04 MercadoPago disponible
--     sin dato o desconocido                     → 1.1.01 Caja, como antes
-- El gasto aplicado a un anticipo sigue yendo a 1.2.02. Lo ya asentado no se
-- toca.

BEGIN;

CREATE OR REPLACE FUNCTION public.cuenta_de_pago(p_metodo text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $fn$
  SELECT CASE lower(btrim(COALESCE(p_metodo, '')))
    WHEN 'transferencia' THEN '1.1.02'
    WHEN 'transfer'      THEN '1.1.02'
    WHEN 'deposito'      THEN '1.1.02'
    WHEN 'debito'        THEN '1.1.02'
    WHEN 'debit'         THEN '1.1.02'
    WHEN 'tarjeta'       THEN '1.1.02'
    WHEN 'credito'       THEN '1.1.02'
    WHEN 'credit'        THEN '1.1.02'
    WHEN 'cheque'        THEN '1.1.02'
    WHEN 'mercado_pago'  THEN '1.1.04'
    WHEN 'mercadopago'   THEN '1.1.04'
    WHEN 'qr'            THEN '1.1.04'
    ELSE '1.1.01'
  END;
$fn$;
COMMENT ON FUNCTION public.cuenta_de_pago(text) IS
  'Cuenta de la que sale un pago segun el medio: efectivo de Caja, bancarios y tarjetas de Banco, Mercado Pago de su saldo disponible. Lo desconocido, de Caja (20261030001200).';

CREATE OR REPLACE FUNCTION public.ledger_asentar_gasto(p_expense_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_e public.expenses; v_existing uuid; v_credit_account text;
BEGIN
  SELECT * INTO v_e FROM public.expenses WHERE id = p_expense_id FOR UPDATE;
  IF v_e.id IS NULL THEN RAISE EXCEPTION 'El gasto no existe'; END IF;
  SELECT entry.id INTO v_existing FROM public.ledger_entries entry
   WHERE entry.org_id = v_e.org_id AND entry.referencia_tipo = 'gasto'
     AND entry.referencia_id = v_e.id AND entry.anulado_por IS NULL AND entry.anula_a IS NULL LIMIT 1;
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;
  IF COALESCE(v_e.amount_ars, 0) <= 0 THEN RAISE EXCEPTION 'El gasto % no tiene importe', v_e.id; END IF;
  -- Un anticipo ya salió del banco al desembolsarse; si no, sale de donde se pagó.
  v_credit_account := CASE WHEN v_e.advance_request_id IS NOT NULL THEN '1.2.02' ELSE public.cuenta_de_pago(v_e.payment_method) END;
  RETURN public.ledger_asentar(v_e.org_id, 'Gasto' || COALESCE(' - ' || v_e.description, ''),
    jsonb_build_array(
      jsonb_build_object('cuenta','5.9.01','debe',round(v_e.amount_ars,2),'detalle',COALESCE(v_e.category,'sin categoria'),
        'metadata',jsonb_strip_nulls(jsonb_build_object('expense_id',v_e.id,'category',v_e.category,'centro_costo',v_e.cost_center,'expense_request_id',v_e.expense_request_id,'advance_request_id',v_e.advance_request_id,'payment_method',v_e.payment_method))),
      jsonb_build_object('cuenta',v_credit_account,'haber',round(v_e.amount_ars,2),
        'detalle',CASE WHEN v_e.advance_request_id IS NOT NULL THEN 'Aplicacion del anticipo'
                       WHEN v_credit_account = '1.1.01' THEN 'Salida de caja'
                       WHEN v_credit_account = '1.1.04' THEN 'Pago con Mercado Pago'
                       ELSE 'Pago desde el banco' END,
        'metadata',jsonb_strip_nulls(jsonb_build_object('expense_id',v_e.id,'centro_costo',v_e.cost_center,'expense_request_id',v_e.expense_request_id,'advance_request_id',v_e.advance_request_id,'payment_method',v_e.payment_method)))
    ), COALESCE(v_e.date::date,v_e.created_at::date),'gasto',v_e.id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.ledger_asentar_gasto(uuid) FROM PUBLIC, anon, authenticated;

COMMIT;
