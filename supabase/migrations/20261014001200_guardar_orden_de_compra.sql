-- Órdenes de compra: guardar la orden y sus renglones en una sola operación.
--
-- Páginas legacy (pedido del dueño 2026-10-14). Medido en el código:
-- · Crear una OC insertaba la cabecera y después los renglones; editar borraba
--   los renglones y los volvía a insertar. Un fallo en el medio dejaba la orden
--   sin ítems (la pantalla misma avisaba «La orden se guardó, pero no sus
--   ítems»).
-- · Nadie calculaba los totales: los renglones quedaban con total_cost 0 y la
--   cabecera con subtotal, IVA y total en 0, así que la lista y los indicadores
--   de «pendiente de recibir» mostraban $0 en toda orden.
-- · Reposición generaba compras programadas sueltas, una por una, en vez de
--   una orden de compra al proveedor.
--
-- `guardar_orden_de_compra` crea o edita en una transacción: cabecera,
-- renglones (reemplazados de una vez), totales recalculados en la base,
-- productos verificados del negocio y numeración con `generate_po_number`.
-- Los guardianes existentes siguen mandando: una orden recibida, parcial o
-- cancelada no se edita. Corre con los permisos de quien llama (compras).
-- Idempotente.
BEGIN;

CREATE OR REPLACE FUNCTION public.guardar_orden_de_compra(p_org uuid, p_id uuid, p_datos jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_items jsonb := coalesce(p_datos->'items', '[]'::jsonb);
  it jsonb;
  v_n int := 0;
  v_prod uuid;
  v_nombre text;
  v_sku text;
  v_cant numeric;
  v_costo numeric;
  v_iva numeric;
  v_neto numeric;
  v_sub numeric := 0;
  v_impuesto numeric := 0;
  v_descuento numeric;
  v_proveedor text;
  v_proveedor_id uuid;
  v_moneda text;
  v_fila public.purchase_orders;
  v_estado text;
  v_renglones jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_org_member(p_org, auth.uid()) THEN
    RAISE EXCEPTION 'No tenés acceso a este negocio' USING ERRCODE = '42501';
  END IF;
  v_proveedor := nullif(btrim(coalesce(p_datos->>'supplier_name', '')), '');
  IF v_proveedor IS NULL THEN
    RAISE EXCEPTION 'Elegí o escribí el proveedor' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(v_items) IS DISTINCT FROM 'array' OR jsonb_array_length(v_items) = 0 THEN
    RAISE EXCEPTION 'Agregá al menos un ítem' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(v_items) > 500 THEN
    RAISE EXCEPTION 'Una orden puede tener hasta 500 ítems' USING ERRCODE = '22023';
  END IF;
  v_proveedor_id := nullif(p_datos->>'supplier_id', '')::uuid;
  IF v_proveedor_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.suppliers WHERE id = v_proveedor_id AND org_id = p_org) THEN
    RAISE EXCEPTION 'El proveedor no es de este negocio' USING ERRCODE = '22023';
  END IF;
  v_moneda := upper(coalesce(nullif(btrim(p_datos->>'currency'), ''), 'USD'));
  IF v_moneda NOT IN ('USD', 'ARS') THEN
    RAISE EXCEPTION 'Moneda no admitida: %', v_moneda USING ERRCODE = '22023';
  END IF;

  -- Validar y calcular antes de tocar nada.
  FOR it IN SELECT value FROM jsonb_array_elements(v_items) LOOP
    v_n := v_n + 1;
    v_cant := public._numero_o_nulo(it->>'quantity_ordered');
    v_costo := coalesce(public._numero_o_nulo(it->>'unit_cost'), 0);
    v_iva := coalesce(public._numero_o_nulo(it->>'tax_rate'), 0);
    v_nombre := nullif(btrim(coalesce(it->>'product_name', '')), '');
    IF v_cant IS NULL OR v_cant <= 0 THEN
      RAISE EXCEPTION 'Ítem % (%): la cantidad tiene que ser mayor a cero', v_n, coalesce(v_nombre, 'sin nombre') USING ERRCODE = '22023';
    END IF;
    IF v_costo < 0 OR v_iva < 0 OR v_iva > 27 THEN
      RAISE EXCEPTION 'Ítem % (%): revisá el costo y el IVA', v_n, coalesce(v_nombre, 'sin nombre') USING ERRCODE = '22023';
    END IF;
    v_prod := CASE WHEN coalesce(it->>'product_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                   THEN (it->>'product_id')::uuid END;
    v_sku := nullif(btrim(coalesce(it->>'sku', '')), '');
    IF v_prod IS NOT NULL THEN
      SELECT coalesce(v_nombre, name), coalesce(v_sku, sku) INTO v_nombre, v_sku FROM public.products WHERE id = v_prod AND org_id = p_org;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Ítem %: el producto ya no está en el catálogo', v_n USING ERRCODE = '22023';
      END IF;
    END IF;
    IF v_nombre IS NULL THEN
      RAISE EXCEPTION 'Ítem %: falta el nombre del producto', v_n USING ERRCODE = '22023';
    END IF;
    v_neto := round(round(v_cant, 3) * round(v_costo, 4), 2);
    v_sub := v_sub + v_neto;
    v_impuesto := v_impuesto + round(v_neto * v_iva / 100, 2);
    v_renglones := v_renglones || jsonb_build_array(jsonb_build_object(
      'n', v_n, 'product_id', v_prod, 'product_name', left(v_nombre, 300), 'sku', v_sku,
      'cantidad', round(v_cant, 3), 'costo', round(v_costo, 4), 'iva', v_iva, 'neto', v_neto));
  END LOOP;
  v_descuento := round(greatest(0, coalesce(public._numero_o_nulo(p_datos->>'discount_amount'), 0)), 2);
  IF v_descuento > v_sub + v_impuesto THEN
    RAISE EXCEPTION 'El descuento supera el total de la orden' USING ERRCODE = '22023';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.purchase_orders (org_id, order_number, supplier_id, supplier_name, supplier_email, currency,
                                        subtotal, tax_amount, discount_amount, total_amount, notes, internal_notes,
                                        expected_date, payment_terms, status)
    VALUES (p_org, public.generate_po_number(p_org), v_proveedor_id, v_proveedor,
            nullif(btrim(coalesce(p_datos->>'supplier_email', '')), ''), v_moneda,
            v_sub, v_impuesto, v_descuento, v_sub + v_impuesto - v_descuento,
            nullif(btrim(coalesce(p_datos->>'notes', '')), ''), nullif(btrim(coalesce(p_datos->>'internal_notes', '')), ''),
            nullif(p_datos->>'expected_date', '')::date, nullif(p_datos->>'payment_terms', ''), 'draft')
    RETURNING * INTO v_fila;
  ELSE
    SELECT status INTO v_estado FROM public.purchase_orders WHERE id = p_id AND org_id = p_org FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'No se encontró la orden de compra' USING ERRCODE = 'P0002';
    END IF;
    IF v_estado NOT IN ('draft', 'sent', 'confirmed') THEN
      RAISE EXCEPTION 'Una orden recibida, con recepción parcial o cancelada no se puede editar' USING ERRCODE = '55000';
    END IF;
    UPDATE public.purchase_orders
       SET supplier_id = v_proveedor_id, supplier_name = v_proveedor,
           supplier_email = nullif(btrim(coalesce(p_datos->>'supplier_email', '')), ''), currency = v_moneda,
           subtotal = v_sub, tax_amount = v_impuesto, discount_amount = v_descuento,
           total_amount = v_sub + v_impuesto - v_descuento,
           notes = nullif(btrim(coalesce(p_datos->>'notes', '')), ''),
           internal_notes = nullif(btrim(coalesce(p_datos->>'internal_notes', '')), ''),
           expected_date = nullif(p_datos->>'expected_date', '')::date,
           payment_terms = nullif(p_datos->>'payment_terms', '')
     WHERE id = p_id
     RETURNING * INTO v_fila;
    DELETE FROM public.purchase_order_items WHERE order_id = p_id;
  END IF;

  INSERT INTO public.purchase_order_items (order_id, org_id, product_id, product_name, sku, quantity_ordered, unit_cost, tax_rate, total_cost)
  SELECT v_fila.id, p_org, r.product_id, r.product_name, r.sku, r.cantidad, r.costo, r.iva, r.neto
    FROM jsonb_to_recordset(v_renglones) AS r(n int, product_id uuid, product_name text, sku text, cantidad numeric, costo numeric, iva numeric, neto numeric)
   ORDER BY r.n;

  RETURN to_jsonb(v_fila) || jsonb_build_object('renglones', v_n);
END;
$$;
REVOKE ALL ON FUNCTION public.guardar_orden_de_compra(uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guardar_orden_de_compra(uuid, uuid, jsonb) TO authenticated, service_role;

COMMIT;
