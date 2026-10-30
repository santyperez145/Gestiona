-- Cambios y saldo a favor desde la tienda online (2026-10-30).
--
-- El comprador ya podía pedir el arrepentimiento (Ley 24.240) o reclamar una
-- falla. Faltaba lo que más piden las tiendas de ropa, calzado y ferretería:
--
--   1. CAMBIO: pedir otro talle, color o producto, dentro del plazo de cambios
--      que fija cada tienda (30 días por defecto; 0 = no acepta cambios).
--   2. SALDO A FAVOR: cuando el comercio resuelve una devolución con «crédito
--      en tienda», el crédito entra al saldo a favor del cliente
--      (`saldo_a_favor_movimientos`, el mismo libro que usa la caja), una sola
--      vez.
--   3. USARLO ONLINE: el comprador ve su saldo y, cuando cubre el total del
--      pedido, lo paga con saldo. El pedido conserva su total (se factura
--      completo: el saldo es un medio de pago, no un descuento) y el saldo se
--      descuenta en la misma transacción, con una cerradura por cliente para
--      que dos pedidos simultáneos no lo dejen negativo. El uso parcial sigue en
--      la caja del local.
--
-- La cuenta corriente y el saldo a favor viven en `payment_methods` (el checkout
-- valida contra esa lista) pero nunca en la lista pública de medios: se le
-- ofrecen sólo al comprador que corresponde.
-- Reversible: DROP de lo nuevo; las redefinidas vuelven con 20261023000600.
BEGIN;

-- ── 1. Cambios ──────────────────────────────────────────────────────────
ALTER TABLE public.ecommerce_stores
  ADD COLUMN IF NOT EXISTS plazo_cambio_dias integer NOT NULL DEFAULT 30;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ecommerce_stores_plazo_cambio_check') THEN
    ALTER TABLE public.ecommerce_stores ADD CONSTRAINT ecommerce_stores_plazo_cambio_check
      CHECK (plazo_cambio_dias BETWEEN 0 AND 365);
  END IF;
END $$;
COMMENT ON COLUMN public.ecommerce_stores.plazo_cambio_dias IS
  'Días desde el pedido para pedir un cambio desde la tienda. 0: la tienda no acepta cambios online.';

-- Deriva: en producción el cliente del RMA es `customer_id` (core_retail_tables),
-- pero una base reconstruida desde cero conserva el `client_id` de
-- returns_portal (su CREATE TABLE IF NOT EXISTS gana). Se alinea con producción.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'return_requests' AND column_name = 'client_id')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'return_requests' AND column_name = 'customer_id') THEN
    ALTER TABLE public.return_requests RENAME COLUMN client_id TO customer_id;
  END IF;
END $$;
ALTER TABLE public.return_requests ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL;

ALTER TABLE public.return_requests ADD COLUMN IF NOT EXISTS cambio_por text;
ALTER TABLE public.return_requests DROP CONSTRAINT IF EXISTS return_requests_tipo_chk;
ALTER TABLE public.return_requests ADD CONSTRAINT return_requests_tipo_chk
  CHECK (tipo IN ('arrepentimiento', 'falla', 'cambio'));

DROP FUNCTION IF EXISTS public.request_store_return(text, text, text, text, uuid, uuid, integer, text);
DELETE FROM public.security_function_contracts
 WHERE function_name = 'request_store_return'
   AND identity_arguments = 'p_slug text, p_order_number text, p_email text, p_tipo text, p_product_id uuid, p_variant_id uuid, p_qty integer, p_motivo text';

CREATE FUNCTION public.request_store_return(
  p_slug text,
  p_order_number text,
  p_email text,
  p_tipo text,
  p_product_id uuid DEFAULT NULL,
  p_variant_id uuid DEFAULT NULL,
  p_qty integer DEFAULT 1,
  p_motivo text DEFAULT NULL,
  p_cambio_por text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_store record;
  v_order record;
  v_days integer;
  v_rma text;
  v_id uuid;
  v_item jsonb;
  v_name text;
  v_amount numeric := 0;
  v_existing integer;
  v_crm uuid;
BEGIN
  IF p_tipo NOT IN ('arrepentimiento', 'falla', 'cambio') THEN
    RAISE EXCEPTION 'Tipo de pedido inválido';
  END IF;

  SELECT s.id, s.org_id, COALESCE(s.plazo_cambio_dias, 30) AS plazo_cambio_dias INTO v_store
  FROM public.ecommerce_stores s
  WHERE lower(s.slug) = lower(p_slug)
    AND s.is_active;
  IF v_store.id IS NULL THEN
    RAISE EXCEPTION 'Tienda no encontrada';
  END IF;

  SELECT o.id, o.org_id, o.items, o.payment_status, o.order_number, o.customer_name,
         o.customer_email, o.store_customer_id, o.created_at
  INTO v_order
  FROM public.ecommerce_orders o
  WHERE o.org_id = v_store.org_id
    AND o.store_id = v_store.id
    AND upper(btrim(o.order_number)) = upper(btrim(p_order_number))
    AND lower(btrim(o.customer_email)) = lower(btrim(COALESCE(p_email, '')))
  LIMIT 1;

  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'No encontramos esa orden con ese email';
  END IF;
  IF v_order.payment_status <> 'paid' THEN
    RAISE EXCEPTION 'Esa orden todavía no figura como pagada';
  END IF;

  IF p_tipo = 'arrepentimiento' THEN
    v_days := public.dias_para_arrepentirse(v_order.id);
    IF v_days <= 0 THEN
      RAISE EXCEPTION 'Pasaron los 10 días corridos para arrepentirte. Si el producto tiene una falla, elegí esa opción: la garantía legal es de 6 meses.';
    END IF;
  END IF;
  IF p_tipo = 'cambio' THEN
    IF v_store.plazo_cambio_dias = 0 THEN
      RAISE EXCEPTION 'Esta tienda no hace cambios online. Si el producto tiene una falla, elegí esa opción.' USING ERRCODE = '22023';
    END IF;
    IF now() > v_order.created_at + make_interval(days => v_store.plazo_cambio_dias) THEN
      RAISE EXCEPTION 'El plazo para cambios es de % días desde la compra.', v_store.plazo_cambio_dias USING ERRCODE = '22023';
    END IF;
    IF NULLIF(btrim(COALESCE(p_cambio_por, '')), '') IS NULL THEN
      RAISE EXCEPTION 'Contanos por qué lo querés cambiar (talle, color u otro producto).' USING ERRCODE = '22023';
    END IF;
  END IF;

  SELECT count(*) INTO v_existing
  FROM public.return_requests r
  WHERE r.ecommerce_order_id = v_order.id
    AND COALESCE(r.product_id, '00000000-0000-0000-0000-000000000000'::uuid)
      = COALESCE(p_product_id, '00000000-0000-0000-0000-000000000000'::uuid)
    AND r.status IN ('pending', 'approved');
  IF v_existing > 0 THEN
    RAISE EXCEPTION 'Ya hay un pedido en curso para ese producto de esta orden';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(v_order.items, '[]'::jsonb)) LOOP
    IF p_product_id IS NULL OR (v_item ->> 'product_id')::uuid = p_product_id THEN
      v_name := COALESCE(v_name, v_item ->> 'name');
      v_amount := v_amount
        + COALESCE((v_item ->> 'unit_price')::numeric, 0)
        * LEAST(GREATEST(COALESCE(p_qty, 1), 1), GREATEST(COALESCE((v_item ->> 'quantity')::integer, 1), 1));
      EXIT WHEN p_product_id IS NOT NULL;
    END IF;
  END LOOP;

  IF p_product_id IS NOT NULL AND v_name IS NULL THEN
    RAISE EXCEPTION 'Ese producto no está en la orden %', v_order.order_number;
  END IF;

  SELECT c.id INTO v_crm
  FROM public.customers c
  WHERE c.org_id = v_order.org_id
    AND lower(btrim(c.email)) = lower(btrim(v_order.customer_email))
  LIMIT 1;

  v_rma := 'RMA-' || to_char(now(), 'YYYYMMDD') || '-' || lpad((floor(random() * 10000))::text, 4, '0');

  INSERT INTO public.return_requests (
    org_id, rma_number, ecommerce_order_id, tipo,
    customer_id, customer_name, customer_email,
    product_id, variant_id, product_name, quantity,
    refund_amount, status, reason_text, cambio_por
  ) VALUES (
    v_order.org_id, v_rma, v_order.id, p_tipo,
    v_crm, v_order.customer_name, v_order.customer_email,
    p_product_id, p_variant_id, COALESCE(v_name, 'Toda la orden'),
    GREATEST(COALESCE(p_qty, 1), 1),
    round(v_amount), 'pending', p_motivo,
    NULLIF(left(btrim(COALESCE(p_cambio_por, '')), 500), '')
  )
  RETURNING id INTO v_id;

  BEGIN
    INSERT INTO public.notifications (user_id, org_id, title, message, type, entity_type, entity_id)
    SELECT m.user_id, v_order.org_id,
      CASE p_tipo WHEN 'arrepentimiento' THEN 'Arrepentimiento de compra'
                  WHEN 'cambio' THEN 'Pedido de cambio'
                  ELSE 'Reclamo por falla' END,
      format('%s — orden %s', COALESCE(v_name, 'Toda la orden'), v_order.order_number),
      'ecommerce', 'return_request', v_id::text
    FROM public.memberships m
    WHERE m.org_id = v_order.org_id AND m.role = 'owner'
    ORDER BY m.joined_at
    LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN jsonb_build_object('ok', true, 'rma', v_rma, 'tipo', p_tipo, 'monto', round(v_amount), 'order_number', v_order.order_number);
END;
$$;
REVOKE ALL ON FUNCTION public.request_store_return(text, text, text, text, uuid, uuid, integer, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_store_return(text, text, text, text, uuid, uuid, integer, text, text) TO anon, authenticated;

-- ── 2. El crédito de una devolución entra al saldo a favor ──────────────
ALTER TABLE public.saldo_a_favor_movimientos
  ADD COLUMN IF NOT EXISTS return_request_id uuid REFERENCES public.return_requests(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ecommerce_order_id uuid REFERENCES public.ecommerce_orders(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS saldo_a_favor_devolucion_uq
  ON public.saldo_a_favor_movimientos(return_request_id) WHERE return_request_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS saldo_a_favor_pedido_uq
  ON public.saldo_a_favor_movimientos(ecommerce_order_id, (monto_ars < 0)) WHERE ecommerce_order_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.trg_devolucion_acredita_saldo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_cliente uuid := NEW.customer_id;
BEGIN
  IF NEW.resolution IS DISTINCT FROM 'store_credit'
     OR NEW.status NOT IN ('resolved', 'refunded', 'closed')
     OR COALESCE(NEW.refund_amount, 0) <= 0
     OR (OLD.status IN ('resolved', 'refunded', 'closed') AND OLD.resolution IS NOT DISTINCT FROM 'store_credit') THEN
    RETURN NEW;
  END IF;
  IF v_cliente IS NULL AND NEW.ecommerce_order_id IS NOT NULL THEN
    BEGIN
      v_cliente := public.upsert_customer_from_order(NEW.ecommerce_order_id);
    EXCEPTION WHEN OTHERS THEN
      v_cliente := NULL;
    END;
  END IF;
  IF v_cliente IS NULL AND NULLIF(btrim(COALESCE(NEW.customer_email, '')), '') IS NOT NULL THEN
    SELECT c.id INTO v_cliente FROM public.customers c
     WHERE c.org_id = NEW.org_id AND lower(btrim(c.email)) = lower(btrim(NEW.customer_email))
     ORDER BY c.created_at LIMIT 1;
  END IF;
  IF v_cliente IS NULL THEN
    RAISE EXCEPTION 'Para dar crédito en tienda, la devolución tiene que estar a nombre de un cliente' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.saldo_a_favor_movimientos (org_id, customer_id, customer_name, monto_ars, motivo, creado_por, return_request_id)
  VALUES (NEW.org_id, v_cliente, NEW.customer_name, round(NEW.refund_amount, 2),
          format('Crédito por la devolución %s', NEW.rma_number), auth.uid(), NEW.id)
  ON CONFLICT (return_request_id) WHERE return_request_id IS NOT NULL DO NOTHING;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.trg_devolucion_acredita_saldo() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_devolucion_acredita_saldo ON public.return_requests;
CREATE TRIGGER trg_devolucion_acredita_saldo
  AFTER UPDATE OF status, resolution, refund_amount ON public.return_requests
  FOR EACH ROW EXECUTE FUNCTION public.trg_devolucion_acredita_saldo();

-- ── 3. El saldo del comprador en la tienda ──────────────────────────────
-- Su cliente: el vinculado (mayorista) o el de su email en ese negocio.
CREATE OR REPLACE FUNCTION public.cliente_del_comprador(p_store_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT COALESCE(
    (SELECT sc.customer_id FROM public.store_customers sc
      WHERE sc.store_id = p_store_id AND sc.user_id = auth.uid() AND sc.customer_id IS NOT NULL LIMIT 1),
    (SELECT c.id FROM public.customers c
       JOIN public.ecommerce_stores s ON s.org_id = c.org_id AND s.id = p_store_id
       JOIN auth.users u ON u.id = auth.uid()
      WHERE lower(btrim(c.email)) = lower(btrim(u.email))
      ORDER BY c.created_at LIMIT 1)
  )
  WHERE auth.uid() IS NOT NULL;
$fn$;
REVOKE ALL ON FUNCTION public.cliente_del_comprador(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.mi_saldo_en_tienda(p_slug text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_store record;
  v_cliente uuid;
BEGIN
  SELECT s.id, s.org_id INTO v_store FROM public.ecommerce_stores s
   WHERE lower(s.slug) = lower(btrim(p_slug)) AND s.is_active LIMIT 1;
  IF v_store.id IS NULL OR auth.uid() IS NULL THEN
    RETURN jsonb_build_object('saldo', 0);
  END IF;
  v_cliente := public.cliente_del_comprador(v_store.id);
  IF v_cliente IS NULL THEN
    RETURN jsonb_build_object('saldo', 0);
  END IF;
  RETURN jsonb_build_object('saldo', COALESCE((
    SELECT sum(m.monto_ars) FROM public.saldo_a_favor_movimientos m
     WHERE m.org_id = v_store.org_id AND m.customer_id = v_cliente), 0));
END;
$fn$;
REVOKE ALL ON FUNCTION public.mi_saldo_en_tienda(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mi_saldo_en_tienda(text) TO anon, authenticated;

-- ── 4. Los medios internos: presentes para validar, nunca públicos ──────
CREATE OR REPLACE FUNCTION public.trg_tienda_mayorista_medios()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
BEGIN
  NEW.payment_methods := array_remove(array_remove(COALESCE(NEW.payment_methods, ARRAY[]::text[]), 'cuenta_corriente'), 'saldo_a_favor');
  IF NEW.mayorista_modo <> 'off' AND NEW.mayorista_cuenta_corriente THEN
    NEW.payment_methods := NEW.payment_methods || 'cuenta_corriente'::text;
  END IF;
  -- Pagar con saldo a favor lo valida el checkout (cubre el total o no se usa).
  NEW.payment_methods := NEW.payment_methods || 'saldo_a_favor'::text;
  RETURN NEW;
END;
$fn$;
UPDATE public.ecommerce_stores SET payment_methods = payment_methods;

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
         AND m NOT IN ('stripe', 'paypal', 'cuenta_corriente', 'saldo_a_favor')
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

-- ── 5. El checkout acepta pagar con saldo cuando cubre el total ─────────
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
  v_con_saldo boolean := lower(btrim(COALESCE(p_payment_method, ''))) = 'saldo_a_favor';
  v_cliente_saldo uuid;
  v_saldo numeric;
  v_total numeric;
  v_order_id uuid;
BEGIN
  SELECT store.id, store.org_id, store.mayorista_modo, store.mayorista_minimo_ars, store.mayorista_cuenta_corriente
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

  -- Saldo a favor (20261030000200): sólo el comprador logueado con saldo, y
  -- una cerradura por cliente para que dos pedidos no lo usen dos veces.
  IF v_con_saldo THEN
    v_cliente_saldo := public.cliente_del_comprador(v_store.id);
    IF v_cliente_saldo IS NULL THEN
      RAISE EXCEPTION 'Ingresá con tu cuenta para pagar con tu saldo a favor.' USING ERRCODE = '22023';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('saldo_a_favor:' || v_cliente_saldo::text, 0));
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

  IF v_con_saldo THEN
    v_total := COALESCE((v_resultado->>'total')::numeric, 0);
    SELECT COALESCE(sum(m.monto_ars), 0) INTO v_saldo FROM public.saldo_a_favor_movimientos m
     WHERE m.org_id = v_store.org_id AND m.customer_id = v_cliente_saldo;
    IF v_saldo < v_total THEN
      RAISE EXCEPTION 'Tu saldo a favor ($ %) no alcanza para el total ($ %). Elegí otro medio de pago: el saldo lo podés usar en el local.',
        replace(to_char(round(v_saldo), 'FM999,999,999,990'), ',', '.'),
        replace(to_char(round(v_total), 'FM999,999,999,990'), ',', '.')
        USING ERRCODE = '22023';
    END IF;
    SELECT o.id INTO v_order_id FROM public.ecommerce_orders o
     WHERE o.store_id = v_store.id AND o.order_number = v_resultado->>'order_number';
    -- Medio de pago, no descuento: el pedido conserva su total y se factura completo.
    IF v_total > 0 THEN
      INSERT INTO public.saldo_a_favor_movimientos (org_id, customer_id, customer_name, monto_ars, motivo, creado_por, ecommerce_order_id)
      VALUES (v_store.org_id, v_cliente_saldo,
              COALESCE((SELECT c.name FROM public.customers c WHERE c.id = v_cliente_saldo), p_customer_name),
              -round(v_total, 2), format('Pago del pedido %s', v_resultado->>'order_number'), auth.uid(), v_order_id);
    END IF;
    PERFORM public.mark_store_order_paid(v_order_id, 'saldo-' || (v_resultado->>'order_number'), 'saldo_a_favor');
    v_resultado := v_resultado || jsonb_build_object('pagado_con_saldo', true);
  END IF;

  RETURN v_resultado;
END;
$$;

-- ── 6. Contratos ─────────────────────────────────────────────────────────
WITH c(function_name, audience, rationale) AS (VALUES
  ('request_store_return', 'public_token', 'El comprador identifica su pedido con número y email; sólo crea la solicitud, no resuelve nada.'),
  ('cliente_del_comprador', 'security_helper', 'Devuelve el cliente de la sesión del comprador en una tienda; sólo lo usan funciones del checkout.'),
  ('mi_saldo_en_tienda', 'public_token', 'Devuelve sólo el saldo a favor del cliente de la sesión del comprador.'),
  ('trg_devolucion_acredita_saldo', 'security_helper', 'Trigger: acredita una vez el crédito en tienda de una devolución resuelta.')
)
INSERT INTO public.security_function_contracts(function_name, identity_arguments, audience, rationale, definition_hash, reviewed_on)
SELECT p.proname, pg_get_function_identity_arguments(p.oid), c.audience, c.rationale, md5(pg_get_functiondef(p.oid)), DATE '2026-10-30'
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN c ON c.function_name = p.proname
 WHERE n.nspname = 'public'
ON CONFLICT (function_name, identity_arguments) DO UPDATE
  SET audience = EXCLUDED.audience, rationale = EXCLUDED.rationale,
      definition_hash = EXCLUDED.definition_hash, reviewed_on = EXCLUDED.reviewed_on;

UPDATE public.security_function_contracts sfc
   SET definition_hash = md5(pg_get_functiondef(p.oid)), reviewed_on = DATE '2026-10-30'
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN ('create_store_order', 'medios_de_pago_vivos')
   AND sfc.function_name = p.proname
   AND sfc.identity_arguments = pg_get_function_identity_arguments(p.oid);

COMMIT;
