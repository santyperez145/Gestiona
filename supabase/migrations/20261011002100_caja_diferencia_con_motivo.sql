-- ═══════════════════════════════════════════════════════════════════════════
-- Caja: cerrar con diferencia exige el motivo
-- ═══════════════════════════════════════════════════════════════════════════
--
-- docs/POS_OPERACION.md, «Caja y turnos»: «diferencias con responsable y
-- motivo». El responsable ya quedaba (closed_by) pero el motivo era optativo:
-- un faltante o sobrante sin explicación no se puede revisar después. Ahora,
-- si el arqueo difiere en $1 o más de lo esperado, `pos_cash_session_close`
-- rechaza el cierre sin motivo, con el monto de la diferencia en el mensaje, y
-- la auditoría guarda el motivo. Sin diferencia, sigue igual (motivo
-- optativo). El resto de la función no cambia.
--
-- Idempotente (CREATE OR REPLACE). Reversible: la versión anterior sin el IF.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

CREATE OR REPLACE FUNCTION public.pos_cash_session_close(p_session_id uuid, p_closing_amount numeric, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_session public.cash_sessions;
  v_expected numeric;
  v_difference numeric;
BEGIN
  SELECT * INTO v_session
  FROM public.cash_sessions session
  WHERE session.id = p_session_id
  FOR UPDATE;

  IF v_session.id IS NULL OR v_actor IS NULL
     OR NOT public.is_org_member(v_session.org_id, v_actor) THEN
    RAISE EXCEPTION 'La sesión no existe o no pertenece a tu organización'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM public.exigir_permiso(v_session.org_id, 'pos', 'edit', 'cerrar la caja');

  IF p_closing_amount IS NULL OR p_closing_amount < 0 THEN
    RAISE EXCEPTION 'El monto de cierre no puede ser negativo'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF v_session.status = 'closed' THEN
    IF abs(COALESCE(v_session.closing_amount, 0) - round(p_closing_amount, 2)) <= 0.01 THEN
      RETURN jsonb_build_object(
        'session_id', v_session.id,
        'status', 'closed',
        'expected_cash', v_session.expected_cash,
        'difference', v_session.difference,
        'reused', true
      );
    END IF;
    RAISE EXCEPTION 'La caja ya fue cerrada con otro importe'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;

  v_expected := public.cash_session_expected_cash(v_session.id);
  v_difference := round(p_closing_amount, 2) - v_expected;

  -- Un faltante o sobrante sin explicación no se puede revisar después:
  -- con diferencia de $1 o más el cierre pide el motivo (POS_OPERACION:
  -- «diferencias con responsable y motivo»; el responsable es closed_by).
  IF abs(v_difference) >= 1 AND NULLIF(btrim(COALESCE(p_notes, '')), '') IS NULL THEN
    RAISE EXCEPTION 'En la caja % $% contra lo esperado. Escribí el motivo para cerrarla.',
      CASE WHEN v_difference < 0 THEN 'faltan' ELSE 'sobran' END,
      replace(to_char(abs(v_difference), 'FM999999990.00'), '.', ',')
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.cash_sessions
  SET closed_by = v_actor,
      closed_at = now(),
      closing_amount = round(p_closing_amount, 2),
      expected_cash = v_expected,
      difference = v_difference,
      notes = COALESCE(NULLIF(left(btrim(COALESCE(p_notes, '')), 1000), ''), notes),
      status = 'closed'
  WHERE id = v_session.id;

  INSERT INTO public.cash_entries (
    org_id, session_id, entry_type, payment_method, amount_ars,
    reference_type, reference_id, description, created_by
  ) VALUES (
    v_session.org_id, v_session.id, 'closing', 'efectivo',
    round(p_closing_amount, 2), 'cash_session', v_session.id,
    'Cierre de caja', v_actor
  );

  INSERT INTO public.audit_logs (user_id, org_id, action, entity_type, entity_id, details)
  VALUES (
    v_actor, v_session.org_id, 'update', 'cash_session', v_session.id,
    jsonb_build_object(
      'location_id', v_session.location_id,
      'expected_cash', v_expected,
      'closing_amount', round(p_closing_amount, 2),
      'difference', v_difference,
      'motivo', NULLIF(left(btrim(COALESCE(p_notes, '')), 1000), '')
    )
  );

  RETURN jsonb_build_object(
    'session_id', v_session.id,
    'status', 'closed',
    'expected_cash', v_expected,
    'difference', v_difference,
    'reused', false
  );
END
$function$;

COMMIT;
