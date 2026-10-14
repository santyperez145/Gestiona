-- Links de pago: cobrar un link registra la venta (y mueve el stock).
--
-- Pedido del dueño 2026-10-14 (páginas legacy). Medido en el código: cuando
-- Mercado Pago aprobaba un link de pago, el webhook sólo marcaba el link como
-- pagado. La venta no existía: no bajaba el stock, no aparecía en reportes ni
-- en la ganancia, y el comercio tenía que cargarla a mano.
--
-- `registrar_venta_de_link(link)` —sólo para el servidor (service_role), la
-- llama el webhook después de marcar el link pagado— crea la venta en una
-- transacción de origen `link_de_pago`:
-- · un renglón por ítem; los que tienen producto del catálogo bajan stock
--   (trg_sale_stock_movement), los libres quedan como texto;
-- · el total cobrado se reparte entre los renglones (si el link tenía
--   descuento, la suma de renglones es igual a lo cobrado);
-- · un ítem que ya no se puede asociar al producto (borrado, de otro negocio o
--   cantidad con decimales en un producto por unidad) igual se registra, como
--   renglón libre: la plata ya entró y la venta tiene que existir. Se informa;
-- · si el link vino de un presupuesto que todavía no se vendió, la venta lo
--   marca vendido (trg_presupuesto_convertido);
-- · es idempotente: Mercado Pago reintenta y la venta no se duplica.
-- Idempotente.
BEGIN;

ALTER TABLE public.sales DROP CONSTRAINT IF EXISTS sales_source_check;
ALTER TABLE public.sales ADD CONSTRAINT sales_source_check CHECK (source = ANY (ARRAY[
  'manual', 'pos', 'tiendanube', 'tienda_online', 'mercadolibre', 'api', 'presupuesto', 'link_de_pago']));
ALTER TABLE public.sale_transactions DROP CONSTRAINT IF EXISTS sale_transactions_source_check;
ALTER TABLE public.sale_transactions ADD CONSTRAINT sale_transactions_source_check CHECK (source = ANY (ARRAY[
  'manual', 'pos', 'tiendanube', 'tienda_online', 'mercadolibre', 'api', 'presupuesto', 'link_de_pago']));

ALTER TABLE public.payment_links ADD COLUMN IF NOT EXISTS sale_transaction_id uuid;
COMMENT ON COLUMN public.payment_links.sale_transaction_id IS
  'Venta registrada al cobrarse el link (registrar_venta_de_link); evita registrarla dos veces.';

CREATE OR REPLACE FUNCTION public._numero_o_nulo(p text)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE WHEN btrim(coalesce(p, '')) ~ '^-?\d+(\.\d+)?$' THEN btrim(p)::numeric END;
$$;
REVOKE ALL ON FUNCTION public._numero_o_nulo(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._numero_o_nulo(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.registrar_venta_de_link(p_link_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  l public.payment_links;
  v_actor uuid;
  v_txn uuid := gen_random_uuid();
  v_items jsonb;
  it jsonb;
  v_suma numeric := 0;
  v_base numeric;
  v_qty numeric;
  v_total numeric;
  v_restante numeric;
  v_n int;
  v_i int := 0;
  v_prod_id uuid;
  v_prod record;
  v_tiene_prod boolean;
  v_nombre text;
  v_tc numeric;
  v_costo_ars numeric;
  v_quote uuid;
  v_libres jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO l FROM public.payment_links WHERE id = p_link_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Link de pago inexistente' USING ERRCODE = 'P0002';
  END IF;
  IF l.sale_transaction_id IS NOT NULL THEN
    RETURN jsonb_build_object('sale_transaction_id', l.sale_transaction_id, 'repetido', true);
  END IF;
  IF l.status IS DISTINCT FROM 'paid' THEN
    RAISE EXCEPTION 'El link todavía no está cobrado' USING ERRCODE = '55000';
  END IF;

  -- La venta queda a nombre del dueño (o un administrador): el cobro llegó sin cajero.
  SELECT user_id INTO v_actor FROM public.memberships
   WHERE org_id = l.org_id AND role IN ('owner', 'admin')
   ORDER BY (role = 'owner') DESC, joined_at NULLS LAST, created_at LIMIT 1;
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'El negocio no tiene dueño ni administrador para registrar la venta' USING ERRCODE = 'P0002';
  END IF;
  SELECT coalesce(nullif(exchange_rate, 0), 1) INTO v_tc FROM public.settings WHERE org_id = l.org_id;
  v_tc := coalesce(v_tc, 1);

  v_items := CASE WHEN jsonb_typeof(l.items) = 'array' AND jsonb_array_length(l.items) > 0 THEN l.items
                  ELSE jsonb_build_array(jsonb_build_object(
                    'description', coalesce('Presupuesto ' || l.quote_number, 'Cobro por link de pago'), 'qty', 1, 'total', l.total_ars)) END;
  v_n := jsonb_array_length(v_items);
  SELECT coalesce(sum(greatest(0, coalesce(public._numero_o_nulo(e->>'total'),
           coalesce(public._numero_o_nulo(e->>'qty'), 1) * coalesce(public._numero_o_nulo(e->>'unitPrice'), 0)))), 0)
    INTO v_suma FROM jsonb_array_elements(v_items) e;

  -- El presupuesto se marca vendido sólo si todavía se puede (si ya se cobró
  -- en la caja o se rechazó, la venta igual se registra, sin vincularlo).
  IF l.quote_id IS NOT NULL THEN
    SELECT id INTO v_quote FROM public.quotes
     WHERE id = l.quote_id AND org_id = l.org_id AND converted_transaction_id IS NULL AND status IS DISTINCT FROM 'rejected';
  END IF;

  PERFORM set_config('gestiona.sale_transaction_id', v_txn::text, true);
  v_restante := round(coalesce(l.total_ars, 0), 2);
  FOR it IN SELECT value FROM jsonb_array_elements(v_items) LOOP
    v_i := v_i + 1;
    v_qty := round(coalesce(public._numero_o_nulo(it->>'qty'), 1), 3);
    IF v_qty <= 0 THEN v_qty := 1; END IF;
    v_base := greatest(0, coalesce(public._numero_o_nulo(it->>'total'), v_qty * coalesce(public._numero_o_nulo(it->>'unitPrice'), 0)));
    -- Lo cobrado se reparte en proporción; el último renglón cierra la diferencia de redondeo.
    v_total := CASE WHEN v_i = v_n THEN v_restante
                    WHEN v_suma > 0 THEN round(v_base * l.total_ars / v_suma, 2)
                    ELSE round(coalesce(l.total_ars, 0) / v_n, 2) END;
    v_restante := v_restante - v_total;

    v_prod_id := CASE WHEN coalesce(it->>'productId', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                      THEN (it->>'productId')::uuid END;
    v_tiene_prod := false;
    SELECT NULL::uuid AS id, NULL::text AS name, NULL::numeric AS total_cost_usd, NULL::text AS unidad_medida INTO v_prod;
    IF v_prod_id IS NOT NULL THEN
      SELECT id, name, total_cost_usd, unidad_medida INTO v_prod FROM public.products WHERE id = v_prod_id AND org_id = l.org_id;
      v_tiene_prod := FOUND AND NOT (coalesce(v_prod.unidad_medida, 'unidad') = 'unidad' AND v_qty <> trunc(v_qty));
      IF NOT v_tiene_prod THEN
        v_libres := v_libres || to_jsonb(coalesce(nullif(btrim(it->>'description'), ''), 'ítem ' || v_i));
      END IF;
    END IF;
    v_nombre := left(coalesce(nullif(btrim(it->>'description'), ''), CASE WHEN v_tiene_prod THEN v_prod.name END, 'Ítem de link de pago'), 500);
    v_costo_ars := CASE WHEN v_tiene_prod THEN round(coalesce(v_prod.total_cost_usd, 0) * v_tc * v_qty, 2) ELSE 0 END;

    INSERT INTO public.sales (
      user_id, org_id, product_id, product_name, quantity, unit_price_ars, total_ars,
      cost_per_unit_usd, cost_of_goods_ars, profit_ars, profit_usd,
      customer_name, date, paid, payment_method, source, quote_id,
      override_de_precio, payment_discount_percent, payment_discount_ars
    ) VALUES (
      v_actor, l.org_id, CASE WHEN v_tiene_prod THEN v_prod.id END, v_nombre, v_qty, round(v_total / v_qty, 2), v_total,
      CASE WHEN v_tiene_prod THEN coalesce(v_prod.total_cost_usd, 0) ELSE 0 END, v_costo_ars,
      v_total - v_costo_ars, round((v_total - v_costo_ars) / v_tc, 4),
      nullif(btrim(coalesce(l.customer_name, '')), ''), coalesce(l.paid_at, now()), true, 'mercado_pago', 'link_de_pago', v_quote,
      false, 0, 0
    );
  END LOOP;

  UPDATE public.payment_links SET sale_transaction_id = v_txn WHERE id = l.id;
  RETURN jsonb_build_object('sale_transaction_id', v_txn, 'renglones', v_n, 'libres', v_libres,
                            'presupuesto', v_quote, 'repetido', false);
END;
$$;
REVOKE ALL ON FUNCTION public.registrar_venta_de_link(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_venta_de_link(uuid) TO service_role;

COMMIT;
