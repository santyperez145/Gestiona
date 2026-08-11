-- A8 — el IVA deja de ser una tasa única para toda la orden.
--
-- ── Qué estaba mal ───────────────────────────────────────────────────────
--
-- Desde A3 la orden discrimina IVA, pero `trg_iva_de_orden` aplica **una sola
-- tasa a todo el total**. Con un catálogo de perfumes al 21% eso da bien de
-- casualidad. El día que entre un producto al 10,5% —libros, algunos
-- alimentos, ciertos productos de salud— o uno exento, la orden factura mal, y
-- factura mal en silencio: el número existe, es plausible, y nadie lo mira
-- hasta que lo mira ARCA.
--
-- ── Cómo se resuelve ─────────────────────────────────────────────────────
--
-- `products.tax_rate` por producto. **NULL significa "la de la organización"**,
-- no "cero": un catálogo entero sin tocar sigue funcionando exactamente igual
-- que antes, y sólo se carga la tasa donde difiere. Cero es una tasa válida y
-- distinta —exento— y por eso no se puede usar el default para significar
-- "no configurado".
--
-- ── La parte que tiene truco: repartir el total entre las líneas ─────────
--
-- El IVA se calcula **por línea y se suma**, que es como se arma cualquier
-- factura. Pero la base de cada línea no es `precio × cantidad`: la orden tiene
-- descuentos a nivel de orden (cupones, promociones de orden) que bajan el
-- total sin estar en ninguna línea. Si se ignoran, la suma de las bases supera
-- el total y el IVA sale de más.
--
-- Por eso el descuento se **prorratea** entre las líneas con `prorratear()`
-- (A9), que garantiza que las partes sumen exactamente el total. Sin eso, tres
-- líneas iguales sobre un total de $100 dejan un centavo colgado, y ese centavo
-- es la diferencia entre que la factura cierre y que no.
--
-- **El envío va a la tasa de la organización, no a la de ningún producto.** El
-- flete es un servicio: no hereda la alícuota de lo que se despacha.
--
-- ── Lo que se conserva a propósito ───────────────────────────────────────
--
-- Si `tax_amount` ya viene calculado, se respeta — quien lo sabe con certeza
-- gana. Si la organización no discrimina IVA (monotributo), sigue dando cero.
-- Y si no se puede resolver ninguna línea (items vacío, o una orden importada
-- de otro canal), se cae al cálculo anterior sobre el total: es mejor el número
-- de antes que ningún número.
--
-- Idempotente.

-- ── La tasa por producto ─────────────────────────────────────────────────
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS tax_rate numeric;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'products_tax_rate_valida'
  ) THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_tax_rate_valida
      CHECK (tax_rate IS NULL OR (tax_rate >= 0 AND tax_rate <= 100));
  END IF;
END;
$$;

COMMENT ON COLUMN public.products.tax_rate IS
  'Alicuota de IVA del producto. NULL = usa la de la organizacion (settings.tax_iva_percent). Cero es exento, que es distinto de NULL.';

-- ── El IVA de la orden, línea por línea ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_iva_de_orden()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_habilitado boolean;
  v_tasa_org   numeric;
  v_incluido   boolean;
  v_moneda     text;
  v_envio      numeric;
  v_base_merca numeric;
  v_item       jsonb;
  v_pesos      numeric[] := '{}';
  v_tasas      numeric[] := '{}';
  v_bases      numeric[] := '{}';
  v_i          int;
  v_iva_total  numeric := 0;
  v_desglose   jsonb;
BEGIN
  -- Si alguien ya lo calculó, se respeta: quien lo sabe con certeza gana.
  IF COALESCE(NEW.tax_amount, 0) > 0 THEN RETURN NEW; END IF;

  SELECT s.tax_enabled, s.tax_iva_percent, s.tax_prices_include_iva
    INTO v_habilitado, v_tasa_org, v_incluido
    FROM public.settings s WHERE s.org_id = NEW.org_id LIMIT 1;

  -- Un monotributista no discrimina IVA. Sin configuración tampoco se inventa.
  IF NOT COALESCE(v_habilitado, false) OR COALESCE(v_tasa_org, 0) <= 0 THEN
    NEW.tax_amount := 0;
    RETURN NEW;
  END IF;

  -- ⚠️ `ecommerce_orders` **no tiene** columna `currency` —el ROADMAP decia
  -- que si—, asi que hoy es ARS fijo. Se deja como variable y no como literal
  -- porque es el unico punto que hay que tocar cuando llegue B6: sin esto, el
  -- redondeo de una orden en otra moneda quedaria mal en cinco lugares.
  v_moneda   := 'ARS';
  v_incluido := COALESCE(v_incluido, true);
  v_envio    := GREATEST(COALESCE(NEW.shipping_cost, 0), 0);

  -- La mercadería es el total menos el flete. Los descuentos de orden ya están
  -- adentro de `total`, así que prorratearlos es automático: se reparte esta
  -- base, no la suma de las líneas.
  v_base_merca := GREATEST(COALESCE(NEW.total, 0) - v_envio, 0);

  -- El peso de cada línea es lo que representa en la mercadería, y su tasa sale
  -- del producto. Una línea sin producto identificable usa la de la
  -- organización: es lo mismo que hacía antes para toda la orden.
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(NEW.items, '[]'::jsonb)) LOOP
    v_pesos := v_pesos || GREATEST(
      COALESCE((v_item->>'unit_price')::numeric, 0)
        * GREATEST(COALESCE((v_item->>'quantity')::int, 0), 0), 0);
    v_tasas := v_tasas || COALESCE(
      (SELECT p.tax_rate FROM public.products p
        WHERE p.id = NULLIF(v_item->>'product_id', '')::uuid),
      v_tasa_org);
  END LOOP;

  -- Sin líneas resolubles se cae al cálculo anterior sobre el total: el número
  -- de antes es mejor que ningún número.
  IF COALESCE(array_length(v_pesos, 1), 0) = 0 THEN
    v_desglose := public.desglosar_iva(NEW.total, v_tasa_org, v_incluido);
    NEW.tax_amount := (v_desglose->>'iva')::numeric;
    RETURN NEW;
  END IF;

  v_bases := public.prorratear(v_base_merca, v_pesos, v_moneda);

  FOR v_i IN 1..array_length(v_bases, 1) LOOP
    v_desglose  := public.desglosar_iva(v_bases[v_i], v_tasas[v_i], v_incluido);
    v_iva_total := v_iva_total + (v_desglose->>'iva')::numeric;
  END LOOP;

  -- El flete es un servicio: va a la tasa de la organización, no hereda la
  -- alícuota de lo que se despacha.
  IF v_envio > 0 THEN
    v_desglose  := public.desglosar_iva(v_envio, v_tasa_org, v_incluido);
    v_iva_total := v_iva_total + (v_desglose->>'iva')::numeric;
  END IF;

  NEW.tax_amount := public.redondear_moneda(v_iva_total, v_moneda);
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.trg_iva_de_orden IS
  'Calcula tax_amount al crear la orden, linea por linea con la alicuota de cada producto (products.tax_rate, NULL = la de la organizacion). Los descuentos de orden se prorratean; el envio va a la tasa de la organizacion. Si no hay lineas resolubles cae al calculo sobre el total.';

-- ── Lo que la tienda pública necesita saber por producto ─────────────────
-- Se agrega al FINAL de la firma para no romper a quien lee por posicion.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'store_catalog_products'
       AND column_name = 'tax_rate'
  ) THEN
    RAISE NOTICE 'store_catalog_products ya expone tax_rate';
  END IF;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Verificación contra datos reales, con limpieza
-- ═══════════════════════════════════════════════════════════════════════════
DO $verif$
DECLARE
  v_org      uuid;
  v_user     uuid;
  v_store    uuid;
  v_p21      uuid;
  v_p105     uuid;
  v_pex      uuid;
  v_orden    uuid;
  v_tax      numeric;
  v_esperado numeric;
  v_restos   int;
BEGIN
  SELECT org_id INTO v_org FROM public.settings
   WHERE tax_enabled AND COALESCE(tax_iva_percent, 0) > 0 LIMIT 1;
  IF v_org IS NULL THEN
    RAISE NOTICE 'A8: ninguna organizacion discrimina IVA, no hay nada que verificar';
    RETURN;
  END IF;

  -- `products.user_id` es NOT NULL: se usa un miembro real de la organizacion.
  SELECT m.user_id INTO v_user FROM public.memberships m
   WHERE m.org_id = v_org ORDER BY (m.role = 'owner') DESC LIMIT 1;
  IF v_user IS NULL THEN
    RAISE NOTICE 'A8: la organizacion no tiene miembros, no se puede verificar';
    RETURN;
  END IF;

  SELECT id INTO v_store FROM public.ecommerce_stores WHERE org_id = v_org LIMIT 1;
  IF v_store IS NULL THEN
    RAISE NOTICE 'A8: la organizacion no tiene tienda, no se puede verificar';
    RETURN;
  END IF;

  CREATE TEMP TABLE zz_a8 (caso text, valor text) ON COMMIT DROP;

  INSERT INTO public.products (org_id, user_id, name, sale_price_ars, stock, tax_rate)
  VALUES (v_org, v_user, 'ZZ IVA 21', 1000, 10, 21)   RETURNING id INTO v_p21;
  INSERT INTO public.products (org_id, user_id, name, sale_price_ars, stock, tax_rate)
  VALUES (v_org, v_user, 'ZZ IVA 105', 1000, 10, 10.5) RETURNING id INTO v_p105;
  INSERT INTO public.products (org_id, user_id, name, sale_price_ars, stock, tax_rate)
  VALUES (v_org, v_user, 'ZZ exento', 1000, 10, 0)     RETURNING id INTO v_pex;

  -- Una orden con las tres alicuotas, sin envio ni descuento: el caso limpio.
  INSERT INTO public.ecommerce_orders (
    org_id, store_id, order_number, customer_name, customer_email,
    items, subtotal, shipping_cost, discount_amount, total, payment_status
  ) VALUES (
    v_org, v_store, 'ZZ-A8-1', 'ZZ Prueba', 'zz@ejemplo.invalid',
    jsonb_build_array(
      jsonb_build_object('product_id', v_p21,  'quantity', 1, 'unit_price', 1000, 'name', 'ZZ IVA 21'),
      jsonb_build_object('product_id', v_p105, 'quantity', 1, 'unit_price', 1000, 'name', 'ZZ IVA 105'),
      jsonb_build_object('product_id', v_pex,  'quantity', 1, 'unit_price', 1000, 'name', 'ZZ exento')
    ),
    3000, 0, 0, 3000, 'pending'
  ) RETURNING id, tax_amount INTO v_orden, v_tax;

  -- Precios con IVA incluido: 1000/1,21 + 1000/1,105 + 0 exento.
  v_esperado := round(1000 - round(1000 / 1.21, 2), 2)
              + round(1000 - round(1000 / 1.105, 2), 2);
  INSERT INTO zz_a8 VALUES ('tres_alicuotas', format('%s (esperado %s)', v_tax, v_esperado));

  ASSERT abs(v_tax - v_esperado) < 0.05,
    format('IVA por linea dio %s y se esperaba %s', v_tax, v_esperado);

  -- La prueba de que servia: con la tasa unica anterior habria dado otra cosa.
  INSERT INTO zz_a8 VALUES ('tasa_unica_habria_dado',
    (public.desglosar_iva(3000, 21, true)->>'iva'));

  -- Una orden con producto sin tasa propia: tiene que dar igual que antes.
  INSERT INTO public.ecommerce_orders (
    org_id, store_id, order_number, customer_name, customer_email,
    items, subtotal, shipping_cost, discount_amount, total, payment_status
  ) VALUES (
    v_org, v_store, 'ZZ-A8-2', 'ZZ Prueba', 'zz@ejemplo.invalid',
    jsonb_build_array(
      jsonb_build_object('product_id', NULL, 'quantity', 1, 'unit_price', 1210, 'name', 'ZZ sin id')
    ),
    1210, 0, 0, 1210, 'pending'
  ) RETURNING tax_amount INTO v_tax;
  INSERT INTO zz_a8 VALUES ('sin_tasa_propia', v_tax::text);
  ASSERT v_tax = (public.desglosar_iva(1210, 21, true)->>'iva')::numeric,
    'sin tasa propia deberia dar lo mismo que antes';

  -- Con descuento de orden: la base baja y el IVA tambien. Si el descuento se
  -- ignorara, el IVA saldria de mas.
  INSERT INTO public.ecommerce_orders (
    org_id, store_id, order_number, customer_name, customer_email,
    items, subtotal, shipping_cost, discount_amount, total, payment_status
  ) VALUES (
    v_org, v_store, 'ZZ-A8-3', 'ZZ Prueba', 'zz@ejemplo.invalid',
    jsonb_build_array(
      jsonb_build_object('product_id', v_p21, 'quantity', 2, 'unit_price', 1000, 'name', 'ZZ IVA 21')
    ),
    2000, 0, 500, 1500, 'pending'
  ) RETURNING tax_amount INTO v_tax;
  INSERT INTO zz_a8 VALUES ('con_descuento', v_tax::text);
  ASSERT v_tax = (public.desglosar_iva(1500, 21, true)->>'iva')::numeric,
    format('con descuento deberia gravar 1500 y dio %s', v_tax);

  RAISE NOTICE 'A8 %', (SELECT string_agg(caso || ': ' || valor, ' | ') FROM zz_a8);

  -- ── Limpieza ───────────────────────────────────────────────────────────
  DELETE FROM public.ecommerce_orders WHERE org_id = v_org AND order_number LIKE 'ZZ-A8-%';
  DELETE FROM public.stock_movements  WHERE product_id IN (v_p21, v_p105, v_pex);
  DELETE FROM public.price_history    WHERE product_id IN (v_p21, v_p105, v_pex);
  DELETE FROM public.products         WHERE id IN (v_p21, v_p105, v_pex);

  SELECT (SELECT count(*) FROM public.products WHERE name LIKE 'ZZ IVA%' OR name = 'ZZ exento')
       + (SELECT count(*) FROM public.ecommerce_orders WHERE order_number LIKE 'ZZ-A8-%')
    INTO v_restos;
  RAISE NOTICE 'A8 restos: %', v_restos;
  ASSERT v_restos = 0, format('quedaron %s restos de la prueba', v_restos);
END;
$verif$;
