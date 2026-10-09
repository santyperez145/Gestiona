-- El registro de invocaciones dejó de escribir el 2026-10-04.
--
-- pg_net reinició la numeración de sus pedidos (iba por 45.155 y volvió a
-- ~21.000). `edge_invocation_log_request_idx` era UNIQUE sobre request_id, así
-- que cada INSERT de `registrar_invocacion` chocaba con una fila histórica; el
-- error se tragaba como WARNING y la salud de crons/Edge quedó ciega.
-- request_id no es único en el tiempo: el índice pasa a ser no único y la
-- conciliación exige que la respuesta sea posterior a la invocación.

DROP INDEX IF EXISTS public.edge_invocation_log_request_idx;
CREATE INDEX IF NOT EXISTS edge_invocation_log_request_pending_idx
  ON public.edge_invocation_log (request_id) WHERE reconciled_at IS NULL;

CREATE OR REPLACE FUNCTION public.reconciliar_invocaciones()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'net'
AS $fn$
DECLARE
  v_n integer;
  v_huerfanas integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT (
       auth.role() IS NULL
       AND session_user IN ('postgres', 'supabase_admin')
     ) THEN
    RAISE EXCEPTION 'Sólo el backend puede reconciliar invocaciones'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE public.edge_invocation_log l
     SET status_code   = r.status_code,
         error_msg     = r.error_msg,
         timed_out     = r.timed_out,
         responded_at  = r.created,
         reconciled_at = now()
    FROM net._http_response r
   WHERE r.id = l.request_id
     AND l.reconciled_at IS NULL
     -- pg_net reinicia su numeración: una respuesta sólo corresponde a una
     -- invocación registrada antes de ella.
     AND r.created >= l.invoked_at - interval '1 minute';
  GET DIAGNOSTICS v_n = ROW_COUNT;

  UPDATE public.edge_invocation_log
     SET reconciled_at = now(),
         error_msg = COALESCE(
           error_msg,
           'sin respuesta registrada antes de la poda de pg_net'
         )
   WHERE reconciled_at IS NULL
     AND invoked_at < now() - interval '6 hours';
  GET DIAGNOSTICS v_huerfanas = ROW_COUNT;

  IF v_huerfanas > 0 THEN
    RAISE WARNING 'reconciliar_invocaciones: % invocaciones sin respuesta',
      v_huerfanas;
  END IF;
  RETURN v_n;
END;
$fn$;
