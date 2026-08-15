-- F6 / Ley 25.326 art. 27: cada campaña de WhatsApp necesita una baja efectiva.
--
-- El enlace es opaco, por destinatario y no depende de una sesión. La tabla no
-- tiene policies: sólo la Edge Function con service_role crea tokens, y el RPC
-- SECURITY DEFINER los consume una sola vez. Un teléfono/correo no alcanza para
-- desuscribir a otra persona.

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS marketing_opt_out_at timestamptz,
  ADD COLUMN IF NOT EXISTS marketing_opt_out_source text;

ALTER TABLE public.store_customers
  ADD COLUMN IF NOT EXISTS marketing_opt_out_at timestamptz,
  ADD COLUMN IF NOT EXISTS marketing_opt_out_source text;

COMMENT ON COLUMN public.customers.marketing_opt_out_at IS
  'Fecha en que la persona pidió dejar de recibir marketing. Las campañas deben excluirla hasta un consentimiento nuevo y explícito.';

CREATE TABLE IF NOT EXISTS public.whatsapp_unsubscribe_tokens (
  token       text PRIMARY KEY,
  org_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_unsubscribe_tokens_customer
  ON public.whatsapp_unsubscribe_tokens(org_id, customer_id, expires_at DESC);

ALTER TABLE public.whatsapp_unsubscribe_tokens ENABLE ROW LEVEL SECURITY;
-- Cero policies a propósito: ni un miembro de la organización puede fabricar o
-- leer enlaces de baja de sus clientes desde el navegador.

CREATE OR REPLACE FUNCTION public.process_whatsapp_unsubscribe(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_token public.whatsapp_unsubscribe_tokens%ROWTYPE;
BEGIN
  IF p_token IS NULL OR length(p_token) < 20 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'token_invalid');
  END IF;

  SELECT * INTO v_token
  FROM public.whatsapp_unsubscribe_tokens
  WHERE token = p_token
  FOR UPDATE;

  IF v_token.token IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'token_invalid');
  END IF;
  IF v_token.used_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'already_unsubscribed', true);
  END IF;
  IF v_token.expires_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'token_expired');
  END IF;

  UPDATE public.customers
     SET marketing_consent_at = NULL,
         marketing_consent_source = NULL,
         marketing_opt_out_at = now(),
         marketing_opt_out_source = 'whatsapp_link',
         updated_at = now()
   WHERE id = v_token.customer_id
     AND org_id = v_token.org_id;

  -- La misma persona puede tener cuenta de tienda y ficha CRM. Se actualizan
  -- ambas cuando comparten email para que una futura campaña que lea
  -- store_customers tampoco pueda reactivar una baja de WhatsApp.
  UPDATE public.store_customers sc
     SET accepts_marketing = false,
         marketing_consent_at = NULL,
         marketing_consent_source = NULL,
         marketing_opt_out_at = now(),
         marketing_opt_out_source = 'whatsapp_link'
    FROM public.customers c
   WHERE c.id = v_token.customer_id
     AND c.org_id = v_token.org_id
     AND sc.org_id = v_token.org_id
     AND lower(btrim(sc.email)) = lower(btrim(COALESCE(c.email, '')));

  UPDATE public.whatsapp_unsubscribe_tokens
     SET used_at = now()
   WHERE token = v_token.token;

  RETURN jsonb_build_object('ok', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.process_whatsapp_unsubscribe(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_whatsapp_unsubscribe(text) TO anon, authenticated;

-- Un nuevo opt-in de checkout es una acción explícita posterior a la baja, por
-- eso puede reactivar el consentimiento. Sólo escribir la fecha desde el panel
-- no alcanza: las campañas también exigen marketing_opt_out_at IS NULL.
CREATE OR REPLACE FUNCTION public.register_store_marketing_consent(
  p_slug text,
  p_order_number text,
  p_email text,
  p_source text DEFAULT 'store_checkout'
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_order public.ecommerce_orders%ROWTYPE;
  v_email text := lower(btrim(COALESCE(p_email, '')));
  v_now timestamptz := now();
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
  FOR UPDATE OF o;

  IF v_order.id IS NULL THEN RAISE EXCEPTION 'Orden no encontrada'; END IF;

  UPDATE public.ecommerce_orders
     SET marketing_consent_at = COALESCE(marketing_consent_at, v_now),
         marketing_consent_source = COALESCE(marketing_consent_source, p_source)
   WHERE id = v_order.id;

  UPDATE public.store_customers
     SET accepts_marketing = true,
         marketing_consent_at = COALESCE(marketing_consent_at, v_now),
         marketing_consent_source = COALESCE(marketing_consent_source, p_source),
         marketing_opt_out_at = NULL,
         marketing_opt_out_source = NULL
   WHERE id = v_order.store_customer_id;

  UPDATE public.customers
     SET marketing_consent_at = COALESCE(marketing_consent_at, v_now),
         marketing_consent_source = COALESCE(marketing_consent_source, p_source),
         marketing_opt_out_at = NULL,
         marketing_opt_out_source = NULL,
         updated_at = now()
   WHERE org_id = v_order.org_id
     AND lower(btrim(COALESCE(email, ''))) = v_email;

  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.register_store_marketing_consent(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_store_marketing_consent(text, text, text, text) TO anon, authenticated;

-- Verificación contra la base vinculada: baja una sola vez, bloquea un token
-- inventado y permite que un consentimiento nuevo y explícito la revierta.
DO $verify$
DECLARE
  v_suffix text := replace(gen_random_uuid()::text, '-', '');
  v_user_id uuid;
  v_org_id uuid;
  v_store_id uuid;
  v_customer_id uuid;
  v_store_customer_id uuid;
  v_order_id uuid;
  v_token text := 'zz-wa-' || replace(gen_random_uuid()::text, '-', '');
  v_result jsonb;
  v_opted_out timestamptz;
  v_consent timestamptz;
  v_store_opted_out timestamptz;
  v_store_accepts boolean;
  v_can_execute boolean;
BEGIN
  SELECT id INTO v_user_id FROM auth.users ORDER BY created_at LIMIT 1;
  IF v_user_id IS NULL THEN
    RAISE NOTICE 'WhatsApp unsubscribe verification omitted: no auth user exists';
    RETURN;
  END IF;

  INSERT INTO public.organizations (name, slug, owner_user_id)
  VALUES ('ZZ baja WhatsApp', 'zz-wa-unsub-' || v_suffix, v_user_id)
  RETURNING id INTO v_org_id;
  INSERT INTO public.memberships (org_id, user_id, role)
  VALUES (v_org_id, v_user_id, 'owner');
  INSERT INTO public.ecommerce_stores (org_id, slug)
  VALUES (v_org_id, 'zz-wa-unsub-' || v_suffix)
  RETURNING id INTO v_store_id;
  INSERT INTO public.customers (
    org_id, user_id, name, email, phone, marketing_consent_at, marketing_consent_source
  ) VALUES (
    v_org_id, v_user_id, 'ZZ Baja WhatsApp', 'zz-wa-' || v_suffix || '@example.invalid',
    '+5491100000000', now(), 'store_checkout'
  ) RETURNING id INTO v_customer_id;
  INSERT INTO public.store_customers (
    store_id, org_id, user_id, email, name, accepts_marketing,
    marketing_consent_at, marketing_consent_source
  ) VALUES (
    v_store_id, v_org_id, v_user_id, 'zz-wa-' || v_suffix || '@example.invalid',
    'ZZ Baja WhatsApp', true, now(), 'store_checkout'
  ) RETURNING id INTO v_store_customer_id;
  INSERT INTO public.ecommerce_orders (
    org_id, store_id, store_customer_id, order_number, customer_name, customer_email, items, subtotal, total
  ) VALUES (
    v_org_id, v_store_id, v_store_customer_id, 'ZZWA-' || v_suffix, 'ZZ Baja WhatsApp',
    'zz-wa-' || v_suffix || '@example.invalid', '[]'::jsonb, 0, 0
  ) RETURNING id INTO v_order_id;
  INSERT INTO public.whatsapp_unsubscribe_tokens (token, org_id, customer_id, expires_at)
  VALUES (v_token, v_org_id, v_customer_id, now() + interval '1 year');

  v_result := public.process_whatsapp_unsubscribe(v_token);
  IF NOT COALESCE((v_result->>'ok')::boolean, false) THEN
    RAISE EXCEPTION 'La baja de WhatsApp no devolvió ok: %', v_result;
  END IF;
  SELECT marketing_opt_out_at, marketing_consent_at
    INTO v_opted_out, v_consent
  FROM public.customers WHERE id = v_customer_id;
  SELECT marketing_opt_out_at, accepts_marketing
    INTO v_store_opted_out, v_store_accepts
  FROM public.store_customers WHERE id = v_store_customer_id;
  IF v_opted_out IS NULL OR v_consent IS NOT NULL
     OR v_store_opted_out IS NULL OR v_store_accepts THEN
    RAISE EXCEPTION 'La baja no dejó al cliente excluido';
  END IF;
  IF COALESCE((public.process_whatsapp_unsubscribe(v_token)->>'already_unsubscribed')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'La segunda baja no fue idempotente';
  END IF;
  IF COALESCE((public.process_whatsapp_unsubscribe('zz-token-inventado')->>'ok')::boolean, true) THEN
    RAISE EXCEPTION 'Un token inventado no puede darse de baja';
  END IF;

  -- Este RPC representa el checkbox marcado de una compra posterior.
  PERFORM public.register_store_marketing_consent(
    'zz-wa-unsub-' || v_suffix,
    'ZZWA-' || v_suffix,
    'zz-wa-' || v_suffix || '@example.invalid',
    'store_checkout'
  );
  SELECT marketing_opt_out_at, marketing_consent_at
    INTO v_opted_out, v_consent
  FROM public.customers WHERE id = v_customer_id;
  SELECT marketing_opt_out_at, accepts_marketing
    INTO v_store_opted_out, v_store_accepts
  FROM public.store_customers WHERE id = v_store_customer_id;
  IF v_opted_out IS NOT NULL OR v_consent IS NULL
     OR v_store_opted_out IS NOT NULL OR NOT v_store_accepts THEN
    RAISE EXCEPTION 'Un consentimiento explícito posterior no reactivó al cliente';
  END IF;

  SELECT has_function_privilege('authenticated',
    'public.process_whatsapp_unsubscribe(text)', 'EXECUTE') INTO v_can_execute;
  IF NOT v_can_execute THEN
    RAISE EXCEPTION 'El endpoint público no puede ejecutar el RPC de baja';
  END IF;

  DELETE FROM public.ecommerce_orders WHERE id = v_order_id;
  DELETE FROM public.organizations WHERE id = v_org_id;

  IF EXISTS (SELECT 1 FROM public.organizations WHERE id = v_org_id)
     OR EXISTS (SELECT 1 FROM public.customers WHERE id = v_customer_id)
     OR EXISTS (SELECT 1 FROM public.whatsapp_unsubscribe_tokens WHERE token = v_token) THEN
    RAISE EXCEPTION 'WhatsApp unsubscribe dejó filas ZZ';
  END IF;

  RAISE NOTICE 'WhatsApp unsubscribe verificado: baja idempotente, consentimiento nuevo y restos ZZ 0';
END
$verify$;
