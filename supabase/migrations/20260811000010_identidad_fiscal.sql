-- ═══════════════════════════════════════════════════════════════════════════
-- Identidad fiscal — quién emite y quién recibe
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Hasta acá el sistema sabía **cuánto** IVA tenía una orden, pero no **quién**
-- la emite ni **a quién**. Esas dos cosas deciden si la venta lleva Factura A,
-- B o C, y si el IVA se discrimina. Sin eso no se puede emitir un comprobante,
-- que es el bloqueo del circuito ARCA entero y el riesgo fiscal más grande del
-- sistema hoy.
--
-- ⚠️ **Un bug fiscal encontrado midiendo, no leyendo.** La organización está
-- configurada como `afip_tipo_emisor = 'monotributo'` y sus órdenes llevaban
-- IVA discriminado: **$84.305 sobre una orden de $485.760**. Un monotributista
-- no discrimina IVA — emite comprobante clase C, donde el neto es el total y el
-- IVA es cero. El trigger tenía la regla escrita en un comentario
-- —"Un monotributista no discrimina IVA"— y **nunca leía la columna**: sólo
-- miraba `tax_enabled` y `tax_iva_percent`, que están en 21%.
--
-- ── Las dos preguntas, en orden ───────────────────────────────────────────
--
-- **1. ¿Se discrimina IVA?** Lo decide el emisor y nada más que el emisor.
-- Sólo un responsable inscripto discrimina.
--
-- **2. ¿Qué comprobante se emite?**
--
--     emisor monotributo o exento  → siempre C
--     emisor responsable inscripto → A si el receptor es responsable inscripto
--                                    B para todos los demás
--
-- La A existe para que el receptor se tome el crédito fiscal. Un monotributista
-- o un consumidor final no pueden tomarlo, así que reciben B. No es una
-- preferencia del comercio: es para qué sirve cada clase.
--
-- ⚠️ Queda afuera la **Factura M**, que ARCA le asigna a un responsable
-- inscripto recién inscripto o con comportamiento fiscal observado. Es una
-- condición que fija el organismo, no algo que el sistema pueda deducir.
--
-- Espejo de `src/lib/fiscalIdentity.ts`, con 35 tests. Si se toca una, se toca
-- la otra.
--
-- **Esto no es asesoramiento fiscal**: es la codificación de reglas publicadas.
-- Los códigos numéricos son los de ARCA para el web service WSFE.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. El umbral de identificación obligatoria ─────────────────────────────
--
-- Arriba de cierto importe hay que identificar al comprador aunque sea
-- consumidor final. Ese monto lo fija una resolución que se actualiza por
-- inflación, así que es configuración y no una constante horneada.
--
-- ⚠️ NULL = el comercio no lo cargó y no se exige. Es una decisión con
-- consecuencia, y se prefiere a inventar un número que en seis meses está
-- viejo y hace fallar checkouts legítimos.

ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS fiscal_id_required_above numeric;

COMMENT ON COLUMN public.settings.fiscal_id_required_above IS
  'Monto desde el cual ARCA exige identificar al comprador consumidor final. NULL = sin configurar, no se exige.';

-- ── 2. La identidad del comprador en la orden ──────────────────────────────

ALTER TABLE public.ecommerce_orders
  ADD COLUMN IF NOT EXISTS buyer_tax_condition text,
  ADD COLUMN IF NOT EXISTS buyer_doc_type      int,
  ADD COLUMN IF NOT EXISTS buyer_doc_number    text,
  ADD COLUMN IF NOT EXISTS buyer_business_name text,
  ADD COLUMN IF NOT EXISTS comprobante_letra   text,
  ADD COLUMN IF NOT EXISTS comprobante_tipo_afip int;

ALTER TABLE public.ecommerce_orders DROP CONSTRAINT IF EXISTS orders_buyer_tax_condition_valida;
ALTER TABLE public.ecommerce_orders ADD CONSTRAINT orders_buyer_tax_condition_valida
  CHECK (buyer_tax_condition IS NULL OR buyer_tax_condition IN
    ('consumidor_final', 'responsable_inscripto', 'monotributo', 'exento'));

ALTER TABLE public.ecommerce_orders DROP CONSTRAINT IF EXISTS orders_comprobante_letra_valida;
ALTER TABLE public.ecommerce_orders ADD CONSTRAINT orders_comprobante_letra_valida
  CHECK (comprobante_letra IS NULL OR comprobante_letra IN ('A', 'B', 'C'));

COMMENT ON COLUMN public.ecommerce_orders.buyer_doc_type IS
  'Código de tipo de documento de ARCA: 80 CUIT, 86 CUIL, 96 DNI, 99 sin identificar.';
COMMENT ON COLUMN public.ecommerce_orders.comprobante_tipo_afip IS
  'Código WSFE de factura: 1 = A, 6 = B, 11 = C.';

-- ── 3. Las reglas, en SQL, espejo del módulo ───────────────────────────────

CREATE OR REPLACE FUNCTION public.discrimina_iva(p_emisor text)
RETURNS boolean LANGUAGE sql IMMUTABLE
AS $fn$
  -- Sólo el responsable inscripto. Ante un valor desconocido, false: no
  -- discriminar de más es el error barato — discriminar IVA que no corresponde
  -- es facturar mal.
  SELECT COALESCE(p_emisor, '') = 'responsable_inscripto';
$fn$;

CREATE OR REPLACE FUNCTION public.tipo_de_comprobante(p_emisor text, p_receptor text)
RETURNS jsonb LANGUAGE sql IMMUTABLE
AS $fn$
  SELECT CASE
    WHEN NOT public.discrimina_iva(p_emisor)
      THEN jsonb_build_object('letra', 'C', 'codigo_afip', 11, 'discrimina', false)
    WHEN COALESCE(p_receptor, '') = 'responsable_inscripto'
      THEN jsonb_build_object('letra', 'A', 'codigo_afip', 1,  'discrimina', true)
    ELSE jsonb_build_object('letra', 'B', 'codigo_afip', 6,  'discrimina', false)
  END;
$fn$;

-- Dígito verificador módulo 11. Es la única validación posible sin consultar el
-- padrón, y agarra casi cualquier error de tipeo.
--
-- ⚠️ Cuando la cuenta da 10 el número **no es un CUIT válido**: ARCA no asigna
-- esos. Varias implementaciones lo mapean a 9 y terminan aceptando un número
-- inexistente, que después hace fallar la autorización del comprobante cuando
-- ya no se puede corregir.
CREATE OR REPLACE FUNCTION public.cuit_valido(p_cuit text)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE
AS $fn$
DECLARE
  v_limpio text;
  v_pesos  int[] := ARRAY[5,4,3,2,7,6,5,4,3,2];
  v_suma   int := 0;
  v_resto  int;
  v_dv     int;
  v_i      int;
BEGIN
  v_limpio := regexp_replace(COALESCE(p_cuit, ''), '[^0-9]', '', 'g');
  IF length(v_limpio) <> 11 THEN RETURN false; END IF;
  -- Todos los dígitos iguales pasa el módulo 11 en algunos casos y nunca es real.
  IF v_limpio ~ '^([0-9])\1{10}$' THEN RETURN false; END IF;
  -- Prefijos que asigna ARCA. Un 99 al frente es un tipeo, no un CUIT.
  IF left(v_limpio, 2) NOT IN ('20','23','24','25','26','27','30','33','34','50','51','55') THEN
    RETURN false;
  END IF;

  FOR v_i IN 1..10 LOOP
    v_suma := v_suma + v_pesos[v_i] * substr(v_limpio, v_i, 1)::int;
  END LOOP;

  v_resto := v_suma % 11;
  IF v_resto = 0 THEN
    v_dv := 0;
  ELSIF v_resto = 1 THEN
    RETURN false;  -- daría 10: ARCA no lo asigna
  ELSE
    v_dv := 11 - v_resto;
  END IF;

  RETURN v_dv = substr(v_limpio, 11, 1)::int;
END;
$fn$;

-- ── 4. El IVA, ahora mirando quién emite ───────────────────────────────────

CREATE OR REPLACE FUNCTION public.trg_iva_de_orden()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_habilitado boolean;
  v_tasa_org   numeric;
  v_incluido   boolean;
  v_emisor     text;
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

  SELECT s.tax_enabled, s.tax_iva_percent, s.tax_prices_include_iva, s.afip_tipo_emisor
    INTO v_habilitado, v_tasa_org, v_incluido, v_emisor
    FROM public.settings s WHERE s.org_id = NEW.org_id LIMIT 1;

  -- ⚠️ **Quién emite manda, y esto es lo que faltaba.** Un monotributista o un
  -- exento emiten comprobante clase C: el neto es el total y el IVA es cero,
  -- cobren lo que cobren y esté como esté `tax_enabled`. Antes esta regla
  -- estaba escrita en un comentario y el código nunca leía la columna, así que
  -- las órdenes de un monotributista llevaban 21% discriminado.
  IF NOT public.discrimina_iva(v_emisor) THEN
    NEW.tax_amount := 0;
    RETURN NEW;
  END IF;

  -- Sin configuración tampoco se inventa.
  IF NOT COALESCE(v_habilitado, false) OR COALESCE(v_tasa_org, 0) <= 0 THEN
    NEW.tax_amount := 0;
    RETURN NEW;
  END IF;

  v_moneda   := 'ARS';
  v_incluido := COALESCE(v_incluido, true);
  v_envio    := GREATEST(COALESCE(NEW.shipping_cost, 0), 0);
  v_base_merca := GREATEST(COALESCE(NEW.total, 0) - v_envio, 0);

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(NEW.items, '[]'::jsonb)) LOOP
    v_pesos := v_pesos || GREATEST(
      COALESCE((v_item->>'unit_price')::numeric, 0)
        * GREATEST(COALESCE((v_item->>'quantity')::int, 0), 0), 0);
    v_tasas := v_tasas || COALESCE(
      (SELECT p.tax_rate FROM public.products p
        WHERE p.id = NULLIF(v_item->>'product_id', '')::uuid),
      v_tasa_org);
  END LOOP;

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
$fn$;

-- ── 5. La orden, con la identidad del comprador ────────────────────────────
--
-- ⚠️ Se dropea la firma de 10 argumentos antes de crear la de 11. Agregar un
-- parámetro con default crea una SOBRECARGA, no un reemplazo, y con las dos
-- vivas una llamada vieja caería en la versión sin las validaciones fiscales.
-- Es la tercera vez que aparece esta trampa en este repo.

DROP FUNCTION IF EXISTS public.create_store_order(text, jsonb, text, text, text, jsonb, text, text, text, text);

CREATE OR REPLACE FUNCTION public.create_store_order(p_slug text, p_items jsonb, p_customer_name text, p_customer_email text, p_customer_phone text, p_shipping jsonb, p_payment_method text, p_notes text DEFAULT NULL::text, p_coupon text DEFAULT NULL::text, p_shipping_option text DEFAULT NULL::text, p_fiscal jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_store        record;
  v_item         jsonb;
  v_qty          int;
  v_subtotal     numeric := 0;
  v_items        jsonb := '[]'::jsonb;
  v_shipping     numeric := 0;   -- cotización del correo, antes del cupón
  v_envio_neto   numeric := 0;   -- lo que paga el comprador
  v_bonif_envio  numeric := 0;   -- lo que absorbe el comercio
  v_order_number text;
  v_order_id     uuid;
  v_customer_id  uuid;
  v_linea        jsonb;
  v_cupon_chk    jsonb;
  v_coupon_id    uuid;
  v_descuento    numeric := 0;
  v_promo_2x     numeric := 0;
  v_subtotal_base numeric := 0;
  v_promo_ahorro numeric := 0;
  v_item_b       jsonb;
  v_linea_b      jsonb;
  v_base_cupon   numeric;
  v_desc_pago    numeric := 0;
  v_pct_pago     numeric := 0;
  v_total        numeric;
  v_coupon_code  text := NULL;
  v_opt          record;
  v_province     text;
  v_emisor       text;
  v_cond_rec     text;
  v_doc_nro      text;
  v_doc_tipo     int;
  v_razon        text;
  v_cbte         jsonb;
  v_umbral       numeric;
BEGIN
  SELECT s.id, s.org_id, s.name, s.shipping_cost, s.free_shipping_above,
         s.payment_methods, s.shipping_mode, s.pickup_enabled,
         COALESCE(s.payment_discounts, '{}'::jsonb) AS payment_discounts
  INTO v_store
  FROM public.ecommerce_stores s
  WHERE lower(s.slug) = lower(p_slug) AND s.is_active;

  IF v_store.id IS NULL THEN RAISE EXCEPTION 'Tienda no encontrada o inactiva'; END IF;
  IF p_customer_name IS NULL OR btrim(p_customer_name) = '' THEN
    RAISE EXCEPTION 'El nombre es obligatorio';
  END IF;
  IF p_customer_email IS NULL OR p_customer_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'El email no es válido';
  END IF;
  IF jsonb_array_length(COALESCE(p_items, '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'El carrito está vacío';
  END IF;
  IF NOT (p_payment_method = ANY(v_store.payment_methods)) THEN
    RAISE EXCEPTION 'Medio de pago no habilitado en esta tienda';
  END IF;

  IF auth.uid() IS NOT NULL THEN
    SELECT id INTO v_customer_id
    FROM public.store_customers
    WHERE store_id = v_store.id AND user_id = auth.uid();
  END IF;

  -- ── Primera pasada: el subtotal SIN promociones ─────────────────────────
  --
  -- Hace falta para poder evaluar `min_order_value`: una promo de "20% off en
  -- compras mayores a $50.000" no se puede decidir mirando una línea sola. Es
  -- como lo resuelve cualquier plataforma seria — primero las condiciones de
  -- orden, después los efectos de línea.
  --
  -- No valida stock ni corta: de eso se encarga la pasada real de abajo. Acá
  -- sólo se suma, y una línea que no resuelve se ignora porque igual va a
  -- hacer fallar la segunda.
  FOR v_item_b IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_linea_b := public.resolve_store_line(
      v_store.org_id,
      (v_item_b->>'product_id')::uuid,
      NULLIF(v_item_b->>'variant_id', '')::uuid,
      GREATEST(1, COALESCE((v_item_b->>'quantity')::int, 1))
    );
    IF (v_linea_b->>'ok')::boolean THEN
      v_subtotal_base := v_subtotal_base + (v_linea_b->'line'->>'total')::numeric;
    END IF;
  END LOOP;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty := GREATEST(1, COALESCE((v_item->>'quantity')::int, 1));

    -- Resolver producto o variante en un solo lugar: el precio y el stock de
    -- una variante son propios, y hasta ahora se cobraba el del padre.
    v_linea := public.resolve_store_line(
      v_store.org_id,
      (v_item->>'product_id')::uuid,
      NULLIF(v_item->>'variant_id', '')::uuid,
      v_qty,
      v_subtotal_base
    );

    IF NOT (v_linea->>'ok')::boolean THEN
      RAISE EXCEPTION '%', v_linea->>'error';
    END IF;

    v_subtotal := v_subtotal + (v_linea->'line'->>'total')::numeric;
    -- Lo que la promoción bajó respecto de lo que se habría cobrado sin ella.
    -- `list_price` es el precio de lista de la línea, así que la diferencia
    -- incluye la oferta manual; se descuenta abajo para aislar la promo.
    v_promo_ahorro := v_promo_ahorro + GREATEST(0,
      COALESCE((v_linea->'line'->>'list_price')::numeric, 0)
        * GREATEST(COALESCE((v_linea->'line'->>'quantity')::int, 1), 0)
      - (v_linea->'line'->>'total')::numeric);
    v_items    := v_items || (v_linea->'line');
  END LOOP;

  -- ── Promo "llevando 2" ──────────────────────────────────────────────────
  -- Se calcula por PRODUCTO cruzando todas sus líneas, no por línea: estos
  -- productos tienen 9 y 10 sabores, así que la compra real son dos variantes
  -- distintas y una regla por línea no dispararía nunca.
  --
  -- Va como descuento y no bajando `v_subtotal`, para que el subtotal guardado
  -- siga siendo la suma de los ítems. Pero se descuenta ANTES del cupón: la
  -- promo es un precio, no una rebaja, y un 10% off sobre un precio que nadie
  -- paga sería regalar plata.
  v_promo_2x   := public.store_volume_discount(v_store.org_id, v_items);
  v_base_cupon := GREATEST(0, v_subtotal - v_promo_2x);

  -- ── Envío ───────────────────────────────────────────────────────────────
  -- El precio se RECALCULA acá: el cliente manda cuál opción eligió, no cuánto
  -- cuesta. El envío gratis por umbral se evalúa sobre el subtotal ANTES del
  -- cupón — si no, un descuento podría hacer perder el beneficio y eso se
  -- siente como un castigo por usar el cupón.
  --
  -- A5: va antes del cupón porque ahora el cupón puede bonificarlo, y para
  -- saber si un cupón de envío gratis hace algo hay que saber cuánto vale el
  -- envío.
  v_province := COALESCE(p_shipping->>'provincia', p_shipping->>'province', '');

  SELECT q.option_id, q.carrier, q.service, q.label, q.price,
         q.days_min, q.days_max, q.zone_id
  INTO v_opt
  FROM public.quote_store_shipping(p_slug, v_province, p_shipping->>'cp', p_items) q
  WHERE p_shipping_option IS NULL OR q.option_id = p_shipping_option
  ORDER BY
    -- Si pidió una opción puntual, gana ésa; si no, la más barata
    (q.option_id = COALESCE(p_shipping_option, q.option_id)) DESC,
    q.price
  LIMIT 1;

  IF v_opt.option_id IS NULL THEN
    IF v_store.shipping_mode = 'zones' THEN
      RAISE EXCEPTION 'No hay envío disponible para esa provincia. Elegí otra opción de entrega.';
    END IF;
    -- Modos plano/gratis siempre devuelven una opción; si no hay, es sin costo
    v_shipping := 0;
  ELSE
    v_shipping := v_opt.price;
  END IF;

  v_envio_neto := v_shipping;

  -- ── Cupón, revalidado acá ───────────────────────────────────────────────
  --
  -- No alcanza con haberlo chequeado al escribirlo: entre eso y el checkout
  -- puede haberse agotado o vencido.
  --
  -- ⚠️ Se llama a `check_store_coupon` en vez de repetir la validación. Antes
  -- había un SELECT propio que sólo miraba vigencia y tope global, así que el
  -- mínimo de compra y el límite por persona de A4 valían únicamente para
  -- quien pasara por el checkout. Este RPC es público: una llamada directa los
  -- salteaba.
  IF p_coupon IS NOT NULL AND btrim(p_coupon) <> '' THEN
    v_cupon_chk := public.check_store_coupon(
      p_slug, p_coupon, v_base_cupon, p_customer_email, v_shipping);

    IF NOT COALESCE((v_cupon_chk->>'valid')::boolean, false) THEN
      -- El motivo bueno, no un genérico: "Te faltan $38.000" le dice al
      -- comprador qué hacer.
      RAISE EXCEPTION '%', COALESCE(v_cupon_chk->>'reason', 'El cupón ya no es válido');
    END IF;

    v_descuento   := COALESCE((v_cupon_chk->>'discount')::numeric, 0);
    v_bonif_envio := LEAST(
      COALESCE((v_cupon_chk->>'shipping_discount')::numeric, 0),
      v_shipping);
    v_envio_neto  := v_shipping - v_bonif_envio;
    v_coupon_code := v_cupon_chk->>'code';

    SELECT id INTO v_coupon_id FROM public.coupons
     WHERE org_id = v_store.org_id AND upper(code) = v_coupon_code LIMIT 1;

    -- Recién acá se consume: si algo de arriba hubiera fallado, el cupón
    -- seguiría disponible.
    UPDATE public.coupons SET current_uses = COALESCE(current_uses, 0) + 1
     WHERE id = v_coupon_id;
  END IF;

  -- ── Descuento por medio de pago ─────────────────────────────────────────
  -- Sobre lo que queda de mercadería DESPUÉS del cupón. El envío queda afuera
  -- — descontarlo sería regalar plata que se le paga al correo.
  v_pct_pago := public.store_payment_discount_pct(v_store.payment_discounts, p_payment_method);

  -- **Los dos descuentos NO se acumulan: se cobra el mejor, nunca la suma.**
  --
  -- Antes el porcentaje del medio de pago se aplicaba sobre el subtotal, que ya
  -- venía con el precio de oferta: un producto con 20% off pagado por
  -- transferencia con 20% terminaba con 36% de descuento. El comprador veía un
  -- precio de lista tachado que no correspondía a nada.
  --
  -- Ahora se calcula por línea contra el precio de LISTA: el descuento del medio
  -- de pago es lo que falta para llegar a `lista × (1 - pct)`, y si la oferta ya
  -- deja el precio por debajo de eso, no descuenta nada más.
  IF v_pct_pago > 0 THEN
    SELECT COALESCE(SUM(
      GREATEST(0,
        (it->>'unit_price')::numeric
        - round(COALESCE((it->>'list_price')::numeric, (it->>'unit_price')::numeric)
                * (100 - v_pct_pago) / 100.0)
      ) * GREATEST(COALESCE((it->>'quantity')::int, 1), 0)
    ), 0)
    INTO v_desc_pago
    FROM jsonb_array_elements(v_items) AS it;

    -- Nunca más que la mercadería que queda después de promo y cupón.
    v_desc_pago := LEAST(
      round(v_desc_pago),
      GREATEST(0, round(v_subtotal - v_promo_2x - v_descuento))
    );
  END IF;

  v_total := GREATEST(0, v_subtotal - v_promo_2x - v_descuento - v_desc_pago) + v_envio_neto;
  -- ── Identidad fiscal del comprador ──────────────────────────────────────
  --
  -- Sin esto no se puede decidir si la venta lleva Factura A, B o C, que es lo
  -- que bloquea el circuito ARCA entero. Lo decide el emisor primero —un
  -- monotributista emite C sin mirar al receptor— y recién después el receptor.
  SELECT s.afip_tipo_emisor, s.fiscal_id_required_above
    INTO v_emisor, v_umbral
    FROM public.settings s WHERE s.org_id = v_store.org_id LIMIT 1;

  v_cond_rec := NULLIF(btrim(COALESCE(p_fiscal->>'condicion', '')), '');
  v_doc_nro  := NULLIF(regexp_replace(COALESCE(p_fiscal->>'documento', ''), '[^0-9]', '', 'g'), '');
  v_razon    := NULLIF(btrim(COALESCE(p_fiscal->>'razon_social', '')), '');

  IF v_cond_rec IS NOT NULL
     AND v_cond_rec NOT IN ('consumidor_final','responsable_inscripto','monotributo','exento') THEN
    RAISE EXCEPTION 'Condición frente al IVA no reconocida';
  END IF;

  v_cbte := public.tipo_de_comprobante(v_emisor, v_cond_rec);

  -- Una factura A sin CUIT no existe, y un CUIT mal tipeado hace fallar la
  -- autorización con ARCA cuando ya no se puede corregir: se valida acá.
  IF (v_cbte->>'letra') = 'A' OR (v_cond_rec IS NOT NULL AND v_cond_rec <> 'consumidor_final') THEN
    IF v_doc_nro IS NULL THEN
      RAISE EXCEPTION 'Para esa condición frente al IVA necesitamos tu CUIT';
    END IF;
    IF NOT public.cuit_valido(v_doc_nro) THEN
      RAISE EXCEPTION 'El CUIT no es válido. Revisá los números.';
    END IF;
    v_doc_tipo := 80;
  ELSIF v_doc_nro IS NOT NULL THEN
    -- 11 dígitos sólo puede ser CUIT; lo demás se toma como DNI.
    v_doc_tipo := CASE WHEN length(v_doc_nro) = 11 THEN 80 ELSE 96 END;
    IF v_doc_tipo = 80 AND NOT public.cuit_valido(v_doc_nro) THEN
      RAISE EXCEPTION 'El CUIT no es válido. Revisá los números.';
    END IF;
  ELSE
    -- 99 = consumidor final no identificado.
    v_doc_tipo := 99;
  END IF;

  -- Arriba del umbral que fija ARCA hay que identificar al comprador aunque sea
  -- consumidor final. El monto lo pone una resolución que se actualiza, así que
  -- vive en configuración: NULL = el comercio no lo cargó y no se exige.
  IF v_umbral IS NOT NULL AND v_umbral > 0 AND v_total >= v_umbral AND v_doc_nro IS NULL THEN
    RAISE EXCEPTION 'Por el monto de la compra necesitamos tu DNI o CUIT para la factura';
  END IF;

  v_order_number := public.next_store_order_number();

  INSERT INTO public.ecommerce_orders (
    org_id, store_id, store_customer_id, order_number,
    customer_name, customer_email, customer_phone,
    items, subtotal, shipping_cost, discount_amount, tax_amount, total,
    coupon_code, coupon_discount_ars, shipping_discount_ars,
    payment_method, payment_status, fulfillment_status,
    shipping_address, billing_address, notes,
    carrier, shipping_service, shipping_label, shipping_zone_id,
    delivery_days_min, delivery_days_max, shipping_quoted_at,
    buyer_tax_condition, buyer_doc_type, buyer_doc_number, buyer_business_name,
    comprobante_letra, comprobante_tipo_afip
  ) VALUES (
    v_store.org_id, v_store.id, v_customer_id, v_order_number,
    btrim(p_customer_name), lower(btrim(p_customer_email)), p_customer_phone,
    v_items, v_subtotal, v_envio_neto, v_promo_2x + v_descuento + v_desc_pago, 0,
    v_total,
    v_coupon_code, v_descuento, v_bonif_envio,
    p_payment_method, 'pending', 'pending',
    COALESCE(p_shipping, '{}'::jsonb), COALESCE(p_shipping, '{}'::jsonb), p_notes,
    v_opt.carrier, v_opt.service, v_opt.label, v_opt.zone_id,
    v_opt.days_min, v_opt.days_max, now(),
    COALESCE(v_cond_rec, 'consumidor_final'), v_doc_tipo, v_doc_nro, v_razon,
    v_cbte->>'letra', (v_cbte->>'codigo_afip')::int
  )
  RETURNING id INTO v_order_id;

  IF v_customer_id IS NOT NULL THEN
    UPDATE public.store_customers
    SET default_address = COALESCE(p_shipping, default_address),
        phone           = COALESCE(NULLIF(p_customer_phone, ''), phone),
        name            = COALESCE(NULLIF(btrim(p_customer_name), ''), name)
    WHERE id = v_customer_id;
  END IF;

  -- ── Registrar el uso de las promociones ────────────────────────────────
  --
  -- `promotion_usages` existía con su trigger de conteo y nadie insertaba nada,
  -- así que el comercio no podía saber si una promoción sirvió. Se registra
  -- **después** de crear la orden: si la orden falla, no queda un uso fantasma.
  --
  -- El ahorro que se guarda es el de la promoción sobre el precio que se habría
  -- cobrado sin ella, prorrateado por promoción cuando aplica más de una. No se
  -- reparte el cupón ni el descuento por medio de pago: esos tienen su propio
  -- registro y mezclarlos haría que la métrica de una promo dependa de cómo
  -- pagó el comprador.
  --
  -- Va en un bloque que no puede tumbar la orden: una métrica rota nunca puede
  -- impedir una venta.
  BEGIN
    INSERT INTO public.promotion_usages (
      promotion_id, org_id, customer_id, customer_name, order_value, discount_applied
    )
    SELECT pr.id, v_store.org_id, v_customer_id, btrim(p_customer_name),
           v_subtotal, v_promo_ahorro / GREATEST(1, count(*) OVER ())
    FROM public.promotions pr
    WHERE pr.org_id = v_store.org_id
      AND pr.status = 'active'
      AND pr.coupon_code IS NULL
      AND pr.type IN ('percentage', 'fixed')
      AND (pr.starts_at IS NULL OR pr.starts_at <= now())
      AND (pr.ends_at   IS NULL OR pr.ends_at   >  now())
      AND COALESCE(pr.min_order_value, 0) <= v_subtotal_base
      AND v_promo_ahorro > 0;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object(
    'order_number',   v_order_number,
    'total',          v_total,
    'subtotal',       v_subtotal,
    'discount',       v_promo_2x + v_descuento + v_desc_pago,
    'promo_2x',             v_promo_2x,
    'coupon_discount',      v_descuento,
    'payment_discount',     v_desc_pago,
    'payment_discount_pct', v_pct_pago,
    'shipping',       v_envio_neto,
    'shipping_gross',   v_shipping,
    'shipping_discount', v_bonif_envio,
    'shipping_label', v_opt.label,
    'comprobante',    v_cbte->>'letra'
  );
END;
$function$
;

GRANT EXECUTE ON FUNCTION public.create_store_order(
  text, jsonb, text, text, text, jsonb, text, text, text, text, jsonb) TO anon, authenticated;

-- ── 6. Las órdenes que ya están, con el comprobante que les corresponde ─────
--
-- Se guarda el valor anterior antes de tocar nada. Una corrección sin asiento
-- es indistinguible de un borrado, y acá se está tocando plata declarada.

CREATE TABLE IF NOT EXISTS public.ecommerce_orders_iva_backup (
  order_id     uuid PRIMARY KEY,
  tax_amount   numeric,
  guardado_at  timestamptz NOT NULL DEFAULT now(),
  motivo       text
);

ALTER TABLE public.ecommerce_orders_iva_backup ENABLE ROW LEVEL SECURITY;

INSERT INTO public.ecommerce_orders_iva_backup (order_id, tax_amount, motivo)
SELECT o.id, o.tax_amount, 'emisor no discrimina IVA (identidad_fiscal)'
  FROM public.ecommerce_orders o
  JOIN public.settings s ON s.org_id = o.org_id
 WHERE NOT public.discrimina_iva(s.afip_tipo_emisor)
   AND COALESCE(o.tax_amount, 0) <> 0
ON CONFLICT (order_id) DO NOTHING;

UPDATE public.ecommerce_orders o
   SET tax_amount = 0
  FROM public.settings s
 WHERE s.org_id = o.org_id
   AND NOT public.discrimina_iva(s.afip_tipo_emisor)
   AND COALESCE(o.tax_amount, 0) <> 0;

-- El comprobante que corresponde a cada orden ya cargada. Sin condición
-- declarada se asume consumidor final, que es lo que eran.
UPDATE public.ecommerce_orders o
   SET buyer_tax_condition   = COALESCE(o.buyer_tax_condition, 'consumidor_final'),
       buyer_doc_type        = COALESCE(o.buyer_doc_type, 99),
       comprobante_letra     = public.tipo_de_comprobante(s.afip_tipo_emisor,
                                 COALESCE(o.buyer_tax_condition, 'consumidor_final'))->>'letra',
       comprobante_tipo_afip = (public.tipo_de_comprobante(s.afip_tipo_emisor,
                                 COALESCE(o.buyer_tax_condition, 'consumidor_final'))->>'codigo_afip')::int
  FROM public.settings s
 WHERE s.org_id = o.org_id
   AND o.comprobante_letra IS NULL;
