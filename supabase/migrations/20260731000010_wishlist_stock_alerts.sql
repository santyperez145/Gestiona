-- Lista de deseos y aviso de reposición.
--
-- Son dos cosas distintas y se separan a propósito:
--
--   * La **lista de deseos** necesita cuenta: es una lista que la persona
--     vuelve a mirar, y sin cuenta no hay dónde guardarla.
--   * El **aviso de reposición** no debe necesitarla. Alguien que entra, ve
--     "sin stock" y se va es una venta perdida; pedirle que se registre para
--     avisarle es perderla dos veces. Alcanza con el email.
--
-- Idempotente.

-- ── Lista de deseos ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.store_wishlists (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES public.organizations(id)    ON DELETE CASCADE,
  store_id          uuid NOT NULL REFERENCES public.ecommerce_stores(id) ON DELETE CASCADE,
  store_customer_id uuid NOT NULL REFERENCES public.store_customers(id)  ON DELETE CASCADE,
  product_id        uuid NOT NULL REFERENCES public.products(id)         ON DELETE CASCADE,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_customer_id, product_id)
);

CREATE INDEX IF NOT EXISTS store_wishlists_customer_idx
  ON public.store_wishlists(store_customer_id, created_at DESC);

ALTER TABLE public.store_wishlists ENABLE ROW LEVEL SECURITY;

-- La ve el comercio (para saber qué se desea y no se compra) y su dueño.
DROP POLICY IF EXISTS "store_wishlists_org_select" ON public.store_wishlists;
CREATE POLICY "store_wishlists_org_select" ON public.store_wishlists
  FOR SELECT USING (public.is_org_member(org_id, auth.uid()));

DROP POLICY IF EXISTS "store_wishlists_own" ON public.store_wishlists;
CREATE POLICY "store_wishlists_own" ON public.store_wishlists
  FOR SELECT USING (
    store_customer_id IN (SELECT id FROM public.store_customers WHERE user_id = auth.uid())
  );

-- ── Aviso de reposición ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.store_stock_alerts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES public.organizations(id)    ON DELETE CASCADE,
  store_id          uuid NOT NULL REFERENCES public.ecommerce_stores(id) ON DELETE CASCADE,
  product_id        uuid NOT NULL REFERENCES public.products(id)         ON DELETE CASCADE,
  -- Si el producto tiene variantes, se avisa por la que se pidió: que vuelva
  -- el 50ml no le sirve a quien esperaba el 100ml.
  variant_id        uuid,
  email             text NOT NULL,
  -- Opcional: si tenía sesión, queda enlazado.
  store_customer_id uuid REFERENCES public.store_customers(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  -- Se avisa UNA vez. Insistir es la forma más rápida de terminar en spam.
  notified_at       timestamptz
);

-- El único va aparte y con NULLS NOT DISTINCT. Un `UNIQUE (product_id,
-- variant_id, email)` común NO deduplica los productos sin variante: en SQL
-- NULL nunca es igual a NULL, así que el `ON CONFLICT` de más abajo no
-- dispararía y el mismo email quedaría anotado tantas veces como clics haga.
-- Lo agarró el test de producción, no la lectura del código.
DROP INDEX IF EXISTS public.store_stock_alerts_unico;
ALTER TABLE public.store_stock_alerts
  DROP CONSTRAINT IF EXISTS store_stock_alerts_product_id_variant_id_email_key;
CREATE UNIQUE INDEX store_stock_alerts_unico
  ON public.store_stock_alerts (product_id, variant_id, email) NULLS NOT DISTINCT;

CREATE INDEX IF NOT EXISTS store_stock_alerts_pendientes_idx
  ON public.store_stock_alerts(product_id) WHERE notified_at IS NULL;

ALTER TABLE public.store_stock_alerts ENABLE ROW LEVEL SECURITY;

-- Los emails de los interesados son datos de terceros: los ve el comercio, y
-- nadie más. La escritura pública va por RPC, no por la tabla.
DROP POLICY IF EXISTS "store_stock_alerts_org_select" ON public.store_stock_alerts;
CREATE POLICY "store_stock_alerts_org_select" ON public.store_stock_alerts
  FOR SELECT USING (public.is_org_member(org_id, auth.uid()));

-- ── Deseos: alternar y leer ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.toggle_wishlist(p_slug text, p_product_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_store    record;
  v_customer uuid;
  v_id       uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Iniciá sesión para usar tu lista de deseos'; END IF;

  SELECT id, org_id INTO v_store
  FROM public.ecommerce_stores WHERE lower(slug) = lower(p_slug) AND is_active;
  IF v_store.id IS NULL THEN RAISE EXCEPTION 'Tienda no encontrada'; END IF;

  SELECT id INTO v_customer FROM public.store_customers
  WHERE store_id = v_store.id AND user_id = auth.uid();
  IF v_customer IS NULL THEN RAISE EXCEPTION 'Iniciá sesión para usar tu lista de deseos'; END IF;

  -- El producto tiene que ser de esta tienda: si no, la lista de deseos sería
  -- una forma de averiguar si un id existe en otra organización.
  IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = p_product_id AND org_id = v_store.org_id) THEN
    RAISE EXCEPTION 'Producto no encontrado';
  END IF;

  SELECT id INTO v_id FROM public.store_wishlists
  WHERE store_customer_id = v_customer AND product_id = p_product_id;

  IF v_id IS NOT NULL THEN
    DELETE FROM public.store_wishlists WHERE id = v_id;
    RETURN jsonb_build_object('ok', true, 'in_wishlist', false);
  END IF;

  INSERT INTO public.store_wishlists (org_id, store_id, store_customer_id, product_id)
  VALUES (v_store.org_id, v_store.id, v_customer, p_product_id);
  RETURN jsonb_build_object('ok', true, 'in_wishlist', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_wishlist(p_slug text)
RETURNS TABLE (product_id uuid, created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_store record; v_customer uuid;
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;

  SELECT id INTO v_store FROM public.ecommerce_stores
  WHERE lower(slug) = lower(p_slug) AND is_active;
  IF v_store.id IS NULL THEN RETURN; END IF;

  SELECT id INTO v_customer FROM public.store_customers
  WHERE store_id = v_store.id AND user_id = auth.uid();
  IF v_customer IS NULL THEN RETURN; END IF;

  RETURN QUERY
    SELECT w.product_id, w.created_at
    FROM public.store_wishlists w
    WHERE w.store_customer_id = v_customer
    ORDER BY w.created_at DESC;
END;
$$;

-- ── Pedir aviso de reposición ─────────────────────────────────────────────
-- Anónimo a propósito. Se valida que el producto sea de la tienda y que
-- realmente esté sin stock: si hay, no hay nada que avisar.
CREATE OR REPLACE FUNCTION public.request_stock_alert(
  p_slug       text,
  p_product_id uuid,
  p_email      text,
  p_variant_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_store    record;
  v_email    text := lower(btrim(p_email));
  v_stock    int;
  v_customer uuid;
BEGIN
  IF v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'Revisá el email';
  END IF;

  SELECT id, org_id INTO v_store
  FROM public.ecommerce_stores WHERE lower(slug) = lower(p_slug) AND is_active;
  IF v_store.id IS NULL THEN RAISE EXCEPTION 'Tienda no encontrada'; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = p_product_id AND org_id = v_store.org_id) THEN
    RAISE EXCEPTION 'Producto no encontrado';
  END IF;

  IF p_variant_id IS NOT NULL THEN
    SELECT stock INTO v_stock FROM public.product_variants
    WHERE id = p_variant_id AND product_id = p_product_id;
    IF v_stock IS NULL THEN RAISE EXCEPTION 'Variante no encontrada'; END IF;
  ELSE
    SELECT stock INTO v_stock FROM public.products WHERE id = p_product_id;
  END IF;

  IF COALESCE(v_stock, 0) > 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'hay_stock');
  END IF;

  SELECT id INTO v_customer FROM public.store_customers
  WHERE store_id = v_store.id AND user_id = auth.uid();

  INSERT INTO public.store_stock_alerts
    (org_id, store_id, product_id, variant_id, email, store_customer_id)
  VALUES (v_store.org_id, v_store.id, p_product_id, p_variant_id, v_email, v_customer)
  -- Pedirlo dos veces reabre el aviso en vez de fallar: si ya se le avisó y
  -- volvió a agotarse, quiere saberlo de nuevo.
  ON CONFLICT (product_id, variant_id, email) DO UPDATE
    SET notified_at = NULL, created_at = now();

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ── Avisos pendientes, para el cron ───────────────────────────────────────
-- Devuelve sólo los que ya tienen stock otra vez. `SECURITY DEFINER` y sin
-- grant a anon: lo llama la edge function con la service role.
CREATE OR REPLACE FUNCTION public.pending_stock_alerts()
RETURNS TABLE (
  alert_id     uuid,
  org_id       uuid,
  email        text,
  product_id   uuid,
  product_name text,
  variant_name text,
  stock        int,
  store_name   text,
  store_slug   text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT a.id, a.org_id, a.email, a.product_id, p.name,
         v.variant_name,
         COALESCE(v.stock, p.stock)::int,
         s.name, s.slug
  FROM public.store_stock_alerts a
  JOIN public.products         p ON p.id = a.product_id
  JOIN public.ecommerce_stores s ON s.id = a.store_id
  LEFT JOIN public.product_variants v ON v.id = a.variant_id
  WHERE a.notified_at IS NULL
    AND s.is_active
    AND COALESCE(v.stock, p.stock) > 0
  ORDER BY a.created_at
  LIMIT 200;
$$;

REVOKE ALL ON FUNCTION public.toggle_wishlist(text, uuid)                       FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_wishlist(text)                             FROM PUBLIC;
REVOKE ALL ON FUNCTION public.request_stock_alert(text, uuid, text, uuid)       FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pending_stock_alerts()                            FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.toggle_wishlist(text, uuid)                 TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_wishlist(text)                       TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_stock_alert(text, uuid, text, uuid) TO anon, authenticated;
-- `pending_stock_alerts` queda sin grant: sólo la service role.
