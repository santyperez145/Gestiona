-- F2 / evidencia de cobro del POS.
--
-- El POS ya persistia el medio y los pagos divididos en `sales`, pero no
-- creaba `payment_transactions`. El margen no podia distinguir "efectivo sin
-- arancel" de "no se midio el arancel", y una tarjeta no tenia un lugar donde
-- conciliar el descuento real del adquirente.
--
-- Esta migracion cierra el circuito hacia adelante:
--   1. la venta y sus snapshots de cobro nacen en la misma transaccion;
--   2. efectivo/transferencia quedan aprobados con costo cero explicito;
--   3. debito/credito quedan pendientes hasta cargar la liquidacion real;
--   4. un split no se considera medido mientras quede una parte pendiente;
--   5. al conciliar, el neto y el asiento los calcula la base.
--
-- `mayorista` no se trata como medio de cobro: hoy es una modalidad comercial
-- metida en el selector de pagos. Inventarle proveedor o arancel seria peor
-- que conservar `comision_cobro` como faltante.

-- `create_sales_transaction_v2` ya agregaba estas dos claves al JSON, pero
-- `jsonb_populate_record(NULL::sales, ...)` descartaba campos que no existian
-- en la tabla. El comentario decia "queda registrado" y no era verdad.
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS precio_autoritativo numeric(14,4),
  ADD COLUMN IF NOT EXISTS override_de_precio boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.sales.precio_autoritativo IS
  'Precio unitario calculado por la base antes del override legitimo del cajero. Snapshot historico; no se reconstruye con el producto actual.';
COMMENT ON COLUMN public.sales.override_de_precio IS
  'True cuando el precio final pedido por el POS difirio del precio vigente calculado por el servidor.';

CREATE UNIQUE INDEX IF NOT EXISTS payment_transactions_pos_part_unique
  ON public.payment_transactions (source_id, provider, method)
  WHERE source = 'pos' AND source_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.pos_payment_method_codes(p_sale_method text)
RETURNS TABLE (
  provider text,
  method text,
  requires_settlement boolean
)
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $function$
  SELECT
    CASE lower(btrim(COALESCE(p_sale_method, '')))
      WHEN 'efectivo' THEN 'efectivo'
      WHEN 'cash' THEN 'efectivo'
      WHEN 'transferencia' THEN 'transferencia'
      WHEN 'deposito' THEN 'transferencia'
      WHEN 'debito' THEN 'otro'
      WHEN 'credito' THEN 'otro'
      WHEN 'tarjeta' THEN 'otro'
      WHEN 'qr' THEN 'otro'
      WHEN 'mercado_pago' THEN 'mercadopago'
      WHEN 'mercadopago' THEN 'mercadopago'
      WHEN 'modo' THEN 'modo'
      ELSE 'otro'
    END,
    CASE lower(btrim(COALESCE(p_sale_method, '')))
      WHEN 'efectivo' THEN 'cash'
      WHEN 'cash' THEN 'cash'
      WHEN 'transferencia' THEN 'transfer'
      WHEN 'deposito' THEN 'transfer'
      WHEN 'debito' THEN 'debit'
      WHEN 'credito' THEN 'credit'
      WHEN 'tarjeta' THEN 'credit'
      WHEN 'qr' THEN 'wallet'
      WHEN 'mercado_pago' THEN 'wallet'
      WHEN 'mercadopago' THEN 'wallet'
      WHEN 'modo' THEN 'wallet'
      ELSE 'default'
    END,
    lower(btrim(COALESCE(p_sale_method, ''))) NOT IN (
      'efectivo', 'cash', 'transferencia', 'deposito'
    );
$function$;

COMMENT ON FUNCTION public.pos_payment_method_codes(text) IS
  'Traduce el vocabulario del POS al ledger de cobros. Efectivo/transferencia son evidencia cero; tarjeta/billetera requieren liquidacion.';

REVOKE ALL ON FUNCTION public.pos_payment_method_codes(text)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.capture_pos_payment_transactions(
  p_org_id uuid,
  p_transaction_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_part record;
  v_provider text;
  v_method text;
  v_requires_settlement boolean;
  v_platform_fee numeric;
  v_inserted integer := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.sale_transactions transaction
    WHERE transaction.id = p_transaction_id
      AND transaction.org_id = p_org_id
      AND transaction.source = 'pos'
  ) THEN
    RAISE EXCEPTION 'La transaccion POS no existe en esta organizacion';
  END IF;

  FOR v_part IN
    WITH payment_parts AS (
      SELECT
        lower(btrim(part.value->>'method')) AS sale_method,
        round(CASE
          WHEN COALESCE(part.value->>'amount', '') ~ '^-?[0-9]+([.][0-9]+)?$'
            THEN (part.value->>'amount')::numeric
          ELSE 0
        END, 2) AS gross_amount
      FROM public.sales sale
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(sale.split_payments) = 'array'
          THEN sale.split_payments ELSE '[]'::jsonb END
      ) part(value)
      WHERE sale.org_id = p_org_id
        AND sale.sale_transaction_id = p_transaction_id
        AND sale.paid

      UNION ALL

      SELECT
        lower(btrim(sale.payment_method)) AS sale_method,
        round(COALESCE(sale.total_ars, 0), 2) AS gross_amount
      FROM public.sales sale
      WHERE sale.org_id = p_org_id
        AND sale.sale_transaction_id = p_transaction_id
        AND sale.paid
        AND (
          jsonb_array_length(
            CASE WHEN jsonb_typeof(sale.split_payments) = 'array'
              THEN sale.split_payments ELSE '[]'::jsonb END
          ) = 0
        )
    )
    SELECT sale_method, round(sum(gross_amount), 2) AS gross_amount
    FROM payment_parts
    WHERE sale_method NOT IN ('', 'fiado', 'cuenta_corriente', 'mayorista')
    GROUP BY sale_method
    HAVING round(sum(gross_amount), 2) > 0
  LOOP
    SELECT codes.provider, codes.method, codes.requires_settlement
    INTO v_provider, v_method, v_requires_settlement
    FROM public.pos_payment_method_codes(v_part.sale_method) codes;

    -- La comision de plataforma solo se calcula para cobros digitales: ahi el
    -- procesador puede retenerla. En efectivo/transferencia registrarla como
    -- descontada inventaria una custodia que Gestiona no hizo.
    v_platform_fee := CASE
      WHEN v_requires_settlement
        THEN public.platform_commission_amount(p_org_id, v_part.gross_amount, 'pos')
      ELSE 0
    END;

    INSERT INTO public.payment_transactions (
      org_id, source, source_id, provider, method, installments,
      gross_amount, provider_fee, provider_fee_iva, platform_fee, net_amount,
      currency, status, expected_release_at, released_at, correlation_id, raw
    ) VALUES (
      p_org_id, 'pos', p_transaction_id, v_provider, v_method, 0,
      v_part.gross_amount, 0, 0, v_platform_fee,
      round(v_part.gross_amount - v_platform_fee, 2),
      'ARS', CASE WHEN v_requires_settlement THEN 'pending' ELSE 'approved' END,
      CASE WHEN v_requires_settlement THEN NULL ELSE CURRENT_DATE END,
      CASE WHEN v_requires_settlement THEN NULL ELSE now() END,
      p_transaction_id,
      jsonb_build_object(
        'sale_method', v_part.sale_method,
        'fee_evidence', CASE
          WHEN v_requires_settlement THEN 'awaiting_actual_settlement'
          ELSE 'non_fee_payment_method'
        END,
        'captured_by', 'create_sales_transaction_v3'
      )
    )
    ON CONFLICT DO NOTHING;

    v_inserted := v_inserted + CASE WHEN FOUND THEN 1 ELSE 0 END;
  END LOOP;

  RETURN jsonb_build_object(
    'inserted', v_inserted,
    'parts', (
      SELECT count(*)
      FROM public.payment_transactions payment
      WHERE payment.org_id = p_org_id
        AND payment.source = 'pos'
        AND payment.source_id = p_transaction_id
    ),
    'pending', (
      SELECT count(*)
      FROM public.payment_transactions payment
      WHERE payment.org_id = p_org_id
        AND payment.source = 'pos'
        AND payment.source_id = p_transaction_id
        AND payment.status = 'pending'
    )
  );
END;
$function$;

COMMENT ON FUNCTION public.capture_pos_payment_transactions(uuid, uuid) IS
  'Crea evidencia idempotente por parte de cobro POS. Funcion interna: el navegador no puede fabricar liquidaciones.';

REVOKE ALL ON FUNCTION public.capture_pos_payment_transactions(uuid, uuid)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_sales_transaction_v3(
  p_org_id uuid,
  p_sales jsonb,
  p_source text DEFAULT 'pos'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_result jsonb;
  v_transaction_id uuid;
  v_payments jsonb;
BEGIN
  -- v2 conserva la autoridad de precio/costo/ganancia y la transaccion de
  -- stock. Este wrapper solo agrega evidencia de cobro en el mismo commit.
  v_result := public.create_sales_transaction_v2(p_org_id, p_sales, p_source);
  v_transaction_id := NULLIF(v_result->>'transaction_id', '')::uuid;

  IF lower(btrim(COALESCE(p_source, 'pos'))) = 'pos' THEN
    v_payments := public.capture_pos_payment_transactions(p_org_id, v_transaction_id);
  ELSE
    v_payments := jsonb_build_object('inserted', 0, 'parts', 0, 'pending', 0);
  END IF;

  RETURN v_result || jsonb_build_object('payment_evidence', v_payments);
END;
$function$;

COMMENT ON FUNCTION public.create_sales_transaction_v3(uuid, jsonb, text) IS
  'Venta autoritativa v2 + snapshots conciliables del cobro POS, atomicos e idempotentes.';

REVOKE ALL ON FUNCTION public.create_sales_transaction_v3(uuid, jsonb, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_sales_transaction_v3(uuid, jsonb, text)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.ledger_asentar_liquidacion_pos(
  p_payment_transaction_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_payment public.payment_transactions;
  v_existing uuid;
  v_provider_cost numeric;
  v_lines jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO v_payment
  FROM public.payment_transactions payment
  WHERE payment.id = p_payment_transaction_id
    AND payment.source = 'pos'
  FOR UPDATE;

  IF v_payment.id IS NULL OR v_payment.status <> 'approved' THEN
    RAISE EXCEPTION 'La liquidacion POS no esta aprobada';
  END IF;

  SELECT entry.id INTO v_existing
  FROM public.ledger_entries entry
  WHERE entry.org_id = v_payment.org_id
    AND entry.referencia_tipo = 'liquidacion_pos'
    AND entry.referencia_id = v_payment.id
    AND entry.anulado_por IS NULL
    AND entry.anula_a IS NULL
  LIMIT 1;
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;

  v_provider_cost := round(v_payment.provider_fee + v_payment.provider_fee_iva, 2);

  IF v_payment.net_amount > 0 THEN
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'cuenta', '1.1.02', 'debe', v_payment.net_amount,
      'detalle', 'Neto acreditado por cobro POS'));
  END IF;
  IF v_provider_cost > 0 THEN
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'cuenta', '5.2.01', 'debe', v_provider_cost,
      'detalle', 'Arancel real del cobro POS'));
  END IF;
  IF v_payment.platform_fee > 0 THEN
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'cuenta', '5.2.02', 'debe', v_payment.platform_fee,
      'detalle', 'Comision de plataforma del cobro POS'));
  END IF;
  v_lines := v_lines || jsonb_build_array(jsonb_build_object(
    'cuenta', '1.1.03', 'haber', v_payment.gross_amount,
    'detalle', 'Cancelacion de valores POS a liquidar',
    'metadata', jsonb_build_object('payment_transaction_id', v_payment.id)));

  RETURN public.ledger_asentar(
    p_org := v_payment.org_id,
    p_descripcion := 'Liquidacion de cobro POS',
    p_lineas := v_lines,
    p_fecha := COALESCE(v_payment.released_at::date, CURRENT_DATE),
    p_ref_tipo := 'liquidacion_pos',
    p_ref_id := v_payment.id
  );
END;
$function$;

COMMENT ON FUNCTION public.ledger_asentar_liquidacion_pos(uuid) IS
  'Mueve valores a liquidar a banco y reconoce arancel/plataforma una sola vez. Funcion interna.';

REVOKE ALL ON FUNCTION public.ledger_asentar_liquidacion_pos(uuid)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.confirm_pos_payment_settlement(
  p_payment_transaction_id uuid,
  p_provider text,
  p_provider_fee numeric,
  p_provider_fee_iva numeric DEFAULT 0,
  p_provider_reference text DEFAULT NULL,
  p_released_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_payment public.payment_transactions;
  v_provider text := lower(btrim(COALESCE(p_provider, '')));
  v_net numeric;
  v_entry uuid;
BEGIN
  SELECT * INTO v_payment
  FROM public.payment_transactions payment
  WHERE payment.id = p_payment_transaction_id
  FOR UPDATE;

  IF v_payment.id IS NULL OR v_payment.source <> 'pos' THEN
    RAISE EXCEPTION 'El cobro POS no existe';
  END IF;
  IF auth.uid() IS NULL
     OR NOT public.has_permission(v_payment.org_id, 'payments', 'edit') THEN
    RAISE EXCEPTION 'No tenes permiso para conciliar cobros'
      USING ERRCODE = '42501';
  END IF;
  IF v_payment.status = 'approved' THEN
    RETURN jsonb_build_object(
      'ok', true, 'already_confirmed', true,
      'payment_transaction_id', v_payment.id,
      'net_amount', v_payment.net_amount
    );
  END IF;
  IF v_payment.status <> 'pending' THEN
    RAISE EXCEPTION 'El cobro esta en estado % y no se puede conciliar', v_payment.status;
  END IF;
  IF v_provider = '' OR (
    v_provider <> 'otro'
    AND NOT EXISTS (
      SELECT 1 FROM public.payment_providers provider
      WHERE provider.codigo = v_provider AND provider.is_active
    )
  ) THEN
    RAISE EXCEPTION 'Proveedor de cobro invalido';
  END IF;
  IF p_provider_fee IS NULL OR p_provider_fee < 0 OR p_provider_fee = 'NaN'::numeric
     OR p_provider_fee_iva IS NULL OR p_provider_fee_iva < 0
     OR p_provider_fee_iva = 'NaN'::numeric THEN
    RAISE EXCEPTION 'El arancel y su IVA deben ser importes validos no negativos';
  END IF;

  v_net := round(
    v_payment.gross_amount
    - p_provider_fee
    - p_provider_fee_iva
    - v_payment.platform_fee,
    2
  );
  IF v_net < 0 THEN
    RAISE EXCEPTION 'Los costos superan el importe bruto del cobro';
  END IF;

  UPDATE public.payment_transactions
  SET provider = v_provider,
      provider_fee = round(p_provider_fee, 2),
      provider_fee_iva = round(p_provider_fee_iva, 2),
      net_amount = v_net,
      status = 'approved',
      external_id = NULLIF(left(btrim(COALESCE(p_provider_reference, '')), 250), ''),
      released_at = COALESCE(p_released_at, now()),
      raw = COALESCE(raw, '{}'::jsonb) || jsonb_build_object(
        'fee_evidence', 'merchant_confirmed_actual_settlement',
        'confirmed_by', auth.uid(),
        'confirmed_at', now()
      )
  WHERE id = v_payment.id;

  v_entry := public.ledger_asentar_liquidacion_pos(v_payment.id);

  INSERT INTO public.audit_logs (
    user_id, org_id, action, entity_type, entity_id, details, severity, tags
  ) VALUES (
    auth.uid(), v_payment.org_id, 'confirm', 'payment_settlement', v_payment.id::text,
    jsonb_build_object(
      'gross_amount', v_payment.gross_amount,
      'provider', v_provider,
      'provider_fee', round(p_provider_fee, 2),
      'provider_fee_iva', round(p_provider_fee_iva, 2),
      'platform_fee', v_payment.platform_fee,
      'net_amount', v_net,
      'ledger_entry_id', v_entry
    ),
    'info', ARRAY['payments', 'settlement', 'pos']::text[]
  );

  RETURN jsonb_build_object(
    'ok', true,
    'already_confirmed', false,
    'payment_transaction_id', v_payment.id,
    'net_amount', v_net,
    'ledger_entry_id', v_entry
  );
END;
$function$;

COMMENT ON FUNCTION public.confirm_pos_payment_settlement(
  uuid, text, numeric, numeric, text, timestamptz
) IS
  'Confirma el arancel real de un cobro digital POS. Valida permiso payments.edit, calcula el neto, audita y asienta.';

REVOKE ALL ON FUNCTION public.confirm_pos_payment_settlement(
  uuid, text, numeric, numeric, text, timestamptz
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_pos_payment_settlement(
  uuid, text, numeric, numeric, text, timestamptz
) TO authenticated;

-- Un split con efectivo aprobado y tarjeta pendiente no puede presentar la
-- comision como cero. La vista efectiva bloquea el componente hasta que todas
-- las partes del ticket esten aprobadas.
CREATE OR REPLACE VIEW public._sale_margin_facts_effective
WITH (security_barrier = true)
AS
WITH unresolved_payment AS (
  SELECT payment.org_id, payment.source_id AS operation_id
  FROM public.payment_transactions payment
  WHERE payment.source = 'pos'
    AND payment.source_id IS NOT NULL
  GROUP BY payment.org_id, payment.source_id
  HAVING bool_or(payment.status <> 'approved')
), effective AS (
  SELECT
    source.*,
    unresolved.operation_id IS NOT NULL AS payment_pending,
    source.known_components - CASE
      WHEN unresolved.operation_id IS NOT NULL AND source.payment_fee_ars IS NOT NULL THEN 1
      ELSE 0
    END AS effective_known_components
  FROM public._sale_margin_facts_source source
  LEFT JOIN unresolved_payment unresolved
    ON unresolved.org_id = source.org_id
   AND unresolved.operation_id = source.operation_id
)
SELECT
  effective.sale_id,
  effective.org_id,
  effective.product_id,
  effective.product_name,
  effective.quantity,
  effective.sold_at,
  effective.recorded_source,
  effective.channel,
  effective.operation_type,
  effective.operation_id,
  effective.operation_key,
  effective.revenue_ars,
  effective.cogs_ars,
  effective.cogs_source,
  CASE WHEN effective.payment_pending THEN NULL ELSE effective.payment_fee_ars END
    AS payment_fee_ars,
  CASE WHEN effective.payment_pending THEN NULL ELSE effective.payment_fee_source END
    AS payment_fee_source,
  effective.shipping_cost_ars,
  effective.shipping_cost_source,
  effective.tax_ars,
  effective.tax_source,
  effective.gross_margin_ars,
  CASE
    WHEN effective.returned OR effective.returned_quantity > 0
      OR effective.payment_pending THEN NULL
    ELSE effective.contribution_margin_ars
  END AS contribution_margin_ars,
  effective.effective_known_components AS known_components,
  effective.effective_known_components * 25 AS coverage_pct,
  CASE
    WHEN effective.payment_pending
      AND NOT ('comision_cobro' = ANY(effective.missing_components))
      THEN array_append(effective.missing_components, 'comision_cobro')
    ELSE effective.missing_components
  END AS missing_components,
  effective.is_explainable
    AND NOT effective.returned
    AND effective.returned_quantity = 0
    AND NOT effective.payment_pending AS is_explainable,
  CASE
    WHEN effective.returned OR effective.returned_quantity > 0 THEN 'return_pending'
    WHEN effective.payment_pending THEN 'settlement_pending'
    ELSE effective.quality_status
  END AS quality_status,
  effective.returned,
  effective.returned_quantity,
  array_remove(ARRAY[
    CASE WHEN effective.returned OR effective.returned_quantity > 0
      THEN 'devolucion_neta' END,
    CASE WHEN effective.payment_pending THEN 'liquidacion_cobro' END
  ], NULL)::text[] AS margin_blockers
FROM effective;

REVOKE ALL ON TABLE public._sale_margin_facts_effective
  FROM PUBLIC, anon, authenticated;

-- La primera version del agregado de operaciones solo preguntaba "hay algun
-- blocker" y lo rotulaba siempre como devolucion. Conservamos el agregado
-- existente y corregimos el contrato efectivo con la evidencia real de cada
-- bloqueo.
CREATE OR REPLACE VIEW public._sale_margin_operations_effective
WITH (security_barrier = true)
AS
WITH unresolved_payment AS (
  SELECT payment.org_id, payment.source_id AS operation_id
  FROM public.payment_transactions payment
  WHERE payment.source = 'pos'
    AND payment.source_id IS NOT NULL
  GROUP BY payment.org_id, payment.source_id
  HAVING bool_or(payment.status <> 'approved')
)
SELECT
  operation.org_id,
  operation.operation_key,
  operation.operation_id,
  operation.operation_type,
  operation.operation_reference,
  operation.channel,
  operation.recorded_source,
  operation.sold_at,
  operation.line_count,
  operation.units,
  operation.revenue_ars,
  operation.cogs_ars,
  operation.payment_fee_ars,
  operation.shipping_cost_ars,
  operation.tax_ars,
  operation.contribution_margin_ars,
  operation.known_components,
  operation.coverage_pct,
  operation.missing_components,
  array_remove(ARRAY[
    CASE WHEN operation.returned_units > 0 THEN 'devolucion_neta' END,
    CASE WHEN unresolved.operation_id IS NOT NULL THEN 'liquidacion_cobro' END
  ], NULL)::text[] AS margin_blockers,
  operation.is_explainable,
  CASE
    WHEN operation.returned_units > 0 THEN 'return_pending'
    WHEN unresolved.operation_id IS NOT NULL THEN 'settlement_pending'
    ELSE operation.quality_status
  END AS quality_status,
  operation.cogs_sources,
  operation.payment_fee_sources,
  operation.shipping_sources,
  operation.tax_sources,
  operation.payment_methods,
  operation.payment_mix,
  operation.payment_mix_difference_ars,
  operation.has_promotion,
  operation.measured_discount_ars,
  operation.coupon_codes,
  operation.price_discount_lines,
  operation.promotion_missing_evidence,
  operation.promotion_evidence_status,
  operation.returned_units
FROM public._sale_margin_operations_source operation
LEFT JOIN unresolved_payment unresolved
  ON unresolved.org_id = operation.org_id
 AND unresolved.operation_id = operation.operation_id;

REVOKE ALL ON TABLE public._sale_margin_operations_effective
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE VIEW public.sale_margin_operations
WITH (security_barrier = true)
AS
SELECT operation.*
FROM public._sale_margin_operations_effective operation
WHERE public.is_org_member(operation.org_id, auth.uid());

REVOKE ALL ON TABLE public.sale_margin_operations FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.sale_margin_operations TO authenticated;

DO $guard$
BEGIN
  IF has_function_privilege(
       'anon', 'public.create_sales_transaction_v3(uuid,jsonb,text)', 'EXECUTE')
     OR has_function_privilege(
       'authenticated', 'public.capture_pos_payment_transactions(uuid,uuid)', 'EXECUTE')
     OR has_function_privilege(
       'authenticated', 'public.ledger_asentar_liquidacion_pos(uuid)', 'EXECUTE')
     OR has_table_privilege(
       'authenticated', 'public._sale_margin_operations_effective', 'SELECT')
     OR has_function_privilege(
       'anon', 'public.confirm_pos_payment_settlement(uuid,text,numeric,numeric,text,timestamptz)', 'EXECUTE')
     OR NOT has_function_privilege(
       'authenticated', 'public.create_sales_transaction_v3(uuid,jsonb,text)', 'EXECUTE')
     OR NOT has_function_privilege(
       'authenticated', 'public.confirm_pos_payment_settlement(uuid,text,numeric,numeric,text,timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION 'POS payment settlement privileges are unsafe';
  END IF;
END;
$guard$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260822000006', 'pos_payment_settlements')
ON CONFLICT DO NOTHING;
