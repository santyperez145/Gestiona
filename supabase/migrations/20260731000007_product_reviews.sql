-- Reseñas de productos en la tienda online.
--
-- En perfumería la prueba social pesa muchísimo: nadie compra a ciegas una
-- fragancia de $90.000 sin leer qué opina alguien que ya la usó.
--
-- Decisión central: **sólo reseña quien compró**. Se valida contra
-- `ecommerce_orders` pagas del mismo comprador. Sin eso, las reseñas se llenan
-- de spam y dejan de servir — que es peor que no tenerlas.
--
-- Idempotente.

CREATE TABLE IF NOT EXISTS public.product_reviews (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  store_id          uuid NOT NULL REFERENCES public.ecommerce_stores(id) ON DELETE CASCADE,
  product_id        uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  store_customer_id uuid REFERENCES public.store_customers(id) ON DELETE SET NULL,
  -- Se guarda el nombre para poder mostrarlo aunque el cliente después se
  -- anonimice por Ley 25.326.
  author_name       text NOT NULL,
  rating            int  NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title             text,
  body              text,
  -- La orden que habilita la reseña; sirve para mostrar "compra verificada".
  order_id          uuid REFERENCES public.ecommerce_orders(id) ON DELETE SET NULL,
  status            text NOT NULL DEFAULT 'published'
                    CHECK (status IN ('published', 'hidden')),
  -- Respuesta del comercio, opcional.
  reply             text,
  replied_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  -- Una reseña por producto y comprador: si quiere cambiarla, la edita.
  UNIQUE (product_id, store_customer_id)
);

CREATE INDEX IF NOT EXISTS product_reviews_product_idx
  ON public.product_reviews(product_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS product_reviews_org_idx
  ON public.product_reviews(org_id, created_at DESC);

ALTER TABLE public.product_reviews ENABLE ROW LEVEL SECURITY;

-- El comercio ve y modera las suyas.
DROP POLICY IF EXISTS "product_reviews_org_select" ON public.product_reviews;
CREATE POLICY "product_reviews_org_select" ON public.product_reviews
  FOR SELECT USING (public.is_org_member(org_id, auth.uid()));

DROP POLICY IF EXISTS "product_reviews_org_write" ON public.product_reviews;
CREATE POLICY "product_reviews_org_write" ON public.product_reviews
  FOR ALL USING (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin']))
  WITH CHECK (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin']));

-- El comprador ve y edita la suya.
DROP POLICY IF EXISTS "product_reviews_own" ON public.product_reviews;
CREATE POLICY "product_reviews_own" ON public.product_reviews
  FOR SELECT USING (
    store_customer_id IN (SELECT id FROM public.store_customers WHERE user_id = auth.uid())
  );

-- ── Lectura pública ───────────────────────────────────────────────────────
-- Sólo las publicadas y sin exponer a quién pertenecen.
CREATE OR REPLACE FUNCTION public.get_store_reviews(p_slug text)
RETURNS TABLE (
  product_id  uuid,
  id          uuid,
  author_name text,
  rating      int,
  title       text,
  body        text,
  verified    boolean,
  reply       text,
  created_at  timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT r.product_id, r.id, r.author_name, r.rating, r.title, r.body,
         (r.order_id IS NOT NULL) AS verified,
         r.reply, r.created_at
  FROM public.product_reviews r
  JOIN public.ecommerce_stores s ON s.id = r.store_id
  WHERE lower(s.slug) = lower(p_slug)
    AND s.is_active
    AND r.status = 'published'
  ORDER BY r.created_at DESC;
$$;

-- ── ¿Puede reseñar este producto? ─────────────────────────────────────────
-- Se consulta desde la ficha para decidir si mostrar el formulario.
CREATE OR REPLACE FUNCTION public.can_review_product(p_slug text, p_product_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_store    record;
  v_customer uuid;
  v_order    uuid;
  v_ya       uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('can', false, 'reason', 'login');
  END IF;

  SELECT id, org_id INTO v_store
  FROM public.ecommerce_stores
  WHERE lower(slug) = lower(p_slug) AND is_active;
  IF v_store.id IS NULL THEN
    RETURN jsonb_build_object('can', false, 'reason', 'tienda');
  END IF;

  SELECT id INTO v_customer
  FROM public.store_customers
  WHERE store_id = v_store.id AND user_id = auth.uid();
  IF v_customer IS NULL THEN
    RETURN jsonb_build_object('can', false, 'reason', 'login');
  END IF;

  SELECT r.id INTO v_ya
  FROM public.product_reviews r
  WHERE r.product_id = p_product_id AND r.store_customer_id = v_customer;

  -- Una orden paga que incluya este producto. `items` guarda product_id por
  -- línea, así que alcanza con buscarlo ahí.
  SELECT o.id INTO v_order
  FROM public.ecommerce_orders o
  WHERE o.store_customer_id = v_customer
    AND o.payment_status = 'paid'
    AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(o.items) it
      WHERE (it->>'product_id')::uuid = p_product_id
    )
  ORDER BY o.created_at DESC
  LIMIT 1;

  IF v_order IS NULL THEN
    RETURN jsonb_build_object('can', false, 'reason', 'sin_compra',
                              'existing', v_ya);
  END IF;

  RETURN jsonb_build_object('can', true, 'order_id', v_order, 'existing', v_ya);
END;
$$;

-- ── Dejar o editar una reseña ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.upsert_product_review(
  p_slug       text,
  p_product_id uuid,
  p_rating     int,
  p_title      text DEFAULT NULL,
  p_body       text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_store    record;
  v_customer record;
  v_order    uuid;
  v_id       uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Iniciá sesión para dejar tu opinión'; END IF;
  IF p_rating IS NULL OR p_rating < 1 OR p_rating > 5 THEN
    RAISE EXCEPTION 'La puntuación va de 1 a 5';
  END IF;

  SELECT id, org_id INTO v_store
  FROM public.ecommerce_stores
  WHERE lower(slug) = lower(p_slug) AND is_active;
  IF v_store.id IS NULL THEN RAISE EXCEPTION 'Tienda no encontrada'; END IF;

  SELECT id, name, email INTO v_customer
  FROM public.store_customers
  WHERE store_id = v_store.id AND user_id = auth.uid();
  IF v_customer.id IS NULL THEN RAISE EXCEPTION 'Iniciá sesión para dejar tu opinión'; END IF;

  -- La compra se revalida acá, no sólo en `can_review_product`: esa función es
  -- para decidir qué mostrar, no una barrera.
  SELECT o.id INTO v_order
  FROM public.ecommerce_orders o
  WHERE o.store_customer_id = v_customer.id
    AND o.payment_status = 'paid'
    AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(o.items) it
      WHERE (it->>'product_id')::uuid = p_product_id
    )
  ORDER BY o.created_at DESC
  LIMIT 1;

  IF v_order IS NULL THEN
    RAISE EXCEPTION 'Sólo pueden opinar quienes compraron este producto';
  END IF;

  INSERT INTO public.product_reviews (
    org_id, store_id, product_id, store_customer_id,
    author_name, rating, title, body, order_id
  ) VALUES (
    v_store.org_id, v_store.id, p_product_id, v_customer.id,
    COALESCE(NULLIF(btrim(v_customer.name), ''), split_part(v_customer.email, '@', 1)),
    p_rating, NULLIF(btrim(p_title), ''), NULLIF(btrim(p_body), ''), v_order
  )
  ON CONFLICT (product_id, store_customer_id) DO UPDATE
    SET rating     = EXCLUDED.rating,
        title      = EXCLUDED.title,
        body       = EXCLUDED.body,
        created_at = now(),
        -- Editar la reseña la vuelve a publicar: si el comercio la ocultó por
        -- algo puntual, el cambio merece una nueva mirada.
        status     = 'published'
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END;
$$;

REVOKE ALL ON FUNCTION public.get_store_reviews(text)                              FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_review_product(text, uuid)                       FROM PUBLIC;
REVOKE ALL ON FUNCTION public.upsert_product_review(text, uuid, int, text, text)   FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_store_reviews(text)                            TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.can_review_product(text, uuid)                     TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_product_review(text, uuid, int, text, text) TO authenticated;
