-- El asiento de venta separa el IVA del responsable inscripto (2026-10-30).
--
-- `ledger_asentar_venta` se cortaba para todo emisor que no fuera
-- monotributista («todavía no separa IVA»). Para un responsable inscripto eso
-- dejaba **todas sus ventas del local fuera del libro**: el resultado sólo veía
-- la tienda online (que sí separa IVA, por orden), y `operaciones_sin_asentar`
-- se llenaba de ventas que nadie veía, porque ninguna pantalla la mostraba.
--
-- La regla es la de `src/lib/fiscalIdentity.ts`: sólo el responsable
-- inscripto discrimina IVA; el monotributista y el exento facturan con IVA
-- cero. El precio de mostrador incluye el IVA, así que:
--     neto = total / (1 + alícuota/100)   → 4.1.01 Ventas (netas de IVA)
--     IVA  = total − neto                  → 2.1.02 IVA débito fiscal
-- con la alícuota que la venta guardó al crearse (`fiscal_tax_rate`, la del
-- producto o la del negocio). Una venta vieja sin alícuota no se adivina:
-- queda pendiente y dice por qué.
--
-- `ledger_asentar_pendientes` (owner o admin) asienta lo que había quedado
-- afuera —ventas y gastos— y devuelve cuántos pudo y por qué no los otros.
-- La pantalla «Libro y resultado» lo muestra y ofrece hacerlo.

BEGIN;

CREATE OR REPLACE FUNCTION public.ledger_asentar_venta(p_sale_id uuid)
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
    IF v_s.fiscal_tax_rate IS NULL THEN
      RAISE EXCEPTION 'La venta % no tiene alicuota de IVA registrada: no se puede separar el IVA', v_s.id;
    END IF;
    v_neto := ROUND(v_total / (1 + v_s.fiscal_tax_rate / 100), 2);
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
      'detalle', format('IVA débito fiscal %s%%', v_s.fiscal_tax_rate),
      'metadata', jsonb_build_object('sale_id', v_s.id, 'alicuota', v_s.fiscal_tax_rate)));
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
    p_descripcion := 'Venta' || COALESCE(' — ' || v_s.customer_name, ''),
    p_lineas      := v_lineas,
    p_fecha       := COALESCE(v_s.date::date, v_s.created_at::date),
    p_ref_tipo    := 'venta',
    p_ref_id      := v_s.id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.ledger_asentar_venta(uuid) FROM PUBLIC, anon, authenticated;

-- ── Asentar lo que quedó afuera ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ledger_asentar_pendientes(p_org uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_op record;
  v_ok integer := 0;
  v_fallas integer := 0;
  v_motivos jsonb := '{}'::jsonb;   -- motivo -> cantidad
  v_motivo text;
  v_quedan integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_org_role(p_org, auth.uid(), ARRAY['owner', 'admin']) THEN
    RAISE EXCEPTION 'Sólo el dueño o un administrador asienta en el libro' USING ERRCODE = '42501';
  END IF;
  PERFORM public.ledger_plan_default(p_org);

  -- De a 500 por vez: un negocio con años de ventas no traba la base.
  FOR v_op IN
    SELECT o.tipo, o.id FROM public.operaciones_sin_asentar o
     WHERE o.org_id = p_org
     ORDER BY o.fecha, o.id
     LIMIT 500
  LOOP
    BEGIN
      IF v_op.tipo = 'venta' THEN
        PERFORM public.ledger_asentar_venta(v_op.id);
      ELSE
        PERFORM public.ledger_asentar_gasto(v_op.id);
      END IF;
      v_ok := v_ok + 1;
    EXCEPTION WHEN OTHERS THEN
      v_fallas := v_fallas + 1;
      -- El motivo sin el id de cada operación: agrupa los que son lo mismo.
      v_motivo := left(regexp_replace(SQLERRM, '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', '…', 'g'), 200);
      v_motivos := jsonb_set(v_motivos, ARRAY[v_motivo], to_jsonb(COALESCE((v_motivos->>v_motivo)::int, 0) + 1));
    END;
  END LOOP;

  SELECT count(*) INTO v_quedan FROM public.operaciones_sin_asentar o WHERE o.org_id = p_org;
  RETURN jsonb_build_object('ok', true, 'asentadas', v_ok, 'fallidas', v_fallas, 'quedan', v_quedan, 'motivos', v_motivos);
END;
$fn$;
REVOKE ALL ON FUNCTION public.ledger_asentar_pendientes(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ledger_asentar_pendientes(uuid) TO authenticated;

WITH c(function_name, audience, rationale) AS (VALUES
  ('ledger_asentar_pendientes', 'authenticated_delegate', 'Owner/admin asienta las ventas y gastos que quedaron sin asiento; cada una con su regla, de a 500.')
)
INSERT INTO public.security_function_contracts(function_name, identity_arguments, audience, rationale, definition_hash, reviewed_on)
SELECT p.proname, pg_get_function_identity_arguments(p.oid), c.audience, c.rationale, md5(pg_get_functiondef(p.oid)), DATE '2026-10-30'
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN c ON c.function_name = p.proname
 WHERE n.nspname = 'public'
ON CONFLICT (function_name, identity_arguments) DO UPDATE
  SET audience = EXCLUDED.audience, rationale = EXCLUDED.rationale,
      definition_hash = EXCLUDED.definition_hash, reviewed_on = EXCLUDED.reviewed_on;

COMMIT;
