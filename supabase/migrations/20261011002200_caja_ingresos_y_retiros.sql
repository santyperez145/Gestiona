-- ═══════════════════════════════════════════════════════════════════════════
-- Caja: ingresos y retiros de efectivo durante el turno, con motivo
-- ═══════════════════════════════════════════════════════════════════════════
--
-- docs/POS_OPERACION.md, «Caja y turnos»: «arqueo inicial/final,
-- ingresos/egresos, diferencias con responsable y motivo». La caja ya
-- reconocía los tipos `manual_in` (Ingreso) y `manual_out` (Egreso) —el
-- efectivo esperado del cierre los suma y resta, la pantalla los rotula—
-- pero no había forma de registrarlos: medido 2026-10-11, ninguna función ni
-- pantalla los crea. Sin eso, el cambio que se trae de afuera o la plata que
-- se saca para pagar un flete terminan como «diferencia» al cerrar.
--
-- `pos_cash_movement(p_session_id, p_tipo, p_monto, p_motivo)`:
--   · exige permiso de caja «editar» (el mismo que cerrar) y turno abierto;
--   · monto mayor a cero, motivo obligatorio (hasta 300 caracteres);
--   · un retiro no puede dejar la caja en negativo;
--   · guarda el movimiento en efectivo y deja auditoría con quién y por qué.
--
-- Idempotente. Reversible: DROP FUNCTION.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

CREATE OR REPLACE FUNCTION public.pos_cash_movement(p_session_id uuid, p_tipo text, p_monto numeric, p_motivo text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_session public.cash_sessions;
  v_motivo text := NULLIF(left(btrim(COALESCE(p_motivo, '')), 300), '');
  v_esperado numeric;
  v_id uuid;
BEGIN
  SELECT * INTO v_session FROM public.cash_sessions WHERE id = p_session_id FOR UPDATE;
  IF v_session.id IS NULL OR v_actor IS NULL OR NOT public.is_org_member(v_session.org_id, v_actor) THEN
    RAISE EXCEPTION 'La sesión no existe o no pertenece a tu organización' USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM public.exigir_permiso(v_session.org_id, 'pos', 'edit', 'registrar movimientos de caja');

  IF v_session.status <> 'open' THEN
    RAISE EXCEPTION 'La caja está cerrada' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF p_tipo NOT IN ('manual_in', 'manual_out') THEN
    RAISE EXCEPTION 'Tipo de movimiento inválido' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_monto IS NULL OR p_monto <= 0 THEN
    RAISE EXCEPTION 'El monto tiene que ser mayor a cero' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF v_motivo IS NULL THEN
    RAISE EXCEPTION 'Escribí el motivo del movimiento' USING ERRCODE = 'check_violation';
  END IF;

  IF p_tipo = 'manual_out' THEN
    v_esperado := public.cash_session_expected_cash(v_session.id);
    IF round(p_monto, 2) > v_esperado THEN
      RAISE EXCEPTION 'En la caja hay $% y querés retirar $%',
        replace(to_char(v_esperado, 'FM999999990.00'), '.', ','),
        replace(to_char(round(p_monto, 2), 'FM999999990.00'), '.', ',')
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  INSERT INTO public.cash_entries (org_id, session_id, entry_type, payment_method, amount_ars,
    reference_type, reference_id, description, created_by)
  VALUES (v_session.org_id, v_session.id, p_tipo, 'efectivo', round(p_monto, 2),
    'cash_session', v_session.id, v_motivo, v_actor)
  RETURNING id INTO v_id;

  INSERT INTO public.audit_logs (user_id, org_id, action, entity_type, entity_id, details)
  VALUES (v_actor, v_session.org_id, 'create', 'cash_entry', v_id,
    jsonb_build_object('tipo', p_tipo, 'monto', round(p_monto, 2), 'motivo', v_motivo, 'session_id', v_session.id));

  RETURN jsonb_build_object('id', v_id, 'esperado', public.cash_session_expected_cash(v_session.id));
END;
$$;

REVOKE ALL ON FUNCTION public.pos_cash_movement(uuid, text, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pos_cash_movement(uuid, text, numeric, text) TO authenticated;

COMMENT ON FUNCTION public.pos_cash_movement(uuid, text, numeric, text) IS
  'Ingreso o retiro de efectivo durante el turno de caja, con motivo obligatorio y auditoría. Permiso de caja «editar».';

COMMIT;
