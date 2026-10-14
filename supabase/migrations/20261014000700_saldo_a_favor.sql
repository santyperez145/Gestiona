-- Cuenta corriente: saldo a favor del cliente.
--
-- Matriz POS, fila «Cuenta corriente», pendiente medido 2026-10-14: si el
-- cliente pagaba más de lo que debía, o dejaba plata a cuenta sin deber nada,
-- `cobrar_cuenta_corriente` lo rechazaba. No había dónde guardar un anticipo
-- ni cómo usarlo después, cosa que cualquier sistema de mostrador resuelve.
--
-- · `saldo_a_favor_movimientos`: libro por cliente (+ a favor, − usado). Sólo
--   lo escribe la función de cobro; los miembros lo leen. Guarda el nombre del
--   cliente en cada movimiento para que la historia no dependa de la ficha.
-- · `cobrar_cuenta_corriente` gana `p_excedente_a_favor`. Con `true` y un
--   cliente elegido, lo que supere la deuda queda a favor; sin deudas, todo es
--   anticipo. La plata entra entera en la caja, porque se recibió entera. Sin
--   el parámetro, pagar de más se sigue rechazando como antes.
-- · Medio `saldo_a_favor`: paga deudas con el saldo del cliente. No toca la
--   caja (no entra plata) y no puede usar más de lo que hay.
-- · Toda operación con saldo bloquea la ficha del cliente: dos cobros
--   simultáneos no gastan el mismo saldo.
-- · No se puede borrar un cliente con saldo distinto de cero (se le debe plata
--   o la debe); borrar el negocio entero sigue funcionando.
-- · El cliente tiene que ser del negocio (antes no se verificaba; no tenía
--   efecto porque las deudas sí se filtraban por negocio).
-- Cambia la firma: se borra la anterior y se recrea con el parámetro nuevo al
-- final y con valor por defecto, así la app vigente sigue funcionando igual.
-- Idempotente.
BEGIN;

CREATE TABLE IF NOT EXISTS public.saldo_a_favor_movimientos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  customer_name text NOT NULL,
  monto_ars numeric(14,2) NOT NULL CHECK (monto_ars <> 0),
  motivo text NOT NULL,
  cobro_id uuid,
  creado_por uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.saldo_a_favor_movimientos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS saldo_a_favor_leer ON public.saldo_a_favor_movimientos;
CREATE POLICY saldo_a_favor_leer ON public.saldo_a_favor_movimientos
  FOR SELECT TO authenticated USING (public.is_org_member(org_id, auth.uid()));
REVOKE ALL ON public.saldo_a_favor_movimientos FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.saldo_a_favor_movimientos FROM authenticated;
GRANT SELECT ON public.saldo_a_favor_movimientos TO authenticated;
GRANT ALL ON public.saldo_a_favor_movimientos TO service_role;
CREATE INDEX IF NOT EXISTS saldo_a_favor_cliente_idx
  ON public.saldo_a_favor_movimientos (org_id, customer_id, created_at DESC);

-- Saldo de un cliente. Corre con los permisos de quien llama (RLS manda).
CREATE OR REPLACE FUNCTION public.saldo_a_favor(p_org uuid, p_customer_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(sum(monto_ars), 0)::numeric(14,2)
    FROM public.saldo_a_favor_movimientos
   WHERE org_id = p_org AND customer_id = p_customer_id;
$$;
REVOKE ALL ON FUNCTION public.saldo_a_favor(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.saldo_a_favor(uuid, uuid) TO authenticated, service_role;

-- Un cliente con saldo no se borra; con el negocio entero, sí.
CREATE OR REPLACE FUNCTION public.no_borrar_cliente_con_saldo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_saldo numeric(14,2);
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = OLD.org_id) THEN
    RETURN OLD;
  END IF;
  SELECT coalesce(sum(monto_ars), 0) INTO v_saldo
    FROM public.saldo_a_favor_movimientos WHERE org_id = OLD.org_id AND customer_id = OLD.id;
  IF abs(v_saldo) >= 0.01 THEN
    RAISE EXCEPTION 'No se puede borrar a %: tiene $% de saldo a favor', OLD.name, to_char(v_saldo, 'FM999G999G990D00')
      USING ERRCODE = '23503';
  END IF;
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION public.no_borrar_cliente_con_saldo() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_no_borrar_cliente_con_saldo ON public.customers;
CREATE TRIGGER trg_no_borrar_cliente_con_saldo
  BEFORE DELETE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.no_borrar_cliente_con_saldo();

DROP FUNCTION IF EXISTS public.cobrar_cuenta_corriente(uuid, numeric, text, text, uuid, text, uuid, text);
DELETE FROM public.security_function_contracts
 WHERE function_name = 'cobrar_cuenta_corriente'
   AND identity_arguments = 'p_org uuid, p_monto numeric, p_medio text, p_clave text, p_customer_id uuid, p_customer_name text, p_debt_id uuid, p_nota text';

CREATE OR REPLACE FUNCTION public.cobrar_cuenta_corriente(
  p_org uuid,
  p_monto numeric,
  p_medio text,
  p_clave text,
  p_customer_id uuid DEFAULT NULL,
  p_customer_name text DEFAULT NULL,
  p_debt_id uuid DEFAULT NULL,
  p_nota text DEFAULT NULL,
  p_excedente_a_favor boolean DEFAULT false
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
  v_usa_saldo boolean;
  v_excedente boolean := coalesce(p_excedente_a_favor, false);
  v_cliente text;
  v_saldo numeric(14,2) := 0;
  v_a_favor numeric(14,2) := 0;
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
  v_usa_saldo := v_medio = 'saldo_a_favor';
  IF (v_usa_saldo OR v_excedente) AND p_customer_id IS NULL THEN
    RAISE EXCEPTION 'El saldo a favor es de un cliente: elegilo de la lista' USING ERRCODE = '22023';
  END IF;
  IF v_usa_saldo AND v_excedente THEN
    RAISE EXCEPTION 'Con saldo a favor no puede quedar un excedente' USING ERRCODE = '22023';
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

  -- El cliente tiene que ser de este negocio. Su ficha queda bloqueada hasta
  -- el final: dos cobros a la vez no gastan el mismo saldo.
  IF p_customer_id IS NOT NULL THEN
    SELECT name INTO v_cliente FROM public.customers WHERE id = p_customer_id AND org_id = p_org FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'El cliente no es de este negocio' USING ERRCODE = '22023';
    END IF;
    SELECT coalesce(sum(monto_ars), 0) INTO v_saldo
      FROM public.saldo_a_favor_movimientos WHERE org_id = p_org AND customer_id = p_customer_id;
  END IF;
  v_cliente := coalesce(nullif(btrim(coalesce(p_customer_name, '')), ''), v_cliente);

  IF v_usa_saldo AND v_monto > v_saldo + 0.005 THEN
    RAISE EXCEPTION 'El saldo a favor de % es $%', coalesce(v_cliente, 'este cliente'), to_char(v_saldo, 'FM999G999G990D00')
      USING ERRCODE = '22023';
  END IF;

  -- La caja del cobro: la que abrió quien cobra; si no, la última abierta.
  -- Con saldo a favor no entra plata, así que no hace falta caja.
  IF NOT v_usa_saldo THEN
    SELECT id INTO v_sesion FROM public.cash_sessions
     WHERE org_id = p_org AND status = 'open'
     ORDER BY (opened_by = v_user) DESC NULLS LAST, opened_at DESC LIMIT 1;
    -- Un vendedor cobra sólo con la caja abierta: lo que recibe tiene que
    -- aparecer en el arqueo del turno.
    IF NOT v_es_admin AND v_sesion IS NULL THEN
      RAISE EXCEPTION 'Abrí la caja para cobrar: el cobro tiene que entrar en el turno' USING ERRCODE = '55000';
    END IF;
  END IF;

  -- Deudas abiertas, bloqueadas, de la más vieja a la más nueva.
  SELECT coalesce(sum(remaining_ars), 0) INTO v_pendiente
    FROM public.debts
   WHERE org_id = p_org AND status IN ('pending', 'partial') AND remaining_ars > 0
     AND (CASE WHEN p_debt_id IS NOT NULL THEN id = p_debt_id
               WHEN p_customer_id IS NOT NULL THEN customer_id = p_customer_id
               ELSE customer_name = btrim(p_customer_name) END);
  IF v_pendiente <= 0 AND NOT v_excedente THEN
    RAISE EXCEPTION 'No hay deudas pendientes para cobrar' USING ERRCODE = 'P0002';
  END IF;
  IF v_monto > v_pendiente + 0.005 AND NOT v_excedente THEN
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

  -- Lo que sobra (sólo con excedente explícito) queda a favor del cliente.
  IF v_restante > 0 THEN
    v_a_favor := v_restante;
    INSERT INTO public.saldo_a_favor_movimientos (org_id, customer_id, customer_name, monto_ars, motivo, cobro_id, creado_por)
    VALUES (p_org, p_customer_id, coalesce(v_cliente, 'Cliente'), v_a_favor,
            CASE WHEN v_pendiente <= 0 THEN 'Anticipo' ELSE 'Excedente de un cobro' END, v_cobro, v_user);
  END IF;
  -- Pagar con saldo a favor lo descuenta.
  IF v_usa_saldo THEN
    INSERT INTO public.saldo_a_favor_movimientos (org_id, customer_id, customer_name, monto_ars, motivo, cobro_id, creado_por)
    VALUES (p_org, p_customer_id, coalesce(v_cliente, 'Cliente'), -v_monto, 'Aplicado a deudas', v_cobro, v_user);
  END IF;

  -- El cobro entra en la caja (como una venta cobrada), entero: la plata se
  -- recibió entera aunque una parte quede a favor.
  IF v_sesion IS NOT NULL THEN
    INSERT INTO public.cash_entries (org_id, session_id, entry_type, payment_method, amount_ars,
                                     reference_type, reference_id, description, created_by)
    VALUES (p_org, v_sesion, 'debt_payment', v_medio, v_monto, 'cobro_cuenta_corriente', v_cobro,
            CASE WHEN v_a_favor > 0 AND v_pendiente <= 0 THEN 'Anticipo de cliente' ELSE 'Cobro de cuenta corriente' END
              || coalesce(' · ' || v_cliente, ''), v_user);
  END IF;

  v_previo := jsonb_build_object(
    'cobro_id', v_cobro,
    'aplicado', v_monto,
    'imputaciones', v_imputaciones,
    'saldo_pendiente', greatest(0, round(v_pendiente - (v_monto - v_a_favor), 2)),
    'a_favor', v_a_favor,
    'saldo_a_favor', CASE WHEN p_customer_id IS NULL THEN NULL
                          ELSE round(v_saldo + v_a_favor - CASE WHEN v_usa_saldo THEN v_monto ELSE 0 END, 2) END,
    'en_caja', v_sesion IS NOT NULL,
    'repetido', false);

  INSERT INTO public.cobros_cuenta_corriente (id, org_id, clave, customer_id, customer_name, monto_ars, medio, nota, resultado, creado_por)
  VALUES (v_cobro, p_org, p_clave, p_customer_id, v_cliente, v_monto, v_medio,
          nullif(btrim(coalesce(p_nota, '')), ''), v_previo, v_user);

  RETURN v_previo;
END;
$$;

REVOKE ALL ON FUNCTION public.cobrar_cuenta_corriente(uuid, numeric, text, text, uuid, text, uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cobrar_cuenta_corriente(uuid, numeric, text, text, uuid, text, uuid, text, boolean) TO authenticated, service_role;

INSERT INTO public.security_function_contracts(function_name, identity_arguments, audience, rationale, definition_hash, reviewed_on)
SELECT 'cobrar_cuenta_corriente', pg_get_function_identity_arguments(p.oid), 'authenticated_delegate',
       'Dueño o administrador del negocio; un vendedor sólo con una caja abierta (el cobro entra en el turno). Sólo toca deudas, clientes y saldo a favor de ese negocio.',
       md5(pg_get_functiondef(p.oid)), DATE '2026-10-14'
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'cobrar_cuenta_corriente'
ON CONFLICT (function_name, identity_arguments) DO UPDATE
  SET definition_hash = EXCLUDED.definition_hash, reviewed_on = EXCLUDED.reviewed_on, rationale = EXCLUDED.rationale;

COMMIT;
