-- Compras: los gastos de la compra entran al costo de cada producto (el costo
-- puesto en depósito).
--
-- Hasta hoy el costo de un producto era el de la factura del proveedor. En una
-- importación eso deja afuera el flete internacional, el seguro, los derechos
-- de importación, la tasa de estadística, el despachante y el depósito fiscal,
-- que se les pagan a otros; en una compra local, el flete. Sin ellos el margen
-- de cada venta sale mejor de lo que es y el precio sugerido queda corto.
--
-- Criterio contable (RT 17, 4.2.1; NIC 2, párrafo 11): el costo de adquisición
-- incluye lo directamente atribuible a la compra. El IVA y las percepciones son
-- crédito fiscal: se pagan, pero no son costo. Los gastos de la compra no van a
-- Gastos (cuenta 5.9.01) porque llegarían a resultados dos veces: hoy como gasto
-- y, al vender, dentro del costo de ventas. Se registran como la compra misma:
-- cuenta a pagar a quien cobra el gasto, egreso con su medio, o nada si la
-- factura ya está cargada (Libro IVA Compras o Proveedores).
--
-- Esta migración:
-- · `compra_gastos`: cada gasto con concepto, monto sin impuestos (pesos o
--   dólares con su cotización), impuestos recuperables, proveedor, comprobante,
--   forma de reparto y cómo se pagó;
-- · `purchases.gastos_ars` / `gastos_usd`: la parte de cada renglón;
-- · `repartir_gastos_de_compra`: reparte por valor (lo habitual: derechos y
--   tasa se calculan sobre el valor), por cantidad o por peso, sin perder un
--   centavo, y deja el costo puesto en cada producto cuya última compra es ésta
--   (si hubo una posterior, su costo es más nuevo y no se toca);
-- · `agregar_gasto_a_compra` / `quitar_gasto_de_compra`: dueño o
--   administrador, como `registrar_compra`; la tabla sólo se escribe por ellas;
-- · `anular_compra` también deshace los gastos y se niega si alguno ya tiene
--   pagos. Pasa a SECURITY DEFINER (con la misma guarda de rol) para poder
--   borrar los gastos, que el navegador no puede tocar.
-- · deriva: en una base armada desde cero `purchase_order_receipts` queda con
--   la forma de 20260523000025 (20260802000002 la declara con IF NOT EXISTS y
--   no la reemplaza) y le faltan las columnas que producción tiene y que usan
--   `anular_compra`, su guardia y `receive_purchase_order`. Se agregan si
--   faltan; en producción no cambia nada.
-- Idempotente. Reversible: DROP de las tres funciones nuevas, de la tabla y de
-- las dos columnas, y `anular_compra` de 20261014001600.
BEGIN;

ALTER TABLE public.purchase_order_receipts
  ADD COLUMN IF NOT EXISTS order_item_id uuid REFERENCES public.purchase_order_items(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS purchase_id uuid REFERENCES public.purchases(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS quantity numeric,
  ADD COLUMN IF NOT EXISTS received_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
DO $deriva$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'purchase_order_receipts' AND column_name = 'receipt_number') THEN
    ALTER TABLE public.purchase_order_receipts ALTER COLUMN receipt_number DROP NOT NULL;
  END IF;
END $deriva$;

CREATE TABLE IF NOT EXISTS public.compra_gastos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- purchases.compra_id (o el id del renglón en las compras de antes de esa columna).
  compra_id uuid NOT NULL,
  concepto text NOT NULL CHECK (concepto IN ('flete', 'seguro', 'derechos', 'tasa_estadistica', 'despachante', 'deposito', 'flete_local', 'otro')),
  detalle text CHECK (detalle IS NULL OR length(detalle) <= 200),
  reparto text NOT NULL DEFAULT 'valor' CHECK (reparto IN ('valor', 'cantidad', 'peso')),
  moneda text NOT NULL DEFAULT 'ARS' CHECK (moneda IN ('ARS', 'USD')),
  -- Sin IVA ni percepciones: es lo que entra al costo.
  monto numeric(15,2) NOT NULL CHECK (monto > 0),
  -- IVA y percepciones: se pagan con el gasto, no son costo.
  impuestos numeric(15,2) NOT NULL DEFAULT 0 CHECK (impuestos >= 0),
  cotizacion numeric(15,4) CHECK (cotizacion IS NULL OR cotizacion > 0),
  monto_ars numeric(15,2) NOT NULL CHECK (monto_ars > 0),
  monto_usd numeric(15,4) CHECK (monto_usd IS NULL OR monto_usd >= 0),
  pago text NOT NULL CHECK (pago IN ('pagado', 'a_pagar', 'registrado')),
  medio text,
  proveedor_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  proveedor text CHECK (proveedor IS NULL OR length(proveedor) <= 200),
  comprobante text CHECK (comprobante IS NULL OR length(comprobante) <= 80),
  fecha date NOT NULL,
  deuda_id uuid REFERENCES public.supplier_debts(id) ON DELETE SET NULL,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS compra_gastos_compra_idx ON public.compra_gastos (org_id, compra_id);

COMMENT ON TABLE public.compra_gastos IS
  'Gastos de una compra (flete, seguro, aduana, despachante): se reparten entre sus renglones y forman el costo puesto. Se escribe sólo con agregar_gasto_a_compra / quitar_gasto_de_compra.';

ALTER TABLE public.compra_gastos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS compra_gastos_leer ON public.compra_gastos;
CREATE POLICY compra_gastos_leer ON public.compra_gastos
  FOR SELECT TO authenticated
  USING (public.has_permission(org_id, 'purchases', 'view'));

-- Producción le da todo a authenticated en cada tabla nueva: se revoca y se
-- otorga sólo la lectura. Escribir es cosa de las funciones.
REVOKE ALL ON public.compra_gastos FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.compra_gastos TO authenticated;
GRANT ALL ON public.compra_gastos TO service_role;

ALTER TABLE public.purchases
  ADD COLUMN IF NOT EXISTS gastos_ars numeric(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gastos_usd numeric(15,4) NOT NULL DEFAULT 0;
ALTER TABLE public.purchases DROP CONSTRAINT IF EXISTS purchases_gastos_no_negativos;
ALTER TABLE public.purchases ADD CONSTRAINT purchases_gastos_no_negativos CHECK (gastos_ars >= 0 AND gastos_usd >= 0);
COMMENT ON COLUMN public.purchases.gastos_ars IS
  'Parte de los gastos de la compra (compra_gastos) que le toca a este renglón. Costo puesto = (total_ars + gastos_ars) / quantity.';

-- ───────────────────────── repartir_gastos_de_compra ─────────────────────────
-- Interna: la llaman las funciones de abajo, que ya validaron rol y negocio.
CREATE OR REPLACE FUNCTION public.repartir_gastos_de_compra(p_org uuid, p_compra uuid, p_actualizar_costos boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ids uuid[];
  v_cant numeric[];
  v_valor numeric[];
  v_peso numeric[];
  v_w numeric[];
  v_ars numeric[];
  v_usd numeric[];
  v_n int;
  v_suma numeric;
  v_acum numeric;
  v_hasta_ars numeric;
  v_hasta_usd numeric;
  v_antes_ars numeric;
  v_antes_usd numeric;
  v_falta_usd boolean;
  v_total_ars numeric := 0;
  v_costos int := 0;
  v_sin_cotizacion int := 0;
  v_posterior int := 0;
  v_moneda_prod text;
  g record;
  r record;
  v_prod record;
BEGIN
  PERFORM 1 FROM public.purchases
   WHERE org_id = p_org AND (compra_id = p_compra OR (compra_id IS NULL AND id = p_compra))
   FOR UPDATE;
  SELECT array_agg(p.id ORDER BY p.id),
         array_agg(p.quantity ORDER BY p.id),
         array_agg(greatest(p.total_ars, 0) ORDER BY p.id),
         array_agg(p.quantity * coalesce(nullif(pr.weight_kg, 0), 0) ORDER BY p.id)
    INTO v_ids, v_cant, v_valor, v_peso
    FROM public.purchases p
    LEFT JOIN public.products pr ON pr.id = p.product_id AND pr.org_id = p.org_id
   WHERE p.org_id = p_org AND (p.compra_id = p_compra OR (p.compra_id IS NULL AND p.id = p_compra))
     AND NOT coalesce(p.is_scheduled, false) AND p.quantity > 0;
  v_n := coalesce(array_length(v_ids, 1), 0);
  IF v_n = 0 THEN
    RAISE EXCEPTION 'La compra no existe en este negocio' USING ERRCODE = 'P0002';
  END IF;
  v_ars := array_fill(0::numeric, ARRAY[v_n]);
  v_usd := array_fill(0::numeric, ARRAY[v_n]);

  SELECT bool_or(monto_usd IS NULL) INTO v_falta_usd
    FROM public.compra_gastos WHERE org_id = p_org AND compra_id = p_compra;
  v_falta_usd := coalesce(v_falta_usd, false);

  FOR g IN
    SELECT reparto, sum(monto_ars) AS ars, sum(coalesce(monto_usd, 0)) AS usd
      FROM public.compra_gastos WHERE org_id = p_org AND compra_id = p_compra
     GROUP BY reparto
  LOOP
    v_total_ars := v_total_ars + g.ars;
    v_w := CASE g.reparto WHEN 'valor' THEN v_valor WHEN 'peso' THEN v_peso ELSE v_cant END;
    SELECT sum(x) INTO v_suma FROM unnest(v_w) AS x;
    -- Sin valor (o sin pesos) no hay proporción: se reparte por cantidad.
    IF coalesce(v_suma, 0) <= 0 THEN
      v_w := v_cant;
      SELECT sum(x) INTO v_suma FROM unnest(v_w) AS x;
    END IF;
    -- Redondeo acumulado: cada renglón recibe la diferencia entre lo repartido
    -- hasta él y hasta el anterior. Suma exacta y ninguna parte negativa.
    v_acum := 0; v_antes_ars := 0; v_antes_usd := 0;
    FOR i IN 1..v_n LOOP
      v_acum := v_acum + v_w[i];
      v_hasta_ars := round(g.ars * v_acum / v_suma, 2);
      v_hasta_usd := round(g.usd * v_acum / v_suma, 4);
      v_ars[i] := v_ars[i] + (v_hasta_ars - v_antes_ars);
      v_usd[i] := v_usd[i] + (v_hasta_usd - v_antes_usd);
      v_antes_ars := v_hasta_ars;
      v_antes_usd := v_hasta_usd;
    END LOOP;
  END LOOP;

  FOR i IN 1..v_n LOOP
    UPDATE public.purchases SET gastos_ars = v_ars[i], gastos_usd = v_usd[i]
     WHERE id = v_ids[i] AND (gastos_ars IS DISTINCT FROM v_ars[i] OR gastos_usd IS DISTINCT FROM v_usd[i]);
  END LOOP;

  IF p_actualizar_costos THEN
    FOR r IN
      SELECT p.product_id,
             sum(p.quantity) AS cant,
             sum(p.total_ars + p.gastos_ars) AS puesto_ars,
             sum(p.total_usd + p.gastos_usd) AS puesto_usd,
             bool_and(coalesce(p.exchange_rate, 0) > 0 AND p.total_usd > 0) AS con_dolares,
             max(p.date) AS fecha,
             max(p.created_at) AS creada
        FROM public.purchases p
       WHERE p.org_id = p_org AND (p.compra_id = p_compra OR (p.compra_id IS NULL AND p.id = p_compra))
         AND NOT coalesce(p.is_scheduled, false) AND p.quantity > 0 AND p.product_id IS NOT NULL
       GROUP BY p.product_id
    LOOP
      -- Una compra posterior del producto ya fijó un costo más nuevo.
      IF EXISTS (
        SELECT 1 FROM public.purchases q
         WHERE q.org_id = p_org AND q.product_id = r.product_id AND NOT coalesce(q.is_scheduled, false)
           AND coalesce(q.compra_id, q.id) <> p_compra
           AND (q.date > r.fecha OR (q.date = r.fecha AND q.created_at > r.creada))
      ) THEN
        v_posterior := v_posterior + 1;
        CONTINUE;
      END IF;
      SELECT cost_currency, cost_ars, cost_usd, total_cost_usd INTO v_prod
        FROM public.products WHERE id = r.product_id AND org_id = p_org FOR UPDATE;
      CONTINUE WHEN NOT FOUND;
      -- La moneda en que el producto lleva su costo, como registrar_compra.
      v_moneda_prod := coalesce(v_prod.cost_currency,
        CASE WHEN coalesce(v_prod.cost_ars, 0) > 0 THEN 'ARS'
             WHEN coalesce(v_prod.total_cost_usd, 0) > 0 OR coalesce(v_prod.cost_usd, 0) > 0 THEN 'USD'
             ELSE 'ARS' END);
      IF v_moneda_prod = 'ARS' THEN
        UPDATE public.products SET cost_ars = round(r.puesto_ars / r.cant, 2), cost_currency = 'ARS'
         WHERE id = r.product_id AND org_id = p_org;
        v_costos := v_costos + 1;
      ELSIF r.con_dolares AND NOT v_falta_usd THEN
        -- C28.1: el costo cargado ya incluye flete y aduana; customs_fee queda como está.
        UPDATE public.products
           SET cost_usd = round(r.puesto_usd / r.cant, 4), total_cost_usd = round(r.puesto_usd / r.cant, 4), cost_currency = 'USD'
         WHERE id = r.product_id AND org_id = p_org;
        v_costos := v_costos + 1;
      ELSE
        v_sin_cotizacion := v_sin_cotizacion + 1;
      END IF;
    END LOOP;
  END IF;

  RETURN jsonb_build_object('gastos_ars', v_total_ars, 'costos_actualizados', v_costos,
                            'con_compra_posterior', v_posterior, 'sin_cotizacion', v_sin_cotizacion);
END;
$$;
REVOKE ALL ON FUNCTION public.repartir_gastos_de_compra(uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.repartir_gastos_de_compra(uuid, uuid, boolean) TO service_role;

-- ───────────────────────── agregar_gasto_a_compra ─────────────────────────
CREATE OR REPLACE FUNCTION public.agregar_gasto_a_compra(p_org uuid, p_compra uuid, p_datos jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_concepto text := lower(coalesce(nullif(btrim(p_datos->>'concepto'), ''), ''));
  v_detalle text := left(nullif(btrim(coalesce(p_datos->>'detalle', '')), ''), 200);
  v_reparto text := lower(coalesce(nullif(btrim(p_datos->>'reparto'), ''), 'valor'));
  v_moneda text := upper(coalesce(nullif(btrim(p_datos->>'moneda'), ''), 'ARS'));
  v_monto numeric := round(public._numero_o_nulo(p_datos->>'monto'), 2);
  v_impuestos numeric := round(coalesce(public._numero_o_nulo(p_datos->>'impuestos'), 0), 2);
  v_tc numeric := public._numero_o_nulo(p_datos->>'cotizacion');
  v_pago text := lower(coalesce(nullif(btrim(p_datos->>'pago'), ''), 'pagado'));
  v_medio text := lower(coalesce(nullif(btrim(p_datos->>'medio'), ''), 'efectivo'));
  v_proveedor text := left(nullif(btrim(coalesce(p_datos->>'proveedor', '')), ''), 200);
  v_proveedor_id uuid := nullif(p_datos->>'proveedor_id', '')::uuid;
  v_comprobante text := left(nullif(btrim(coalesce(p_datos->>'comprobante', '')), ''), 80);
  v_fecha date := coalesce(nullif(p_datos->>'fecha', '')::date, public.hoy_ar());
  v_actualizar boolean := coalesce((p_datos->>'actualizar_costos')::boolean, true);
  v_monto_ars numeric;
  v_monto_usd numeric;
  v_impuestos_ars numeric;
  v_sin_peso text;
  v_de_la_compra text;
  v_etiqueta text;
  v_descripcion text;
  v_gasto uuid := gen_random_uuid();
  v_deuda uuid;
  v_r jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_org_role(p_org, auth.uid(), ARRAY['owner', 'admin']) THEN
    RAISE EXCEPTION 'Sólo el dueño o un administrador pueden cargar gastos de una compra' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.purchases
   WHERE org_id = p_org AND (compra_id = p_compra OR (compra_id IS NULL AND id = p_compra))
     AND NOT coalesce(is_scheduled, false)
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La compra no existe en este negocio' USING ERRCODE = 'P0002';
  END IF;
  IF v_concepto NOT IN ('flete', 'seguro', 'derechos', 'tasa_estadistica', 'despachante', 'deposito', 'flete_local', 'otro') THEN
    RAISE EXCEPTION 'Elegí qué es el gasto: flete, seguro, derechos, despachante…' USING ERRCODE = '22023';
  END IF;
  IF v_concepto = 'otro' AND v_detalle IS NULL THEN
    RAISE EXCEPTION 'Contá qué es el gasto' USING ERRCODE = '22023';
  END IF;
  IF v_reparto NOT IN ('valor', 'cantidad', 'peso') THEN
    RAISE EXCEPTION 'Forma de reparto no admitida: %', v_reparto USING ERRCODE = '22023';
  END IF;
  IF v_moneda NOT IN ('ARS', 'USD') THEN
    RAISE EXCEPTION 'Moneda no admitida: %', v_moneda USING ERRCODE = '22023';
  END IF;
  IF v_monto IS NULL OR v_monto <= 0 THEN
    RAISE EXCEPTION 'El monto tiene que ser mayor a cero' USING ERRCODE = '22023';
  END IF;
  IF v_impuestos < 0 THEN
    RAISE EXCEPTION 'Los impuestos no pueden ser negativos' USING ERRCODE = '22023';
  END IF;
  IF v_pago NOT IN ('pagado', 'a_pagar', 'registrado') THEN
    RAISE EXCEPTION 'Indicá si el gasto ya se pagó, queda a pagar o ya está registrado' USING ERRCODE = '22023';
  END IF;
  IF v_proveedor_id IS NOT NULL THEN
    SELECT coalesce(v_proveedor, name) INTO v_proveedor FROM public.suppliers WHERE id = v_proveedor_id AND org_id = p_org;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'El proveedor no es de este negocio' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF v_pago = 'a_pagar' AND v_proveedor IS NULL THEN
    RAISE EXCEPTION 'Para dejarlo a pagar, elegí a quién: el despachante, el transporte…' USING ERRCODE = '22023';
  END IF;

  -- Cotización: la cargada, la del negocio o la de la compra.
  IF v_tc IS NULL OR v_tc <= 0 THEN
    SELECT nullif(exchange_rate, 0) INTO v_tc FROM public.settings WHERE org_id = p_org;
  END IF;
  IF v_tc IS NULL OR v_tc <= 0 THEN
    SELECT max(nullif(exchange_rate, 0)) INTO v_tc FROM public.purchases
     WHERE org_id = p_org AND (compra_id = p_compra OR (compra_id IS NULL AND id = p_compra));
  END IF;
  IF v_moneda = 'USD' AND (v_tc IS NULL OR v_tc <= 0) THEN
    RAISE EXCEPTION 'Para un gasto en dólares cargá la cotización' USING ERRCODE = '22023';
  END IF;
  IF v_moneda = 'USD' THEN
    v_monto_ars := round(v_monto * v_tc, 2);
    v_monto_usd := v_monto;
    v_impuestos_ars := round(v_impuestos * v_tc, 2);
  ELSE
    v_monto_ars := v_monto;
    v_monto_usd := CASE WHEN coalesce(v_tc, 0) > 0 THEN round(v_monto / v_tc, 4) END;
    v_impuestos_ars := v_impuestos;
  END IF;

  IF v_reparto = 'peso' THEN
    SELECT left(string_agg(DISTINCT p.product_name, ', '), 300) INTO v_sin_peso
      FROM public.purchases p
      LEFT JOIN public.products pr ON pr.id = p.product_id AND pr.org_id = p.org_id
     WHERE p.org_id = p_org AND (p.compra_id = p_compra OR (p.compra_id IS NULL AND p.id = p_compra))
       AND NOT coalesce(p.is_scheduled, false) AND coalesce(pr.weight_kg, 0) <= 0;
    IF v_sin_peso IS NOT NULL THEN
      RAISE EXCEPTION 'Para repartir por peso, cargá el peso de: %', v_sin_peso USING ERRCODE = '22023';
    END IF;
  END IF;

  SELECT min(batch_name) INTO v_de_la_compra FROM public.purchases
   WHERE org_id = p_org AND (compra_id = p_compra OR (compra_id IS NULL AND id = p_compra));
  v_etiqueta := CASE v_concepto
    WHEN 'flete' THEN 'Flete' WHEN 'seguro' THEN 'Seguro' WHEN 'derechos' THEN 'Derechos de importación'
    WHEN 'tasa_estadistica' THEN 'Tasa de estadística' WHEN 'despachante' THEN 'Despachante'
    WHEN 'deposito' THEN 'Depósito fiscal' WHEN 'flete_local' THEN 'Flete hasta el local'
    ELSE v_detalle END;
  v_descripcion := left(v_etiqueta || coalesce(' ' || v_comprobante, '') || ' · compra' || coalesce(' ' || v_de_la_compra, ''), 200);

  IF v_pago = 'a_pagar' THEN
    -- remaining_ars lo calcula la tabla (amount_ars - paid_ars). Sin purchase_id:
    -- la cuenta de la compra es la del proveedor de la mercadería.
    INSERT INTO public.supplier_debts (org_id, supplier_id, supplier_name, description, amount_ars, paid_ars, due_date, status, notes)
    VALUES (p_org, v_proveedor_id, v_proveedor, v_descripcion, v_monto_ars + v_impuestos_ars, 0,
            nullif(p_datos->>'vencimiento', '')::date, 'pending', v_detalle)
    RETURNING id INTO v_deuda;
  ELSIF v_pago = 'pagado' THEN
    INSERT INTO public.financial_movements (org_id, direction, source_type, source_id, amount_ars, description,
                                            counterparty, payment_method, channel, affects_cash, happened_at, created_by, metadata)
    VALUES (p_org, 'out', 'supplier_payment', v_gasto, v_monto_ars + v_impuestos_ars,
            v_descripcion || coalesce(' · ' || v_proveedor, ''), v_proveedor, v_medio,
            CASE WHEN v_medio IN ('efectivo', 'cash') THEN 'cash'
                 WHEN v_medio IN ('transferencia', 'deposito') THEN 'bank'
                 WHEN v_medio IN ('credito', 'debito', 'tarjeta', 'mercado_pago', 'mercadopago') THEN 'card'
                 ELSE 'other' END,
            v_medio IN ('efectivo', 'cash'), (v_fecha::timestamp + time '12:00'), auth.uid(),
            jsonb_build_object('compra_id', p_compra, 'gasto_de_compra', v_concepto, 'comprobante', v_comprobante));
  END IF;

  INSERT INTO public.compra_gastos (id, org_id, compra_id, concepto, detalle, reparto, moneda, monto, impuestos, cotizacion,
                                    monto_ars, monto_usd, pago, medio, proveedor_id, proveedor, comprobante, fecha, deuda_id, created_by)
  VALUES (v_gasto, p_org, p_compra, v_concepto, v_detalle, v_reparto, v_moneda, v_monto, v_impuestos, v_tc,
          v_monto_ars, v_monto_usd, v_pago, CASE WHEN v_pago = 'pagado' THEN v_medio END,
          v_proveedor_id, v_proveedor, v_comprobante, v_fecha, v_deuda, auth.uid());

  v_r := public.repartir_gastos_de_compra(p_org, p_compra, v_actualizar);

  INSERT INTO public.audit_logs (user_id, org_id, action, entity_type, entity_id, entity_label, details, severity, tags)
  VALUES (auth.uid(), p_org, 'update', 'purchase', p_compra::text, 'Compra' || coalesce(' ' || v_de_la_compra, ''),
          jsonb_build_object('gasto_agregado', v_concepto, 'monto_ars', v_monto_ars, 'impuestos_ars', v_impuestos_ars,
                             'pago', v_pago, 'reparto', v_reparto, 'costos_actualizados', v_r->'costos_actualizados'),
          'info', ARRAY['purchases', 'costs']::text[]);

  RETURN v_r || jsonb_build_object('gasto_id', v_gasto, 'deuda_id', v_deuda, 'monto_ars', v_monto_ars,
                                   'a_pagar_ars', v_monto_ars + v_impuestos_ars);
END;
$$;
REVOKE ALL ON FUNCTION public.agregar_gasto_a_compra(uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agregar_gasto_a_compra(uuid, uuid, jsonb) TO authenticated, service_role;

-- ───────────────────────── quitar_gasto_de_compra ─────────────────────────
CREATE OR REPLACE FUNCTION public.quitar_gasto_de_compra(p_org uuid, p_gasto uuid, p_actualizar_costos boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_g public.compra_gastos;
  v_pagado numeric;
  v_r jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_org_role(p_org, auth.uid(), ARRAY['owner', 'admin']) THEN
    RAISE EXCEPTION 'Sólo el dueño o un administrador pueden quitar gastos de una compra' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_g FROM public.compra_gastos WHERE id = p_gasto AND org_id = p_org FOR UPDATE;
  IF v_g.id IS NULL THEN
    RAISE EXCEPTION 'El gasto no existe en este negocio' USING ERRCODE = 'P0002';
  END IF;
  IF v_g.deuda_id IS NOT NULL THEN
    SELECT coalesce(paid_ars, 0) INTO v_pagado FROM public.supplier_debts WHERE id = v_g.deuda_id AND org_id = p_org FOR UPDATE;
    IF coalesce(v_pagado, 0) > 0 THEN
      RAISE EXCEPTION 'Ya registraste pagos por $% de este gasto: revertilos en Proveedores antes de quitarlo', v_pagado
        USING ERRCODE = '22023';
    END IF;
    DELETE FROM public.supplier_debts WHERE id = v_g.deuda_id AND org_id = p_org;
  END IF;
  DELETE FROM public.financial_movements
   WHERE org_id = p_org AND source_type = 'supplier_payment' AND source_id = v_g.id;
  DELETE FROM public.compra_gastos WHERE id = v_g.id;

  v_r := public.repartir_gastos_de_compra(p_org, v_g.compra_id, p_actualizar_costos);

  INSERT INTO public.audit_logs (user_id, org_id, action, entity_type, entity_id, entity_label, details, severity, tags)
  VALUES (auth.uid(), p_org, 'update', 'purchase', v_g.compra_id::text, 'Compra',
          jsonb_build_object('gasto_quitado', v_g.concepto, 'monto_ars', v_g.monto_ars, 'pago', v_g.pago,
                             'costos_actualizados', v_r->'costos_actualizados'),
          'warning', ARRAY['purchases', 'costs']::text[]);
  RETURN v_r;
END;
$$;
REVOKE ALL ON FUNCTION public.quitar_gasto_de_compra(uuid, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.quitar_gasto_de_compra(uuid, uuid, boolean) TO authenticated, service_role;

-- ───────────────────────── anular_compra ─────────────────────────
-- Igual que en 20261014001600 más los gastos de la compra.
CREATE OR REPLACE FUNCTION public.anular_compra(p_org uuid, p_compra uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ids uuid[];
  v_total numeric;
  v_comprobante text;
  v_orden text;
  v_pagado numeric;
  v_gastos int;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_org_role(p_org, auth.uid(), ARRAY['owner', 'admin']) THEN
    RAISE EXCEPTION 'Sólo el dueño o un administrador pueden anular compras' USING ERRCODE = '42501';
  END IF;
  -- Las compras anteriores a compra_id son de un solo renglón: se anulan por su id.
  SELECT array_agg(id), sum(total_ars), min(batch_name) INTO v_ids, v_total, v_comprobante
    FROM public.purchases
   WHERE org_id = p_org AND (compra_id = p_compra OR (compra_id IS NULL AND id = p_compra));
  IF v_ids IS NULL THEN
    RAISE EXCEPTION 'La compra no existe en este negocio' USING ERRCODE = 'P0002';
  END IF;

  SELECT po.order_number INTO v_orden
    FROM public.purchase_order_receipts r JOIN public.purchase_orders po ON po.id = r.order_id
   WHERE r.purchase_id = ANY (v_ids)
   LIMIT 1;
  IF v_orden IS NOT NULL THEN
    RAISE EXCEPTION 'Esta compra entró al recibir la orden %: la orden ya la cuenta como recibida y no se anula desde Compras', v_orden
      USING ERRCODE = '22023';
  END IF;

  SELECT coalesce(sum(paid_ars), 0) INTO v_pagado
    FROM public.supplier_debts WHERE org_id = p_org AND purchase_id = ANY (v_ids);
  IF v_pagado > 0 THEN
    RAISE EXCEPTION 'Ya registraste pagos por $% al proveedor por esta compra: revertilos en Cuentas a pagar antes de anularla', v_pagado
      USING ERRCODE = '22023';
  END IF;
  SELECT coalesce(sum(d.paid_ars), 0) INTO v_pagado
    FROM public.compra_gastos g JOIN public.supplier_debts d ON d.id = g.deuda_id
   WHERE g.org_id = p_org AND g.compra_id = p_compra;
  IF v_pagado > 0 THEN
    RAISE EXCEPTION 'Ya registraste pagos por $% de los gastos de esta compra: revertilos en Proveedores antes de anularla', v_pagado
      USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.supplier_debts d
   USING public.compra_gastos g
   WHERE g.org_id = p_org AND g.compra_id = p_compra AND d.id = g.deuda_id AND d.org_id = p_org;
  DELETE FROM public.financial_movements f
   USING public.compra_gastos g
   WHERE g.org_id = p_org AND g.compra_id = p_compra
     AND f.org_id = p_org AND f.source_type = 'supplier_payment' AND f.source_id = g.id;
  DELETE FROM public.compra_gastos WHERE org_id = p_org AND compra_id = p_compra;
  GET DIAGNOSTICS v_gastos = ROW_COUNT;

  DELETE FROM public.supplier_debts WHERE org_id = p_org AND purchase_id = ANY (v_ids);
  DELETE FROM public.financial_movements
   WHERE org_id = p_org AND source_type = 'supplier_payment' AND (source_id = p_compra OR source_id = ANY (v_ids));
  -- trg_purchase_stock_movement revierte el stock de cada renglón.
  DELETE FROM public.purchases WHERE org_id = p_org AND id = ANY (v_ids);

  INSERT INTO public.audit_logs (user_id, org_id, action, entity_type, entity_id, entity_label, details, severity, tags)
  VALUES (auth.uid(), p_org, 'delete', 'purchase', p_compra::text, coalesce('Compra ' || v_comprobante, 'Compra'),
          jsonb_build_object('renglones', cardinality(v_ids), 'total_ars', v_total, 'gastos', v_gastos, 'anulada', true),
          'warning', ARRAY['purchases', 'inventory']::text[]);

  RETURN jsonb_build_object('renglones', cardinality(v_ids), 'total_ars', v_total, 'gastos', v_gastos);
END;
$$;
REVOKE ALL ON FUNCTION public.anular_compra(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.anular_compra(uuid, uuid) TO authenticated, service_role;

COMMIT;
