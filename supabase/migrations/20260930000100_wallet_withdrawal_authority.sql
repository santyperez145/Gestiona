-- La billetera refleja fondos del comercio en el proveedor; Nerqia no los
-- custodia. Solicitar reserva saldo. Solo una transferencia confirmada con
-- referencia mueve el ledger desde billetera a banco.

BEGIN;

ALTER TABLE public.wallet_withdrawals
  ADD COLUMN IF NOT EXISTS procesado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS payment_method text,
  ADD COLUMN IF NOT EXISTS procesado_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS wallet_withdrawals_reference_unique
  ON public.wallet_withdrawals(org_id, referencia)
  WHERE referencia IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS wallet_bank_account_active_unique
  ON public.wallet_bank_accounts(org_id, cbu)
  WHERE is_active;

DROP POLICY IF EXISTS wallet_bank_org ON public.wallet_bank_accounts;
DROP POLICY IF EXISTS wallet_bank_read ON public.wallet_bank_accounts;
CREATE POLICY wallet_bank_read ON public.wallet_bank_accounts
  FOR SELECT TO authenticated
  USING (public.has_permission(org_id, 'finance', 'view'));
REVOKE ALL ON TABLE public.wallet_bank_accounts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.wallet_bank_accounts TO authenticated;

CREATE OR REPLACE FUNCTION public.wallet_guardar_cuenta(
  p_org uuid,
  p_alias text,
  p_titular text,
  p_cbu text,
  p_banco text DEFAULT NULL
) RETURNS public.wallet_bank_accounts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_row public.wallet_bank_accounts;
  v_cbu text := regexp_replace(COALESCE(p_cbu, ''), '[^0-9]', '', 'g');
  v_alias text := left(btrim(COALESCE(p_alias, '')), 100);
  v_titular text := left(btrim(COALESCE(p_titular, '')), 160);
BEGIN
  IF NOT public.is_org_member(p_org, auth.uid()) THEN
    RAISE EXCEPTION 'Sin permiso sobre esa organizacion' USING ERRCODE = '42501';
  END IF;
  PERFORM public.exigir_permiso(p_org, 'finance', 'edit', 'administrar cuentas de retiro');
  IF char_length(v_alias) < 2 OR char_length(v_titular) < 3 THEN
    RAISE EXCEPTION 'Completa el alias y el titular de la cuenta' USING ERRCODE = '22023';
  END IF;
  IF v_cbu !~ '^[0-9]{22}$' THEN
    RAISE EXCEPTION 'El CBU o CVU debe tener 22 digitos' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.wallet_bank_accounts(
    org_id, alias, titular, cbu, banco, is_default, is_active
  ) VALUES (
    p_org, v_alias, v_titular, v_cbu,
    NULLIF(left(btrim(COALESCE(p_banco, '')), 100), ''),
    NOT EXISTS (SELECT 1 FROM public.wallet_bank_accounts account
      WHERE account.org_id = p_org AND account.is_active), true
  )
  ON CONFLICT (org_id, cbu) WHERE is_active DO UPDATE SET
    alias = EXCLUDED.alias,
    titular = EXCLUDED.titular,
    banco = EXCLUDED.banco
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.wallet_saldo(p_org uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_pendiente numeric := 0;
  v_disponible numeric := 0;
  v_reservado numeric := 0;
BEGIN
  IF NOT public.has_permission(p_org, 'finance', 'view') THEN
    RAISE EXCEPTION 'No tenes permiso para ver la billetera' USING ERRCODE = '42501';
  END IF;
  SELECT
    COALESCE(sum(CASE WHEN account.codigo = '1.1.03' THEN line.debe - line.haber ELSE 0 END), 0),
    COALESCE(sum(CASE WHEN account.codigo = '1.1.04' THEN line.debe - line.haber ELSE 0 END), 0)
  INTO v_pendiente, v_disponible
  FROM public.ledger_lines line
  JOIN public.ledger_accounts account ON account.id = line.account_id
  WHERE line.org_id = p_org AND account.codigo IN ('1.1.03', '1.1.04');

  -- Los retiros nuevos se reservan sin asiento. Los historicos con entry_id ya
  -- redujeron el disponible y no deben descontarse una segunda vez.
  SELECT COALESCE(sum(monto), 0) INTO v_reservado
  FROM public.wallet_withdrawals
  WHERE org_id = p_org AND estado IN ('solicitado', 'en_proceso')
    AND entry_id IS NULL;

  RETURN jsonb_build_object(
    'pendiente', round(greatest(v_pendiente, 0), 2),
    'disponible', round(v_disponible, 2),
    'en_retiro', round(v_reservado, 2),
    'retirable', round(greatest(v_disponible - v_reservado, 0), 2),
    'total', round(greatest(v_pendiente, 0) + v_disponible, 2),
    'moneda', 'ARS'
  );
END;
$fn$;

CREATE OR REPLACE FUNCTION public.wallet_solicitar_retiro(
  p_org uuid,
  p_monto numeric,
  p_cuenta uuid DEFAULT NULL,
  p_clave text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_monto numeric;
  v_saldo jsonb;
  v_cuenta public.wallet_bank_accounts;
  v_id uuid;
  v_reserva jsonb;
BEGIN
  IF NOT public.is_org_member(p_org, auth.uid()) THEN
    RAISE EXCEPTION 'Sin permiso sobre esa organizacion' USING ERRCODE = '42501';
  END IF;
  PERFORM public.exigir_permiso(p_org, 'finance', 'edit', 'retirar dinero de la billetera');
  v_monto := round(COALESCE(p_monto, 0), 2);
  IF v_monto <= 0 THEN
    RAISE EXCEPTION 'El monto a retirar tiene que ser mayor a cero' USING ERRCODE = '22023';
  END IF;

  v_reserva := public.idempotencia_reservar(
    p_org, 'wallet_retiro', p_clave,
    jsonb_build_object('monto', v_monto, 'cuenta', p_cuenta));
  IF NOT (v_reserva->>'ejecutar')::boolean THEN
    RETURN (v_reserva->'respuesta') || jsonb_build_object('reintento', true);
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('wallet:' || p_org::text, 0));
  v_saldo := public.wallet_saldo(p_org);
  IF v_monto > (v_saldo->>'retirable')::numeric THEN
    PERFORM public.idempotencia_fallar(p_org, 'wallet_retiro', p_clave, 'saldo insuficiente');
    RAISE EXCEPTION 'No alcanza el saldo disponible' USING ERRCODE = '23514';
  END IF;

  IF p_cuenta IS NOT NULL THEN
    SELECT * INTO v_cuenta FROM public.wallet_bank_accounts
    WHERE id = p_cuenta AND org_id = p_org AND is_active;
  ELSE
    SELECT * INTO v_cuenta FROM public.wallet_bank_accounts
    WHERE org_id = p_org AND is_default AND is_active LIMIT 1;
  END IF;
  IF v_cuenta.id IS NULL THEN
    PERFORM public.idempotencia_fallar(p_org, 'wallet_retiro', p_clave, 'sin cuenta destino');
    RAISE EXCEPTION 'Carga una cuenta bancaria antes de retirar' USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.wallet_withdrawals(
    org_id, bank_account_id, monto, estado, solicitado_por
  ) VALUES (p_org, v_cuenta.id, v_monto, 'solicitado', auth.uid())
  RETURNING id INTO v_id;

  PERFORM public.emitir_evento(p_org, 'billetera', v_id, 'retiro.solicitado',
    jsonb_build_object('withdrawal_id', v_id, 'monto', v_monto, 'cuenta', v_cuenta.alias));
  PERFORM public.idempotencia_completar(p_org, 'wallet_retiro', p_clave,
    jsonb_build_object('withdrawal_id', v_id, 'monto', v_monto));

  RETURN jsonb_build_object(
    'withdrawal_id', v_id, 'monto', v_monto, 'estado', 'solicitado',
    'cuenta', v_cuenta.alias, 'entry_id', NULL);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.wallet_confirmar_retiro(
  p_id uuid,
  p_referencia text,
  p_payment_method text DEFAULT 'transferencia'
) RETURNS public.wallet_withdrawals
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_row public.wallet_withdrawals;
  v_account public.wallet_bank_accounts;
  v_reference text := left(btrim(COALESCE(p_referencia, '')), 160);
  v_method text := left(btrim(COALESCE(NULLIF(p_payment_method, ''), 'transferencia')), 40);
  v_entry uuid;
BEGIN
  SELECT * INTO v_row FROM public.wallet_withdrawals WHERE id = p_id FOR UPDATE;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'El retiro no existe' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.is_org_member(v_row.org_id, auth.uid()) THEN
    RAISE EXCEPTION 'Sin permiso sobre ese retiro' USING ERRCODE = '42501';
  END IF;
  PERFORM public.exigir_permiso(v_row.org_id, 'finance', 'edit', 'confirmar retiros');
  IF char_length(v_reference) < 3 THEN
    RAISE EXCEPTION 'Ingresa la referencia de la transferencia' USING ERRCODE = '22023';
  END IF;
  IF v_row.estado = 'pagado' THEN
    IF v_row.referencia IS DISTINCT FROM v_reference THEN
      RAISE EXCEPTION 'El retiro ya fue confirmado con otra referencia' USING ERRCODE = '22023';
    END IF;
    RETURN v_row;
  END IF;
  IF v_row.estado NOT IN ('solicitado', 'en_proceso') THEN
    RAISE EXCEPTION 'El retiro no esta disponible para confirmar' USING ERRCODE = '23514';
  END IF;

  IF v_row.entry_id IS NULL THEN
    SELECT * INTO v_account FROM public.wallet_bank_accounts WHERE id = v_row.bank_account_id;
    v_entry := public.ledger_asentar(
      v_row.org_id, 'Retiro confirmado a ' || COALESCE(v_account.alias, 'cuenta bancaria'),
      jsonb_build_array(
        jsonb_build_object('cuenta', '1.1.02', 'debe', v_row.monto, 'detalle', 'Ingreso a cuenta bancaria'),
        jsonb_build_object('cuenta', '1.1.04', 'haber', v_row.monto, 'detalle', 'Salida de billetera')
      ), CURRENT_DATE, 'retiro', v_row.id
    );
  ELSE
    -- Compatibilidad: los retiros creados antes de esta migracion ya tenian el asiento.
    v_entry := v_row.entry_id;
  END IF;

  UPDATE public.wallet_withdrawals
  SET estado = 'pagado', entry_id = v_entry, referencia = v_reference,
      payment_method = v_method, pagado_at = COALESCE(pagado_at, now()),
      procesado_at = now(), procesado_por = auth.uid(), updated_at = now()
  WHERE id = v_row.id RETURNING * INTO v_row;
  PERFORM public.emitir_evento(v_row.org_id, 'billetera', v_row.id, 'retiro.pagado',
    jsonb_build_object('withdrawal_id', v_row.id, 'monto', v_row.monto,
      'referencia', v_reference, 'payment_method', v_method));
  RETURN v_row;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.wallet_rechazar_retiro(p_id uuid, p_motivo text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_row public.wallet_withdrawals;
  v_reversal uuid;
  v_reason text := left(btrim(COALESCE(p_motivo, '')), 500);
BEGIN
  SELECT * INTO v_row FROM public.wallet_withdrawals WHERE id = p_id FOR UPDATE;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'El retiro no existe' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.is_org_member(v_row.org_id, auth.uid()) THEN
    RAISE EXCEPTION 'Sin permiso sobre ese retiro' USING ERRCODE = '42501';
  END IF;
  PERFORM public.exigir_permiso(v_row.org_id, 'finance', 'edit', 'cancelar retiros');
  IF char_length(v_reason) < 5 THEN
    RAISE EXCEPTION 'Ingresa el motivo de la cancelacion' USING ERRCODE = '22023';
  END IF;
  IF v_row.estado = 'pagado' THEN
    RAISE EXCEPTION 'Un retiro pagado requiere una devolucion documentada' USING ERRCODE = '23514';
  END IF;
  IF v_row.estado = 'rechazado' THEN RETURN v_row.reversa_id; END IF;

  IF v_row.entry_id IS NOT NULL THEN
    v_reversal := public.ledger_contraasentar(v_row.entry_id, v_reason);
  END IF;
  UPDATE public.wallet_withdrawals
  SET estado = 'rechazado', motivo_rechazo = v_reason,
      reversa_id = v_reversal, procesado_at = now(), procesado_por = auth.uid(), updated_at = now()
  WHERE id = v_row.id;
  PERFORM public.emitir_evento(v_row.org_id, 'billetera', v_row.id, 'retiro.rechazado',
    jsonb_build_object('withdrawal_id', v_row.id, 'monto', v_row.monto, 'motivo', v_reason));
  RETURN v_reversal;
END;
$fn$;

REVOKE ALL ON FUNCTION public.wallet_guardar_cuenta(uuid, text, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.wallet_saldo(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.wallet_solicitar_retiro(uuid, numeric, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.wallet_confirmar_retiro(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.wallet_rechazar_retiro(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wallet_guardar_cuenta(uuid, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wallet_saldo(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wallet_solicitar_retiro(uuid, numeric, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wallet_confirmar_retiro(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wallet_rechazar_retiro(uuid, text) TO authenticated;

INSERT INTO public.security_function_contracts(
  function_name, identity_arguments, audience, rationale, definition_hash, reviewed_on
)
SELECT contract.function_name, contract.identity_arguments, 'authenticated_delegate',
       contract.rationale, md5(pg_get_functiondef(procedure.oid)), DATE '2026-09-30'
FROM (VALUES
  ('wallet_guardar_cuenta', 'p_org uuid, p_alias text, p_titular text, p_cbu text, p_banco text',
   'Administra destinos bancarios con finance.edit y validacion server-side.'),
  ('wallet_saldo', 'p_org uuid',
   'Deriva saldo del ledger y reservas sin contabilizar dinero no transferido.'),
  ('wallet_solicitar_retiro', 'p_org uuid, p_monto numeric, p_cuenta uuid, p_clave text',
   'Reserva saldo idempotentemente; no crea un movimiento bancario ficticio.'),
  ('wallet_confirmar_retiro', 'p_id uuid, p_referencia text, p_payment_method text',
   'Solo con referencia externa mueve billetera a banco y confirma el retiro.'),
  ('wallet_rechazar_retiro', 'p_id uuid, p_motivo text',
   'Libera reservas nuevas o contraasienta retiros historicos con evidencia.')
) AS contract(function_name, identity_arguments, rationale)
JOIN pg_proc procedure ON procedure.proname = contract.function_name
JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace AND namespace.nspname = 'public'
WHERE pg_get_function_identity_arguments(procedure.oid) = contract.identity_arguments
ON CONFLICT (function_name, identity_arguments) DO UPDATE SET
  audience = EXCLUDED.audience,
  rationale = EXCLUDED.rationale,
  definition_hash = EXCLUDED.definition_hash,
  reviewed_on = EXCLUDED.reviewed_on;

COMMIT;
