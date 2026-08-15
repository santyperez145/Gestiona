-- C9 — La tienda vende desde el depósito que realmente despacha.
--
-- El stock total de una organización no sirve para prometer una entrega: una
-- unidad que está en el local de Palermo no se puede despachar desde el
-- depósito de Córdoba. La tienda ahora puede elegir una sucursal de despacho;
-- cada orden toma una foto inmutable de esa elección y reserva, vende, devuelve
-- y deja Kardex contra esa misma ubicación.
--
-- Las variantes requieren su propio desglose: `location_stock` siempre fue
-- por producto y suma sabores/talles. `location_variant_stock` conserva el
-- detalle sin alterar ni reemplazar el desglose existente. Para organizaciones
-- con una sola sucursal se asignan allí los movimientos sin ubicación explícita:
-- es el único caso en que la inferencia no puede inventar una distribución.
-- Con dos o más sucursales, una operación sin ubicación sigue sin inventar una.

-- ── Estructura y autoridad de la ubicación de despacho ────────────────────
ALTER TABLE public.ecommerce_stores
  ADD COLUMN IF NOT EXISTS fulfillment_location_id uuid
  REFERENCES public.locations(id) ON DELETE RESTRICT;

ALTER TABLE public.ecommerce_orders
  ADD COLUMN IF NOT EXISTS fulfillment_location_id uuid
  REFERENCES public.locations(id) ON DELETE RESTRICT;

ALTER TABLE public.stock_reservations
  ADD COLUMN IF NOT EXISTS location_id uuid
  REFERENCES public.locations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS ecommerce_orders_fulfillment_location_idx
  ON public.ecommerce_orders(fulfillment_location_id, created_at DESC)
  WHERE fulfillment_location_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS stock_reservations_location_active_idx
  ON public.stock_reservations(location_id, product_id, variant_id)
  WHERE status = 'active';

COMMENT ON COLUMN public.ecommerce_stores.fulfillment_location_id IS
  'Sucursal desde la que despacha la tienda. Null conserva el modo histórico de stock global; una ubicación elegida obliga a reservar y vender sólo desde ella.';

COMMENT ON COLUMN public.ecommerce_orders.fulfillment_location_id IS
  'Foto inmutable de la sucursal de despacho al crear la orden. Conserva trazabilidad aunque luego cambie la configuración de la tienda.';

COMMENT ON COLUMN public.stock_reservations.location_id IS
  'Sucursal cuyo disponible queda apartado. Null es una reserva manual histórica/global y se descuenta conservadoramente de cada despacho localizado.';

CREATE TABLE IF NOT EXISTS public.location_variant_stock (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  variant_id uuid NOT NULL REFERENCES public.product_variants(id) ON DELETE CASCADE,
  stock integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (location_id, variant_id)
);

CREATE INDEX IF NOT EXISTS location_variant_stock_org_location_idx
  ON public.location_variant_stock(org_id, location_id, product_id);

ALTER TABLE public.location_variant_stock ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS location_variant_stock_org_read ON public.location_variant_stock;
CREATE POLICY location_variant_stock_org_read ON public.location_variant_stock
  FOR SELECT TO authenticated
  USING (public.is_org_member(org_id, auth.uid()));

COMMENT ON TABLE public.location_variant_stock IS
  'Desglose de stock por variante y sucursal. La UI sólo lee: record_stock_movement es la única escritura, igual que location_stock.';

-- La configuración de una tienda no puede apuntar a una sucursal ajena,
-- inactiva o inexistente. RLS por fila no expresa este vínculo entre tablas.
CREATE OR REPLACE FUNCTION public.validate_store_fulfillment_location()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.fulfillment_location_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.locations l
    WHERE l.id = NEW.fulfillment_location_id
      AND l.org_id = NEW.org_id
      AND l.active
  ) THEN
    RAISE EXCEPTION 'La sucursal de despacho tiene que estar activa y pertenecer a la organización'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_store_fulfillment_location ON public.ecommerce_stores;
CREATE TRIGGER trg_validate_store_fulfillment_location
BEFORE INSERT OR UPDATE OF org_id, fulfillment_location_id ON public.ecommerce_stores
FOR EACH ROW EXECUTE FUNCTION public.validate_store_fulfillment_location();

-- El navegador jamás decide desde dónde se descuenta una orden. En INSERT se
-- toma la configuración persistida de la tienda, ignorando cualquier UUID del
-- payload; después queda bloqueado para preservar la evidencia del pedido.
CREATE OR REPLACE FUNCTION public.assign_store_order_fulfillment_location()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_location_id uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.fulfillment_location_id IS DISTINCT FROM OLD.fulfillment_location_id THEN
      RAISE EXCEPTION 'La sucursal de despacho de una orden no se puede cambiar'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  SELECT s.fulfillment_location_id
    INTO v_location_id
  FROM public.ecommerce_stores s
  WHERE s.id = NEW.store_id
    AND s.org_id = NEW.org_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La tienda no pertenece a la organización de la orden'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  NEW.fulfillment_location_id := v_location_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assign_store_order_fulfillment_location ON public.ecommerce_orders;
CREATE TRIGGER trg_assign_store_order_fulfillment_location
BEFORE INSERT OR UPDATE ON public.ecommerce_orders
FOR EACH ROW EXECUTE FUNCTION public.assign_store_order_fulfillment_location();

-- ── Kardex: el detalle de variante acompaña a la ubicación ────────────────
CREATE OR REPLACE FUNCTION public.record_stock_movement(
  p_org_id UUID, p_product_id UUID, p_variant_id UUID,
  p_product_name TEXT, p_variant_name TEXT,
  p_movement_type TEXT, p_quantity INTEGER,
  p_reference_type TEXT DEFAULT NULL, p_reference_id UUID DEFAULT NULL,
  p_unit_cost_usd NUMERIC DEFAULT NULL, p_unit_price_ars NUMERIC DEFAULT NULL,
  p_notes TEXT DEFAULT NULL, p_created_by UUID DEFAULT NULL,
  p_location_id UUID DEFAULT NULL
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_stock_before INTEGER;
  v_stock_after  INTEGER;
  v_mov_id       UUID;
  v_location_id  UUID := p_location_id;
BEGIN
  -- Con una sola sucursal activa, cualquier stock sin ubicación sólo puede
  -- estar ahí. Así una variante creada después de habilitar sucursales no
  -- queda global e invisible para la tienda. Con dos o más no se adivina.
  IF v_location_id IS NULL THEN
    SELECT min(l.id::text)::uuid INTO v_location_id
    FROM public.locations l
    WHERE l.org_id = p_org_id AND l.active
    HAVING count(*) = 1;
  END IF;

  IF v_location_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.locations l
    WHERE l.id = v_location_id AND l.org_id = p_org_id
  ) THEN
    RAISE EXCEPTION 'La sucursal del movimiento no pertenece a la organización'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF p_variant_id IS NOT NULL THEN
    SELECT stock INTO v_stock_before
    FROM public.product_variants
    WHERE id = p_variant_id AND product_id = p_product_id AND org_id = p_org_id;
  ELSE
    SELECT stock INTO v_stock_before
    FROM public.products
    WHERE id = p_product_id AND org_id = p_org_id;
  END IF;
  v_stock_before := COALESCE(v_stock_before, 0);
  v_stock_after  := v_stock_before + p_quantity;

  IF p_variant_id IS NOT NULL THEN
    UPDATE public.product_variants
       SET stock = v_stock_after
     WHERE id = p_variant_id AND product_id = p_product_id AND org_id = p_org_id;
    UPDATE public.products p
       SET stock = (
         SELECT COALESCE(SUM(pv.stock), 0)
         FROM public.product_variants pv
         WHERE pv.product_id = p.id
       )
     WHERE id = p_product_id AND org_id = p_org_id;
  ELSE
    UPDATE public.products
       SET stock = v_stock_after
     WHERE id = p_product_id AND org_id = p_org_id;
  END IF;

  IF v_location_id IS NOT NULL AND p_product_id IS NOT NULL THEN
    INSERT INTO public.location_stock (org_id, location_id, product_id, stock, updated_at)
    VALUES (p_org_id, v_location_id, p_product_id, p_quantity, now())
    ON CONFLICT (location_id, product_id) DO UPDATE
      SET stock = public.location_stock.stock + EXCLUDED.stock,
          updated_at = now();

    IF p_variant_id IS NOT NULL THEN
      INSERT INTO public.location_variant_stock (
        org_id, location_id, product_id, variant_id, stock, updated_at
      ) VALUES (
        p_org_id, v_location_id, p_product_id, p_variant_id, p_quantity, now()
      )
      ON CONFLICT (location_id, variant_id) DO UPDATE
        SET stock = public.location_variant_stock.stock + EXCLUDED.stock,
            updated_at = now(),
            product_id = EXCLUDED.product_id,
            org_id = EXCLUDED.org_id;
    END IF;
  END IF;

  INSERT INTO public.stock_movements (
    org_id, product_id, variant_id, product_name, variant_name,
    movement_type, quantity, stock_before, stock_after,
    reference_type, reference_id, unit_cost_usd, unit_price_ars, notes, created_by,
    location_id
  ) VALUES (
    p_org_id, p_product_id, p_variant_id, p_product_name, p_variant_name,
    p_movement_type, p_quantity, v_stock_before, v_stock_after,
    p_reference_type, p_reference_id, p_unit_cost_usd, p_unit_price_ars, p_notes, p_created_by,
    v_location_id
  ) RETURNING id INTO v_mov_id;

  RETURN v_mov_id;
END;
$$;

COMMENT ON FUNCTION public.record_stock_movement IS
  'Único lugar que mueve stock. Mantiene el total, location_stock y el detalle location_variant_stock; sólo infiere ubicación cuando la organización tiene exactamente una sucursal activa.';

-- Las organizaciones que recién crean su primera sucursal ya tenían stock
-- global. Se copia también cada variante: no hay distribución que inferir con
-- un único destino. En más de una sucursal se exige una transferencia real.
CREATE OR REPLACE FUNCTION public.trg_location_seed_stock()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT NEW.active THEN RETURN NEW; END IF;

  IF (SELECT count(*) FROM public.locations l
       WHERE l.org_id = NEW.org_id AND l.active) > 1 THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.location_stock (org_id, location_id, product_id, stock, updated_at)
  SELECT p.org_id, NEW.id, p.id, COALESCE(p.stock, 0), now()
  FROM public.products p
  WHERE p.org_id = NEW.org_id
    AND NOT EXISTS (SELECT 1 FROM public.location_stock ls WHERE ls.product_id = p.id)
  ON CONFLICT (location_id, product_id) DO NOTHING;

  INSERT INTO public.location_variant_stock (
    org_id, location_id, product_id, variant_id, stock, updated_at
  )
  SELECT pv.org_id, NEW.id, pv.product_id, pv.id, COALESCE(pv.stock, 0), now()
  FROM public.product_variants pv
  WHERE pv.org_id = NEW.org_id
    AND NOT EXISTS (
      SELECT 1 FROM public.location_variant_stock lvs WHERE lvs.variant_id = pv.id
    )
  ON CONFLICT (location_id, variant_id) DO NOTHING;

  RETURN NEW;
END;
$$;

-- ── Disponible localizado: físico menos reservas del mismo depósito ───────
DROP FUNCTION IF EXISTS public.stock_disponible(uuid, uuid);

CREATE OR REPLACE FUNCTION public.stock_disponible(
  p_product_id uuid,
  p_variant_id uuid DEFAULT NULL,
  p_location_id uuid DEFAULT NULL
) RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    CASE
      WHEN p_location_id IS NOT NULL AND p_variant_id IS NOT NULL THEN (
        SELECT lvs.stock
        FROM public.location_variant_stock lvs
        WHERE lvs.location_id = p_location_id
          AND lvs.product_id = p_product_id
          AND lvs.variant_id = p_variant_id
      )
      WHEN p_location_id IS NOT NULL THEN (
        SELECT ls.stock
        FROM public.location_stock ls
        WHERE ls.location_id = p_location_id
          AND ls.product_id = p_product_id
      )
      WHEN p_variant_id IS NOT NULL THEN (
        SELECT v.stock FROM public.product_variants v WHERE v.id = p_variant_id
      )
      ELSE (
        SELECT p.stock FROM public.products p WHERE p.id = p_product_id
      )
    END,
    0
  ) - COALESCE((
    SELECT sum(r.quantity)
    FROM public.stock_reservations r
    WHERE r.status = 'active'
      AND (r.expires_at IS NULL OR r.expires_at > now())
      AND r.product_id = p_product_id
      AND r.variant_id IS NOT DISTINCT FROM p_variant_id
      AND (
        p_location_id IS NULL
        OR r.location_id IS NULL
        OR r.location_id = p_location_id
      )
  ), 0);
$$;

COMMENT ON FUNCTION public.stock_disponible(uuid, uuid, uuid) IS
  'Disponible global o por sucursal. Una reserva histórica sin ubicación se descuenta de cada sucursal localizada de forma conservadora: nunca habilita una sobreventa.';

REVOKE ALL ON FUNCTION public.stock_disponible(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.stock_disponible(uuid, uuid, uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.trg_reservar_stock_de_orden()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_item      jsonb;
  v_pid       uuid;
  v_vid       uuid;
  v_qty       numeric;
  v_disp      numeric;
  v_nombre    text;
  v_minutos   int := 30;
BEGIN
  IF NEW.payment_status = 'paid' THEN RETURN NEW; END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(NEW.items, '[]'::jsonb)) LOOP
    v_pid := NULLIF(v_item->>'product_id', '')::uuid;
    v_vid := NULLIF(v_item->>'variant_id', '')::uuid;
    v_qty := COALESCE((v_item->>'quantity')::numeric, 0);
    IF v_pid IS NULL OR v_qty <= 0 THEN CONTINUE; END IF;

    -- Serializa el producto aunque cada tienda despache desde una sucursal
    -- distinta: una reserva global histórica puede competir con cualquiera.
    PERFORM 1 FROM public.products WHERE id = v_pid FOR UPDATE;

    v_disp := public.stock_disponible(v_pid, v_vid, NEW.fulfillment_location_id);
    IF v_disp < v_qty THEN
      SELECT name INTO v_nombre FROM public.products WHERE id = v_pid;
      RAISE EXCEPTION 'Sin stock disponible de % en el depósito de despacho: quedan % y se piden %',
        COALESCE(v_nombre, 'el producto'), GREATEST(v_disp, 0), v_qty
        USING ERRCODE = 'invalid_parameter_value';
    END IF;

    INSERT INTO public.stock_reservations (
      org_id, order_id, product_id, variant_id, location_id, quantity,
      status, expires_at, customer_name, notes
    ) VALUES (
      NEW.org_id, NEW.id, v_pid, v_vid, NEW.fulfillment_location_id, v_qty,
      'active', now() + (v_minutos || ' minutes')::interval,
      NULLIF(NEW.customer_name, ''),
      format('Orden %s', NEW.order_number)
    );
  END LOOP;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.trg_reservar_stock_de_orden IS
  'Aparta el disponible de la sucursal que despacha. Sin una sucursal configurada conserva el modo global; una reserva sin ubicación previa se descuenta conservadoramente.';

-- La reserva manual también puede declarar sucursal. Las llamadas históricas
-- sin p_location_id siguen siendo globales y no se reinterpretan sin evidencia.
DROP FUNCTION IF EXISTS public.create_stock_reservation(uuid, uuid, integer, text, text, timestamptz, text, uuid);

CREATE OR REPLACE FUNCTION public.create_stock_reservation(
  p_org_id         UUID,
  p_product_id     UUID,
  p_quantity       INTEGER,
  p_customer_name  TEXT,
  p_customer_phone TEXT DEFAULT NULL,
  p_expires_at     TIMESTAMPTZ DEFAULT NULL,
  p_notes          TEXT DEFAULT NULL,
  p_variant_id     UUID DEFAULT NULL,
  p_location_id    UUID DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_available integer;
  v_id uuid;
BEGIN
  IF NOT public.has_org_role(p_org_id, auth.uid(), ARRAY['owner','admin']) THEN
    RAISE EXCEPTION 'Unauthorized: requires owner/admin role';
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'La cantidad debe ser mayor a 0';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.products p WHERE p.id = p_product_id AND p.org_id = p_org_id
  ) THEN
    RAISE EXCEPTION 'Producto no encontrado';
  END IF;
  IF p_variant_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.product_variants v
    WHERE v.id = p_variant_id AND v.product_id = p_product_id AND v.org_id = p_org_id
  ) THEN
    RAISE EXCEPTION 'Variante no encontrada para el producto';
  END IF;
  IF p_location_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.locations l
    WHERE l.id = p_location_id AND l.org_id = p_org_id AND l.active
  ) THEN
    RAISE EXCEPTION 'La sucursal de la reserva tiene que estar activa y pertenecer a la organización';
  END IF;

  PERFORM 1 FROM public.products WHERE id = p_product_id FOR UPDATE;
  v_available := public.stock_disponible(p_product_id, p_variant_id, p_location_id);
  IF p_quantity > v_available THEN
    RAISE EXCEPTION 'Stock insuficiente: hay % disponible(s)', GREATEST(v_available, 0);
  END IF;

  INSERT INTO public.stock_reservations (
    org_id, product_id, variant_id, location_id, customer_name, customer_phone,
    quantity, expires_at, notes, created_by
  ) VALUES (
    p_org_id, p_product_id, p_variant_id, p_location_id, p_customer_name, p_customer_phone,
    p_quantity, p_expires_at, p_notes, auth.uid()
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_stock_reservation(uuid, uuid, integer, text, text, timestamptz, text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_stock_reservation(uuid, uuid, integer, text, text, timestamptz, text, uuid, uuid) TO authenticated;

-- ── Cobro y devolución usan la misma foto de despacho ─────────────────────
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

  BEGIN
    v_customer_id := public.upsert_customer_from_order(v_order.id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'upsert_customer_from_order falló antes de crear ventas para %: %', p_order_id, SQLERRM;
    v_customer_id := NULL;
  END;

  SELECT m.user_id INTO v_owner
  FROM public.memberships m
  WHERE m.org_id = v_order.org_id AND m.role = 'owner'
  ORDER BY m.joined_at LIMIT 1;

  SELECT COALESCE(exchange_rate, 1) INTO v_rate
  FROM public.settings WHERE org_id = v_order.org_id;
  v_rate := COALESCE(v_rate, 1);

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
      v_customer_id, v_order.customer_name, now(), true,
      p_method, 'tienda_online', v_order.id
    );
    v_ventas := v_ventas + 1;
  END LOOP;

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
        v_owner, v_order.org_id, 'Pedido pagado en la tienda',
        format('%s pagó %s (pedido %s)', v_order.customer_name,
               to_char(v_order.total, 'FM$999G999G999'), v_order.order_number),
        'ecommerce'
      );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;

  RETURN jsonb_build_object('ok', true, 'ventas_creadas', v_ventas, 'customer_id', v_customer_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.mark_store_order_paid(uuid, text, text)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.return_store_order_item(
  p_order_id uuid,
  p_product_id uuid,
  p_variant_id uuid DEFAULT NULL,
  p_qty int DEFAULT 1,
  p_reason text DEFAULT NULL,
  p_refund_method text DEFAULT 'transferencia',
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order record;
  v_item jsonb;
  v_comprados int := 0;
  v_devueltos int := 0;
  v_unit numeric := 0;
  v_nombre text;
  v_var_nombre text;
  v_return_id uuid;
BEGIN
  IF COALESCE(p_qty, 0) < 1 THEN
    RAISE EXCEPTION 'La cantidad a devolver tiene que ser al menos 1';
  END IF;
  SELECT o.id, o.org_id, o.items, o.payment_status, o.order_number, o.fulfillment_location_id
    INTO v_order FROM public.ecommerce_orders o WHERE o.id = p_order_id;
  IF v_order.id IS NULL THEN RAISE EXCEPTION 'Orden no encontrada'; END IF;
  IF NOT public.has_org_role(v_order.org_id, auth.uid(), ARRAY['owner','admin','manager']) THEN
    RAISE EXCEPTION 'No tenés permiso para registrar devoluciones';
  END IF;
  IF v_order.payment_status NOT IN ('paid', 'refunded', 'charged_back') THEN
    RAISE EXCEPTION 'La orden % todavía no tiene un cobro revertible', v_order.order_number;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(v_order.items, '[]'::jsonb)) LOOP
    IF (v_item->>'product_id')::uuid = p_product_id
       AND COALESCE(NULLIF(v_item->>'variant_id','')::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
         = COALESCE(p_variant_id, '00000000-0000-0000-0000-000000000000'::uuid) THEN
      v_comprados := v_comprados + GREATEST(COALESCE((v_item->>'quantity')::int, 0), 0);
      v_unit := COALESCE((v_item->>'unit_price')::numeric, 0);
      v_nombre := v_item->>'name';
    END IF;
  END LOOP;
  IF v_comprados = 0 THEN RAISE EXCEPTION 'Ese producto no está en la orden %', v_order.order_number; END IF;

  SELECT COALESCE(SUM(r.quantity), 0) INTO v_devueltos
  FROM public.returns r
  WHERE r.ecommerce_order_id = p_order_id AND r.product_id = p_product_id
    AND COALESCE(r.variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
      = COALESCE(p_variant_id, '00000000-0000-0000-0000-000000000000'::uuid);
  IF v_devueltos + p_qty > v_comprados THEN
    RAISE EXCEPTION 'Se compraron % y ya se devolvieron %: no se pueden devolver % más', v_comprados, v_devueltos, p_qty;
  END IF;

  SELECT v.variant_name INTO v_var_nombre FROM public.product_variants v WHERE v.id = p_variant_id;
  INSERT INTO public.returns (
    org_id, user_id, ecommerce_order_id, product_id, variant_id,
    product_name, quantity, amount_ars, reason, refund_method, notes
  ) VALUES (
    v_order.org_id, auth.uid(), p_order_id, p_product_id, p_variant_id,
    COALESCE(v_nombre, 'Producto'), p_qty, round(v_unit * p_qty),
    p_reason, p_refund_method, p_notes
  ) RETURNING id INTO v_return_id;

  PERFORM public.record_stock_movement(
    v_order.org_id, p_product_id, p_variant_id,
    COALESCE(v_nombre, 'Producto'), v_var_nombre,
    'return', p_qty, 'ecommerce_order', p_order_id, NULL, v_unit,
    format('Devolución de la orden %s', v_order.order_number), auth.uid(),
    v_order.fulfillment_location_id
  );

  RETURN jsonb_build_object(
    'ok', true, 'return_id', v_return_id, 'order_number', v_order.order_number,
    'quantity', p_qty, 'amount', round(v_unit * p_qty),
    'restantes', v_comprados - v_devueltos - p_qty
  );
END;
$$;

REVOKE ALL ON FUNCTION public.return_store_order_item(uuid, uuid, uuid, int, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.return_store_order_item(uuid, uuid, uuid, int, text, text, text) TO authenticated;

-- ── Verificación contra la base real, sin tocar mercadería del negocio ─────
CREATE TEMP TABLE IF NOT EXISTS zz_store_fulfillment_location_verification (
  check_name text PRIMARY KEY,
  passed boolean NOT NULL,
  detail text NOT NULL
);
TRUNCATE zz_store_fulfillment_location_verification;

DO $verify$
DECLARE
  v_suffix text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
  v_user uuid;
  v_org uuid;
  v_store uuid;
  v_location_a uuid;
  v_location_b uuid;
  v_product uuid;
  v_variant uuid;
  v_order uuid;
  v_location uuid;
  v_reserved_location uuid;
  v_sale_variant uuid;
  v_sale_location uuid;
  v_variant_a int;
  v_variant_b int;
  v_total int;
  v_local_rejected boolean := false;
  v_no_write_policy boolean;
  v_anon_reservation boolean;
BEGIN
  SELECT id INTO v_user FROM auth.users ORDER BY created_at LIMIT 1;
  IF v_user IS NULL THEN
    RAISE NOTICE 'Store fulfillment location verification omitted: no auth user exists';
    RETURN;
  END IF;

  INSERT INTO public.organizations (name, slug, owner_user_id)
  VALUES ('ZZ despacho tienda ' || v_suffix, 'zz-store-fulfillment-' || v_suffix, v_user)
  RETURNING id INTO v_org;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_user, 'owner');
  INSERT INTO public.locations (org_id, name, is_main) VALUES (v_org, 'ZZ depósito A', true) RETURNING id INTO v_location_a;
  INSERT INTO public.locations (org_id, name) VALUES (v_org, 'ZZ depósito B') RETURNING id INTO v_location_b;
  INSERT INTO public.ecommerce_stores (org_id, slug, fulfillment_location_id)
  VALUES (v_org, 'zz-store-fulfillment-' || v_suffix, v_location_a)
  RETURNING id INTO v_store;
  INSERT INTO public.products (org_id, user_id, name, sale_price_ars, total_cost_usd, stock)
  VALUES (v_org, v_user, 'ZZ variante despacho', 500, 2, 0)
  RETURNING id INTO v_product;
  INSERT INTO public.product_variants (org_id, user_id, product_id, variant_name, stock, active)
  VALUES (v_org, v_user, v_product, 'ZZ 100ml', 0, true)
  RETURNING id INTO v_variant;

  PERFORM public.record_stock_movement(
    v_org, v_product, v_variant, 'ZZ variante despacho', 'ZZ 100ml',
    'adjustment_in', 5, 'manual', NULL, NULL, 500, 'stock ZZ A', v_user, v_location_a
  );
  PERFORM public.record_stock_movement(
    v_org, v_product, v_variant, 'ZZ variante despacho', 'ZZ 100ml',
    'adjustment_in', 2, 'manual', NULL, NULL, 500, 'stock ZZ B', v_user, v_location_b
  );

  -- El UUID B llega deliberadamente en el INSERT y el trigger lo reemplaza
  -- por A: la configuración persistida, no quien llama, es la autoridad.
  INSERT INTO public.ecommerce_orders (
    org_id, store_id, fulfillment_location_id, order_number, customer_name, customer_email,
    items, subtotal, total
  ) VALUES (
    v_org, v_store, v_location_b, 'ZZFUL-' || v_suffix, 'ZZ comprador',
    'zz-fulfillment-' || v_suffix || '@invalid.test',
    jsonb_build_array(jsonb_build_object(
      'product_id', v_product, 'variant_id', v_variant, 'name', 'ZZ variante despacho',
      'quantity', 1, 'unit_price', 500, 'total', 500
    )),
    500, 500
  ) RETURNING id INTO v_order;

  SELECT fulfillment_location_id INTO v_location FROM public.ecommerce_orders WHERE id = v_order;
  SELECT location_id INTO v_reserved_location
  FROM public.stock_reservations WHERE order_id = v_order AND status = 'active';
  IF v_location IS DISTINCT FROM v_location_a OR v_reserved_location IS DISTINCT FROM v_location_a THEN
    RAISE EXCEPTION 'La orden no tomó el depósito configurado: orden %, reserva %, esperado %',
      v_location, v_reserved_location, v_location_a;
  END IF;

  PERFORM public.mark_store_order_paid(v_order, 'zz-fulfillment-payment-' || v_suffix, 'mercado_pago');
  SELECT variant_id, location_id INTO v_sale_variant, v_sale_location
  FROM public.sales WHERE ecommerce_order_id = v_order;
  IF v_sale_variant IS DISTINCT FROM v_variant OR v_sale_location IS DISTINCT FROM v_location_a THEN
    RAISE EXCEPTION 'El cobro perdió variante o depósito: variante %, depósito %', v_sale_variant, v_sale_location;
  END IF;

  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_user::text, 'role', 'authenticated'
  )::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM public.return_store_order_item(v_order, v_product, v_variant, 1, 'ZZ devolución', 'transferencia', 'verificación');
  EXECUTE 'RESET ROLE';

  SELECT lvs.stock INTO v_variant_a
  FROM public.location_variant_stock lvs
  WHERE lvs.location_id = v_location_a AND lvs.variant_id = v_variant;
  SELECT lvs.stock INTO v_variant_b
  FROM public.location_variant_stock lvs
  WHERE lvs.location_id = v_location_b AND lvs.variant_id = v_variant;
  SELECT stock INTO v_total FROM public.product_variants WHERE id = v_variant;
  IF v_variant_a <> 5 OR v_variant_b <> 2 OR v_total <> 7 THEN
    RAISE EXCEPTION 'El ciclo venta/devolución no cerró por ubicación: A %, B %, total %', v_variant_a, v_variant_b, v_total;
  END IF;

  -- Hay 7 en total, pero sólo 5 en A: una orden de 6 debe rechazarse antes de
  -- existir. Es la prueba que el modo global no puede ofrecer.
  BEGIN
    INSERT INTO public.ecommerce_orders (
      org_id, store_id, order_number, customer_name, customer_email, items, subtotal, total
    ) VALUES (
      v_org, v_store, 'ZZFUL-LOCAL-' || v_suffix, 'ZZ comprador',
      'zz-local-' || v_suffix || '@invalid.test',
      jsonb_build_array(jsonb_build_object(
        'product_id', v_product, 'variant_id', v_variant, 'name', 'ZZ variante despacho',
        'quantity', 6, 'unit_price', 500, 'total', 3000
      )),
      3000, 3000
    );
  EXCEPTION WHEN invalid_parameter_value THEN
    v_local_rejected := true;
  END;
  IF NOT v_local_rejected THEN
    RAISE EXCEPTION 'La tienda aceptó 6 unidades desde A aunque sólo había 5 allí';
  END IF;

  SELECT NOT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polrelid = 'public.location_variant_stock'::regclass
      AND polcmd IN ('a', 'w', 'd', '*')
  ) INTO v_no_write_policy;
  SELECT has_function_privilege(
    'anon', 'public.create_stock_reservation(uuid,uuid,integer,text,text,timestamptz,text,uuid,uuid)', 'EXECUTE'
  ) INTO v_anon_reservation;
  IF NOT v_no_write_policy OR v_anon_reservation THEN
    RAISE EXCEPTION 'C9 dejó una escritura pública: política %, reserva anon %', v_no_write_policy, v_anon_reservation;
  END IF;
  IF EXISTS (SELECT 1 FROM public.stock_sucursal_descuadrado WHERE org_id = v_org) THEN
    RAISE EXCEPTION 'El stock por sucursal quedó descuadrado';
  END IF;

  DELETE FROM public.sales WHERE ecommerce_order_id = v_order;
  DELETE FROM public.ecommerce_orders WHERE id = v_order;
  DELETE FROM public.organizations WHERE id = v_org;
  IF EXISTS (SELECT 1 FROM public.organizations WHERE id = v_org)
     OR EXISTS (SELECT 1 FROM public.stock_movements WHERE product_name = 'ZZ variante despacho')
     OR EXISTS (SELECT 1 FROM public.location_variant_stock WHERE org_id = v_org) THEN
    RAISE EXCEPTION 'C9 dejó restos ZZ';
  END IF;

  INSERT INTO zz_store_fulfillment_location_verification VALUES
    ('despacho', true, 'orden, reserva, venta, devolución, variante y depósito verificados'),
    ('autoridad', true, 'configuración, RLS y RPC sin escritura anónima verificados'),
    ('zz_restos', true, 'sin restos de verificación');
END
$verify$;

SELECT check_name, passed, detail
FROM zz_store_fulfillment_location_verification
ORDER BY check_name;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260815000005', 'store_fulfillment_location') ON CONFLICT DO NOTHING;
