-- F5 / L4: consentimiento de marketing verificable.
--
-- `store_customers.accepts_marketing` existía como booleano, pero no decía
-- cuándo ni dónde se había aceptado y sólo cubría compradores con cuenta. Las
-- campañas, además, no lo consultaban. La orden conserva la evidencia para
-- invitados y el CRM recibe fecha + origen al acreditarse el pago.

ALTER TABLE public.ecommerce_orders
  ADD COLUMN IF NOT EXISTS marketing_consent_at timestamptz,
  ADD COLUMN IF NOT EXISTS marketing_consent_source text;

ALTER TABLE public.store_customers
  ADD COLUMN IF NOT EXISTS marketing_consent_at timestamptz,
  ADD COLUMN IF NOT EXISTS marketing_consent_source text;

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS marketing_consent_at timestamptz,
  ADD COLUMN IF NOT EXISTS marketing_consent_source text;

COMMENT ON COLUMN public.customers.marketing_consent_at IS
  'Fecha verificable en que la persona aceptó recibir marketing. NULL significa sin consentimiento.';
COMMENT ON COLUMN public.customers.marketing_consent_source IS
  'Origen del consentimiento, por ejemplo store_checkout. Nunca se infiere de una compra previa.';

CREATE OR REPLACE FUNCTION public.register_store_marketing_consent(
  p_slug text,
  p_order_number text,
  p_email text,
  p_source text DEFAULT 'store_checkout'
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_order public.ecommerce_orders%ROWTYPE;
  v_now timestamptz := now();
  v_email text := lower(btrim(COALESCE(p_email, '')));
BEGIN
  IF v_email = '' OR p_source <> 'store_checkout' THEN
    RAISE EXCEPTION 'Consentimiento inválido';
  END IF;

  SELECT o.* INTO v_order
  FROM public.ecommerce_orders o
  JOIN public.ecommerce_stores s ON s.id = o.store_id
  WHERE lower(s.slug) = lower(p_slug)
    AND o.order_number = p_order_number
    AND lower(btrim(o.customer_email)) = v_email
  FOR UPDATE;

  IF v_order.id IS NULL THEN RAISE EXCEPTION 'Orden no encontrada'; END IF;

  UPDATE public.ecommerce_orders
     SET marketing_consent_at = COALESCE(marketing_consent_at, v_now),
         marketing_consent_source = COALESCE(marketing_consent_source, p_source)
   WHERE id = v_order.id;

  UPDATE public.store_customers
     SET accepts_marketing = true,
         marketing_consent_at = COALESCE(marketing_consent_at, v_now),
         marketing_consent_source = COALESCE(marketing_consent_source, p_source)
   WHERE id = v_order.store_customer_id;

  UPDATE public.customers
     SET marketing_consent_at = COALESCE(marketing_consent_at, v_now),
         marketing_consent_source = COALESCE(marketing_consent_source, p_source),
         updated_at = now()
   WHERE org_id = v_order.org_id
     AND lower(btrim(COALESCE(email, ''))) = v_email;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.register_store_marketing_consent(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_store_marketing_consent(text, text, text, text) TO anon, authenticated;

-- El alta CRM ocurre al acreditarse la orden. Copia la evidencia de la orden
-- para que un invitado que recién entra al CRM no pierda su consentimiento.
CREATE OR REPLACE FUNCTION public.upsert_customer_from_order(p_order_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order record; v_owner uuid; v_id uuid; v_email text; v_dir text;
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

  SELECT id INTO v_id FROM public.customers
  WHERE org_id = v_order.org_id AND lower(btrim(COALESCE(email, ''))) = v_email
  LIMIT 1;

  IF v_id IS NOT NULL THEN
    UPDATE public.customers
       SET phone = COALESCE(NULLIF(btrim(phone), ''), NULLIF(btrim(v_order.customer_phone), '')),
           address = COALESCE(NULLIF(btrim(address), ''), v_dir),
           marketing_consent_at = COALESCE(marketing_consent_at, v_order.marketing_consent_at),
           marketing_consent_source = COALESCE(marketing_consent_source, v_order.marketing_consent_source),
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
    ARRAY['tienda-online'], v_order.marketing_consent_at, v_order.marketing_consent_source
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
    WHERE table_schema = 'public' AND table_name = 'customers'
      AND column_name = 'marketing_consent_at'
  ) THEN RAISE EXCEPTION 'Falta customers.marketing_consent_at'; END IF;
END $$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260814000003', 'marketing_consent') ON CONFLICT DO NOTHING;
