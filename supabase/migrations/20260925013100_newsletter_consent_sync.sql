-- El consentimiento del newsletter viaja al CRM cuando la persona compra.
--
-- `upsert_customer_from_order` sólo copiaba la evidencia de la orden. Si el
-- comprador se suscribió antes al newsletter (sin comprar), la ficha nueva
-- nacía sin consentimiento y las campañas lo excluían. Ahora la ficha hereda
-- la fecha y fuente del newsletter vigente (sin baja) cuando la orden no trae
-- una más reciente. Idempotente: re-ejecutar no pisa evidencia existente.

CREATE OR REPLACE FUNCTION public.upsert_customer_from_order(p_order_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order record; v_owner uuid; v_id uuid; v_email text; v_dir text;
  v_newsletter_at timestamptz; v_newsletter_source text;
BEGIN
  SELECT * INTO v_order FROM public.ecommerce_orders WHERE id = p_order_id;
  IF v_order.id IS NULL THEN RETURN NULL; END IF;
  v_email := lower(btrim(COALESCE(v_order.customer_email, '')));
  IF v_email = '' THEN RETURN NULL; END IF;

  SELECT m.user_id INTO v_owner FROM public.memberships m
  WHERE m.org_id = v_order.org_id AND m.role = 'owner'
  ORDER BY m.joined_at LIMIT 1;
  IF v_owner IS NULL THEN RETURN NULL; END IF;

  v_dir := NULLIF(btrim(concat_ws(', ',
    NULLIF(v_order.shipping_address->>'calle', ''),
    NULLIF(v_order.shipping_address->>'ciudad', ''),
    NULLIF(v_order.shipping_address->>'provincia', ''),
    NULLIF(v_order.shipping_address->>'cp', '')
  )), '');

  -- Evidencia del newsletter vigente (sin baja), si existe.
  SELECT subscribed_at, source INTO v_newsletter_at, v_newsletter_source
  FROM public.store_newsletter_subscribers
  WHERE org_id = v_order.org_id
    AND email = v_email
    AND unsubscribed_at IS NULL
  ORDER BY subscribed_at DESC
  LIMIT 1;

  SELECT id INTO v_id FROM public.customers
  WHERE org_id = v_order.org_id AND lower(btrim(COALESCE(email, ''))) = v_email
  LIMIT 1;

  IF v_id IS NOT NULL THEN
    UPDATE public.customers
       SET phone = COALESCE(NULLIF(btrim(phone), ''), NULLIF(btrim(v_order.customer_phone), '')),
           address = COALESCE(NULLIF(btrim(address), ''), v_dir),
           marketing_consent_at = COALESCE(marketing_consent_at, v_order.marketing_consent_at, v_newsletter_at),
           marketing_consent_source = COALESCE(marketing_consent_source, v_order.marketing_consent_source, v_newsletter_source),
           updated_at = now()
     WHERE id = v_id;
    RETURN v_id;
  END IF;

  INSERT INTO public.customers (
    org_id, user_id, name, email, phone, address, tags,
    marketing_consent_at, marketing_consent_source
  ) VALUES (
    v_order.org_id, v_owner,
    COALESCE(NULLIF(btrim(v_order.customer_name), ''), split_part(v_email, '@', 1)),
    v_email, NULLIF(btrim(v_order.customer_phone), ''), v_dir,
    ARRAY['tienda-online'],
    COALESCE(v_order.marketing_consent_at, v_newsletter_at),
    COALESCE(v_order.marketing_consent_source, v_newsletter_source)
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_customer_from_order(uuid) FROM PUBLIC;

-- Verificación estructural, sin tocar datos reales.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'store_newsletter_subscribers'
      AND column_name = 'subscribed_at'
  ) THEN RAISE EXCEPTION 'Falta store_newsletter_subscribers.subscribed_at'; END IF;
END $$;