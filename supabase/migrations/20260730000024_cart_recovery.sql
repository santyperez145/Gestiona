-- Carritos abandonados.
--
-- `ecommerce_cart_sessions` existía —el panel hasta muestra un embudo con esos
-- datos— pero la tienda nunca escribía una fila: el embudo estaba siempre en
-- cero y no había forma de recuperar una venta a medio hacer.
--
-- Es de lo que más recupera: alguien deja el carrito, a las horas le llega un
-- email con lo que había elegido y un link que se lo devuelve armado.
-- Idempotente.

-- Token para restaurar el carrito desde el link del email sin pedir login.
ALTER TABLE public.ecommerce_cart_sessions
  ADD COLUMN IF NOT EXISTS recovery_token text;

CREATE UNIQUE INDEX IF NOT EXISTS cart_sessions_recovery_token_key
  ON public.ecommerce_cart_sessions (recovery_token)
  WHERE recovery_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS cart_sessions_abandon_idx
  ON public.ecommerce_cart_sessions (status, updated_at)
  WHERE status = 'active';

-- ── Guardar el carrito ────────────────────────────────────────────────────
-- La llama la tienda cada vez que cambia el carrito. Solo guarda algo si hay
-- email: sin forma de contactar a la persona, registrar el carrito no aporta.
CREATE OR REPLACE FUNCTION public.save_store_cart(
  p_slug     text,
  p_token    text,
  p_items    jsonb,
  p_email    text DEFAULT NULL,
  p_subtotal numeric DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_store record;
  v_email text;
  v_id    uuid;
  v_rec   text;
BEGIN
  SELECT id, org_id INTO v_store
  FROM public.ecommerce_stores
  WHERE lower(slug) = lower(p_slug) AND is_active;
  IF v_store.id IS NULL THEN RETURN jsonb_build_object('ok', false); END IF;

  -- Email del comprador logueado, o el que haya escrito en el checkout.
  v_email := NULLIF(btrim(COALESCE(p_email, '')), '');
  IF v_email IS NULL AND auth.uid() IS NOT NULL THEN
    SELECT email INTO v_email FROM public.store_customers
    WHERE store_id = v_store.id AND user_id = auth.uid();
  END IF;

  -- Carrito vacío: se cierra la sesión en vez de dejar basura.
  IF jsonb_array_length(COALESCE(p_items, '[]'::jsonb)) = 0 THEN
    UPDATE public.ecommerce_cart_sessions
    SET status = 'abandoned', items = '[]'::jsonb, updated_at = now()
    WHERE store_id = v_store.id AND session_token = p_token;
    RETURN jsonb_build_object('ok', true, 'empty', true);
  END IF;

  IF v_email IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'skipped', 'sin email');
  END IF;

  -- gen_random_bytes vive en el esquema `extensions`, fuera del search_path
  -- de esta función. gen_random_uuid() sí está disponible y alcanza de sobra.
  v_rec := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');

  INSERT INTO public.ecommerce_cart_sessions
    (org_id, store_id, session_token, customer_email, items, subtotal, total,
     status, recovery_token, expires_at)
  VALUES
    (v_store.org_id, v_store.id, p_token, lower(v_email), p_items, p_subtotal,
     p_subtotal, 'active', v_rec, now() + interval '30 days')
  ON CONFLICT (session_token) DO UPDATE
    SET items          = EXCLUDED.items,
        subtotal       = EXCLUDED.subtotal,
        total          = EXCLUDED.total,
        customer_email = COALESCE(EXCLUDED.customer_email, public.ecommerce_cart_sessions.customer_email),
        status         = CASE WHEN public.ecommerce_cart_sessions.status = 'converted'
                              THEN 'converted' ELSE 'active' END,
        -- El token de recuperación se conserva: si cambiara, el link que ya se
        -- mandó por email dejaría de funcionar.
        recovery_token = COALESCE(public.ecommerce_cart_sessions.recovery_token, EXCLUDED.recovery_token),
        updated_at     = now()
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END;
$$;

-- ── Marcar convertido al comprar ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.convert_store_cart(p_slug text, p_token text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  UPDATE public.ecommerce_cart_sessions cs
  SET status = 'converted', converted_at = now(), updated_at = now()
  FROM public.ecommerce_stores s
  WHERE s.id = cs.store_id
    AND lower(s.slug) = lower(p_slug)
    AND cs.session_token = p_token;
END;
$$;

-- ── Recuperar un carrito desde el link del email ──────────────────────────
CREATE OR REPLACE FUNCTION public.get_cart_by_recovery_token(p_token text)
RETURNS TABLE (store_slug text, items jsonb, customer_email text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT s.slug, cs.items, cs.customer_email
  FROM public.ecommerce_cart_sessions cs
  JOIN public.ecommerce_stores s ON s.id = cs.store_id
  WHERE cs.recovery_token = p_token
    AND cs.status <> 'converted'
    AND cs.expires_at > now()
  LIMIT 1;
$$;

-- ── Carritos a recuperar ──────────────────────────────────────────────────
-- Activos, con email, con al menos una hora de inactividad y sin aviso previo.
-- La hora de espera evita escribirle a alguien que todavía está comprando.
CREATE OR REPLACE FUNCTION public.pending_abandoned_carts(p_hours int DEFAULT 1)
RETURNS TABLE (
  id uuid, store_slug text, store_name text, org_id uuid,
  customer_email text, items jsonb, subtotal numeric, recovery_token text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT cs.id, s.slug, s.name, cs.org_id, cs.customer_email,
         cs.items, cs.subtotal, cs.recovery_token
  FROM public.ecommerce_cart_sessions cs
  JOIN public.ecommerce_stores s ON s.id = cs.store_id
  WHERE cs.status = 'active'
    AND s.is_active
    AND NOT cs.abandoned_email_sent
    AND cs.customer_email IS NOT NULL
    AND cs.recovery_token IS NOT NULL
    AND jsonb_array_length(cs.items) > 0
    AND cs.updated_at < now() - make_interval(hours => p_hours)
    AND cs.expires_at > now()
  LIMIT 200;
$$;

CREATE OR REPLACE FUNCTION public.mark_cart_email_sent(p_id uuid)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  UPDATE public.ecommerce_cart_sessions
  SET abandoned_email_sent = true, updated_at = updated_at
  WHERE id = p_id;
$$;

REVOKE ALL ON FUNCTION public.save_store_cart(text, text, jsonb, text, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.convert_store_cart(text, text)                    FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_cart_by_recovery_token(text)                  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pending_abandoned_carts(int)                      FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_cart_email_sent(uuid)                        FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.save_store_cart(text, text, jsonb, text, numeric) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.convert_store_cart(text, text)                    TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_cart_by_recovery_token(text)                  TO anon, authenticated;
-- `pending_abandoned_carts` y `mark_cart_email_sent` quedan solo para
-- service_role: las usa el cron, no el navegador.
