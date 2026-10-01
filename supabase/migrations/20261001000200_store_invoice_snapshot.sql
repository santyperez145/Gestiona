-- Public storefront wrappers call these helpers as their owner, never as web RPCs.
REVOKE ALL ON FUNCTION public.resolve_store_line(uuid, uuid, uuid, integer, numeric)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_newsletter_consent_to_customer(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_newsletter_consent_to_customer(uuid, text) TO service_role;

-- Mirrors src/lib/rounding.ts: largest remainders, ties from the last line.
CREATE OR REPLACE FUNCTION public.prorratear(p_total numeric, p_pesos numeric[], p_moneda text DEFAULT 'ARS')
RETURNS numeric[] LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $$
DECLARE
  v_n integer := COALESCE(array_length(p_pesos, 1), 0);
  v_weights numeric[];
  v_sum numeric;
  v_factor numeric := power(10::numeric, public.decimales_de_moneda(p_moneda));
  v_units numeric;
  v_sign integer := CASE WHEN p_total < 0 THEN -1 ELSE 1 END;
  v_parts numeric[];
  v_assigned numeric := 0;
  v_remaining integer;
  v_i integer;
  v_rank record;
BEGIN
  IF v_n = 0 THEN RETURN '{}'; END IF;
  SELECT array_agg(CASE WHEN x IS NULL OR x::text IN ('NaN','Infinity','-Infinity') OR x <= 0 THEN 0 ELSE x END ORDER BY i)
    INTO v_weights FROM unnest(p_pesos) WITH ORDINALITY AS w(x, i);
  SELECT sum(x) INTO v_sum FROM unnest(v_weights) x;
  IF v_sum <= 0 THEN v_weights := array_fill(1::numeric, ARRAY[v_n]); v_sum := v_n; END IF;
  v_units := CASE WHEN p_total::text IN ('NaN','Infinity','-Infinity') THEN 0
    ELSE abs(public.redondear_moneda(p_total, p_moneda)) * v_factor END;
  v_parts := array_fill(0::numeric, ARRAY[v_n]);
  FOR v_i IN 1..v_n LOOP
    v_parts[v_i] := floor(v_units * v_weights[v_i] / v_sum);
    v_assigned := v_assigned + v_parts[v_i];
  END LOOP;
  v_remaining := (v_units - v_assigned)::integer;
  FOR v_rank IN SELECT i FROM unnest(v_weights) WITH ORDINALITY AS w(x, i)
    ORDER BY (v_units * x / v_sum - floor(v_units * x / v_sum)) DESC, i DESC
    LIMIT v_remaining
  LOOP
    v_parts[v_rank.i] := v_parts[v_rank.i] + 1;
  END LOOP;
  FOR v_i IN 1..v_n LOOP v_parts[v_i] := v_parts[v_i] / v_factor * v_sign; END LOOP;
  RETURN v_parts;
END;
$$;
COMMENT ON FUNCTION public.prorratear(numeric,numeric[],text) IS
  'Distributes currency units by largest remainder, ties from the last line. Preserves total and sign; zero weights never absorb rounding. Mirrors src/lib/rounding.ts.';

ALTER TABLE public.ecommerce_orders ADD COLUMN IF NOT EXISTS fiscal_snapshot jsonb;
COMMENT ON COLUMN public.ecommerce_orders.fiscal_snapshot IS
  'Server-captured order VAT lines after discounts, including shipping. NULL on historical orders; no inferred backfill. Not an authorized fiscal document.';

-- Direct inserts and checkout share the sequence; historical formats are not parsed.
CREATE OR REPLACE FUNCTION public.set_ecommerce_order_number()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  NEW.order_number := public.next_store_order_number();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.set_ecommerce_order_number() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.trg_iva_de_orden()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_emisor text;
  v_default_rate numeric;
  v_class_c boolean;
  v_ready boolean := true;
  v_reason text;
  v_item jsonb;
  v_line jsonb;
  v_weights numeric[] := '{}';
  v_rates numeric[] := '{}';
  v_allocated numeric[];
  v_lines jsonb := '[]'::jsonb;
  v_rate numeric;
  v_qty numeric;
  v_weight numeric;
  v_subtotal numeric := 0;
  v_gross numeric;
  v_shipping numeric := round(COALESCE(NEW.shipping_cost, 0), 2);
  v_net numeric := 0;
  v_vat numeric := 0;
  v_split jsonb;
  v_index integer := 0;
BEGIN
  SELECT COALESCE(a.tipo_emisor, s.afip_tipo_emisor), s.tax_iva_percent
  INTO v_emisor, v_default_rate FROM public.settings s
  LEFT JOIN public.afip_credentials a ON a.org_id = s.org_id WHERE s.org_id = NEW.org_id LIMIT 1;
  v_class_c := v_emisor IN ('monotributo', 'monotributista', 'exento');
  IF v_emisor IS NULL OR v_emisor NOT IN ('responsable_inscripto','monotributo','monotributista','exento') THEN
    v_ready := false; v_reason := 'Falta declarar la condicion frente al IVA del emisor';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(ARRAY[NEW.total, NEW.subtotal, NEW.discount_amount, NEW.shipping_cost]) amount
      WHERE amount IS NULL OR amount::text IN ('NaN','Infinity','-Infinity')) OR
    NEW.total < 0 OR v_shipping < 0 OR v_shipping > NEW.total OR
    round(NEW.subtotal - NEW.discount_amount + v_shipping, 2) <> round(NEW.total, 2) THEN
    RAISE EXCEPTION 'Los importes del pedido no coinciden' USING ERRCODE = 'check_violation';
  END IF;
  IF jsonb_typeof(NEW.items) IS DISTINCT FROM 'array' OR jsonb_array_length(NEW.items) = 0 THEN
    NEW.tax_amount := 0;
    NEW.fiscal_snapshot := jsonb_build_object('version', 1, 'status', 'requires_review',
      'reason', 'Falta el detalle de productos del pedido', 'issuer_tax_condition', v_emisor,
      'captured_at', now(), 'currency', 'ARS', 'gross', NEW.total, 'lines', '[]'::jsonb);
    RETURN NEW;
  END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(NEW.items) LOOP
    v_qty := (v_item->>'quantity')::numeric;
    v_weight := round(COALESCE((v_item->>'total')::numeric, (v_item->>'unit_price')::numeric * v_qty), 2);
    IF v_qty IS NULL OR v_qty <= 0 OR v_qty::text IN ('NaN','Infinity','-Infinity') OR
      v_weight IS NULL OR v_weight < 0 OR v_weight::text IN ('NaN','Infinity','-Infinity') THEN
      RAISE EXCEPTION 'El pedido tiene renglones invalidos' USING ERRCODE = 'check_violation';
    END IF;
    v_subtotal := v_subtotal + v_weight;
    v_weights := array_append(v_weights, v_weight);
    SELECT CASE WHEN v_class_c THEN 0 ELSE COALESCE(p.tax_rate, v_default_rate) END INTO v_rate
    FROM public.products p WHERE p.id = NULLIF(v_item->>'product_id', '')::uuid AND p.org_id = NEW.org_id;
    IF v_rate IS NULL OR v_rate NOT IN (0,2.5,5,10.5,21,27) THEN
      v_ready := false; v_reason := COALESCE(v_reason, 'Falta una alicuota de IVA valida en los productos');
      v_rate := NULL;
    END IF;
    v_rates := array_append(v_rates, v_rate);
  END LOOP;
  IF v_subtotal <> round(NEW.subtotal, 2) OR NEW.discount_amount < 0 OR NEW.discount_amount > NEW.subtotal THEN
    RAISE EXCEPTION 'El detalle de productos no coincide con el subtotal del pedido' USING ERRCODE = 'check_violation';
  END IF;
  v_allocated := public.prorratear(round(NEW.total - v_shipping, 2), v_weights, 'ARS');
  FOR v_item IN SELECT value FROM jsonb_array_elements(NEW.items) LOOP
    v_index := v_index + 1;
    v_rate := v_rates[v_index];
    v_gross := v_allocated[v_index];
    v_split := CASE WHEN v_rate IS NOT NULL THEN public.desglosar_iva(v_gross, v_rate, true) END;
    v_line := jsonb_build_object('kind', 'product', 'source_index', v_index,
      'product_id', v_item->>'product_id', 'variant_id', v_item->>'variant_id',
      'description', COALESCE(NULLIF(btrim(v_item->>'name'), ''), 'Producto'),
      'quantity', (v_item->>'quantity')::numeric, 'gross', v_gross,
      'discount', v_weights[v_index] - v_gross, 'tax_rate', v_rate,
      'net', (v_split->>'neto')::numeric, 'tax_amount', (v_split->>'iva')::numeric);
    v_lines := v_lines || jsonb_build_array(v_line);
    v_net := v_net + COALESCE((v_split->>'neto')::numeric, 0);
    v_vat := v_vat + COALESCE((v_split->>'iva')::numeric, 0);
  END LOOP;
  IF v_shipping > 0 THEN
    v_rate := CASE WHEN v_class_c THEN 0 ELSE v_default_rate END;
    IF v_rate IS NULL OR v_rate NOT IN (0,2.5,5,10.5,21,27) THEN
      v_ready := false; v_reason := COALESCE(v_reason, 'Falta una alicuota de IVA valida para el envio');
      v_rate := NULL;
    END IF;
    v_split := CASE WHEN v_rate IS NOT NULL THEN public.desglosar_iva(v_shipping, v_rate, true) END;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('kind', 'shipping', 'description', 'Envio',
      'quantity', 1, 'gross', v_shipping, 'discount', 0, 'tax_rate', v_rate,
      'net', (v_split->>'neto')::numeric, 'tax_amount', (v_split->>'iva')::numeric));
    v_net := v_net + COALESCE((v_split->>'neto')::numeric, 0);
    v_vat := v_vat + COALESCE((v_split->>'iva')::numeric, 0);
  END IF;
  NEW.tax_amount := CASE WHEN v_ready THEN v_vat ELSE 0 END;
  -- Caller-supplied snapshot/IVA is never an authority, including explicit nonzero IVA.
  NEW.fiscal_snapshot := jsonb_build_object('version', 1, 'status', CASE WHEN v_ready THEN 'ready' ELSE 'requires_review' END,
    'reason', v_reason, 'issuer_tax_condition', v_emisor, 'captured_at', now(), 'currency', 'ARS',
    'gross', round(NEW.total, 2), 'net', CASE WHEN v_ready THEN v_net END,
    'tax_amount', CASE WHEN v_ready THEN v_vat END, 'lines', v_lines);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.trg_iva_de_orden() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.guard_store_order_fiscal_snapshot()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.fiscal_snapshot IS DISTINCT FROM OLD.fiscal_snapshot OR
    (OLD.fiscal_snapshot IS NOT NULL AND (
      NEW.org_id IS DISTINCT FROM OLD.org_id OR NEW.store_id IS DISTINCT FROM OLD.store_id OR
      NEW.items IS DISTINCT FROM OLD.items OR NEW.total IS DISTINCT FROM OLD.total OR
      NEW.subtotal IS DISTINCT FROM OLD.subtotal OR NEW.discount_amount IS DISTINCT FROM OLD.discount_amount OR
      NEW.shipping_cost IS DISTINCT FROM OLD.shipping_cost OR NEW.tax_amount IS DISTINCT FROM OLD.tax_amount OR
      NEW.buyer_tax_condition IS DISTINCT FROM OLD.buyer_tax_condition OR
      NEW.buyer_doc_type IS DISTINCT FROM OLD.buyer_doc_type OR NEW.buyer_doc_number IS DISTINCT FROM OLD.buyer_doc_number OR
      NEW.buyer_business_name IS DISTINCT FROM OLD.buyer_business_name OR
      NEW.comprobante_tipo_afip IS DISTINCT FROM OLD.comprobante_tipo_afip OR
      NEW.comprobante_letra IS DISTINCT FROM OLD.comprobante_letra OR
      NEW.billing_address IS DISTINCT FROM OLD.billing_address OR NEW.customer_name IS DISTINCT FROM OLD.customer_name
    )) THEN
    RAISE EXCEPTION 'Los importes y el detalle fiscal del pedido no se pueden reescribir; requieren revision fiscal'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_guard_store_order_fiscal_snapshot ON public.ecommerce_orders;
CREATE TRIGGER trg_guard_store_order_fiscal_snapshot BEFORE UPDATE ON public.ecommerce_orders
FOR EACH ROW EXECUTE FUNCTION public.guard_store_order_fiscal_snapshot();
REVOKE ALL ON FUNCTION public.guard_store_order_fiscal_snapshot() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.snapshot_sale_tax_rate()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.fiscal_tax_rate IS DISTINCT FROM OLD.fiscal_tax_rate THEN
      RAISE EXCEPTION 'La alicuota registrada de la venta no se puede modificar';
    END IF;
    IF NEW.org_id IS DISTINCT FROM OLD.org_id THEN RAISE EXCEPTION 'La venta no puede cambiar de organizacion'; END IF;
    IF NEW.product_id IS NOT DISTINCT FROM OLD.product_id THEN RETURN NEW; END IF;
    IF OLD.invoice_id IS NOT NULL THEN RAISE EXCEPTION 'Una venta facturada no puede cambiar de producto'; END IF;
  END IF;
  IF NEW.ecommerce_order_id IS NOT NULL THEN
    SELECT (line->>'tax_rate')::numeric INTO NEW.fiscal_tax_rate
    FROM public.ecommerce_orders o CROSS JOIN LATERAL jsonb_array_elements(o.fiscal_snapshot->'lines') line
    WHERE o.id = NEW.ecommerce_order_id AND o.org_id = NEW.org_id
      AND o.fiscal_snapshot->>'status' = 'ready' AND line->>'kind' = 'product'
      AND (line->>'product_id')::uuid = NEW.product_id LIMIT 1;
  ELSE
    SELECT COALESCE(p.tax_rate, s.tax_iva_percent) INTO NEW.fiscal_tax_rate
    FROM public.settings s LEFT JOIN public.products p ON p.id = NEW.product_id AND p.org_id = NEW.org_id
    WHERE s.org_id = NEW.org_id LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.snapshot_sale_tax_rate() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.facturar_orden_pagada(p_evento jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_org uuid := NULLIF(p_evento->>'org_id', '')::uuid;
  v_order_id uuid := NULLIF(p_evento#>>'{data,order_id}', '')::uuid;
  v_order public.ecommerce_orders%ROWTYPE;
  v_existing uuid;
  v_emisor text;
  v_cbte jsonb;
  v_snapshot jsonb;
  v_lines jsonb;
  v_net numeric;
  v_vat numeric;
  v_gross numeric;
  v_rate numeric;
  v_id uuid;
  v_number text;
BEGIN
  IF v_org IS NULL OR v_order_id IS NULL THEN RAISE EXCEPTION 'El evento no identifica el pedido y su organizacion'; END IF;
  SELECT * INTO v_order FROM public.ecommerce_orders WHERE id = v_order_id AND org_id = v_org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'El pedido no existe en esta organizacion'; END IF;
  SELECT id INTO v_existing FROM public.invoices WHERE ecommerce_order_id = v_order_id AND org_id = v_org;
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;
  IF v_order.payment_status <> 'paid' THEN RAISE EXCEPTION 'El pedido todavia no tiene un cobro confirmado'; END IF;
  IF v_order.total <= 0 THEN RETURN NULL; END IF;
  v_snapshot := v_order.fiscal_snapshot;
  IF v_snapshot IS NULL OR v_snapshot->>'version' IS DISTINCT FROM '1' OR v_snapshot->>'status' IS DISTINCT FROM 'ready' THEN
    RAISE EXCEPTION 'El pedido necesita revision fiscal: %',
      COALESCE(v_snapshot->>'reason', 'no tiene un desglose historico de IVA; no se reconstruye desde el catalogo actual');
  END IF;
  SELECT COALESCE(a.tipo_emisor, s.afip_tipo_emisor) INTO v_emisor
  FROM public.settings s LEFT JOIN public.afip_credentials a ON a.org_id = s.org_id WHERE s.org_id = v_org LIMIT 1;
  IF v_emisor IS NULL OR v_emisor NOT IN ('responsable_inscripto','monotributo','monotributista','exento') THEN
    RAISE EXCEPTION 'Falta declarar la condicion frente al IVA del emisor';
  END IF;
  IF public.discrimina_iva(v_emisor) IS DISTINCT FROM public.discrimina_iva(v_snapshot->>'issuer_tax_condition') THEN
    RAISE EXCEPTION 'Cambio la condicion frente al IVA del emisor; el pedido necesita revision fiscal';
  END IF;
  v_cbte := public.tipo_de_comprobante(v_emisor, v_order.buyer_tax_condition);
  v_lines := v_snapshot->'lines';
  IF jsonb_typeof(v_lines) IS DISTINCT FROM 'array' OR jsonb_array_length(v_lines) = 0 THEN
    RAISE EXCEPTION 'El pedido no tiene renglones fiscales';
  END IF;
  SELECT sum((line->>'net')::numeric), sum((line->>'tax_amount')::numeric), sum((line->>'gross')::numeric),
    CASE WHEN count(DISTINCT (line->>'tax_rate')::numeric) = 1 THEN min((line->>'tax_rate')::numeric) ELSE 0 END
    INTO v_net, v_vat, v_gross, v_rate FROM jsonb_array_elements(v_lines) line;
  IF v_net IS NULL OR v_vat IS NULL OR v_gross IS NULL OR v_gross <> round(v_order.total, 2)
    OR v_net + v_vat <> v_gross OR v_vat <> round(v_order.tax_amount, 2) THEN
    RAISE EXCEPTION 'El desglose fiscal no coincide con el total cobrado del pedido';
  END IF;
  v_number := public.siguiente_numero_factura(v_org);
  INSERT INTO public.invoices (org_id, number, ecommerce_order_id, customer_name, customer_email, customer_tax_id,
    customer_address, issue_date, due_date, status, currency, subtotal, tax_pct, tax_amount, total,
    tipo_comprobante, condicion_iva_receptor, afip_status, notes)
  VALUES (v_org, v_number, v_order_id,
    COALESCE(NULLIF(btrim(v_order.buyer_business_name), ''), NULLIF(btrim(v_order.customer_name), ''), 'Consumidor final'),
    v_order.customer_email, NULLIF(v_order.buyer_doc_number, ''),
    NULLIF(concat_ws(', ', NULLIF(v_order.billing_address->>'calle', ''), NULLIF(v_order.billing_address->>'ciudad', ''),
      NULLIF(v_order.billing_address->>'provincia', ''), NULLIF(v_order.billing_address->>'cp', '')), ''),
    CURRENT_DATE, CURRENT_DATE, 'draft', 'ARS', v_net, v_rate, v_vat, v_gross,
    (v_cbte->>'codigo_afip')::integer, public.condicion_iva_codigo(v_order.buyer_tax_condition), 'pending',
    'Generada desde el detalle fiscal del pedido ' || v_order.order_number) RETURNING id INTO v_id;
  INSERT INTO public.invoice_items(invoice_id, description, quantity, unit_price, total, tax_rate, tax_amount)
  SELECT v_id, line->>'description', (line->>'quantity')::numeric,
    (line->>'net')::numeric / (line->>'quantity')::numeric,
    (line->>'net')::numeric, (line->>'tax_rate')::numeric, (line->>'tax_amount')::numeric
  FROM jsonb_array_elements(v_lines) line;
  PERFORM public.invoice_iva_groups(v_id);
  UPDATE public.sales SET invoice_id = v_id WHERE ecommerce_order_id = v_order_id AND org_id = v_org;
  PERFORM public.emitir_evento(v_org, 'factura', v_id, 'factura.creada',
    jsonb_build_object('invoice_id', v_id, 'order_id', v_order_id, 'numero', v_number,
      'tipo', v_cbte->>'letra', 'total', v_gross));
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.facturar_orden_pagada(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.facturar_orden_pagada(jsonb) TO service_role;

CREATE OR REPLACE VIEW public.ordenes_sin_facturar AS
SELECT o.org_id, o.id AS order_id, o.order_number, o.customer_name, o.total, o.created_at,
  EXTRACT(day FROM now() - o.created_at)::integer AS dias,
  CASE WHEN o.fiscal_snapshot IS NULL THEN 'requiere revision fiscal del pedido historico'
    WHEN o.fiscal_snapshot->>'status' IS DISTINCT FROM 'ready' THEN COALESCE(o.fiscal_snapshot->>'reason', 'requiere revision fiscal')
    WHEN COALESCE(a.tipo_emisor, s.afip_tipo_emisor) IS NULL
      THEN 'falta declarar la condicion frente al IVA del emisor'
    WHEN public.discrimina_iva(COALESCE(a.tipo_emisor, s.afip_tipo_emisor))
      IS DISTINCT FROM public.discrimina_iva(o.fiscal_snapshot->>'issuer_tax_condition')
      THEN 'cambio la condicion frente al IVA del emisor; requiere revision fiscal'
    WHEN o.total <= 0 THEN 'la orden es de importe cero'
    ELSE 'pendiente de facturar' END AS motivo
FROM public.ecommerce_orders o
LEFT JOIN public.settings s ON s.org_id = o.org_id
LEFT JOIN public.afip_credentials a ON a.org_id = o.org_id
WHERE o.payment_status = 'paid'
  AND NOT EXISTS (SELECT 1 FROM public.invoices i WHERE i.ecommerce_order_id = o.id)
  AND public.is_org_member(o.org_id, auth.uid());
GRANT SELECT ON public.ordenes_sin_facturar TO authenticated;
NOTIFY pgrst, 'reload schema';
