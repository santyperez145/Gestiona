-- La billetera acredita lo que Mercado Pago ya liberó.
--
-- Medido el 2026-10-15 en la Billetera de Exentry: «Pendiente de acreditación
-- $2,00 … Se libera solo», con dos cobros de prueba de la tienda del 31/7.
-- `payment_transactions` dice que Mercado Pago los liberó ese mismo día
-- (released_at 31/7), pero nada pasaba esa plata de «a liquidar» (1.1.03) a
-- «disponible» (1.1.04): `wallet_liberar` existe desde agosto y nadie la llama.
-- Lo pendiente no se liberaba nunca. Y `record_payment_settlement` deja
-- released_at vacío cuando Mercado Pago acredita a 7, 14 o 30 días: sólo queda
-- la fecha esperada (expected_release_at), que tampoco miraba nadie.
--
-- Además, el mismo cartel le decía a Famatina que «Mercado Pago todavía no lo
-- acreditó» por un cobro con tarjeta de otro procesador en el mostrador, que
-- no se libera solo: se concilia a mano con su arancel real
-- (`confirm_pos_payment_settlement`).
--
-- Esta migración:
--   1. `wallet_acreditar_cobro(pt)`: acredita un cobro online de Mercado Pago
--      cuya fecha de liberación ya pasó, una sola vez (idempotente por el
--      libro: asiento 'liberacion' con referencia al cobro).
--        · Si la orden ya se asentó con sus comisiones (asiento 'orden'), se
--          mueve lo que ese asiento dejó a liquidar.
--        · Si entró como venta por el bruto (asiento 'venta'), se mueve el neto
--          a disponible y lo que retuvo el procesador va a comisiones (5.2.01)
--          y a la comisión de plataforma (5.2.02): el asiento cuadra por
--          construcción y la billetera muestra lo que de verdad llegó.
--        · Nunca acredita más de lo que hay a liquidar.
--   2. `wallet_acreditar_liberados()`: lo corre cada hora pg_cron. Espera una
--      hora desde el último cambio del cobro para que el asiento de la orden
--      llegue antes (si no, cobraría las comisiones dos veces).
--   3. `wallet_pendiente`: de qué está hecho lo pendiente, para que la
--      pantalla diga cuándo llega o qué falta hacer, sin inventar.
--   4. Acredita ahora lo que ya estaba liberado.
-- Idempotente. Reversible: cron.unschedule('billetera-acreditar-liberados').
BEGIN;

CREATE OR REPLACE FUNCTION public.wallet_acreditar_cobro(p_payment_transaction_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_pt        public.payment_transactions;
  v_fecha     date;
  v_ya        uuid;
  v_pendiente numeric;
  v_de_orden  numeric;
  v_bruto     numeric;
  v_neto      numeric;
  v_plat      numeric;
  v_proc      numeric;
  v_lineas    jsonb;
BEGIN
  SELECT * INTO v_pt FROM public.payment_transactions WHERE id = p_payment_transaction_id;
  IF v_pt.id IS NULL OR v_pt.status <> 'approved' OR v_pt.source = 'pos'
     OR v_pt.provider <> 'mercadopago' THEN
    RETURN NULL;
  END IF;

  v_fecha := COALESCE(v_pt.released_at::date, v_pt.expected_release_at);
  IF v_fecha IS NULL OR v_fecha > CURRENT_DATE THEN
    RETURN NULL;
  END IF;

  -- Un candado por negocio, el mismo que usan los retiros: el saldo a liquidar
  -- se lee y se descuenta sin que otro movimiento se meta en el medio.
  PERFORM pg_advisory_xact_lock(hashtextextended('wallet:' || v_pt.org_id::text, 0));

  SELECT e.id INTO v_ya FROM public.ledger_entries e
   WHERE e.org_id = v_pt.org_id AND e.referencia_tipo = 'liberacion'
     AND e.referencia_id = v_pt.id AND e.anulado_por IS NULL AND e.anula_a IS NULL
   LIMIT 1;
  IF v_ya IS NOT NULL THEN
    RETURN v_ya;
  END IF;

  SELECT COALESCE(sum(l.debe - l.haber), 0) INTO v_pendiente
    FROM public.ledger_lines l
    JOIN public.ledger_accounts a ON a.id = l.account_id
   WHERE l.org_id = v_pt.org_id AND a.codigo = '1.1.03';

  SELECT COALESCE(sum(l.debe), 0) INTO v_de_orden
    FROM public.ledger_entries e
    JOIN public.ledger_lines l ON l.entry_id = e.id
    JOIN public.ledger_accounts a ON a.id = l.account_id
   WHERE e.org_id = v_pt.org_id AND e.referencia_tipo = 'orden'
     AND e.referencia_id = v_pt.source_id AND a.codigo = '1.1.03'
     AND e.anulado_por IS NULL AND e.anula_a IS NULL;

  IF v_de_orden > 0 THEN
    -- La orden ya reconoció las comisiones y dejó el neto a liquidar.
    v_bruto := round(v_de_orden, 2);
    v_lineas := jsonb_build_array(
      jsonb_build_object('cuenta', '1.1.04', 'debe', v_bruto, 'detalle', 'Acreditado por Mercado Pago'),
      jsonb_build_object('cuenta', '1.1.03', 'haber', v_bruto, 'detalle', 'Deja de estar a liquidar'));
  ELSE
    v_bruto := round(COALESCE(v_pt.gross_amount, 0), 2);
    v_neto  := round(LEAST(GREATEST(COALESCE(v_pt.net_amount, v_bruto), 0), v_bruto), 2);
    v_plat  := round(LEAST(GREATEST(COALESCE(v_pt.platform_fee, 0), 0), v_bruto - v_neto), 2);
    v_proc  := round(v_bruto - v_neto - v_plat, 2);
    v_lineas := jsonb_build_array(
      jsonb_build_object('cuenta', '1.1.03', 'haber', v_bruto, 'detalle', 'Deja de estar a liquidar'));
    IF v_neto > 0 THEN
      v_lineas := v_lineas || jsonb_build_array(jsonb_build_object(
        'cuenta', '1.1.04', 'debe', v_neto, 'detalle', 'Acreditado por Mercado Pago'));
    END IF;
    IF v_proc > 0 THEN
      v_lineas := v_lineas || jsonb_build_array(jsonb_build_object(
        'cuenta', '5.2.01', 'debe', v_proc, 'detalle', 'Comisión retenida por Mercado Pago'));
    END IF;
    IF v_plat > 0 THEN
      v_lineas := v_lineas || jsonb_build_array(jsonb_build_object(
        'cuenta', '5.2.02', 'debe', v_plat, 'detalle', 'Comisión de plataforma'));
    END IF;
  END IF;

  -- No se acredita lo que nunca se asentó a liquidar.
  IF v_bruto <= 0 OR v_bruto > round(v_pendiente, 2) THEN
    RETURN NULL;
  END IF;

  PERFORM public.ledger_plan_default(v_pt.org_id);
  RETURN public.ledger_asentar(
    p_org := v_pt.org_id,
    p_descripcion := 'Acreditación de Mercado Pago',
    p_lineas := v_lineas,
    p_fecha := v_fecha,
    p_ref_tipo := 'liberacion',
    p_ref_id := v_pt.id);
END;
$fn$;

COMMENT ON FUNCTION public.wallet_acreditar_cobro(uuid) IS
  'Pasa a disponible un cobro online de Mercado Pago cuya fecha de liberación ya pasó, una sola vez. Función interna (cron).';
REVOKE ALL ON FUNCTION public.wallet_acreditar_cobro(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.wallet_acreditar_liberados()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_id uuid;
  v_n  integer := 0;
BEGIN
  FOR v_id IN
    SELECT pt.id FROM public.payment_transactions pt
     WHERE pt.status = 'approved' AND pt.source <> 'pos' AND pt.provider = 'mercadopago'
       AND COALESCE(pt.released_at::date, pt.expected_release_at) <= CURRENT_DATE
       AND COALESCE(pt.updated_at, pt.created_at) < now() - interval '1 hour'
       AND NOT EXISTS (
         SELECT 1 FROM public.ledger_entries e
          WHERE e.org_id = pt.org_id AND e.referencia_tipo = 'liberacion'
            AND e.referencia_id = pt.id AND e.anulado_por IS NULL AND e.anula_a IS NULL)
     ORDER BY COALESCE(pt.released_at::date, pt.expected_release_at), pt.created_at
  LOOP
    IF public.wallet_acreditar_cobro(v_id) IS NOT NULL THEN
      v_n := v_n + 1;
    END IF;
  END LOOP;
  RETURN v_n;
END;
$fn$;

COMMENT ON FUNCTION public.wallet_acreditar_liberados() IS
  'Acredita en la billetera los cobros de Mercado Pago ya liberados. La corre pg_cron cada hora.';
REVOKE ALL ON FUNCTION public.wallet_acreditar_liberados() FROM PUBLIC, anon, authenticated;

-- De qué está hecho lo pendiente. Corre con los permisos de quien la lee.
CREATE OR REPLACE VIEW public.wallet_pendiente
WITH (security_invoker = true) AS
SELECT pt.org_id,
       'mercado_pago'::text AS tipo,
       count(*)::int AS cobros,
       round(sum(pt.net_amount), 2) AS monto,
       min(COALESCE(pt.released_at::date, pt.expected_release_at)) AS proxima_fecha
FROM public.payment_transactions pt
WHERE pt.status = 'approved' AND pt.source <> 'pos' AND pt.provider = 'mercadopago'
  AND NOT EXISTS (
    SELECT 1 FROM public.ledger_entries e
     WHERE e.org_id = pt.org_id AND e.referencia_tipo = 'liberacion'
       AND e.referencia_id = pt.id AND e.anulado_por IS NULL AND e.anula_a IS NULL)
  AND public.has_permission(pt.org_id, 'finance', 'view')
GROUP BY pt.org_id
UNION ALL
SELECT pt.org_id,
       'por_conciliar'::text,
       count(*)::int,
       round(sum(pt.gross_amount), 2),
       NULL::date
FROM public.payment_transactions pt
WHERE pt.source = 'pos' AND pt.status = 'pending'
  AND public.has_permission(pt.org_id, 'finance', 'view')
GROUP BY pt.org_id;

COMMENT ON VIEW public.wallet_pendiente IS
  'Lo pendiente de la billetera por origen: cobros de Mercado Pago que se acreditan solos (con la próxima fecha) y cobros del mostrador que hay que conciliar. @revisada: security_invoker y finance.view.';
REVOKE ALL ON public.wallet_pendiente FROM PUBLIC, anon;
GRANT SELECT ON public.wallet_pendiente TO authenticated, service_role;

DO $$
BEGIN
  PERFORM cron.unschedule('billetera-acreditar-liberados')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'billetera-acreditar-liberados');
  PERFORM cron.schedule('billetera-acreditar-liberados', '41 * * * *', 'SELECT public.wallet_acreditar_liberados()');
END $$;

-- Lo que Mercado Pago ya liberó y la billetera seguía mostrando pendiente.
SELECT public.wallet_acreditar_liberados();

COMMIT;
