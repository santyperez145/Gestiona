-- Cuentas de comprador por tienda, como en Tiendanube.
--
-- Se apoya en Supabase Auth (una sola identidad por email en todo el proyecto)
-- pero el vínculo con la tienda es una fila aparte: la misma persona puede
-- tener cuenta en varias tiendas del SaaS sin que se mezclen sus datos ni sus
-- pedidos.
--
-- OJO: `store_customers` NO otorga ningún acceso al panel de gestión. El
-- acceso administrativo se decide por `memberships`, que estos usuarios no
-- tienen. Un comprador que inicia sesión en una tienda no puede entrar a la
-- app de gestión de nadie.
-- Idempotente.

CREATE TABLE IF NOT EXISTS public.store_customers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id        uuid NOT NULL REFERENCES public.ecommerce_stores(id) ON DELETE CASCADE,
  org_id          uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email           text NOT NULL,
  name            text,
  phone           text,
  -- Última dirección usada: precarga el checkout en la próxima compra.
  default_address jsonb NOT NULL DEFAULT '{}'::jsonb,
  accepts_marketing boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_login_at   timestamptz,
  UNIQUE (store_id, user_id)
);

CREATE INDEX IF NOT EXISTS store_customers_user_idx  ON public.store_customers(user_id);
CREATE INDEX IF NOT EXISTS store_customers_org_idx   ON public.store_customers(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS store_customers_email_idx ON public.store_customers(store_id, lower(email));

ALTER TABLE public.store_customers ENABLE ROW LEVEL SECURITY;

-- El comprador ve y edita SOLO su propia ficha.
DROP POLICY IF EXISTS "store_customers_own_select" ON public.store_customers;
CREATE POLICY "store_customers_own_select" ON public.store_customers
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "store_customers_own_update" ON public.store_customers;
CREATE POLICY "store_customers_own_update" ON public.store_customers
  FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "store_customers_own_insert" ON public.store_customers;
CREATE POLICY "store_customers_own_insert" ON public.store_customers
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- El comercio ve a los clientes de su tienda.
DROP POLICY IF EXISTS "store_customers_org_select" ON public.store_customers;
CREATE POLICY "store_customers_org_select" ON public.store_customers
  FOR SELECT USING (public.is_org_member(org_id, auth.uid()));

-- ── Vínculo pedido ↔ cuenta ───────────────────────────────────────────────
ALTER TABLE public.ecommerce_orders
  ADD COLUMN IF NOT EXISTS store_customer_id uuid REFERENCES public.store_customers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS ecommerce_orders_store_customer_idx
  ON public.ecommerce_orders(store_customer_id, created_at DESC);

-- El comprador puede ver sus propios pedidos.
DROP POLICY IF EXISTS "ecommerce_orders_own_select" ON public.ecommerce_orders;
CREATE POLICY "ecommerce_orders_own_select" ON public.ecommerce_orders
  FOR SELECT USING (
    store_customer_id IN (SELECT id FROM public.store_customers WHERE user_id = auth.uid())
  );

-- ── Alta / actualización de la ficha al iniciar sesión ────────────────────
CREATE OR REPLACE FUNCTION public.upsert_store_customer(
  p_slug  text,
  p_name  text DEFAULT NULL,
  p_phone text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_store  record;
  v_uid    uuid := auth.uid();
  v_email  text;
  v_id     uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  SELECT id, org_id INTO v_store
  FROM public.ecommerce_stores
  WHERE lower(slug) = lower(p_slug) AND is_active;
  IF v_store.id IS NULL THEN RAISE EXCEPTION 'Tienda no encontrada'; END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = v_uid;

  INSERT INTO public.store_customers (store_id, org_id, user_id, email, name, phone, last_login_at)
  VALUES (v_store.id, v_store.org_id, v_uid, COALESCE(v_email, ''), p_name, p_phone, now())
  ON CONFLICT (store_id, user_id) DO UPDATE
    SET name          = COALESCE(NULLIF(EXCLUDED.name, ''), public.store_customers.name),
        phone         = COALESCE(NULLIF(EXCLUDED.phone, ''), public.store_customers.phone),
        last_login_at = now()
  RETURNING id INTO v_id;

  -- Pedidos anteriores hechos como invitado con el mismo email quedan
  -- asociados a la cuenta: si no, el historial arrancaría vacío para alguien
  -- que ya compró y sería una mala primera impresión.
  UPDATE public.ecommerce_orders
  SET store_customer_id = v_id
  WHERE store_id = v_store.id
    AND store_customer_id IS NULL
    AND lower(customer_email) = lower(COALESCE(v_email, ''));

  RETURN jsonb_build_object('id', v_id, 'email', v_email);
END;
$$;

-- ── Historial de pedidos del comprador ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_my_store_orders(p_slug text)
RETURNS TABLE (
  order_number text, items jsonb, subtotal numeric, shipping_cost numeric,
  total numeric, payment_method text, payment_status text,
  fulfillment_status text, tracking_number text, created_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT o.order_number, o.items, o.subtotal, o.shipping_cost, o.total,
         o.payment_method, o.payment_status, o.fulfillment_status,
         o.tracking_number, o.created_at
  FROM public.ecommerce_orders o
  JOIN public.ecommerce_stores s  ON s.id = o.store_id
  JOIN public.store_customers  sc ON sc.id = o.store_customer_id
  WHERE lower(s.slug) = lower(p_slug)
    AND sc.user_id = auth.uid()
  ORDER BY o.created_at DESC
  LIMIT 100;
$$;

REVOKE ALL ON FUNCTION public.upsert_store_customer(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_store_orders(text)               FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_store_customer(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_store_orders(text)               TO authenticated;
