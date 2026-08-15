-- C7 / MercadoLibre: una orden cobrada deja de ser una fila aislada y pasa al
-- Business Core. El navegador sólo elige la orden: precio, comisión, costo,
-- usuario, ventas y stock se resuelven en esta transacción dentro de la base.
--
-- MercadoLibre informa `sale_fee` por línea de una orden paid. Se conserva en
-- `meli_order_sale_lines` y en `payment_transactions`, para que E4 pueda
-- comparar márgenes por canal sin volver a consultar ni adivinar la comisión.
-- El costo de envío de ML no está en /orders y queda explícitamente fuera de
-- este slice; no se inventa una tarifa para completar el margen.

-- Una orden puede tener más de un producto y `meli_orders.sale_id` sólo podía
-- guardar una venta. La columna se mantiene como primera venta por
-- compatibilidad; esta tabla es el vínculo completo y auditable.
CREATE TABLE IF NOT EXISTS public.meli_order_sale_lines (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  meli_order_id uuid NOT NULL REFERENCES public.meli_orders(id) ON DELETE CASCADE,
  sale_id       uuid NOT NULL REFERENCES public.sales(id) ON DELETE RESTRICT,
  line_number   integer NOT NULL CHECK (line_number >= 1),
  meli_item_id  text NOT NULL,
  sale_fee_ars  numeric(14,2) NOT NULL DEFAULT 0 CHECK (sale_fee_ars >= 0),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (meli_order_id, line_number),
  UNIQUE (sale_id)
);

CREATE INDEX IF NOT EXISTS meli_order_sale_lines_org_idx
  ON public.meli_order_sale_lines(org_id, created_at DESC);

ALTER TABLE public.meli_order_sale_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "meli_order_sale_lines_select" ON public.meli_order_sale_lines;
CREATE POLICY "meli_order_sale_lines_select" ON public.meli_order_sale_lines
  FOR SELECT TO authenticated
  USING (public.is_org_member(org_id, auth.uid()));

-- Las órdenes y sus vínculos son evidencia que baja desde MercadoLibre. Antes
-- un owner/admin podía editar `items`, precio o estado desde PostgREST y luego
-- convertir esa edición en una venta. Ninguna pantalla escribe estas tablas:
-- las Edge Functions lo hacen con service_role.
DROP POLICY IF EXISTS "meli_orders_select" ON public.meli_orders;
DROP POLICY IF EXISTS "meli_orders_write" ON public.meli_orders;
CREATE POLICY "meli_orders_select" ON public.meli_orders
  FOR SELECT TO authenticated
  USING (public.is_org_member(org_id, auth.uid()));

DROP POLICY IF EXISTS "meli_listings_select" ON public.meli_listings;
DROP POLICY IF EXISTS "meli_listings_write" ON public.meli_listings;
CREATE POLICY "meli_listings_select" ON public.meli_listings
  FOR SELECT TO authenticated
  USING (public.is_org_member(org_id, auth.uid()));

-- `payment_transactions` separa bruto, comisión y neto. MercadoLibre es un
-- canal distinto de ecommerce propio: no debe disparar la comisión de la
-- plataforma Gestiona ni reutilizar un arancel estimado de MercadoPago.
ALTER TABLE public.payment_transactions
  DROP CONSTRAINT IF EXISTS payment_transactions_source_check;
ALTER TABLE public.payment_transactions
  ADD CONSTRAINT payment_transactions_source_check
  CHECK (source IN ('ecommerce','payment_link','pos','subscription','mercadolibre','otro'));

CREATE OR REPLACE FUNCTION public.import_meli_order_as_sales(
  p_org_id uuid,
  p_meli_order_id uuid,
  p_actor_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order            public.meli_orders%ROWTYPE;
  v_item             jsonb;
  v_product          record;
  v_item_id          text;
  v_quantity         integer;
  v_unit_price       numeric;
  v_line_fee         numeric;
  v_cost_per_unit_usd numeric;
  v_cost_ars         numeric;
  v_line_total       numeric;
  v_line_profit      numeric;
  v_exchange_rate    numeric := 1695;
  v_sale_id          uuid;
  v_first_sale_id    uuid;
  v_line_number      integer := 0;
  v_sales_count      integer := 0;
  v_sales            jsonb := '[]'::jsonb;
  v_total_sales      numeric := 0;
  v_total_fee        numeric := 0;
  v_payment_gross    numeric;
BEGIN
  -- La Edge Function sólo llama esto para owner/admin. Repetirlo en la base
  -- evita que un error futuro en el handler convierta una orden ajena o con un
  -- actor inventado. El EXECUTE queda restringido a service_role más abajo.
  IF NOT public.has_org_role(p_org_id, p_actor_id, ARRAY['owner','admin']) THEN
    RAISE EXCEPTION 'Unauthorized: requires owner/admin role';
  END IF;

  SELECT * INTO v_order
  FROM public.meli_orders
  WHERE id = p_meli_order_id AND org_id = p_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orden de MercadoLibre no encontrada en la organización';
  END IF;

  IF lower(COALESCE(v_order.status, '')) <> 'paid' THEN
    RAISE EXCEPTION 'Sólo se pueden importar órdenes cobradas de MercadoLibre';
  END IF;

  IF v_order.imported_at IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(sale_id ORDER BY line_number), '[]'::jsonb)
      INTO v_sales
    FROM public.meli_order_sale_lines
    WHERE meli_order_id = v_order.id;

    RETURN jsonb_build_object(
      'already_imported', true,
      'ventas', jsonb_array_length(v_sales),
      'sale_ids', v_sales
    );
  END IF;

  IF jsonb_typeof(v_order.items) IS DISTINCT FROM 'array'
     OR jsonb_array_length(v_order.items) = 0 THEN
    RAISE EXCEPTION 'La orden no tiene productos para importar';
  END IF;

  -- Es el mismo fallback que usan POS y Ventas. Es una referencia de la
  -- organización, nunca un número que llega desde el navegador.
  SELECT COALESCE(NULLIF(exchange_rate, 0), 1695)
    INTO v_exchange_rate
  FROM public.settings
  WHERE org_id = p_org_id
  LIMIT 1;
  v_exchange_rate := COALESCE(v_exchange_rate, 1695);

  FOR v_item IN SELECT value FROM jsonb_array_elements(v_order.items)
  LOOP
    v_line_number := v_line_number + 1;
    v_item_id := NULLIF(btrim(v_item->>'item_id'), '');

    BEGIN
      v_quantity := (v_item->>'quantity')::integer;
      v_unit_price := (v_item->>'unit_price')::numeric;
      v_line_fee := NULLIF(v_item->>'sale_fee', '')::numeric;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'La orden tiene una línea con cantidad, precio o comisión inválidos';
    END;

    IF v_item_id IS NULL OR v_quantity IS NULL OR v_quantity <= 0
       OR v_unit_price IS NULL OR v_unit_price < 0 THEN
      RAISE EXCEPTION 'La orden tiene una línea incompleta o inválida';
    END IF;

    -- Las órdenes descargadas antes de este slice guardaban el payload entero
    -- en `raw`, pero todavía no copiaban sale_fee dentro de `items`. Recuperar
    -- ese valor permite importarlas sin convertir una comisión desconocida en
    -- cero. Si ML no la informó en ninguno de los dos lugares, se corta: el
    -- margen no puede fingirse como completo.
    IF v_line_fee IS NULL THEN
      SELECT NULLIF(raw_item->>'sale_fee', '')::numeric
        INTO v_line_fee
      FROM jsonb_array_elements(COALESCE(v_order.raw->'order_items', '[]'::jsonb)) raw_item
      WHERE raw_item->'item'->>'id' = v_item_id
      LIMIT 1;
    END IF;

    IF v_line_fee IS NULL OR v_line_fee < 0 THEN
      RAISE EXCEPTION 'MercadoLibre no informó una comisión válida para la publicación %', v_item_id;
    END IF;

    -- El vínculo publicado es la autoridad para saber qué producto interno se
    -- vendió. No se intenta adivinar por título: una coincidencia falsa mueve
    -- el stock del perfume equivocado.
    SELECT p.id, p.name, p.total_cost_usd
      INTO v_product
    FROM public.meli_listings ml
    JOIN public.products p ON p.id = ml.product_id AND p.org_id = ml.org_id
    WHERE ml.org_id = p_org_id
      AND ml.meli_item_id = v_item_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'La publicación % no está vinculada a un producto de Gestiona', v_item_id;
    END IF;

    -- Espejo servidor de `calcMeliLineMargin()` en businessCalc.ts. SQL es la
    -- autoridad porque los importes de una venta no pueden venir calculados
    -- desde el navegador.
    v_cost_per_unit_usd := COALESCE(v_product.total_cost_usd, 0);
    v_cost_ars := round(v_cost_per_unit_usd * v_exchange_rate * v_quantity, 2);
    v_line_total := round(v_unit_price * v_quantity, 2);
    v_line_profit := round(v_line_total - v_cost_ars - v_line_fee, 2);

    INSERT INTO public.sales (
      user_id, org_id, product_id, product_name, quantity, unit_price_ars,
      total_ars, cost_per_unit_usd, cost_of_goods_ars, profit_ars, profit_usd,
      customer_name, date, paid, payment_method, source
    ) VALUES (
      p_actor_id, p_org_id, v_product.id, v_product.name, v_quantity, v_unit_price,
      v_line_total, v_cost_per_unit_usd, v_cost_ars, v_line_profit,
      round(v_line_profit / v_exchange_rate, 4),
      NULLIF(btrim(v_order.buyer_nickname), ''), COALESCE(v_order.date_created, now()),
      true, 'mercadolibre', 'mercadolibre'
    ) RETURNING id INTO v_sale_id;

    INSERT INTO public.meli_order_sale_lines (
      org_id, meli_order_id, sale_id, line_number, meli_item_id, sale_fee_ars
    ) VALUES (
      p_org_id, v_order.id, v_sale_id, v_line_number, v_item_id, v_line_fee
    );

    v_first_sale_id := COALESCE(v_first_sale_id, v_sale_id);
    v_sales_count := v_sales_count + 1;
    v_sales := v_sales || to_jsonb(v_sale_id);
    v_total_sales := v_total_sales + v_line_total;
    v_total_fee := v_total_fee + v_line_fee;
  END LOOP;

  -- total_ars es la cifra recibida de MercadoLibre para el cobro. Si una orden
  -- histórica no la trajo, se conserva la suma de sus líneas, que acabamos de
  -- validar. Una comisión mayor al bruto es un dato corrupto, no algo para
  -- esconder con GREATEST(0, ...).
  v_payment_gross := COALESCE(NULLIF(v_order.total_ars, 0), v_total_sales);
  IF v_payment_gross <= 0 THEN
    RAISE EXCEPTION 'La orden no informa un total cobrable';
  END IF;
  IF v_total_fee > v_payment_gross THEN
    RAISE EXCEPTION 'La comisión de MercadoLibre supera el total de la orden';
  END IF;

  INSERT INTO public.payment_transactions (
    org_id, source, source_id, provider, method, installments,
    gross_amount, provider_fee, provider_fee_iva, platform_fee, net_amount,
    currency, status, external_id, released_at, raw
  ) VALUES (
    p_org_id, 'mercadolibre', v_order.id, 'mercadolibre', 'marketplace', 0,
    round(v_payment_gross, 2), round(v_total_fee, 2), 0, 0,
    round(v_payment_gross - v_total_fee, 2), 'ARS', 'approved',
    'meli-order:' || v_order.meli_order_id::text, now(), v_order.raw
  )
  ON CONFLICT (provider, external_id) DO UPDATE
    SET status = EXCLUDED.status,
        updated_at = now();

  UPDATE public.meli_orders
  SET sale_id = v_first_sale_id,
      imported_at = now()
  WHERE id = v_order.id;

  RETURN jsonb_build_object(
    'already_imported', false,
    'ventas', v_sales_count,
    'sale_ids', v_sales,
    'fee_ars', round(v_total_fee, 2)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.import_meli_order_as_sales(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.import_meli_order_as_sales(uuid, uuid, uuid)
  TO service_role;

-- Verificación real y autocontenida: dos líneas de una orden paid entran como
-- dos ventas, el trigger existente descuenta una vez por línea y la segunda
-- llamada no duplica nada. La última comprobación exige cero restos ZZ.
DO $verificar$
DECLARE
  v_user_id uuid;
  v_org_id uuid;
  v_product_a uuid;
  v_product_b uuid;
  v_order_id uuid;
  v_suffix text := substr(gen_random_uuid()::text, 1, 8);
  v_result jsonb;
  v_repeat jsonb;
  v_sales integer;
  v_links integer;
  v_stock integer;
  v_profit numeric;
  v_fee numeric;
  v_net numeric;
  v_can_execute boolean;
  v_write_policies integer;
BEGIN
  SELECT id INTO v_user_id FROM auth.users ORDER BY created_at LIMIT 1;
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'C7 necesita un usuario existente para verificar la importación';
  END IF;

  INSERT INTO public.organizations (name, slug, owner_user_id)
  VALUES ('ZZ importación MercadoLibre', 'zz-meli-import-' || v_suffix, v_user_id)
  RETURNING id INTO v_org_id;

  INSERT INTO public.memberships (org_id, user_id, role)
  VALUES (v_org_id, v_user_id, 'owner');

  INSERT INTO public.products (org_id, user_id, name, sale_price_ars, total_cost_usd)
  VALUES (v_org_id, v_user_id, 'ZZ ML producto A', 100, 1)
  RETURNING id INTO v_product_a;

  INSERT INTO public.products (org_id, user_id, name, sale_price_ars, total_cost_usd)
  VALUES (v_org_id, v_user_id, 'ZZ ML producto B', 200, 2)
  RETURNING id INTO v_product_b;

  INSERT INTO public.meli_listings (org_id, product_id, meli_item_id)
  VALUES
    (v_org_id, v_product_a, 'MLAZZ' || v_suffix || 'A'),
    (v_org_id, v_product_b, 'MLAZZ' || v_suffix || 'B');

  INSERT INTO public.meli_orders (
    org_id, meli_order_id, status, buyer_nickname, total_ars, items, date_created, raw
  ) VALUES (
    v_org_id, 900000000000 + floor(random() * 999999)::bigint, 'paid',
    'zz-comprador', 300,
    jsonb_build_array(
      jsonb_build_object('item_id', 'MLAZZ' || v_suffix || 'A', 'quantity', 1, 'unit_price', 100, 'sale_fee', 10),
      jsonb_build_object('item_id', 'MLAZZ' || v_suffix || 'B', 'quantity', 1, 'unit_price', 200, 'sale_fee', 20)
    ), now(), jsonb_build_object('origin', 'ZZ verification')
  ) RETURNING id INTO v_order_id;

  SELECT public.import_meli_order_as_sales(v_org_id, v_order_id, v_user_id)
    INTO v_result;
  SELECT public.import_meli_order_as_sales(v_org_id, v_order_id, v_user_id)
    INTO v_repeat;

  SELECT count(*), COALESCE(sum(profit_ars), 0)
    INTO v_sales, v_profit
  FROM public.sales
  WHERE org_id = v_org_id AND source = 'mercadolibre';

  SELECT count(*) INTO v_links
  FROM public.meli_order_sale_lines
  WHERE meli_order_id = v_order_id;

  SELECT count(*) INTO v_stock
  FROM public.stock_movements
  WHERE org_id = v_org_id AND movement_type = 'sale' AND quantity = -1;

  SELECT provider_fee, net_amount INTO v_fee, v_net
  FROM public.payment_transactions
  WHERE org_id = v_org_id AND source = 'mercadolibre';

  SELECT has_function_privilege(
    'authenticated',
    'public.import_meli_order_as_sales(uuid,uuid,uuid)',
    'EXECUTE'
  ) INTO v_can_execute;

  -- `db query` asume el rol postgres, que tiene BYPASSRLS y no sirve para
  -- probar un UPDATE real como authenticated. El catálogo sí expresa la
  -- barrera efectiva: sólo pueden quedar policies SELECT y el RPC no puede
  -- tener EXECUTE para ese rol.
  SELECT count(*) INTO v_write_policies
  FROM pg_policy
  WHERE polrelid IN ('public.meli_orders'::regclass, 'public.meli_listings'::regclass)
    AND polcmd <> 'r';

  IF (v_result->>'ventas')::integer <> 2
     OR (v_repeat->>'already_imported')::boolean IS NOT TRUE
     OR v_sales <> 2 OR v_links <> 2 OR v_stock <> 2
     OR v_profit <> -4815 OR v_fee <> 30 OR v_net <> 270
     OR v_can_execute OR v_write_policies <> 0 THEN
    RAISE EXCEPTION
      'C7 falló: resultado %, repetición %, ventas %, links %, stock %, ganancia %, fee %, neto %, execute authenticated %, policies de escritura %',
      v_result, v_repeat, v_sales, v_links, v_stock, v_profit, v_fee, v_net, v_can_execute, v_write_policies;
  END IF;

  -- Se borra explícitamente el vínculo primero porque en producción una venta
  -- importada no debe desaparecer sin resolver el pedido externo.
  DELETE FROM public.meli_order_sale_lines WHERE meli_order_id = v_order_id;
  -- El trigger de ventas devuelve el stock al borrar. Hacerlo antes de borrar
  -- la organización conserva la FK del asiento; un DELETE en cascada desde la
  -- org eliminaría primero el padre y el trigger no podría dejar el Kardex.
  DELETE FROM public.sales WHERE org_id = v_org_id;
  DELETE FROM public.organizations WHERE id = v_org_id;

  IF EXISTS (SELECT 1 FROM public.organizations WHERE id = v_org_id)
     OR EXISTS (SELECT 1 FROM public.products WHERE id IN (v_product_a, v_product_b))
     OR EXISTS (SELECT 1 FROM public.meli_orders WHERE id = v_order_id)
     OR EXISTS (SELECT 1 FROM public.sales WHERE org_id = v_org_id)
     OR EXISTS (SELECT 1 FROM public.stock_movements WHERE org_id = v_org_id)
     OR EXISTS (SELECT 1 FROM public.payment_transactions WHERE org_id = v_org_id) THEN
    RAISE EXCEPTION 'C7 dejó filas ZZ';
  END IF;

  RAISE NOTICE 'C7 verificado: paid multi-línea importada una vez, comisión real registrada y restos ZZ 0';
END
$verificar$;
