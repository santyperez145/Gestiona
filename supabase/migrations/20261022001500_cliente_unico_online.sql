-- Cliente único: el comprador online es el mismo cliente del local.
--
-- `upsert_customer_from_order` ya pasaba al comprador a Clientes, pero lo
-- buscaba sólo por email: un cliente del mostrador que compraba online con
-- otro email quedaba duplicado, y la identidad fiscal que el comprador dejó en
-- el checkout (CUIT, condición frente al IVA, razón social) no llegaba a su
-- ficha. La factura A siguiente del local tenía que pedirla de nuevo.
--
-- Ahora: primero se busca por CUIT (o DNI), después por email; la identidad
-- fiscal se completa en la ficha si estaba vacía (nunca pisa lo que el
-- comercio cargó a mano), y el email también si faltaba.
-- Reversible: volver a la definición de 20260925013100.
BEGIN;

CREATE OR REPLACE FUNCTION public.upsert_customer_from_order(p_order_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order record; v_owner uuid; v_id uuid; v_email text; v_dir text;
  v_newsletter_at timestamptz; v_newsletter_source text;
  v_doc text; v_doc_tipo text;
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

  -- El documento que dejó en el checkout: CUIT (80) o DNI (96).
  v_doc := NULLIF(regexp_replace(COALESCE(v_order.buyer_doc_number, ''), '\D', '', 'g'), '');
  v_doc_tipo := CASE
    WHEN v_doc IS NOT NULL AND length(v_doc) = 11 AND COALESCE(v_order.buyer_doc_type, 80) = 80 THEN 'CUIT'
    WHEN v_doc IS NOT NULL AND length(v_doc) IN (7, 8) THEN 'DNI'
  END;
  IF v_doc_tipo IS NULL THEN v_doc := NULL; END IF;

  -- Evidencia del newsletter vigente (sin baja), si existe.
  SELECT subscribed_at, source INTO v_newsletter_at, v_newsletter_source
  FROM public.store_newsletter_subscribers
  WHERE org_id = v_order.org_id
    AND email = v_email
    AND unsubscribed_at IS NULL
  ORDER BY subscribed_at DESC
  LIMIT 1;

  -- Primero por documento: es la misma persona aunque use otro email.
  IF v_doc IS NOT NULL THEN
    SELECT id INTO v_id FROM public.customers
    WHERE org_id = v_order.org_id AND tax_id = v_doc
    ORDER BY created_at LIMIT 1;
  END IF;
  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM public.customers
    WHERE org_id = v_order.org_id AND lower(btrim(COALESCE(email, ''))) = v_email
    LIMIT 1;
  END IF;

  IF v_id IS NOT NULL THEN
    UPDATE public.customers
       SET phone = COALESCE(NULLIF(btrim(phone), ''), NULLIF(btrim(v_order.customer_phone), '')),
           address = COALESCE(NULLIF(btrim(address), ''), v_dir),
           email = COALESCE(NULLIF(btrim(email), ''), v_email),
           -- La identidad fiscal se completa, nunca se pisa.
           tax_id = COALESCE(tax_id, v_doc),
           tax_id_type = CASE WHEN tax_id IS NULL AND v_doc IS NOT NULL THEN v_doc_tipo ELSE tax_id_type END,
           vat_condition = CASE WHEN tax_id IS NULL AND v_doc IS NOT NULL AND v_order.buyer_tax_condition IS NOT NULL
                                THEN v_order.buyer_tax_condition ELSE vat_condition END,
           legal_name = COALESCE(legal_name, NULLIF(btrim(v_order.buyer_business_name), '')),
           marketing_consent_at = COALESCE(marketing_consent_at, v_order.marketing_consent_at, v_newsletter_at),
           marketing_consent_source = COALESCE(marketing_consent_source, v_order.marketing_consent_source, v_newsletter_source),
           updated_at = now()
     WHERE id = v_id;
    RETURN v_id;
  END IF;

  INSERT INTO public.customers (
    org_id, user_id, name, email, phone, address, tags,
    marketing_consent_at, marketing_consent_source,
    tax_id, tax_id_type, vat_condition, legal_name
  ) VALUES (
    v_order.org_id, v_owner,
    COALESCE(NULLIF(btrim(v_order.customer_name), ''), split_part(v_email, '@', 1)),
    v_email, NULLIF(btrim(v_order.customer_phone), ''), v_dir,
    ARRAY['tienda-online'],
    COALESCE(v_order.marketing_consent_at, v_newsletter_at),
    COALESCE(v_order.marketing_consent_source, v_newsletter_source),
    v_doc, v_doc_tipo,
    CASE WHEN v_doc IS NOT NULL THEN COALESCE(v_order.buyer_tax_condition, 'consumidor_final') ELSE 'consumidor_final' END,
    NULLIF(btrim(v_order.buyer_business_name), '')
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.upsert_customer_from_order(uuid) FROM PUBLIC;

UPDATE public.security_function_contracts c
   SET definition_hash = md5(pg_get_functiondef(p.oid)), reviewed_on = DATE '2026-10-22'
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = c.function_name
   AND pg_get_function_identity_arguments(p.oid) = c.identity_arguments
   AND c.function_name = 'upsert_customer_from_order';

COMMIT;
