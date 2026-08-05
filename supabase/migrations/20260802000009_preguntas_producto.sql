-- Preguntas sobre el producto.
--
-- Es lo que tiene MercadoLibre y no tiene Tiendanube, y en perfumería pesa: la
-- objeción que frena la compra es "¿es original?", "¿cuánto dura?", "¿tenés el
-- de 100ml?". Contestarla una vez y dejarla publicada la contesta para todos
-- los que vengan después — hoy esa misma pregunta llega por WhatsApp y se
-- responde de nuevo cada vez.
--
-- Dos decisiones que definen el producto:
--
--   * **Sólo se publican las respondidas.** Una lista de preguntas sin
--     contestar le dice al comprador que acá no atiende nadie. Mientras no
--     tenga respuesta, la ve quien la hizo y el comercio, nadie más.
--   * **Preguntar pide cuenta.** No compra —eso es para las reseñas— pero sí
--     identidad: sin eso la sección se llena de spam en una semana y deja de
--     servir, que es peor que no tenerla.
--
-- Idempotente.

CREATE TABLE IF NOT EXISTS public.product_questions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES public.organizations(id)    ON DELETE CASCADE,
  store_id          uuid NOT NULL REFERENCES public.ecommerce_stores(id) ON DELETE CASCADE,
  product_id        uuid NOT NULL REFERENCES public.products(id)         ON DELETE CASCADE,
  store_customer_id uuid NOT NULL REFERENCES public.store_customers(id)  ON DELETE CASCADE,
  -- Se guarda el nombre para poder mostrarlo aunque después se anonimice por
  -- Ley 25.326, igual que en las reseñas.
  author_name       text NOT NULL,
  question          text NOT NULL CHECK (length(btrim(question)) BETWEEN 3 AND 500),
  answer            text,
  answered_at       timestamptz,
  status            text NOT NULL DEFAULT 'published'
                    CHECK (status IN ('published', 'hidden')),
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- El índice sirve a la consulta pública, que filtra por producto y respondidas.
CREATE INDEX IF NOT EXISTS product_questions_publicas_idx
  ON public.product_questions(product_id, created_at DESC)
  WHERE answer IS NOT NULL AND status = 'published';

CREATE INDEX IF NOT EXISTS product_questions_pendientes_idx
  ON public.product_questions(org_id, created_at DESC)
  WHERE answer IS NULL;

ALTER TABLE public.product_questions ENABLE ROW LEVEL SECURITY;

-- El comercio ve todas las suyas, contestadas o no.
DROP POLICY IF EXISTS "product_questions_org_select" ON public.product_questions;
CREATE POLICY "product_questions_org_select" ON public.product_questions
  FOR SELECT USING (public.is_org_member(org_id, auth.uid()));

DROP POLICY IF EXISTS "product_questions_org_write" ON public.product_questions;
CREATE POLICY "product_questions_org_write" ON public.product_questions
  FOR ALL USING (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin','manager']))
  WITH CHECK (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin','manager']));

-- Quien preguntó ve la suya aunque todavía no esté contestada.
DROP POLICY IF EXISTS "product_questions_own" ON public.product_questions;
CREATE POLICY "product_questions_own" ON public.product_questions
  FOR SELECT USING (
    store_customer_id IN (SELECT id FROM public.store_customers WHERE user_id = auth.uid())
  );

-- ── Lectura pública ───────────────────────────────────────────────────────
-- Sólo las contestadas. Una lista de preguntas sin responder ahuyenta.
CREATE OR REPLACE FUNCTION public.get_store_questions(p_slug text)
RETURNS TABLE (
  product_id  uuid,
  id          uuid,
  author_name text,
  question    text,
  answer      text,
  created_at  timestamptz,
  answered_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT q.product_id, q.id, q.author_name, q.question, q.answer,
         q.created_at, q.answered_at
  FROM public.product_questions q
  JOIN public.ecommerce_stores s ON s.id = q.store_id
  WHERE lower(s.slug) = lower(p_slug)
    AND s.is_active
    AND q.status = 'published'
    AND q.answer IS NOT NULL
  ORDER BY q.answered_at DESC NULLS LAST, q.created_at DESC;
$$;

-- ── Preguntar ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ask_product_question(
  p_slug       text,
  p_product_id uuid,
  p_question   text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_store    record;
  v_customer record;
  v_texto    text := btrim(p_question);
  v_pendientes int;
  v_id       uuid;
  v_owner    uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Iniciá sesión para hacer una pregunta';
  END IF;
  IF length(v_texto) < 3 THEN
    RAISE EXCEPTION 'Escribí tu pregunta';
  END IF;
  IF length(v_texto) > 500 THEN
    RAISE EXCEPTION 'La pregunta es muy larga (máximo 500 caracteres)';
  END IF;

  SELECT id, org_id INTO v_store
  FROM public.ecommerce_stores WHERE lower(slug) = lower(p_slug) AND is_active;
  IF v_store.id IS NULL THEN RAISE EXCEPTION 'Tienda no encontrada'; END IF;

  SELECT id, name, email INTO v_customer
  FROM public.store_customers
  WHERE store_id = v_store.id AND user_id = auth.uid();
  IF v_customer.id IS NULL THEN
    RAISE EXCEPTION 'Iniciá sesión para hacer una pregunta';
  END IF;

  -- El producto tiene que ser de esta tienda: si no, preguntar sería una forma
  -- de averiguar si un id existe en otra organización.
  IF NOT EXISTS (
    SELECT 1 FROM public.products WHERE id = p_product_id AND org_id = v_store.org_id
  ) THEN
    RAISE EXCEPTION 'Producto no encontrado';
  END IF;

  -- Tope de preguntas sin contestar por persona. Sin esto, alguien deja
  -- cincuenta en un minuto y el comercio no encuentra las de verdad.
  SELECT count(*) INTO v_pendientes
  FROM public.product_questions
  WHERE store_customer_id = v_customer.id AND answer IS NULL;
  IF v_pendientes >= 5 THEN
    RAISE EXCEPTION 'Tenés varias preguntas sin responder. Esperá la respuesta antes de hacer otra.';
  END IF;

  INSERT INTO public.product_questions (
    org_id, store_id, product_id, store_customer_id, author_name, question
  ) VALUES (
    v_store.org_id, v_store.id, p_product_id, v_customer.id,
    COALESCE(NULLIF(btrim(v_customer.name), ''), split_part(v_customer.email, '@', 1)),
    v_texto
  )
  RETURNING id INTO v_id;

  -- Aviso al dueño: una pregunta sin contestar es una venta esperando.
  SELECT m.user_id INTO v_owner
  FROM public.memberships m
  WHERE m.org_id = v_store.org_id AND m.role = 'owner'
  ORDER BY m.joined_at LIMIT 1;

  IF v_owner IS NOT NULL THEN
    BEGIN
      INSERT INTO public.notifications (user_id, org_id, title, message, type, entity_type, entity_id)
      VALUES (
        v_owner, v_store.org_id,
        'Nueva pregunta en la tienda',
        left(v_texto, 120),
        'ecommerce', 'product', p_product_id::text
      );
    EXCEPTION WHEN OTHERS THEN NULL;   -- el aviso nunca frena la pregunta
    END;
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END;
$$;

-- ── Mis preguntas sobre un producto ───────────────────────────────────────
-- Para que quien preguntó vea la suya mientras espera respuesta.
CREATE OR REPLACE FUNCTION public.get_my_questions(p_slug text, p_product_id uuid)
RETURNS TABLE (id uuid, question text, answer text, created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_store record; v_customer uuid;
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;

  -- Alias obligatorio: `RETURNS TABLE (id uuid, …)` declara una variable `id`
  -- que choca con la columna y PostgreSQL no sabe a cuál te referís.
  SELECT s.id INTO v_store FROM public.ecommerce_stores s
  WHERE lower(s.slug) = lower(p_slug) AND s.is_active;
  IF v_store.id IS NULL THEN RETURN; END IF;

  SELECT c.id INTO v_customer FROM public.store_customers c
  WHERE c.store_id = v_store.id AND c.user_id = auth.uid();
  IF v_customer IS NULL THEN RETURN; END IF;

  RETURN QUERY
    SELECT q.id, q.question, q.answer, q.created_at
    FROM public.product_questions q
    WHERE q.store_customer_id = v_customer
      AND q.product_id = p_product_id
    ORDER BY q.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_store_questions(text)                  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ask_product_question(text, uuid, text)     FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_questions(text, uuid)               FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_store_questions(text)               TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ask_product_question(text, uuid, text)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_questions(text, uuid)            TO authenticated;
