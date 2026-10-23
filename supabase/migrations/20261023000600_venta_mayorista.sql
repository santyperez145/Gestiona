-- Venta mayorista online (2026-10-23).
--
-- Un mayorista (Famatina, una ferretería que le vende a otras) necesita que la
-- tienda le muestre a cada cliente SU precio, le exija la compra mínima y le
-- deje pedir a cuenta corriente. Las piezas existían por separado —listas de
-- precios por cliente con tramos por cantidad, cuentas de comprador en la
-- tienda, límite de crédito con control en la base— y esta migración las une:
--
--   1. Cada tienda elige su modo mayorista: 'off', 'mixto' (público con
--      precio minorista; el comprador aprobado ve el suyo) o 'exclusivo'
--      (sólo compran los aprobados), la compra mínima y si acepta cuenta
--      corriente.
--   2. El comprador pide su cuenta mayorista desde la tienda (razón social y
--      CUIT válido); el comercio la aprueba vinculándola a un cliente de
--      gestión —uno existente, el del mismo CUIT o uno nuevo— con lista de
--      precios, límite de crédito y permiso de cuenta corriente.
--   3. El precio lo decide la base: `resolve_store_line` (carrito y checkout)
--      aplica la lista del comprador aprobado con la misma regla que la caja
--      (`src/lib/priceListCalc.ts`): precio fijo del tramo, % del producto,
--      descuento de la lista. Si la lista no cambia el precio, rige el
--      minorista con sus promociones.
--   4. El checkout exige la compra mínima y, a cuenta corriente, que el pedido
--      entre en el crédito disponible (deudas pendientes más pedidos a cuenta
--      todavía sin aprobar). El comercio aprueba el pedido y recién ahí nace la
--      venta sin cobrar con su deuda, que vuelve a pasar por el límite de
--      crédito de la base.
--
-- La cuenta corriente no figura en los medios de pago públicos: sólo se le
-- ofrece al comprador habilitado (`get_store_mayorista`).
-- Reversible: DROP de las funciones nuevas y de las columnas; las redefinidas
-- vuelven con sus migraciones anteriores.
BEGIN;

-- ── 1. Datos ─────────────────────────────────────────────────────────────
ALTER TABLE public.ecommerce_stores
  ADD COLUMN IF NOT EXISTS mayorista_modo text NOT NULL DEFAULT 'off',
  ADD COLUMN IF NOT EXISTS mayorista_minimo_ars numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS mayorista_cuenta_corriente boolean NOT NULL DEFAULT false;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ecommerce_stores_mayorista_modo_check') THEN
    ALTER TABLE public.ecommerce_stores ADD CONSTRAINT ecommerce_stores_mayorista_modo_check
      CHECK (mayorista_modo IN ('off', 'mixto', 'exclusivo'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ecommerce_stores_mayorista_minimo_check') THEN
    ALTER TABLE public.ecommerce_stores ADD CONSTRAINT ecommerce_stores_mayorista_minimo_check
      CHECK (mayorista_minimo_ars >= 0 AND mayorista_minimo_ars <= 1000000000);
  END IF;
END $$;

ALTER TABLE public.store_customers
  ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS mayorista_estado text NOT NULL DEFAULT 'ninguno',
  ADD COLUMN IF NOT EXISTS mayorista_solicitud jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS mayorista_solicitado_at timestamptz,
  ADD COLUMN IF NOT EXISTS mayorista_resuelto_at timestamptz,
  ADD COLUMN IF NOT EXISTS mayorista_resuelto_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS mayorista_motivo text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'store_customers_mayorista_estado_check') THEN
    ALTER TABLE public.store_customers ADD CONSTRAINT store_customers_mayorista_estado_check
      CHECK (mayorista_estado IN ('ninguno', 'pendiente', 'aprobado', 'rechazado'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS store_customers_mayorista_idx
  ON public.store_customers(org_id, mayorista_estado, mayorista_solicitado_at DESC)
  WHERE mayorista_estado <> 'ninguno';
CREATE INDEX IF NOT EXISTS store_customers_customer_idx
  ON public.store_customers(customer_id) WHERE customer_id IS NOT NULL;

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS cuenta_corriente_online boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.ecommerce_stores.mayorista_modo IS
  'off: sin venta mayorista. mixto: público minorista; el comprador aprobado ve su lista. exclusivo: sólo compran los aprobados.';
COMMENT ON COLUMN public.store_customers.customer_id IS
  'Cliente de gestión del comprador mayorista aprobado: de ahí salen su lista de precios, su límite de crédito y su cuenta corriente.';
COMMENT ON COLUMN public.customers.cuenta_corriente_online IS
  'Puede pedir a cuenta corriente desde la tienda (además de que la tienda lo acepte).';

-- El comprador edita su ficha (dirección, teléfono), pero no puede aprobarse
-- solo ni vincularse a un cliente: esas columnas las cambian únicamente las
-- funciones de abajo, que encienden `nerqia.mayorista`. Se conservan en vez de
-- rechazar para no romper actualizaciones legítimas que manden la fila entera.
CREATE OR REPLACE FUNCTION public.trg_store_customers_mayorista_guarda()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF COALESCE(current_setting('nerqia.mayorista', true), '') = 'on' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.customer_id := NULL;
    NEW.mayorista_estado := 'ninguno';
    NEW.mayorista_solicitud := '{}'::jsonb;
    NEW.mayorista_solicitado_at := NULL;
    NEW.mayorista_resuelto_at := NULL;
    NEW.mayorista_resuelto_por := NULL;
    NEW.mayorista_motivo := NULL;
  ELSE
    NEW.customer_id := OLD.customer_id;
    NEW.mayorista_estado := OLD.mayorista_estado;
    NEW.mayorista_solicitud := OLD.mayorista_solicitud;
    NEW.mayorista_solicitado_at := OLD.mayorista_solicitado_at;
    NEW.mayorista_resuelto_at := OLD.mayorista_resuelto_at;
    NEW.mayorista_resuelto_por := OLD.mayorista_resuelto_por;
    NEW.mayorista_motivo := OLD.mayorista_motivo;
  END IF;
  RETURN NEW;
END;
$fn$;
DROP TRIGGER IF EXISTS trg_store_customers_mayorista_guarda ON public.store_customers;
CREATE TRIGGER trg_store_customers_mayorista_guarda
  BEFORE INSERT OR UPDATE ON public.store_customers
  FOR EACH ROW EXECUTE FUNCTION public.trg_store_customers_mayorista_guarda();

-- La cuenta corriente vive en `payment_methods` (el checkout valida contra esa
-- lista) sólo mientras la tienda la acepte; la sincroniza la base, no la pantalla.
CREATE OR REPLACE FUNCTION public.trg_tienda_mayorista_medios()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
BEGIN
  NEW.payment_methods := array_remove(COALESCE(NEW.payment_methods, ARRAY[]::text[]), 'cuenta_corriente');
  IF NEW.mayorista_modo <> 'off' AND NEW.mayorista_cuenta_corriente THEN
    NEW.payment_methods := NEW.payment_methods || 'cuenta_corriente'::text;
  END IF;
  RETURN NEW;
END;
$fn$;
DROP TRIGGER IF EXISTS trg_tienda_mayorista_medios ON public.ecommerce_stores;
CREATE TRIGGER trg_tienda_mayorista_medios
  BEFORE INSERT OR UPDATE OF payment_methods, mayorista_modo, mayorista_cuenta_corriente ON public.ecommerce_stores
  FOR EACH ROW EXECUTE FUNCTION public.trg_tienda_mayorista_medios();

-- ── 2. Precio de lista, en la base ──────────────────────────────────────
-- La misma regla que `precioDeLista` (src/lib/priceListCalc.ts). NULL cuando
-- la lista no cambia el precio: rige el minorista con sus promociones.
CREATE OR REPLACE FUNCTION public.precio_lista_cliente(
  p_customer_id uuid, p_product_id uuid, p_qty integer, p_base numeric
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_lista public.price_lists%ROWTYPE;
  v_fijo numeric;
  v_pct numeric;
  v_hoy date := (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;
  v_base numeric := GREATEST(COALESCE(p_base, 0), 0);
BEGIN
  IF p_customer_id IS NULL OR v_base <= 0 THEN
    RETURN NULL;
  END IF;
  SELECT l.* INTO v_lista
    FROM public.customers c
    JOIN public.price_lists l ON l.id = c.price_list_id AND l.org_id = c.org_id
   WHERE c.id = p_customer_id;
  IF v_lista.id IS NULL OR NOT COALESCE(v_lista.is_active, true)
     OR (v_lista.valid_from IS NOT NULL AND v_hoy < v_lista.valid_from)
     OR (v_lista.valid_until IS NOT NULL AND v_hoy > v_lista.valid_until) THEN
    RETURN NULL;
  END IF;

  -- El tramo más alto que la cantidad alcanza.
  SELECT i.custom_price, i.discount_pct INTO v_fijo, v_pct
    FROM public.price_list_items i
   WHERE i.price_list_id = v_lista.id
     AND i.product_id = p_product_id
     AND COALESCE(i.min_quantity, 1) <= GREATEST(COALESCE(p_qty, 1), 1)
   ORDER BY COALESCE(i.min_quantity, 1) DESC
   LIMIT 1;

  IF v_fijo IS NOT NULL AND v_fijo >= 0 THEN
    RETURN round(v_fijo);
  END IF;
  IF COALESCE(v_pct, 0) > 0 THEN
    RETURN round(v_base * (1 - LEAST(v_pct, 100) / 100));
  END IF;
  IF v_lista.discount_type = 'percentage' AND COALESCE(v_lista.discount_value, 0) > 0 THEN
    RETURN round(v_base * (1 - LEAST(v_lista.discount_value, 100) / 100));
  END IF;
  IF v_lista.discount_type = 'fixed' AND COALESCE(v_lista.discount_value, 0) > 0 THEN
    RETURN round(GREATEST(0, v_base - v_lista.discount_value));
  END IF;
  RETURN NULL;
END;
$fn$;

-- El cliente de gestión del comprador logueado, si está aprobado como
-- mayorista en esa tienda y la tienda vende mayorista.
CREATE OR REPLACE FUNCTION public.cliente_mayorista_de_tienda(p_store_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT sc.customer_id
    FROM public.store_customers sc
    JOIN public.ecommerce_stores s ON s.id = sc.store_id
    JOIN public.customers c ON c.id = sc.customer_id AND c.org_id = sc.org_id
   WHERE sc.store_id = p_store_id
     AND sc.user_id = auth.uid()
     AND sc.mayorista_estado = 'aprobado'
     AND s.mayorista_modo <> 'off'
   LIMIT 1;
$fn$;

-- Lo que el cliente ya debe o tiene comprometido a cuenta corriente: deudas
-- pendientes más pedidos de la tienda a cuenta todavía sin aprobar.
CREATE OR REPLACE FUNCTION public.saldo_comprometido_cliente(p_customer_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT COALESCE((
           SELECT sum(d.remaining_ars) FROM public.debts d
            WHERE d.customer_id = p_customer_id AND d.status IN ('pending', 'partial')
         ), 0)
       + COALESCE((
           SELECT sum(o.total) FROM public.ecommerce_orders o
             JOIN public.store_customers sc ON sc.id = o.store_customer_id
            WHERE sc.customer_id = p_customer_id
              AND o.payment_method = 'cuenta_corriente'
              AND o.payment_status = 'pending'
              AND COALESCE(o.fulfillment_status, '') <> 'cancelled'
         ), 0);
$fn$;

REVOKE ALL ON FUNCTION public.precio_lista_cliente(uuid, uuid, integer, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cliente_mayorista_de_tienda(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.saldo_comprometido_cliente(uuid) FROM PUBLIC, anon, authenticated;

-- ── 3. El carrito y el checkout aplican la lista ─────────────────────────
CREATE OR REPLACE FUNCTION public.resolve_store_line(
  p_org_id uuid,
  p_product_id uuid,
  p_variant_id uuid,
  p_qty integer,
  p_order_subtotal numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_product record;
  v_variant record;
  v_publication public.store_product_publications%ROWTYPE;
  v_store_id uuid;
  v_unit numeric;
  v_list numeric;
  v_offer numeric;
  v_stacks boolean;
  v_promo numeric;
  v_disp numeric;
  v_reserva numeric := 0;
  v_mayorista numeric;
  v_base_mayorista numeric;
BEGIN
  IF p_qty IS NULL OR p_qty < 1 OR p_qty > 999 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'La cantidad no es válida');
  END IF;

  BEGIN
    v_store_id := NULLIF(current_setting('nerqia.store_id', true), '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    v_store_id := NULL;
  END;

  SELECT
    product.id, product.name, product.brand, product.category, product.stock,
    product.sale_price_ars, product.discount_price_ars, product.image_url,
    product.offer_stacks_payment, COALESCE(product.is_active, true) AS active
  INTO v_product
  FROM public.products product
  WHERE product.id = p_product_id AND product.org_id = p_org_id;

  IF v_product.id IS NULL OR NOT v_product.active THEN
    RETURN jsonb_build_object(
      'ok', false, 'error', 'Un producto del carrito ya no está disponible'
    );
  END IF;

  IF v_store_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.ecommerce_stores store
      WHERE store.id = v_store_id AND store.org_id = p_org_id AND store.is_active
    ) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'La tienda ya no está disponible');
    END IF;
    -- Unidades de cada producto que la tienda deja para el local (20261023000300).
    SELECT COALESCE(store.reserva_local, 0) INTO v_reserva
    FROM public.ecommerce_stores store WHERE store.id = v_store_id;

    SELECT publication.* INTO v_publication
    FROM public.store_product_publications publication
    WHERE publication.store_id = v_store_id
      AND publication.product_id = p_product_id;

    IF COALESCE(v_publication.visibility, 'published') <> 'published' THEN
      RETURN jsonb_build_object(
        'ok', false, 'error', 'Este producto ya no está publicado en la tienda'
      );
    END IF;
  END IF;

  v_product.category := COALESCE(v_publication.category_slug, v_product.category);
  v_list := CASE
    WHEN v_publication.price_ars IS NOT NULL
      THEN COALESCE(v_publication.compare_at_price_ars, v_publication.price_ars)
    ELSE v_product.sale_price_ars
  END;
  v_offer := CASE
    WHEN v_publication.price_ars IS NOT NULL THEN v_publication.price_ars
    ELSE COALESCE(NULLIF(v_product.discount_price_ars, 0), v_product.sale_price_ars)
  END;

  IF COALESCE(v_offer, 0) <= 0 THEN
    RETURN jsonb_build_object(
      'ok', false, 'error', 'Un producto del carrito ya no tiene precio disponible'
    );
  END IF;

  v_unit := v_offer;
  v_promo := public.store_promo_price(
    p_org_id, v_product.id, v_product.category, v_list, p_order_subtotal
  );
  IF v_promo IS NOT NULL AND v_promo < v_unit THEN
    v_unit := v_promo;
  END IF;

  v_stacks := COALESCE(
    v_product.offer_stacks_payment,
    (SELECT store.payment_discount_stacks
     FROM public.ecommerce_stores store
     WHERE store.id = v_store_id),
    (SELECT store.payment_discount_stacks
     FROM public.ecommerce_stores store
     WHERE store.org_id = p_org_id
     ORDER BY store.is_primary DESC, store.created_at ASC
     LIMIT 1),
    false
  );

  -- El stock real: físico menos reservas activas. Se lee sin lock —esta
  -- función es STABLE y sólo consulta—; el lock exclusivo lo toma el trigger
  -- al crear la orden, que es donde una carrera puede sobre-vender.
  IF p_variant_id IS NULL THEN
    -- Venta mayorista (20261023000600): el comprador aprobado paga su lista.
    -- NULL si la lista no cambia el precio: rige el minorista con sus promos.
    IF v_store_id IS NOT NULL THEN
      v_base_mayorista := COALESCE(v_publication.price_ars, v_product.sale_price_ars);
      v_mayorista := public.precio_lista_cliente(
        public.cliente_mayorista_de_tienda(v_store_id), p_product_id, p_qty, v_base_mayorista
      );
      IF v_mayorista IS NOT NULL THEN
        v_unit := v_mayorista;
      END IF;
    END IF;
    v_disp := public.stock_disponible(p_product_id, NULL) - v_reserva;
    IF v_disp < p_qty THEN
      RETURN jsonb_build_object(
        'ok', false,
        'error', format(
          'Sin stock disponible de %s: quedan %s y se piden %s',
          v_product.name, GREATEST(v_disp, 0), p_qty
        ),
        'available_quantity', GREATEST(v_disp, 0)
      );
    END IF;
    RETURN jsonb_build_object('ok', true, 'line', jsonb_build_object(
      'product_id', v_product.id,
      'variant_id', NULL,
      'name', v_product.name,
      'brand', v_product.brand,
      'quantity', p_qty,
      'unit_price', v_unit,
      'list_price', CASE
        WHEN v_mayorista IS NOT NULL THEN v_base_mayorista
        WHEN v_stacks THEN v_unit
        ELSE v_list
      END,
      'mayorista', v_mayorista IS NOT NULL,
      'total', v_unit * p_qty,
      'image_url', v_product.image_url,
      'available_quantity', GREATEST(v_disp, 0)
    ));
  END IF;

  SELECT
    variant.id, variant.variant_name, variant.stock,
    variant.price_override, variant.image_url
  INTO v_variant
  FROM public.product_variants variant
  WHERE variant.id = p_variant_id
    AND variant.product_id = p_product_id
    AND variant.org_id = p_org_id
    AND variant.active;

  IF v_variant.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Esa variante ya no está disponible');
  END IF;
  v_disp := public.stock_disponible(p_product_id, p_variant_id) - v_reserva;
  IF v_disp < p_qty THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', format(
        'Sin stock disponible de %s %s: quedan %s y se piden %s',
        v_product.name, v_variant.variant_name, GREATEST(v_disp, 0), p_qty
      ),
      'available_quantity', GREATEST(v_disp, 0)
    );
  END IF;
  IF COALESCE(v_variant.price_override, 0) > 0 THEN
    v_unit := v_variant.price_override;
  END IF;
  IF v_store_id IS NOT NULL THEN
    v_base_mayorista := COALESCE(NULLIF(v_variant.price_override, 0), v_publication.price_ars, v_product.sale_price_ars);
    v_mayorista := public.precio_lista_cliente(
      public.cliente_mayorista_de_tienda(v_store_id), p_product_id, p_qty, v_base_mayorista
    );
    IF v_mayorista IS NOT NULL THEN
      v_unit := v_mayorista;
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'line', jsonb_build_object(
    'product_id', v_product.id,
    'variant_id', v_variant.id,
    'name', v_product.name || ' — ' || v_variant.variant_name,
    'brand', v_product.brand,
    'quantity', p_qty,
    'unit_price', v_unit,
    'mayorista', v_mayorista IS NOT NULL,
    'list_price', CASE
      WHEN v_mayorista IS NOT NULL THEN v_base_mayorista
      WHEN COALESCE(v_variant.price_override, 0) > 0 THEN v_variant.price_override
      WHEN v_stacks THEN v_unit
      ELSE v_list
    END,
    'total', v_unit * p_qty,
    'image_url', COALESCE(v_variant.image_url, v_product.image_url),
    'available_quantity', GREATEST(v_disp, 0)
  ));
END;
$$;

-- La lista pública de medios de pago no ofrece la cuenta corriente: se le
-- muestra sólo al comprador habilitado (`get_store_mayorista`).
CREATE OR REPLACE FUNCTION public.medios_de_pago_vivos(p_org_id uuid, p_methods text[])
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
  SELECT COALESCE(
    ARRAY(
      SELECT DISTINCT
        CASE
          WHEN m IN ('mercadopago', 'gestiona_pay') THEN 'gestiona_pay'
          ELSE m
        END
        FROM unnest(COALESCE(p_methods, ARRAY[]::text[])) AS m
       WHERE m IS NOT NULL
         AND btrim(m) <> ''
         AND m NOT IN ('stripe', 'paypal', 'cuenta_corriente')
         AND (
           m NOT IN ('mercadopago', 'gestiona_pay')
           OR public.gestiona_pay_listo(p_org_id)
         )
         AND (
           m <> 'transferencia'
           OR public.transferencia_tienda_lista(p_org_id)
         )
    ),
    ARRAY[]::text[]
  );
$$;

CREATE OR REPLACE FUNCTION public.create_store_order(
  p_slug text,
  p_items jsonb,
  p_customer_name text,
  p_customer_email text,
  p_customer_phone text,
  p_shipping jsonb,
  p_payment_method text,
  p_notes text DEFAULT NULL,
  p_coupon text DEFAULT NULL,
  p_shipping_option text DEFAULT NULL,
  p_fiscal jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_store record;
  v_cliente uuid;
  v_resultado jsonb;
  v_limite numeric;
  v_comprometido numeric;
  v_a_cuenta boolean := lower(btrim(COALESCE(p_payment_method, ''))) = 'cuenta_corriente';
BEGIN
  SELECT store.id, store.mayorista_modo, store.mayorista_minimo_ars, store.mayorista_cuenta_corriente
    INTO v_store
  FROM public.ecommerce_stores store
  WHERE lower(store.slug) = lower(btrim(p_slug)) AND store.is_active
  LIMIT 1;
  IF v_store.id IS NULL THEN
    RAISE EXCEPTION 'Tienda no encontrada o inactiva' USING ERRCODE = '22023';
  END IF;

  PERFORM set_config('nerqia.store_id', v_store.id::text, true);

  -- Venta mayorista (20261023000600).
  v_cliente := public.cliente_mayorista_de_tienda(v_store.id);
  IF v_store.mayorista_modo = 'exclusivo' AND v_cliente IS NULL THEN
    RAISE EXCEPTION 'Esta tienda vende sólo a clientes mayoristas aprobados. Ingresá con tu cuenta o pedí el alta mayorista.'
      USING ERRCODE = '22023';
  END IF;
  IF v_a_cuenta AND (
       v_cliente IS NULL OR NOT v_store.mayorista_cuenta_corriente
       OR NOT COALESCE((SELECT c.cuenta_corriente_online FROM public.customers c WHERE c.id = v_cliente), false)
     ) THEN
    RAISE EXCEPTION 'La cuenta corriente no está habilitada para tu cuenta.' USING ERRCODE = '22023';
  END IF;

  v_resultado := public.create_store_order_core(
    p_slug, p_items, p_customer_name, p_customer_email, p_customer_phone,
    p_shipping, p_payment_method, p_notes, p_coupon, p_shipping_option, p_fiscal
  );

  -- Después del núcleo, con el subtotal ya calculado por la base: si no
  -- alcanza, la excepción deshace el pedido entero.
  IF v_cliente IS NOT NULL AND COALESCE(v_store.mayorista_minimo_ars, 0) > 0
     AND COALESCE((v_resultado->>'subtotal')::numeric, 0) < v_store.mayorista_minimo_ars THEN
    RAISE EXCEPTION 'La compra mínima mayorista es de $ %. Te faltan $ %.',
      replace(to_char(round(v_store.mayorista_minimo_ars), 'FM999,999,999,990'), ',', '.'),
      replace(to_char(round(v_store.mayorista_minimo_ars - COALESCE((v_resultado->>'subtotal')::numeric, 0)), 'FM999,999,999,990'), ',', '.')
      USING ERRCODE = '22023';
  END IF;

  IF v_a_cuenta THEN
    SELECT c.credit_limit_ars INTO v_limite FROM public.customers c WHERE c.id = v_cliente;
    IF v_limite IS NOT NULL THEN
      -- Incluye este pedido, que ya quedó pendiente a cuenta.
      v_comprometido := public.saldo_comprometido_cliente(v_cliente);
      IF v_comprometido > v_limite THEN
        RAISE EXCEPTION 'El pedido supera tu crédito disponible: te quedan $ % de $ %.',
          replace(to_char(GREATEST(round(v_limite - (v_comprometido - COALESCE((v_resultado->>'total')::numeric, 0))), 0), 'FM999,999,999,990'), ',', '.'),
          replace(to_char(round(v_limite), 'FM999,999,999,990'), ',', '.')
          USING ERRCODE = '22023';
      END IF;
    END IF;
  END IF;

  RETURN v_resultado;
END;
$$;

-- ── 4. Al aprobar el pedido a cuenta nace la venta con su deuda ─────────
-- La guardia del vínculo venta ↔ pedido acepta el cobro del servidor aunque
-- lo dispare un comerciante logueado (confirmación manual, cuenta corriente).
CREATE OR REPLACE FUNCTION public.guard_sales_ecommerce_order_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF (TG_OP = 'INSERT' AND NEW.ecommerce_order_id IS NOT NULL)
     OR (TG_OP = 'UPDATE' AND NEW.ecommerce_order_id IS DISTINCT FROM OLD.ecommerce_order_id) THEN
    IF auth.role() IN ('anon', 'authenticated')
       AND COALESCE(current_setting('nerqia.cobro_servidor', true), '') <> 'on' THEN
      RAISE EXCEPTION 'El vínculo de una venta con una orden de tienda sólo lo registra el cobro del servidor';
    END IF;

    IF NEW.ecommerce_order_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
         FROM public.ecommerce_orders o
         WHERE o.id = NEW.ecommerce_order_id AND o.org_id = NEW.org_id
       ) THEN
      RAISE EXCEPTION 'La orden de tienda debe pertenecer a la misma organización que la venta';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.guard_sales_ecommerce_order_link() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.mark_store_order_paid(
  p_order_id uuid,
  p_payment_id text DEFAULT NULL,
  p_method text DEFAULT 'mercado_pago'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_order       record;
  v_item        jsonb;
  v_prod        record;
  v_variant_id  uuid;
  v_qty         int;
  v_owner       uuid;
  v_customer_id uuid;
  v_rate        numeric;
  v_cost_ars    numeric;
  v_profit      numeric;
  v_ventas      int := 0;
  v_a_cuenta    boolean := p_method = 'cuenta_corriente';
  v_sale_id     uuid;
  v_deudor      text;
BEGIN
  -- Dos webhooks aprobados no pueden crear el mismo ticket: la cerradura es
  -- la fila de la orden y el segundo lector ve payment_status = paid.
  SELECT * INTO v_order
  FROM public.ecommerce_orders
  WHERE id = p_order_id
  FOR UPDATE;
  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Orden no encontrada';
  END IF;
  IF v_order.payment_status = 'paid' THEN
    RETURN jsonb_build_object('ok', true, 'ya_procesada', true);
  END IF;
  IF v_order.payment_status IN ('refunded', 'charged_back') THEN
    RAISE EXCEPTION 'El pago de la orden fue revertido; creá una orden nueva para cobrarla'
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_a_cuenta THEN
    -- A cuenta corriente, la deuda es del cliente aprobado, no de uno que se
    -- adivine por email (20261023000600).
    SELECT sc.customer_id, c.name INTO v_customer_id, v_deudor
      FROM public.store_customers sc
      JOIN public.customers c ON c.id = sc.customer_id
     WHERE sc.id = v_order.store_customer_id AND sc.org_id = v_order.org_id;
    IF v_customer_id IS NULL THEN
      RAISE EXCEPTION 'El pedido no está vinculado a un cliente mayorista: no se puede cargar a cuenta corriente'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    BEGIN
      v_customer_id := public.upsert_customer_from_order(v_order.id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'upsert_customer_from_order falló antes de crear ventas para %: %', p_order_id, SQLERRM;
      v_customer_id := NULL;
    END;
  END IF;

  SELECT m.user_id INTO v_owner
  FROM public.memberships m
  WHERE m.org_id = v_order.org_id AND m.role = 'owner'
  ORDER BY m.joined_at LIMIT 1;

  SELECT COALESCE(exchange_rate, 1) INTO v_rate
  FROM public.settings WHERE org_id = v_order.org_id;
  v_rate := COALESCE(v_rate, 1);

  -- Esta función sólo la llaman funciones del servidor (no tiene EXECUTE para
  -- usuarios): marca la transacción como cobro del servidor para la guardia
  -- de `sales`. Sin esto, «Confirmar cobro» de una transferencia, que llama
  -- un comerciante logueado, chocaba siempre con la guardia (visto el 23/10).
  PERFORM set_config('nerqia.cobro_servidor', 'on', true);

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_order.items) LOOP
    v_qty := COALESCE((v_item->>'quantity')::int, 1);
    v_variant_id := NULLIF(v_item->>'variant_id', '')::uuid;

    SELECT id, name, total_cost_usd
      INTO v_prod
    FROM public.products
    WHERE id = (v_item->>'product_id')::uuid
      AND org_id = v_order.org_id
    FOR UPDATE;
    IF v_prod.id IS NULL THEN
      RAISE EXCEPTION 'El producto de la orden ya no pertenece a la organización';
    END IF;
    IF v_variant_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.product_variants v
      WHERE v.id = v_variant_id AND v.product_id = v_prod.id AND v.org_id = v_order.org_id
    ) THEN
      RAISE EXCEPTION 'La variante de la orden ya no pertenece al producto';
    END IF;

    v_cost_ars := COALESCE(v_prod.total_cost_usd, 0) * v_rate;
    v_profit := (v_item->>'unit_price')::numeric * v_qty - v_cost_ars * v_qty;
    INSERT INTO public.sales (
      org_id, user_id, product_id, variant_id, location_id, product_name, quantity,
      unit_price_ars, total_ars, cost_per_unit_usd, cost_of_goods_ars,
      profit_ars, profit_usd, customer_id, customer_name, date, paid,
      payment_method, source, ecommerce_order_id
    ) VALUES (
      v_order.org_id, v_owner, v_prod.id, v_variant_id, v_order.fulfillment_location_id,
      v_item->>'name', v_qty,
      (v_item->>'unit_price')::numeric, (v_item->>'total')::numeric,
      COALESCE(v_prod.total_cost_usd, 0), round(v_cost_ars * v_qty, 2),
      v_profit, CASE WHEN v_rate > 0 THEN v_profit / v_rate ELSE 0 END,
      v_customer_id, COALESCE(v_deudor, v_order.customer_name), now(), NOT v_a_cuenta,
      p_method, 'tienda_online', v_order.id
    )
    RETURNING id INTO v_sale_id;

    -- Como un fiado de la caja: venta sin cobrar y su deuda. El límite de
    -- crédito lo vuelve a controlar el trigger de `debts`.
    IF v_a_cuenta THEN
      INSERT INTO public.debts (
        user_id, org_id, sale_id, customer_id, customer_name,
        amount_ars, paid_ars, remaining_ars, description, date, status
      ) VALUES (
        v_owner, v_order.org_id, v_sale_id, v_customer_id, COALESCE(v_deudor, v_order.customer_name),
        (v_item->>'total')::numeric, 0, (v_item->>'total')::numeric,
        format('Pedido %s: %sx %s', v_order.order_number, v_qty, v_item->>'name'),
        now(), 'pending'
      );
    END IF;
    v_ventas := v_ventas + 1;
  END LOOP;
  PERFORM set_config('nerqia.cobro_servidor', '', true);

  UPDATE public.ecommerce_orders
     SET payment_status = 'paid',
         fulfillment_status = CASE WHEN fulfillment_status = 'pending' THEN 'processing' ELSE fulfillment_status END,
         payment_id = COALESCE(payment_id, p_payment_id),
         updated_at = now()
   WHERE id = p_order_id;

  IF v_owner IS NOT NULL THEN
    BEGIN
      INSERT INTO public.notifications (user_id, org_id, title, message, type)
      VALUES (
        v_owner, v_order.org_id,
        CASE WHEN v_a_cuenta THEN 'Pedido a cuenta corriente aprobado' ELSE 'Pedido pagado en la tienda' END,
        format(CASE WHEN v_a_cuenta THEN '%s compró a cuenta corriente %s (pedido %s)' ELSE '%s pagó %s (pedido %s)' END,
               COALESCE(v_deudor, v_order.customer_name),
               to_char(v_order.total, 'FM$999G999G999'), v_order.order_number),
        'ecommerce'
      );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;

  RETURN jsonb_build_object('ok', true, 'ventas_creadas', v_ventas, 'customer_id', v_customer_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.mark_store_order_paid(uuid, text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.confirmar_pedido_cuenta_corriente(p_order_id uuid, p_nota text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_order public.ecommerce_orders;
  v_result jsonb;
BEGIN
  SELECT * INTO v_order FROM public.ecommerce_orders WHERE id = p_order_id FOR UPDATE;
  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Orden no encontrada' USING ERRCODE = 'no_data_found';
  END IF;
  PERFORM public.exigir_permiso(v_order.org_id, 'ecommerce', 'edit', 'aprobar un pedido a cuenta corriente');
  IF v_order.payment_method <> 'cuenta_corriente' THEN
    RAISE EXCEPTION 'Este pedido no es a cuenta corriente' USING ERRCODE = '22023';
  END IF;
  IF v_order.payment_status = 'paid' THEN
    RETURN jsonb_build_object('ok', true, 'ya_procesada', true, 'order_id', v_order.id);
  END IF;
  IF v_order.payment_status <> 'pending' OR COALESCE(v_order.fulfillment_status, '') = 'cancelled' THEN
    RAISE EXCEPTION 'Este pedido no está esperando aprobación (estado %)', v_order.payment_status USING ERRCODE = '22023';
  END IF;

  v_result := public.mark_store_order_paid(v_order.id, 'cuenta-corriente-' || v_order.order_number, 'cuenta_corriente');

  PERFORM public.emitir_evento(
    v_order.org_id, 'pago', v_order.id, 'pago.cuenta_corriente_aprobada',
    jsonb_build_object('order_id', v_order.id, 'order_number', v_order.order_number,
                       'nota', NULLIF(btrim(COALESCE(p_nota, '')), ''), 'por', auth.uid())
  );
  RETURN v_result || jsonb_build_object('order_id', v_order.id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.confirmar_pedido_cuenta_corriente(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirmar_pedido_cuenta_corriente(uuid, text) TO authenticated;

-- ── 5. El comprador pide su cuenta; el comercio la resuelve ─────────────
CREATE OR REPLACE FUNCTION public.solicitar_cuenta_mayorista(
  p_slug text, p_razon_social text, p_cuit text, p_telefono text DEFAULT NULL, p_mensaje text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_store record;
  v_ficha public.store_customers;
  v_cuit text := regexp_replace(COALESCE(p_cuit, ''), '\D', '', 'g');
  v_razon text := left(btrim(COALESCE(p_razon_social, '')), 200);
  v_owner uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Ingresá con tu cuenta para pedir el alta mayorista' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT s.id, s.org_id, s.mayorista_modo, s.name INTO v_store
    FROM public.ecommerce_stores s
   WHERE lower(s.slug) = lower(btrim(p_slug)) AND s.is_active
   LIMIT 1;
  IF v_store.id IS NULL OR v_store.mayorista_modo = 'off' THEN
    RAISE EXCEPTION 'Esta tienda no tiene venta mayorista' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_razon) < 2 THEN
    RAISE EXCEPTION 'Escribí la razón social' USING ERRCODE = '22023';
  END IF;
  IF NOT public.cuit_valido(v_cuit) THEN
    RAISE EXCEPTION 'El CUIT no es válido' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_ficha FROM public.store_customers
   WHERE store_id = v_store.id AND user_id = auth.uid() FOR UPDATE;
  IF v_ficha.id IS NULL THEN
    INSERT INTO public.store_customers (store_id, org_id, user_id, email)
    SELECT v_store.id, v_store.org_id, u.id, COALESCE(u.email, '')
      FROM auth.users u WHERE u.id = auth.uid()
    RETURNING * INTO v_ficha;
  END IF;
  IF v_ficha.mayorista_estado = 'aprobado' THEN
    RETURN jsonb_build_object('ok', true, 'estado', 'aprobado');
  END IF;

  PERFORM set_config('nerqia.mayorista', 'on', true);
  UPDATE public.store_customers
     SET mayorista_estado = 'pendiente',
         mayorista_solicitud = jsonb_build_object(
           'razon_social', v_razon,
           'cuit', v_cuit,
           'telefono', NULLIF(left(btrim(COALESCE(p_telefono, '')), 40), ''),
           'mensaje', NULLIF(left(btrim(COALESCE(p_mensaje, '')), 1000), '')
         ),
         mayorista_solicitado_at = now(),
         mayorista_resuelto_at = NULL,
         mayorista_resuelto_por = NULL,
         mayorista_motivo = NULL
   WHERE id = v_ficha.id;
  PERFORM set_config('nerqia.mayorista', '', true);

  SELECT m.user_id INTO v_owner FROM public.memberships m
   WHERE m.org_id = v_store.org_id AND m.role = 'owner' ORDER BY m.joined_at LIMIT 1;
  IF v_owner IS NOT NULL THEN
    BEGIN
      INSERT INTO public.notifications (user_id, org_id, title, message, type)
      VALUES (v_owner, v_store.org_id, 'Nueva solicitud mayorista',
              format('%s (CUIT %s) pidió cuenta mayorista en %s', v_razon, v_cuit, v_store.name), 'ecommerce');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;
  PERFORM public.emitir_evento(v_store.org_id, 'tienda', v_ficha.id, 'mayorista.solicitada',
                               jsonb_build_object('store_customer_id', v_ficha.id, 'cuit', v_cuit));
  RETURN jsonb_build_object('ok', true, 'estado', 'pendiente');
END;
$fn$;
REVOKE ALL ON FUNCTION public.solicitar_cuenta_mayorista(text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.solicitar_cuenta_mayorista(text, text, text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.resolver_cuenta_mayorista(
  p_store_customer_id uuid,
  p_aprobar boolean,
  p_customer_id uuid DEFAULT NULL,
  p_price_list_id uuid DEFAULT NULL,
  p_credit_limit_ars numeric DEFAULT NULL,
  p_cuenta_corriente boolean DEFAULT false,
  p_motivo text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_ficha public.store_customers;
  v_cliente uuid;
  v_sol jsonb;
BEGIN
  SELECT * INTO v_ficha FROM public.store_customers WHERE id = p_store_customer_id FOR UPDATE;
  IF v_ficha.id IS NULL THEN
    RAISE EXCEPTION 'Esa cuenta de comprador no existe' USING ERRCODE = 'no_data_found';
  END IF;
  IF auth.uid() IS NULL OR NOT public.is_org_member(v_ficha.org_id, auth.uid()) THEN
    RAISE EXCEPTION 'No sos miembro de esta organizacion' USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM public.exigir_permiso(v_ficha.org_id, 'customers', 'edit', 'aprobar o rechazar una cuenta mayorista');

  IF NOT p_aprobar THEN
    PERFORM set_config('nerqia.mayorista', 'on', true);
    UPDATE public.store_customers
       SET mayorista_estado = 'rechazado', mayorista_resuelto_at = now(), mayorista_resuelto_por = auth.uid(),
           mayorista_motivo = NULLIF(left(btrim(COALESCE(p_motivo, '')), 500), ''), customer_id = NULL
     WHERE id = v_ficha.id;
    PERFORM set_config('nerqia.mayorista', '', true);
    RETURN jsonb_build_object('ok', true, 'estado', 'rechazado');
  END IF;

  IF p_credit_limit_ars IS NOT NULL AND (p_credit_limit_ars < 0 OR p_credit_limit_ars > 1000000000) THEN
    RAISE EXCEPTION 'El límite de crédito no es válido' USING ERRCODE = '22023';
  END IF;
  IF p_price_list_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.price_lists l WHERE l.id = p_price_list_id AND l.org_id = v_ficha.org_id
  ) THEN
    RAISE EXCEPTION 'Esa lista de precios no es de este negocio' USING ERRCODE = '22023';
  END IF;

  v_sol := COALESCE(v_ficha.mayorista_solicitud, '{}'::jsonb);
  IF p_customer_id IS NOT NULL THEN
    SELECT c.id INTO v_cliente FROM public.customers c WHERE c.id = p_customer_id AND c.org_id = v_ficha.org_id;
    IF v_cliente IS NULL THEN
      RAISE EXCEPTION 'Ese cliente no es de este negocio' USING ERRCODE = '22023';
    END IF;
  ELSE
    -- El mismo CUIT ya es cliente del local: se usa ése, no se duplica.
    SELECT c.id INTO v_cliente FROM public.customers c
     WHERE c.org_id = v_ficha.org_id
       AND NULLIF(v_sol->>'cuit', '') IS NOT NULL
       AND regexp_replace(COALESCE(c.tax_id, ''), '\D', '', 'g') = v_sol->>'cuit'
     ORDER BY c.created_at LIMIT 1;
    IF v_cliente IS NULL THEN
      INSERT INTO public.customers (org_id, user_id, name, legal_name, email, phone, tax_id, tax_id_type)
      VALUES (
        v_ficha.org_id, auth.uid(),
        COALESCE(NULLIF(v_sol->>'razon_social', ''), NULLIF(v_ficha.name, ''), v_ficha.email),
        NULLIF(v_sol->>'razon_social', ''),
        NULLIF(v_ficha.email, ''),
        COALESCE(NULLIF(v_sol->>'telefono', ''), v_ficha.phone),
        NULLIF(v_sol->>'cuit', ''),
        CASE WHEN NULLIF(v_sol->>'cuit', '') IS NULL THEN NULL ELSE 'CUIT' END
      )
      RETURNING id INTO v_cliente;
    END IF;
  END IF;

  UPDATE public.customers
     SET price_list_id = p_price_list_id,
         credit_limit_ars = p_credit_limit_ars,
         cuenta_corriente_online = COALESCE(p_cuenta_corriente, false)
   WHERE id = v_cliente;

  PERFORM set_config('nerqia.mayorista', 'on', true);
  UPDATE public.store_customers
     SET mayorista_estado = 'aprobado', customer_id = v_cliente,
         mayorista_resuelto_at = now(), mayorista_resuelto_por = auth.uid(), mayorista_motivo = NULL
   WHERE id = v_ficha.id;
  PERFORM set_config('nerqia.mayorista', '', true);

  PERFORM public.emitir_evento(v_ficha.org_id, 'tienda', v_ficha.id, 'mayorista.aprobada',
                               jsonb_build_object('store_customer_id', v_ficha.id, 'customer_id', v_cliente, 'por', auth.uid()));
  RETURN jsonb_build_object('ok', true, 'estado', 'aprobado', 'customer_id', v_cliente);
END;
$fn$;
REVOKE ALL ON FUNCTION public.resolver_cuenta_mayorista(uuid, boolean, uuid, uuid, numeric, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolver_cuenta_mayorista(uuid, boolean, uuid, uuid, numeric, boolean, text) TO authenticated;

-- ── 6. Lo que la tienda le muestra al comprador ─────────────────────────
CREATE OR REPLACE FUNCTION public.get_store_mayorista(p_slug text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_store record;
  v_ficha public.store_customers;
  v_cli_id uuid;
  v_limite numeric;
  v_cc boolean := false;
  v_lista text;
  v_comprador jsonb := NULL;
BEGIN
  SELECT s.id, s.mayorista_modo, s.mayorista_minimo_ars, s.mayorista_cuenta_corriente INTO v_store
    FROM public.ecommerce_stores s
   WHERE lower(s.slug) = lower(btrim(p_slug)) AND s.is_active LIMIT 1;
  IF v_store.id IS NULL THEN
    RETURN jsonb_build_object('modo', 'off');
  END IF;
  IF v_store.mayorista_modo = 'off' THEN
    RETURN jsonb_build_object('modo', 'off');
  END IF;

  IF auth.uid() IS NOT NULL THEN
    SELECT * INTO v_ficha FROM public.store_customers WHERE store_id = v_store.id AND user_id = auth.uid();
    IF v_ficha.id IS NOT NULL THEN
      IF v_ficha.mayorista_estado = 'aprobado' AND v_ficha.customer_id IS NOT NULL THEN
        SELECT c.id, c.credit_limit_ars, c.cuenta_corriente_online, l.name
          INTO v_cli_id, v_limite, v_cc, v_lista
          FROM public.customers c LEFT JOIN public.price_lists l ON l.id = c.price_list_id
         WHERE c.id = v_ficha.customer_id;
      END IF;
      v_comprador := jsonb_build_object(
        'estado', v_ficha.mayorista_estado,
        'motivo', v_ficha.mayorista_motivo,
        'razon_social', v_ficha.mayorista_solicitud->>'razon_social',
        'lista', v_lista,
        'cuenta_corriente', v_store.mayorista_cuenta_corriente AND COALESCE(v_cc, false),
        'credito_disponible', CASE
          WHEN v_cli_id IS NULL OR v_limite IS NULL THEN NULL
          ELSE GREATEST(v_limite - public.saldo_comprometido_cliente(v_cli_id), 0)
        END
      );
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'modo', v_store.mayorista_modo,
    'minimo', v_store.mayorista_minimo_ars,
    'comprador', v_comprador
  );
END;
$fn$;
REVOKE ALL ON FUNCTION public.get_store_mayorista(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_store_mayorista(text) TO anon, authenticated;

-- Precios del comprador aprobado para los productos que está viendo, con sus
-- tramos por cantidad. El catálogo público sigue siendo minorista (y
-- cacheable); esto se superpone en la pantalla.
CREATE OR REPLACE FUNCTION public.get_store_precios_mayoristas(p_slug text, p_product_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_store record;
  v_cliente uuid;
  v_lista uuid;
  v_resp jsonb := '[]'::jsonb;
  v_prod record;
  v_tramos jsonb;
  v_desde integer;
  v_precio numeric;
BEGIN
  SELECT s.id, s.org_id INTO v_store FROM public.ecommerce_stores s
   WHERE lower(s.slug) = lower(btrim(p_slug)) AND s.is_active LIMIT 1;
  IF v_store.id IS NULL OR p_product_ids IS NULL THEN
    RETURN v_resp;
  END IF;
  v_cliente := public.cliente_mayorista_de_tienda(v_store.id);
  IF v_cliente IS NULL THEN
    RETURN v_resp;
  END IF;
  SELECT c.price_list_id INTO v_lista FROM public.customers c WHERE c.id = v_cliente;

  FOR v_prod IN
    SELECT p.id, COALESCE(pub.price_ars, p.sale_price_ars) AS base
      FROM public.products p
      LEFT JOIN public.store_product_publications pub ON pub.store_id = v_store.id AND pub.product_id = p.id
     WHERE p.org_id = v_store.org_id
       AND p.id = ANY(p_product_ids[1:300])
       AND COALESCE(p.is_active, true)
       AND COALESCE(pub.visibility, 'published') = 'published'
  LOOP
    v_tramos := '[]'::jsonb;
    FOR v_desde IN
      SELECT DISTINCT q FROM (
        SELECT 1 AS q
        UNION SELECT COALESCE(i.min_quantity, 1) FROM public.price_list_items i
         WHERE i.price_list_id = v_lista AND i.product_id = v_prod.id
      ) t ORDER BY q
    LOOP
      v_precio := public.precio_lista_cliente(v_cliente, v_prod.id, v_desde, v_prod.base);
      IF v_precio IS NOT NULL THEN
        v_tramos := v_tramos || jsonb_build_array(jsonb_build_object('desde', v_desde, 'precio', v_precio));
      END IF;
    END LOOP;
    IF jsonb_array_length(v_tramos) > 0 THEN
      v_resp := v_resp || jsonb_build_array(jsonb_build_object('product_id', v_prod.id, 'base', v_prod.base, 'tramos', v_tramos));
    END IF;
  END LOOP;
  RETURN v_resp;
END;
$fn$;
REVOKE ALL ON FUNCTION public.get_store_precios_mayoristas(text, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_store_precios_mayoristas(text, uuid[]) TO anon, authenticated;

-- ── 7. Contratos de seguridad ────────────────────────────────────────────
WITH c(function_name, audience, rationale) AS (VALUES
  ('precio_lista_cliente', 'security_helper', 'Calcula el precio de lista de un cliente; sólo la llaman funciones del checkout.'),
  ('cliente_mayorista_de_tienda', 'security_helper', 'Devuelve el cliente aprobado de la sesión del comprador; no recibe identidades de afuera.'),
  ('saldo_comprometido_cliente', 'security_helper', 'Suma deudas y pedidos a cuenta de un cliente; sólo para el control de crédito.'),
  ('confirmar_pedido_cuenta_corriente', 'authenticated_delegate', 'Exige permiso de editar la tienda; sólo pedidos a cuenta corriente pendientes de su negocio.'),
  ('solicitar_cuenta_mayorista', 'public_token', 'El comprador logueado pide su propia cuenta mayorista; no puede aprobarse solo.'),
  ('resolver_cuenta_mayorista', 'authenticated_delegate', 'Exige permiso de editar clientes; vincula y aprueba sólo cuentas de su negocio.'),
  ('get_store_mayorista', 'public_storefront', 'Expone el modo mayorista de la tienda y, a la sesión del comprador, sólo su propio estado.'),
  ('get_store_precios_mayoristas', 'public_token', 'Devuelve precios de lista sólo al comprador aprobado de esa tienda, para su sesión.')
)
INSERT INTO public.security_function_contracts(function_name, identity_arguments, audience, rationale, definition_hash, reviewed_on)
SELECT p.proname, pg_get_function_identity_arguments(p.oid), c.audience, c.rationale, md5(pg_get_functiondef(p.oid)), DATE '2026-10-23'
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN c ON c.function_name = p.proname
 WHERE n.nspname = 'public'
ON CONFLICT (function_name, identity_arguments) DO UPDATE
  SET audience = EXCLUDED.audience, rationale = EXCLUDED.rationale,
      definition_hash = EXCLUDED.definition_hash, reviewed_on = EXCLUDED.reviewed_on;

-- Las redefinidas conservan su contrato; se actualiza el hash.
UPDATE public.security_function_contracts sfc
   SET definition_hash = md5(pg_get_functiondef(p.oid)), reviewed_on = DATE '2026-10-23'
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN ('resolve_store_line', 'create_store_order', 'mark_store_order_paid', 'medios_de_pago_vivos', 'guard_sales_ecommerce_order_link')
   AND sfc.function_name = p.proname
   AND sfc.identity_arguments = pg_get_function_identity_arguments(p.oid);

COMMIT;
