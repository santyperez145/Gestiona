-- El POS cobra un ticket. Facturar ese ticket en ARCA es un paso aparte.
--
-- Ventas y Clientes ya podían abrir `/facturas?from_sale=`. El mostrador no:
-- `facturar_pendientes` / `facturar_orden_pagada` cubren órdenes de tienda,
-- y `invoices.sale_id` apunta a una línea, no al ticket (`sale_transactions`).
-- Dos facturas por un mismo cobro es un problema fiscal; por eso el id del
-- ticket es la llave, no la primera línea.
--
-- ⚠️ Esta función NO llama a ARCA. Crea el borrador, igual que
-- `facturar_orden_pagada`. El CAE lo pide `afip-authorize` desde el POS
-- después, y un fallo de ARCA no deshace el cobro.
--
-- ⚠️ Sin condición frente al IVA no se factura. No se adivina monotributo.

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS sale_transaction_id uuid
  REFERENCES public.sale_transactions(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS invoices_un_sale_transaction
  ON public.invoices (sale_transaction_id)
  WHERE sale_transaction_id IS NOT NULL;

COMMENT ON COLUMN public.invoices.sale_transaction_id IS
  'Ticket POS que originó este comprobante. Uno por transacción: el CAE no se duplica si el cajero aprieta dos veces.';

CREATE OR REPLACE FUNCTION public.facturar_venta_pos(
  p_org uuid,
  p_transaction_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_user     uuid := auth.uid();
  v_tx       public.sale_transactions;
  v_ya       public.invoices;
  v_emisor   text;
  v_cbte     jsonb;
  v_esC      boolean;
  v_neto     numeric := 0;
  v_iva      numeric := 0;
  v_pct      numeric := 0;
  v_total    numeric := 0;
  v_incluido boolean := true;
  v_org_tax  numeric;
  v_id       uuid;
  v_numero   text;
  v_sale_id  uuid;
  v_cliente  text;
  v_letra    text;
  v_autorizar boolean := true;
  v_line     record;
  v_tasa     numeric;
  v_d        jsonb;
BEGIN
  IF p_org IS NULL OR p_transaction_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'faltan org_id o transaction_id');
  END IF;

  IF v_user IS NULL OR NOT public.is_org_member(p_org, v_user) THEN
    RAISE EXCEPTION 'No sos miembro de esta organización'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  PERFORM public.exigir_permiso(
    p_org, 'invoices', 'edit', 'facturar un ticket del POS');

  SELECT * INTO v_tx
    FROM public.sale_transactions
   WHERE id = p_transaction_id AND org_id = p_org;
  IF v_tx.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'el ticket no existe en este comercio');
  END IF;

  -- Idempotencia: si ya hay factura del ticket, o de una de sus líneas
  -- (el camino viejo `/facturas?from_sale=`), se devuelve esa. No se crea
  -- otra. Si le faltaba el id del ticket, se lo completa.
  SELECT i.* INTO v_ya
    FROM public.invoices i
   WHERE i.org_id = p_org
     AND (
       i.sale_transaction_id = p_transaction_id
       OR i.sale_id IN (
         SELECT s.id FROM public.sales s
          WHERE s.sale_transaction_id = p_transaction_id
       )
     )
   ORDER BY i.created_at
   LIMIT 1;

  IF v_ya.id IS NOT NULL THEN
    IF v_ya.sale_transaction_id IS NULL THEN
      UPDATE public.invoices
         SET sale_transaction_id = p_transaction_id
       WHERE id = v_ya.id AND sale_transaction_id IS NULL;
    END IF;
    RETURN jsonb_build_object(
      'ok', true,
      'invoice_id', v_ya.id,
      'number', v_ya.number,
      'tipo', CASE v_ya.tipo_comprobante
                WHEN 1 THEN 'A' WHEN 6 THEN 'B' WHEN 11 THEN 'C'
                ELSE NULL
              END,
      'already', true,
      'autorizar', v_ya.cae IS NULL
    );
  END IF;

  SELECT COALESCE(SUM(s.total_ars), 0),
         (ARRAY_AGG(s.id ORDER BY s.created_at, s.id))[1],
         NULLIF(btrim((ARRAY_AGG(s.customer_name ORDER BY s.created_at, s.id))[1]), '')
    INTO v_total, v_sale_id, v_cliente
    FROM public.sales s
   WHERE s.sale_transaction_id = p_transaction_id
     AND s.org_id = p_org;

  IF COALESCE(v_total, 0) <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'el ticket es de importe cero');
  END IF;

  SELECT a.tipo_emisor INTO v_emisor
    FROM public.afip_credentials a WHERE a.org_id = p_org;
  IF v_emisor IS NULL THEN
    SELECT s.afip_tipo_emisor INTO v_emisor
      FROM public.settings s WHERE s.org_id = p_org LIMIT 1;
  END IF;

  IF v_emisor IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'motivo', 'falta declarar la condicion frente al IVA del emisor'
    );
  END IF;

  -- Receptor por default: consumidor final. El POS de mostrador no pide
  -- CUIT. Una Factura A (RI+RI) sin CUIT no se autoriza: se deja el
  -- borrador y se dice por qué.
  v_cbte := public.tipo_de_comprobante(v_emisor, 'consumidor_final');
  v_letra := v_cbte->>'letra';
  v_esC := v_letra = 'C';

  SELECT s.tax_iva_percent, COALESCE(s.tax_prices_include_iva, true)
    INTO v_org_tax, v_incluido
    FROM public.settings s WHERE s.org_id = p_org LIMIT 1;

  IF v_esC THEN
    v_neto := public.redondear_moneda(v_total, 'ARS');
    v_iva  := 0;
    v_pct  := 0;
  ELSE
    FOR v_line IN
      SELECT s.product_id, s.total_ars
        FROM public.sales s
       WHERE s.sale_transaction_id = p_transaction_id
       ORDER BY s.created_at, s.id
    LOOP
      SELECT COALESCE(p.tax_rate, v_org_tax) INTO v_tasa
        FROM public.products p
       WHERE p.id = v_line.product_id;
      IF v_tasa IS NULL THEN
        v_tasa := COALESCE(v_org_tax, 21);
      END IF;
      v_d := public.desglosar_iva(v_line.total_ars, v_tasa, v_incluido);
      v_neto := v_neto + COALESCE((v_d->>'neto')::numeric, 0);
      v_iva  := v_iva  + COALESCE((v_d->>'iva')::numeric, 0);
    END LOOP;
    v_neto := public.redondear_moneda(v_neto, 'ARS');
    v_iva  := public.redondear_moneda(v_iva, 'ARS');
    v_pct  := CASE WHEN v_neto > 0
                   THEN ROUND(v_iva / v_neto * 100, 2)
                   ELSE 0 END;
  END IF;

  IF v_letra = 'A' THEN
    v_autorizar := false;
  END IF;

  v_numero := public.siguiente_numero_factura(p_org);

  INSERT INTO public.invoices (
    org_id, number, sale_id, sale_transaction_id,
    customer_name, issue_date, due_date, status, currency,
    subtotal, tax_pct, tax_amount, total,
    tipo_comprobante, condicion_iva_receptor,
    afip_status, notes, created_by)
  VALUES (
    p_org, v_numero, v_sale_id, p_transaction_id,
    COALESCE(v_cliente, 'Consumidor final'),
    CURRENT_DATE, CURRENT_DATE, 'draft', 'ARS',
    v_neto, v_pct, v_iva, public.redondear_moneda(v_total, 'ARS'),
    (v_cbte->>'codigo_afip')::int,
    public.condicion_iva_codigo('consumidor_final'),
    'pending',
    'Generada desde el POS',
    v_user)
  RETURNING id INTO v_id;

  INSERT INTO public.invoice_items (invoice_id, description, quantity, unit_price, total)
  SELECT v_id, s.product_name, s.quantity, s.unit_price_ars, s.total_ars
    FROM public.sales s
   WHERE s.sale_transaction_id = p_transaction_id
   ORDER BY s.created_at, s.id;

  UPDATE public.sales
     SET invoice_id = v_id
   WHERE sale_transaction_id = p_transaction_id
     AND invoice_id IS NULL;

  PERFORM public.emitir_evento(p_org, 'factura', v_id, 'factura.creada',
    jsonb_build_object(
      'invoice_id', v_id,
      'sale_transaction_id', p_transaction_id,
      'numero', v_numero,
      'tipo', v_letra,
      'total', v_total));

  RETURN jsonb_build_object(
    'ok', true,
    'invoice_id', v_id,
    'number', v_numero,
    'tipo', v_letra,
    'already', false,
    'autorizar', v_autorizar,
    'motivo', CASE WHEN v_autorizar THEN NULL
                   ELSE 'Factura A sin CUIT del receptor: ARCA no va a autorizar hasta cargarlo'
              END
  );
END;
$fn$;

COMMENT ON FUNCTION public.facturar_venta_pos(uuid, uuid) IS
  'Crea el comprobante de un ticket POS. Idempotente por sale_transaction_id. No llama a ARCA: el CAE lo pide afip-authorize. Sin condición IVA no adivina ni factura.';

REVOKE ALL ON FUNCTION public.facturar_venta_pos(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.facturar_venta_pos(uuid, uuid) TO authenticated, service_role;
