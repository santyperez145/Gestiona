-- Cuenta corriente (fiado): cobrar sin pisarse ni cobrar dos veces.
--
-- Matriz POS, fila «Cuenta corriente»: «anticipo/abono e imputación sin
-- cobrar dos veces». Medido 2026-10-14 en el código:
--   · El cobro de una deuda era leer → calcular en el navegador → escribir
--     (`addDebtPaymentDB`). Dos cajeros cobrando a la vez se pisaban y nada
--     impedía cobrar de más; un reintento de red duplicaba el cobro.
--   · No existía el pago a cuenta: el cliente paga un monto y se aplica a sus
--     deudas más viejas.
--   · El cobro no entraba en la caja del turno (`record_debt_payment_cash_entry`
--     existía y nadie la llamaba): el cierre daba una diferencia que no era.
--
-- `cobrar_cuenta_corriente` hace todo en una transacción: bloquea las deudas
-- del cliente, aplica el pago de la más vieja a la más nueva (o a una deuda
-- puntual), registra cada imputación en `debt_payments`, marca la venta como
-- cobrada al saldarla, suma el cobro a la caja abierta y guarda un recibo.
-- La clave del recibo es única por negocio: el mismo pedido repetido devuelve
-- el recibo original sin volver a cobrar. Un pago mayor a lo que se debe se
-- rechaza con el monto exacto pendiente (el saldo a favor queda para cuando
-- exista crédito de cliente).
-- Permiso: el mismo que hoy pide escribir deudas (dueño o administrador).
-- Idempotente.
BEGIN;

CREATE TABLE IF NOT EXISTS public.cobros_cuenta_corriente (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  clave text NOT NULL CHECK (char_length(clave) BETWEEN 8 AND 120),
  customer_id uuid,
  customer_name text,
  monto_ars numeric(14,2) NOT NULL CHECK (monto_ars > 0),
  medio text NOT NULL,
  nota text,
  resultado jsonb NOT NULL,
  creado_por uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, clave)
);
ALTER TABLE public.cobros_cuenta_corriente ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cobros_cuenta_corriente_leer ON public.cobros_cuenta_corriente;
CREATE POLICY cobros_cuenta_corriente_leer ON public.cobros_cuenta_corriente
  FOR SELECT TO authenticated USING (public.is_org_member(org_id, auth.uid()));
REVOKE ALL ON public.cobros_cuenta_corriente FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.cobros_cuenta_corriente FROM authenticated;
GRANT SELECT ON public.cobros_cuenta_corriente TO authenticated;
GRANT ALL ON public.cobros_cuenta_corriente TO service_role;
CREATE INDEX IF NOT EXISTS cobros_cuenta_corriente_cliente_idx
  ON public.cobros_cuenta_corriente (org_id, customer_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.cobrar_cuenta_corriente(
  p_org uuid,
  p_monto numeric,
  p_medio text,
  p_clave text,
  p_customer_id uuid DEFAULT NULL,
  p_customer_name text DEFAULT NULL,
  p_debt_id uuid DEFAULT NULL,
  p_nota text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_previo jsonb;
  v_monto numeric(14,2) := round(coalesce(p_monto, 0), 2);
  v_pendiente numeric(14,2);
  v_restante numeric(14,2);
  v_aplicar numeric(14,2);
  v_nuevo_pagado numeric(14,2);
  v_nuevo_saldo numeric(14,2);
  v_imputaciones jsonb := '[]'::jsonb;
  v_cobro uuid := gen_random_uuid();
  v_sesion uuid;
  v_medio text := lower(btrim(coalesce(p_medio, '')));
  d record;
BEGIN
  IF v_user IS NULL OR NOT public.has_org_role(p_org, v_user, ARRAY['owner', 'admin']) THEN
    RAISE EXCEPTION 'Sólo el dueño o un administrador pueden cobrar deudas' USING ERRCODE = '42501';
  END IF;
  IF p_clave IS NULL OR char_length(p_clave) < 8 THEN
    RAISE EXCEPTION 'Falta la clave del cobro' USING ERRCODE = '22023';
  END IF;
  IF v_medio = '' THEN
    RAISE EXCEPTION 'Elegí el medio de pago' USING ERRCODE = '22023';
  END IF;
  IF v_monto <= 0 THEN
    RAISE EXCEPTION 'Ingresá un monto mayor a cero' USING ERRCODE = '22023';
  END IF;
  IF p_debt_id IS NULL AND p_customer_id IS NULL AND nullif(btrim(coalesce(p_customer_name, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Elegí la deuda o el cliente' USING ERRCODE = '22023';
  END IF;

  -- Mismo pedido repetido (corte de red, doble clic): el recibo original.
  SELECT resultado INTO v_previo FROM public.cobros_cuenta_corriente WHERE org_id = p_org AND clave = p_clave;
  IF v_previo IS NOT NULL THEN
    RETURN v_previo || jsonb_build_object('repetido', true);
  END IF;
  -- Dos pedidos simultáneos con la misma clave: el segundo espera al primero.
  PERFORM pg_advisory_xact_lock(hashtextextended('cobro-cc:' || p_org::text || ':' || p_clave, 0));
  SELECT resultado INTO v_previo FROM public.cobros_cuenta_corriente WHERE org_id = p_org AND clave = p_clave;
  IF v_previo IS NOT NULL THEN
    RETURN v_previo || jsonb_build_object('repetido', true);
  END IF;

  -- Deudas abiertas, bloqueadas, de la más vieja a la más nueva.
  SELECT coalesce(sum(remaining_ars), 0) INTO v_pendiente
    FROM public.debts
   WHERE org_id = p_org AND status IN ('pending', 'partial') AND remaining_ars > 0
     AND (CASE WHEN p_debt_id IS NOT NULL THEN id = p_debt_id
               WHEN p_customer_id IS NOT NULL THEN customer_id = p_customer_id
               ELSE customer_name = btrim(p_customer_name) END);
  IF v_pendiente <= 0 THEN
    RAISE EXCEPTION 'No hay deudas pendientes para cobrar' USING ERRCODE = 'P0002';
  END IF;
  IF v_monto > v_pendiente + 0.005 THEN
    RAISE EXCEPTION 'El pago (%) supera lo que se debe (%)', to_char(v_monto, 'FM999G999G990D00'), to_char(v_pendiente, 'FM999G999G990D00')
      USING ERRCODE = '22023';
  END IF;

  v_restante := v_monto;
  FOR d IN
    SELECT * FROM public.debts
     WHERE org_id = p_org AND status IN ('pending', 'partial') AND remaining_ars > 0
       AND (CASE WHEN p_debt_id IS NOT NULL THEN id = p_debt_id
                 WHEN p_customer_id IS NOT NULL THEN customer_id = p_customer_id
                 ELSE customer_name = btrim(p_customer_name) END)
     ORDER BY coalesce(due_date, date, created_at), created_at, id
     FOR UPDATE
  LOOP
    EXIT WHEN v_restante <= 0;
    v_aplicar := least(d.remaining_ars, v_restante);
    v_nuevo_pagado := round(coalesce(d.paid_ars, 0) + v_aplicar, 2);
    v_nuevo_saldo := greatest(0, round(d.amount_ars - v_nuevo_pagado, 2));

    UPDATE public.debts
       SET paid_ars = v_nuevo_pagado,
           remaining_ars = v_nuevo_saldo,
           status = CASE WHEN v_nuevo_saldo <= 0.01 THEN 'paid' ELSE 'partial' END
     WHERE id = d.id;

    INSERT INTO public.debt_payments (org_id, debt_id, amount_ars, payment_method, user_id, notes)
    VALUES (p_org, d.id, v_aplicar, v_medio, v_user,
            coalesce(nullif(btrim(coalesce(p_nota, '')), ''), 'Cobro de cuenta corriente') || ' · recibo ' || left(v_cobro::text, 8));

    IF v_nuevo_saldo <= 0.01 AND d.sale_id IS NOT NULL THEN
      UPDATE public.sales SET paid = true WHERE id = d.sale_id AND org_id = p_org AND paid = false;
    END IF;

    v_imputaciones := v_imputaciones || jsonb_build_object(
      'debt_id', d.id, 'aplicado', v_aplicar, 'saldo', v_nuevo_saldo, 'descripcion', d.description);
    v_restante := round(v_restante - v_aplicar, 2);
  END LOOP;

  -- El cobro entra en la caja abierta del negocio (como una venta cobrada).
  SELECT id INTO v_sesion FROM public.cash_sessions
   WHERE org_id = p_org AND status = 'open' ORDER BY opened_at DESC LIMIT 1;
  IF v_sesion IS NOT NULL THEN
    INSERT INTO public.cash_entries (org_id, session_id, entry_type, payment_method, amount_ars,
                                     reference_type, reference_id, description, created_by)
    VALUES (p_org, v_sesion, 'debt_payment', v_medio, v_monto, 'cobro_cuenta_corriente', v_cobro,
            'Cobro de cuenta corriente' || coalesce(' · ' || nullif(btrim(coalesce(p_customer_name, '')), ''), ''), v_user);
  END IF;

  v_previo := jsonb_build_object(
    'cobro_id', v_cobro,
    'aplicado', v_monto,
    'imputaciones', v_imputaciones,
    'saldo_pendiente', round(v_pendiente - v_monto, 2),
    'en_caja', v_sesion IS NOT NULL,
    'repetido', false);

  INSERT INTO public.cobros_cuenta_corriente (id, org_id, clave, customer_id, customer_name, monto_ars, medio, nota, resultado, creado_por)
  VALUES (v_cobro, p_org, p_clave, p_customer_id, nullif(btrim(coalesce(p_customer_name, '')), ''), v_monto, v_medio,
          nullif(btrim(coalesce(p_nota, '')), ''), v_previo, v_user);

  RETURN v_previo;
END;
$$;

REVOKE ALL ON FUNCTION public.cobrar_cuenta_corriente(uuid, numeric, text, text, uuid, text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cobrar_cuenta_corriente(uuid, numeric, text, text, uuid, text, uuid, text) TO authenticated, service_role;

INSERT INTO public.security_function_contracts(function_name, identity_arguments, audience, rationale, definition_hash, reviewed_on)
SELECT 'cobrar_cuenta_corriente', pg_get_function_identity_arguments(p.oid), 'authenticated_delegate',
       'Exige dueño o administrador del negocio (has_org_role) y sólo toca deudas de ese negocio.',
       md5(pg_get_functiondef(p.oid)), DATE '2026-10-14'
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'cobrar_cuenta_corriente'
ON CONFLICT (function_name, identity_arguments) DO UPDATE
  SET definition_hash = EXCLUDED.definition_hash, reviewed_on = EXCLUDED.reviewed_on, rationale = EXCLUDED.rationale;

COMMIT;
