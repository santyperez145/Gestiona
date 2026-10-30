-- Ventas viejas sin alícuota: asentarlas con una alícuota que decide el dueño
-- (2026-10-30).
--
-- 20261030001100 asienta las ventas del responsable inscripto separando el
-- IVA con la alícuota que la venta guardó al crearse. Las anteriores a
-- 20261001000100 no la guardaron, y la base decidió no completarla con la
-- configuración de hoy («never backfilled from current product
-- configuration»): sin una decisión, quedarían fuera del libro para siempre.
--
-- `ledger_asentar_ventas_sin_alicuota` es esa decisión, explícita y del
-- dueño: usar la alícuota actual de cada producto cuando la tiene y, si no,
-- la que él indica (una de las de ARCA). Cada asiento anota que la alícuota
-- fue supuesta y de dónde salió, y la corrida queda en la auditoría. Es
-- contabilidad de gestión: el IVA que se declara sale del Libro IVA de las
-- facturas, no de este libro.
--
-- `ledger_asentar_venta` sigue igual por fuera: es la misma lógica con la
-- alícuota de la venta y sin suponer nada.

BEGIN;

CREATE OR REPLACE FUNCTION public.ledger_asentar_venta_con_alicuota(p_sale_id uuid, p_alicuota_supuesta numeric)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_s        public.sales;
  v_existing uuid;
  v_emisor   text;
  v_costo    numeric;
  v_lineas   jsonb := '[]'::jsonb;
  v_cuenta   text;
  v_cobros   jsonb := '{}'::jsonb;   -- cuenta -> importe
  v_sp       jsonb;
  v_monto    numeric;
  v_suma     numeric := 0;
  v_ultima   text;
  v_valido   boolean := false;
  v_c        record;
  v_total    numeric;
  v_neto     numeric;
  v_iva      numeric := 0;
  v_alicuota numeric;
  v_supuesta boolean := false;
BEGIN
  SELECT * INTO v_s FROM public.sales WHERE id = p_sale_id FOR UPDATE;
  IF v_s.id IS NULL THEN
    RAISE EXCEPTION 'La venta no existe';
  END IF;

  -- Idempotencia: mismo criterio que la liquidación.
  SELECT e.id INTO v_existing
    FROM public.ledger_entries e
   WHERE e.org_id = v_s.org_id
     AND e.referencia_tipo = 'venta'
     AND e.referencia_id = v_s.id
     AND e.anulado_por IS NULL AND e.anula_a IS NULL
   LIMIT 1;
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;

  IF COALESCE(v_s.total_ars, 0) <= 0 THEN
    RAISE EXCEPTION 'La venta % no tiene importe', v_s.id;
  END IF;
  v_total := ROUND(v_s.total_ars, 2);

  -- ¿Se discrimina IVA? Lo decide el emisor (fiscalIdentity.ts).
  SELECT st.afip_tipo_emisor INTO v_emisor
    FROM public.settings st WHERE st.org_id = v_s.org_id;
  v_emisor := lower(btrim(COALESCE(v_emisor, 'monotributo')));
  IF v_emisor IN ('monotributo', 'exento') THEN
    v_neto := v_total;
  ELSIF v_emisor = 'responsable_inscripto' THEN
    -- La alícuota de la venta manda; una supuesta sólo si la venta no la tiene.
    v_alicuota := v_s.fiscal_tax_rate;
    IF v_alicuota IS NULL AND p_alicuota_supuesta IS NOT NULL THEN
      v_alicuota := p_alicuota_supuesta;
      v_supuesta := true;
    END IF;
    IF v_alicuota IS NULL THEN
      RAISE EXCEPTION 'La venta % no tiene alicuota de IVA registrada: no se puede separar el IVA', v_s.id;
    END IF;
    v_neto := ROUND(v_total / (1 + v_alicuota / 100), 2);
    v_iva  := v_total - v_neto;
  ELSE
    RAISE EXCEPTION 'El tipo de emisor % no esta contemplado en el asiento de venta', v_emisor;
  END IF;

  -- Cobro dividido (la caja guarda en cada renglón su parte de cada medio):
  -- cada medio a su cuenta; el redondeo lo absorbe el último para que el
  -- asiento cuadre exacto. Una venta no cobrada es crédito entero.
  IF v_s.paid IS NOT FALSE AND COALESCE(v_s.payment_method, '') <> 'fiado'
     AND jsonb_typeof(v_s.split_payments) = 'array' AND jsonb_array_length(v_s.split_payments) > 0 THEN
    v_valido := true;
    FOR v_sp IN SELECT value FROM jsonb_array_elements(v_s.split_payments) LOOP
      BEGIN
        v_monto := ROUND((v_sp->>'amount')::numeric, 2);
      EXCEPTION WHEN OTHERS THEN
        v_monto := NULL;
      END;
      IF v_monto IS NULL OR v_monto < 0 THEN v_valido := false; EXIT; END IF;
      CONTINUE WHEN v_monto = 0;
      v_cuenta := public.cuenta_de_cobro(v_sp->>'method', true);
      v_cobros := jsonb_set(v_cobros, ARRAY[v_cuenta], to_jsonb(COALESCE((v_cobros->>v_cuenta)::numeric, 0) + v_monto));
      v_suma := v_suma + v_monto;
      v_ultima := v_cuenta;
    END LOOP;
    IF v_valido AND v_ultima IS NOT NULL AND abs(v_suma - v_total) <= GREATEST(1, 0.01 * v_total) THEN
      v_cobros := jsonb_set(v_cobros, ARRAY[v_ultima], to_jsonb((v_cobros->>v_ultima)::numeric + v_total - v_suma));
    ELSE
      v_valido := false;
    END IF;
  END IF;

  IF v_valido THEN
    FOR v_c IN SELECT key AS cuenta, value::numeric AS importe FROM jsonb_each_text(v_cobros) WHERE value::numeric <> 0 ORDER BY key LOOP
      v_lineas := v_lineas || jsonb_build_array(jsonb_build_object(
        'cuenta', v_c.cuenta, 'debe', v_c.importe,
        'detalle', 'Cobro de venta (dividido)',
        'metadata', jsonb_build_object('sale_id', v_s.id, 'split_payments', v_s.split_payments)));
    END LOOP;
  ELSE
    v_cuenta := public.cuenta_de_cobro(v_s.payment_method, v_s.paid);
    v_lineas := jsonb_build_array(jsonb_build_object(
      'cuenta', v_cuenta, 'debe', v_total,
      'detalle', 'Cobro de venta (' || COALESCE(v_s.payment_method, 'sin medio') || ')',
      'metadata', jsonb_build_object('sale_id', v_s.id, 'payment_method', v_s.payment_method)));
  END IF;

  v_lineas := v_lineas || jsonb_build_array(
    jsonb_build_object('cuenta', '4.1.01', 'haber', v_neto, 'detalle', COALESCE(v_s.product_name, 'Venta')));
  IF v_iva > 0 THEN
    v_lineas := v_lineas || jsonb_build_array(jsonb_build_object(
      'cuenta', '2.1.02', 'haber', v_iva,
      'detalle', format('IVA débito fiscal %s%%%s', v_alicuota, CASE WHEN v_supuesta THEN ' (alícuota supuesta)' ELSE '' END),
      'metadata', jsonb_build_object('sale_id', v_s.id, 'alicuota', v_alicuota, 'alicuota_supuesta', v_supuesta)));
  END IF;

  -- El costo sólo se asienta si se conoce. Una venta sin costo NO se asienta
  -- con costo cero: eso pondría margen 100% en el libro.
  v_costo := ROUND(COALESCE(v_s.cost_of_goods_ars, 0), 2);
  IF v_costo > 0 THEN
    v_lineas := v_lineas || jsonb_build_array(
      jsonb_build_object('cuenta', '5.1.01', 'debe', v_costo, 'detalle', 'Costo de lo vendido'),
      jsonb_build_object('cuenta', '1.3.01', 'haber', v_costo, 'detalle', 'Salida de mercaderia')
    );
  END IF;

  RETURN public.ledger_asentar(
    p_org         := v_s.org_id,
    p_descripcion := 'Venta' || COALESCE(' — ' || v_s.customer_name, '') || CASE WHEN v_supuesta THEN ' (alícuota supuesta)' ELSE '' END,
    p_lineas      := v_lineas,
    p_fecha       := COALESCE(v_s.date::date, v_s.created_at::date),
    p_ref_tipo    := 'venta',
    p_ref_id      := v_s.id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.ledger_asentar_venta_con_alicuota(uuid, numeric) FROM PUBLIC, anon, authenticated;

-- La de siempre: la alícuota de la venta, sin suponer nada.
CREATE OR REPLACE FUNCTION public.ledger_asentar_venta(p_sale_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
  RETURN public.ledger_asentar_venta_con_alicuota(p_sale_id, NULL);
END;
$fn$;
REVOKE ALL ON FUNCTION public.ledger_asentar_venta(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.ledger_asentar_ventas_sin_alicuota(p_org uuid, p_alicuota numeric, p_usar_la_del_producto boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_v record;
  v_ok integer := 0;
  v_fallas integer := 0;
  v_motivos jsonb := '{}'::jsonb;
  v_motivo text;
  v_quedan integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_org_role(p_org, auth.uid(), ARRAY['owner']) THEN
    RAISE EXCEPTION 'Suponer la alícuota de ventas viejas lo decide el dueño del negocio' USING ERRCODE = '42501';
  END IF;
  IF p_alicuota IS NULL OR p_alicuota NOT IN (0, 2.5, 5, 10.5, 21, 27) THEN
    RAISE EXCEPTION 'La alícuota tiene que ser una de ARCA: 0, 2,5, 5, 10,5, 21 o 27' USING ERRCODE = '22023';
  END IF;
  PERFORM public.ledger_plan_default(p_org);

  FOR v_v IN
    SELECT s.id, CASE WHEN p_usar_la_del_producto THEN COALESCE(p.tax_rate, p_alicuota) ELSE p_alicuota END AS alicuota
      FROM public.operaciones_sin_asentar o
      JOIN public.sales s ON s.id = o.id
      LEFT JOIN public.products p ON p.id = s.product_id AND p.org_id = s.org_id
     WHERE o.org_id = p_org AND o.tipo = 'venta' AND s.fiscal_tax_rate IS NULL
     ORDER BY o.fecha, o.id
     LIMIT 500
  LOOP
    BEGIN
      PERFORM public.ledger_asentar_venta_con_alicuota(v_v.id, v_v.alicuota);
      v_ok := v_ok + 1;
    EXCEPTION WHEN OTHERS THEN
      v_fallas := v_fallas + 1;
      v_motivo := left(regexp_replace(SQLERRM, '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', '…', 'g'), 200);
      v_motivos := jsonb_set(v_motivos, ARRAY[v_motivo], to_jsonb(COALESCE((v_motivos->>v_motivo)::int, 0) + 1));
    END;
  END LOOP;

  IF v_ok > 0 THEN
    INSERT INTO public.audit_logs (user_id, org_id, action, entity_type, entity_id, details)
    VALUES (auth.uid(), p_org, 'ledger_supposed_vat', 'ledger', NULL,
            jsonb_build_object('asentadas', v_ok, 'alicuota', p_alicuota, 'usar_la_del_producto', p_usar_la_del_producto,
                               'motivo', 'ventas anteriores a que cada venta guardara su alícuota'));
  END IF;
  SELECT count(*) INTO v_quedan FROM public.operaciones_sin_asentar o WHERE o.org_id = p_org;
  RETURN jsonb_build_object('ok', true, 'asentadas', v_ok, 'fallidas', v_fallas, 'quedan', v_quedan, 'motivos', v_motivos);
END;
$fn$;
REVOKE ALL ON FUNCTION public.ledger_asentar_ventas_sin_alicuota(uuid, numeric, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ledger_asentar_ventas_sin_alicuota(uuid, numeric, boolean) TO authenticated;

WITH c(function_name, audience, rationale) AS (VALUES
  ('ledger_asentar_ventas_sin_alicuota', 'authenticated_delegate', 'Sólo el dueño asienta ventas viejas sin alícuota con la del producto o una de ARCA que indica; queda anotado como supuesta y en la auditoría.')
)
INSERT INTO public.security_function_contracts(function_name, identity_arguments, audience, rationale, definition_hash, reviewed_on)
SELECT p.proname, pg_get_function_identity_arguments(p.oid), c.audience, c.rationale, md5(pg_get_functiondef(p.oid)), DATE '2026-10-30'
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN c ON c.function_name = p.proname
 WHERE n.nspname = 'public'
ON CONFLICT (function_name, identity_arguments) DO UPDATE
  SET audience = EXCLUDED.audience, rationale = EXCLUDED.rationale,
      definition_hash = EXCLUDED.definition_hash, reviewed_on = EXCLUDED.reviewed_on;

COMMIT;
