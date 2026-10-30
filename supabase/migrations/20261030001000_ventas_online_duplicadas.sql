-- Ventas de la tienda contadas dos veces: verlas y corregirlas (2026-10-30).
--
-- 20261030000900 dejó de duplicar: una venta que viene de un pedido online ya
-- no se asienta sola, la cubre el asiento de su orden. Lo asentado antes no se
-- tocó: en un monotributista, cada pedido pagado desde agosto tiene su asiento
-- de orden y, además, uno por cada venta que creó. Ventas (4.1.01) y el
-- margen bruto de esos meses salen inflados.
--
-- El libro es inmutable y corregirlo es decisión del dueño, así que:
--   · `ledger_ventas_online_duplicadas`: lo que hay para corregir (owner o
--     admin), con cantidad, importe y cada asiento.
--   · `ledger_corregir_ventas_online_duplicadas`: sólo el dueño. Anula cada
--     asiento duplicado con un contraasiento **fechado el mismo día que el
--     original**: así el mes original queda bien, en vez de mostrar ventas
--     negativas este mes (lo que haría `ledger_contraasentar`, que fecha hoy).
--     Nada se borra; queda en el registro de auditoría. Correrla dos veces no
--     hace nada la segunda.

BEGIN;

CREATE OR REPLACE FUNCTION public.ledger_ventas_online_duplicadas(p_org uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_resultado jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_org_role(p_org, auth.uid(), ARRAY['owner', 'admin']) THEN
    RAISE EXCEPTION 'Sólo el dueño o un administrador ve el libro' USING ERRCODE = '42501';
  END IF;
  WITH d AS (
    SELECT e.id, e.numero, e.fecha, o.order_number,
           (SELECT COALESCE(sum(l.haber), 0) FROM public.ledger_lines l
              JOIN public.ledger_accounts a ON a.id = l.account_id
             WHERE l.entry_id = e.id AND a.codigo = '4.1.01') AS ventas
      FROM public.ledger_entries e
      JOIN public.sales s ON s.id = e.referencia_id AND s.org_id = e.org_id
      JOIN public.ecommerce_orders o ON o.id = s.ecommerce_order_id
     WHERE e.org_id = p_org AND e.referencia_tipo = 'venta'
       AND e.anulado_por IS NULL AND e.anula_a IS NULL
       AND EXISTS (SELECT 1 FROM public.ledger_entries eo
                    WHERE eo.org_id = p_org AND eo.referencia_tipo = 'orden' AND eo.referencia_id = o.id
                      AND eo.anulado_por IS NULL AND eo.anula_a IS NULL)
  )
  SELECT jsonb_build_object(
    'cantidad', (SELECT count(*) FROM d),
    'ventas', (SELECT COALESCE(sum(ventas), 0) FROM d),
    'desde', (SELECT min(fecha) FROM d),
    'hasta', (SELECT max(fecha) FROM d),
    'asientos', COALESCE((SELECT jsonb_agg(jsonb_build_object('numero', x.numero, 'fecha', x.fecha, 'pedido', x.order_number, 'ventas', x.ventas)
                                          ORDER BY x.fecha, x.numero)
                            FROM (SELECT * FROM d ORDER BY fecha, numero LIMIT 200) x), '[]'::jsonb))
    INTO v_resultado;
  RETURN v_resultado;
END;
$fn$;
REVOKE ALL ON FUNCTION public.ledger_ventas_online_duplicadas(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ledger_ventas_online_duplicadas(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.ledger_corregir_ventas_online_duplicadas(p_org uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_e record;
  v_numero bigint;
  v_id uuid;
  v_n integer := 0;
  v_total numeric := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_org_role(p_org, auth.uid(), ARRAY['owner']) THEN
    RAISE EXCEPTION 'Corregir el libro lo decide el dueño del negocio' USING ERRCODE = '42501';
  END IF;
  -- La misma cerradura que toma ledger_contraasentar: la numeración no choca.
  PERFORM pg_advisory_xact_lock(hashtextextended('ledger:' || p_org::text, 0));

  FOR v_e IN
    SELECT e.id, e.numero, e.fecha, e.moneda, e.referencia_tipo, e.referencia_id, o.order_number,
           (SELECT COALESCE(sum(l.haber), 0) FROM public.ledger_lines l
              JOIN public.ledger_accounts a ON a.id = l.account_id
             WHERE l.entry_id = e.id AND a.codigo = '4.1.01') AS ventas
      FROM public.ledger_entries e
      JOIN public.sales s ON s.id = e.referencia_id AND s.org_id = e.org_id
      JOIN public.ecommerce_orders o ON o.id = s.ecommerce_order_id
     WHERE e.org_id = p_org AND e.referencia_tipo = 'venta'
       AND e.anulado_por IS NULL AND e.anula_a IS NULL
       AND EXISTS (SELECT 1 FROM public.ledger_entries eo
                    WHERE eo.org_id = p_org AND eo.referencia_tipo = 'orden' AND eo.referencia_id = o.id
                      AND eo.anulado_por IS NULL AND eo.anula_a IS NULL)
     ORDER BY e.fecha, e.numero
  LOOP
    SELECT COALESCE(MAX(numero), 0) + 1 INTO v_numero FROM public.ledger_entries WHERE org_id = p_org;
    -- Como ledger_contraasentar, pero en la fecha del original: corrige el mes
    -- que estaba inflado.
    INSERT INTO public.ledger_entries (org_id, numero, fecha, descripcion, moneda,
                                       referencia_tipo, referencia_id, anula_a, created_by)
    VALUES (p_org, v_numero, v_e.fecha,
            format('Anulación del asiento %s — duplicado: el pedido %s ya está asentado como orden', v_e.numero, v_e.order_number),
            v_e.moneda, v_e.referencia_tipo, v_e.referencia_id, v_e.id, auth.uid())
    RETURNING id INTO v_id;
    INSERT INTO public.ledger_lines (entry_id, org_id, account_id, debe, haber, descripcion)
    SELECT v_id, l.org_id, l.account_id, l.haber, l.debe, 'Anula: ' || COALESCE(l.descripcion, '')
      FROM public.ledger_lines l WHERE l.entry_id = v_e.id;
    UPDATE public.ledger_entries SET anulado_por = v_id WHERE id = v_e.id;
    v_n := v_n + 1;
    v_total := v_total + v_e.ventas;
  END LOOP;

  IF v_n > 0 THEN
    INSERT INTO public.audit_logs (user_id, org_id, action, entity_type, entity_id, details)
    VALUES (auth.uid(), p_org, 'ledger_correction', 'ledger', NULL,
            jsonb_build_object('motivo', 'ventas de la tienda online asentadas dos veces', 'asientos', v_n, 'ventas', v_total));
  END IF;
  RETURN jsonb_build_object('ok', true, 'corregidos', v_n, 'ventas', v_total);
END;
$fn$;
REVOKE ALL ON FUNCTION public.ledger_corregir_ventas_online_duplicadas(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ledger_corregir_ventas_online_duplicadas(uuid) TO authenticated;

WITH c(function_name, audience, rationale) AS (VALUES
  ('ledger_ventas_online_duplicadas', 'authenticated_delegate', 'Owner/admin ve los asientos de venta duplicados por pedidos online ya asentados como orden; sólo lectura.'),
  ('ledger_corregir_ventas_online_duplicadas', 'authenticated_delegate', 'Sólo el dueño anula con contraasientos fechados en el original los asientos de venta duplicados de pedidos online.')
)
INSERT INTO public.security_function_contracts(function_name, identity_arguments, audience, rationale, definition_hash, reviewed_on)
SELECT p.proname, pg_get_function_identity_arguments(p.oid), c.audience, c.rationale, md5(pg_get_functiondef(p.oid)), DATE '2026-10-30'
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN c ON c.function_name = p.proname
 WHERE n.nspname = 'public'
ON CONFLICT (function_name, identity_arguments) DO UPDATE
  SET audience = EXCLUDED.audience, rationale = EXCLUDED.rationale,
      definition_hash = EXCLUDED.definition_hash, reviewed_on = EXCLUDED.reviewed_on;

COMMIT;
