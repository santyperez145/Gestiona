-- Cuenta corriente: el cajero cobra el fiado en el mostrador.
--
-- Medido 2026-10-14: `cobrar_cuenta_corriente` (20261014000500) sólo dejaba
-- cobrar al dueño o a un administrador. Un vendedor puede vender fiado desde
-- la caja, pero cuando el cliente volvía a pagar no podía registrarlo: en una
-- ferretería el que recibe la plata es el cajero.
--
-- Ahora un vendedor también cobra, con una condición: tiene que haber una caja
-- abierta, porque lo que recibe entra en ese turno y el arqueo lo controla
-- (igual que una venta). El dueño y el administrador cobran con o sin caja.
-- El cobro va a la caja que abrió quien cobra y, si no abrió ninguna, a la
-- última abierta del negocio. Un reintento con la misma clave sigue
-- devolviendo el recibo original aunque la caja ya se haya cerrado.
-- Un lector (viewer) sigue sin poder cobrar.
-- Idempotente.
BEGIN;

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
  v_es_admin boolean;
  d record;
BEGIN
  v_es_admin := v_user IS NOT NULL AND public.has_org_role(p_org, v_user, ARRAY['owner', 'admin']);
  IF v_user IS NULL OR NOT (v_es_admin OR public.has_org_role(p_org, v_user, ARRAY['vendedor'])) THEN
    RAISE EXCEPTION 'Tu rol no permite cobrar deudas' USING ERRCODE = '42501';
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

  -- La caja del cobro: la que abrió quien cobra; si no, la última abierta.
  SELECT id INTO v_sesion FROM public.cash_sessions
   WHERE org_id = p_org AND status = 'open'
   ORDER BY (opened_by = v_user) DESC NULLS LAST, opened_at DESC LIMIT 1;
  -- Un vendedor cobra sólo con la caja abierta: lo que recibe tiene que
  -- aparecer en el arqueo del turno.
  IF NOT v_es_admin AND v_sesion IS NULL THEN
    RAISE EXCEPTION 'Abrí la caja para cobrar: el cobro tiene que entrar en el turno' USING ERRCODE = '55000';
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

  -- El cobro entra en la caja (como una venta cobrada).
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

UPDATE public.security_function_contracts c
   SET definition_hash = md5(pg_get_functiondef(p.oid)),
       reviewed_on = DATE '2026-10-14',
       rationale = 'Dueño o administrador del negocio; un vendedor sólo con una caja abierta (el cobro entra en el turno). Sólo toca deudas de ese negocio.'
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'cobrar_cuenta_corriente'
   AND c.function_name = 'cobrar_cuenta_corriente'
   AND c.identity_arguments = pg_get_function_identity_arguments(p.oid);

COMMIT;
