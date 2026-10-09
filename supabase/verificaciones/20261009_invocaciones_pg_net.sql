-- Registro de invocaciones con request_id reciclado por pg_net. ROLLBACK.
BEGIN;
DO $$
DECLARE v_old bigint; v_before integer; v_after integer;
BEGIN
  SELECT request_id INTO v_old FROM public.edge_invocation_log WHERE request_id IS NOT NULL ORDER BY invoked_at LIMIT 1;
  ASSERT v_old IS NOT NULL, 'Se necesita una invocación histórica';
  SELECT count(*) INTO v_before FROM public.edge_invocation_log WHERE request_id = v_old;
  PERFORM public.registrar_invocacion(v_old, 'zz-verificacion');
  SELECT count(*) INTO v_after FROM public.edge_invocation_log WHERE request_id = v_old;
  ASSERT v_after = v_before + 1, 'Un request_id reciclado no se registró';
  -- Una respuesta vieja de pg_net con ese id no concilia la invocación nueva.
  PERFORM public.reconciliar_invocaciones();
  ASSERT (SELECT reconciled_at IS NULL FROM public.edge_invocation_log WHERE function_name = 'zz-verificacion'), 'Se concilió con una respuesta anterior';
  RAISE NOTICE 'OK: request_id reciclado registrado y sin conciliación cruzada';
END;
$$;
ROLLBACK;
SELECT count(*) AS restos FROM public.edge_invocation_log WHERE function_name = 'zz-verificacion';
