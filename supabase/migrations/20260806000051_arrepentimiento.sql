-- El comprador pide la devolución desde la tienda: botón de arrepentimiento.
--
-- La sesión anterior dejó el lado del comercio (`return_store_order_item`).
-- Falta la otra punta, que además **es obligatoria por ley**.
--
-- ── Dos cosas distintas que no se pueden mezclar ─────────────────────────
--
-- Confundirlas es el error de fondo, y el que trae multas:
--
-- **ARREPENTIMIENTO** — Ley 24.240 art. 34 y Resolución 424/2020. En una compra
-- a distancia el comprador puede arrepentirse dentro de los **10 días corridos**
-- desde que recibió el producto, **sin dar ningún motivo**, y el costo de
-- devolución lo paga el vendedor. La resolución exige además un botón visible
-- en la **primera pantalla** del sitio. No es negociable ni se puede condicionar
-- a que el producto esté "sin abrir".
--
-- **FALLA / GARANTÍA** — Ley 24.240 art. 11. Seis meses para un producto nuevo,
-- tres para uno usado, y ahí sí hace falta que el producto tenga un defecto.
--
-- Por eso `tipo` es obligatorio y cada uno tiene su propia ventana. Un formulario
-- único que pregunte "¿por qué querés devolverlo?" y trate las dos igual le
-- niega el arrepentimiento a quien no tiene un motivo que dar — que es
-- exactamente lo que la ley protege.
--
-- ── Cómo se identifica al comprador ──────────────────────────────────────
--
-- Número de orden + email, igual que el seguimiento del envío que ya existe. No
-- se pide cuenta: obligar a registrarse para ejercer un derecho es ponerle una
-- barrera, y además la mayoría compró sin cuenta.
--
-- ── Lo que este RPC NO hace ──────────────────────────────────────────────
--
-- No aprueba nada ni mueve stock ni plata. Sólo **registra el pedido** y le da
-- un número al comprador. La devolución efectiva la resuelve el comercio con
-- `return_store_order_item`, que ya repone el stock por el Kardex. Separar el
-- pedido de la resolución es lo que permite que quede constancia de la fecha en
-- que se ejerció el derecho, aunque el comercio tarde en contestar.
--
-- Idempotente.

-- La fecha de entrega no se estaba guardando: `ecommerce_orders` tiene
-- `fulfillment_status` pero ningún timestamp de cuándo cambió. Sin eso no se
-- puede contar el plazo desde la entrega, que es lo que manda la ley.
ALTER TABLE public.ecommerce_orders
  ADD COLUMN IF NOT EXISTS shipped_at   timestamptz,
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz;

COMMENT ON COLUMN public.ecommerce_orders.delivered_at IS
  'Cuando el comprador recibio el pedido. Es el inicio de los 10 dias del arrepentimiento (Ley 24.240 art. 34).';

ALTER TABLE public.return_requests
  ADD COLUMN IF NOT EXISTS ecommerce_order_id uuid
    REFERENCES public.ecommerce_orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS tipo text NOT NULL DEFAULT 'arrepentimiento',
  ADD COLUMN IF NOT EXISTS variant_id uuid
    REFERENCES public.product_variants(id) ON DELETE SET NULL;

DO $$ BEGIN
  ALTER TABLE public.return_requests
    ADD CONSTRAINT return_requests_tipo_chk
    CHECK (tipo IN ('arrepentimiento', 'falla'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN public.return_requests.tipo IS
  'arrepentimiento (Ley 24.240 art. 34, 10 dias corridos, sin causa) o falla '
  '(art. 11, garantia legal). Tienen ventanas y requisitos distintos.';

CREATE INDEX IF NOT EXISTS return_requests_orden_idx
  ON public.return_requests(ecommerce_order_id)
  WHERE ecommerce_order_id IS NOT NULL;

-- ── Cuántos días tiene para arrepentirse ────────────────────────────────
--
-- Se cuenta desde la **entrega**, no desde la compra: es lo que dice la ley y
-- es lo que le conviene al comprador cuando el envío tarda.
--
-- ⚠️ **Si no sabemos cuándo se entregó, no se corta el plazo.** Devolver 10
-- días con `delivered_at` en NULL es deliberado: negarle el derecho a alguien
-- porque *nosotros* no registramos la fecha sería trasladarle nuestra falta de
-- dato, y ante la duda la ley se lee a favor del consumidor. El plazo empieza a
-- correr en serio cuando la orden se marca entregada.
CREATE OR REPLACE FUNCTION public.dias_para_arrepentirse(p_order_id uuid)
RETURNS int
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT CASE
           WHEN o.delivered_at IS NULL THEN 10
           ELSE GREATEST(0, 10 - EXTRACT(day FROM now() - o.delivered_at)::int)
         END
  FROM public.ecommerce_orders o WHERE o.id = p_order_id;
$$;

REVOKE ALL ON FUNCTION public.dias_para_arrepentirse(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dias_para_arrepentirse(uuid) TO anon, authenticated;

-- ── El pedido del comprador ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.request_store_return(
  p_slug         text,
  p_order_number text,
  p_email        text,
  p_tipo         text,
  p_product_id   uuid    DEFAULT NULL,
  p_variant_id   uuid    DEFAULT NULL,
  p_qty          int     DEFAULT 1,
  p_motivo       text    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_store  record;
  v_order  record;
  v_dias   int;
  v_rma    text;
  v_id     uuid;
  v_item   jsonb;
  v_nombre text;
  v_monto  numeric := 0;
  v_ya     int;
  v_crm    uuid;
BEGIN
  IF p_tipo NOT IN ('arrepentimiento', 'falla') THEN
    RAISE EXCEPTION 'Tipo de pedido inválido';
  END IF;

  SELECT s.id, s.org_id INTO v_store
  FROM public.ecommerce_stores s
  WHERE lower(s.slug) = lower(p_slug) AND s.is_active;
  IF v_store.id IS NULL THEN RAISE EXCEPTION 'Tienda no encontrada'; END IF;

  -- Número de orden + email, igual que el seguimiento. El email se compara en
  -- minúsculas porque así se guarda.
  SELECT o.id, o.org_id, o.items, o.payment_status, o.order_number,
         o.customer_name, o.customer_email, o.store_customer_id
  INTO v_order
  FROM public.ecommerce_orders o
  WHERE o.org_id = v_store.org_id
    AND upper(btrim(o.order_number)) = upper(btrim(p_order_number))
    AND lower(btrim(o.customer_email)) = lower(btrim(COALESCE(p_email, '')));

  IF v_order.id IS NULL THEN
    -- Mismo mensaje exista o no la orden: si dijera "el email no coincide",
    -- este RPC público serviría para averiguar quién compró qué.
    RAISE EXCEPTION 'No encontramos esa orden con ese email';
  END IF;

  IF v_order.payment_status <> 'paid' THEN
    RAISE EXCEPTION 'Esa orden todavía no figura como pagada';
  END IF;

  -- La ventana. Sólo aplica al arrepentimiento: la garantía por falla tiene la
  -- suya, mucho más larga, y no se corta a los 10 días.
  IF p_tipo = 'arrepentimiento' THEN
    v_dias := public.dias_para_arrepentirse(v_order.id);
    IF v_dias <= 0 THEN
      RAISE EXCEPTION
        'Pasaron los 10 días corridos para arrepentirte. Si el producto tiene una falla, elegí esa opción: la garantía legal es de 6 meses.';
    END IF;
  END IF;

  -- Un pedido abierto por el mismo producto alcanza. Sin esto, un formulario
  -- reenviado por impaciencia genera tres RMA del mismo caso.
  SELECT count(*) INTO v_ya
  FROM public.return_requests r
  WHERE r.ecommerce_order_id = v_order.id
    AND COALESCE(r.product_id, '00000000-0000-0000-0000-000000000000'::uuid)
      = COALESCE(p_product_id, '00000000-0000-0000-0000-000000000000'::uuid)
    AND r.status IN ('pending', 'approved');
  IF v_ya > 0 THEN
    RAISE EXCEPTION 'Ya hay un pedido en curso para ese producto de esta orden';
  END IF;

  -- El monto, del detalle congelado de la orden.
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(v_order.items, '[]'::jsonb)) LOOP
    IF p_product_id IS NULL OR (v_item->>'product_id')::uuid = p_product_id THEN
      v_nombre := COALESCE(v_nombre, v_item->>'name');
      v_monto  := v_monto + COALESCE((v_item->>'unit_price')::numeric, 0)
                  * LEAST(GREATEST(COALESCE(p_qty, 1), 1),
                          GREATEST(COALESCE((v_item->>'quantity')::int, 1), 1));
      EXIT WHEN p_product_id IS NOT NULL;
    END IF;
  END LOOP;

  IF p_product_id IS NOT NULL AND v_nombre IS NULL THEN
    RAISE EXCEPTION 'Ese producto no está en la orden %', v_order.order_number;
  END IF;

  -- ⚠️ `return_requests.customer_id` apunta a `customers` (el CRM del comercio),
  -- **no** a `store_customers` (las cuentas de la tienda). Son dos tablas
  -- distintas y meter una en la otra rompe la FK — lo encontró el test. Se
  -- resuelve por email contra el CRM, y si no hay ficha queda en NULL: el
  -- pedido igual guarda nombre y email.
  SELECT c.id INTO v_crm
  FROM public.customers c
  WHERE c.org_id = v_order.org_id
    AND lower(btrim(c.email)) = lower(btrim(v_order.customer_email))
  LIMIT 1;

  v_rma := 'RMA-' || to_char(now(), 'YYYYMMDD') || '-' ||
           lpad((floor(random() * 10000))::text, 4, '0');

  INSERT INTO public.return_requests (
    org_id, rma_number, ecommerce_order_id, tipo,
    customer_id, customer_name, customer_email,
    product_id, variant_id, product_name, quantity,
    refund_amount, status, reason_text
  ) VALUES (
    v_order.org_id, v_rma, v_order.id, p_tipo,
    v_crm, v_order.customer_name, v_order.customer_email,
    p_product_id, p_variant_id, COALESCE(v_nombre, 'Toda la orden'),
    GREATEST(COALESCE(p_qty, 1), 1),
    round(v_monto), 'pending', p_motivo
  )
  RETURNING id INTO v_id;

  -- Aviso al comercio: un pedido de devolución sin contestar tiene un plazo
  -- legal corriendo.
  BEGIN
    INSERT INTO public.notifications (user_id, org_id, title, message, type, entity_type, entity_id)
    SELECT m.user_id, v_order.org_id,
           CASE WHEN p_tipo = 'arrepentimiento'
                THEN 'Arrepentimiento de compra' ELSE 'Reclamo por falla' END,
           format('%s — orden %s', COALESCE(v_nombre, 'Toda la orden'), v_order.order_number),
           'ecommerce', 'return_request', v_id::text
    FROM public.memberships m
    WHERE m.org_id = v_order.org_id AND m.role = 'owner'
    ORDER BY m.joined_at LIMIT 1;
  EXCEPTION WHEN OTHERS THEN NULL;   -- el aviso nunca frena el pedido
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'rma', v_rma,
    'tipo', p_tipo,
    'monto', round(v_monto),
    'order_number', v_order.order_number
  );
END;
$$;

REVOKE ALL ON FUNCTION public.request_store_return(text, text, text, text, uuid, uuid, int, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_store_return(text, text, text, text, uuid, uuid, int, text) TO anon, authenticated;

COMMENT ON FUNCTION public.request_store_return(text, text, text, text, uuid, uuid, int, text) IS
  'Pedido de devolucion desde la tienda, sin cuenta: numero de orden + email. '
  'Distingue arrepentimiento (10 dias corridos, sin causa) de falla (garantia). '
  'Solo registra: la resolucion la hace el comercio con return_store_order_item.';
