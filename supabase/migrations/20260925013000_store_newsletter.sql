-- ============================================================================
-- Newsletter de la tienda (Shopify/Tiendanube parity) — consentimiento en
-- todo el sitio, no sólo en el checkout.
--
-- ── El defecto ──────────────────────────────────────────────────────────────
-- El consentimiento de marketing sólo se capturaba al finalizar una compra
-- (`register_store_marketing_consent` exige una orden). El visitante que
-- todavía no compró —el más común en un newsletter— no podía dejar su email,
-- y las campañas de email se quedaban sin audiencia nueva. Tiendanube y
-- Shopify pisan el footer con el formulario en cada página.
--
-- ── Por qué una tabla propia ────────────────────────────────────────────────
-- `store_customers` exige `user_id NOT NULL` (UNIQUE store_id+user_id): una
-- suscripción anónima no tiene dónde vivir ahí. `store_newsletter_
-- subscribers` es la lista de emails por tienda; cuando la persona compra o
-- crea cuenta, el consentimiento viaja al CRM (`customers`) y a su ficha de
-- comprador por el upsert existente de órdenes.
--
-- ── Ley 25.326 art. 27 ──────────────────────────────────────────────────────
-- Una baja nunca se reactiva con un simple alta de newsletter. El RPC ignora
-- emails dados de baja y lo comunica, sin datos de terceros: el slug de la
-- tienda pública es el único alcance.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.store_newsletter_subscribers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  store_id        uuid NOT NULL REFERENCES public.ecommerce_stores(id) ON DELETE CASCADE,
  email           text NOT NULL,
  subscribed_at   timestamptz NOT NULL DEFAULT now(),
  unsubscribed_at timestamptz,
  source          text NOT NULL DEFAULT 'store_newsletter',
  UNIQUE (store_id, email)
);

CREATE INDEX IF NOT EXISTS store_newsletter_subscribers_org_idx
  ON public.store_newsletter_subscribers(org_id, subscribed_at DESC);

ALTER TABLE public.store_newsletter_subscribers ENABLE ROW LEVEL SECURITY;
-- Sin policies: ni el comercio desde el navegador ni el público escriben
-- acá directo. La lista se lee por el RPC del comercio y por las campañas
-- (que corren con service_role / en servidor).
DROP POLICY IF EXISTS "store_newsletter_any" ON public.store_newsletter_subscribers;

CREATE OR REPLACE FUNCTION public.register_store_newsletter(
  p_slug text,
  p_email text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_store public.ecommerce_stores%ROWTYPE;
  v_email text := lower(btrim(COALESCE(p_email, '')));
  v_now timestamptz := now();
  v_existing public.store_newsletter_subscribers%ROWTYPE;
  v_crm public.customers%ROWTYPE;
BEGIN
  IF v_email = '' OR v_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'email_invalido');
  END IF;

  SELECT * INTO v_store
  FROM public.ecommerce_stores
  WHERE lower(slug) = lower(btrim(COALESCE(p_slug, '')))
    AND is_active = true;
  IF v_store.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tienda_no_encontrada');
  END IF;

  SELECT * INTO v_existing
  FROM public.store_newsletter_subscribers
  WHERE store_id = v_store.id AND email = v_email
  FOR UPDATE;

  IF v_existing.id IS NOT NULL THEN
    IF v_existing.unsubscribed_at IS NOT NULL THEN
      RETURN jsonb_build_object('ok', true, 'estado', 'dado_de_baja');
    END IF;
    RETURN jsonb_build_object('ok', true, 'estado', 'ya_suscrito');
  END IF;

  INSERT INTO public.store_newsletter_subscribers (org_id, store_id, email)
  VALUES (v_store.org_id, v_store.id, v_email);

  -- Si la persona ya existe en el CRM de la organización (compró antes en
  -- otra tienda o la cargó el comercio), el consentimiento nuevo y explícito
  -- lo actualiza. Una baja previa del CRM NUNCA se reactiva desde acá.
  SELECT * INTO v_crm
  FROM public.customers
  WHERE org_id = v_store.org_id
    AND lower(btrim(COALESCE(email, ''))) = v_email
  FOR UPDATE;

  IF v_crm.id IS NOT NULL
     AND v_crm.marketing_opt_out_at IS NULL
     AND v_crm.marketing_consent_at IS NULL THEN
    UPDATE public.customers
       SET marketing_consent_at = v_now,
           marketing_consent_source = 'store_newsletter',
           updated_at = v_now
     WHERE id = v_crm.id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'estado', 'suscrito');
END;
$$;

REVOKE ALL ON FUNCTION public.register_store_newsletter(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_store_newsletter(text, text) TO anon, authenticated;

-- ── El consentimiento viaja cuando el suscriptor compra ─────────────────────
-- El alta CRM de una orden (`upsert_customer_from_order`) crea la ficha; si
-- ese email estaba en el newsletter, hereda el consentimiento con su fecha y
-- fuente original — la evidencia no se pierde en el salto de lista.
CREATE OR REPLACE FUNCTION public.sync_newsletter_consent_to_customer(
  p_org_id uuid,
  p_email text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text := lower(btrim(COALESCE(p_email, '')));
  v_sub public.store_newsletter_subscribers%ROWTYPE;
BEGIN
  IF v_email = '' OR p_org_id IS NULL THEN RETURN; END IF;

  SELECT * INTO v_sub
  FROM public.store_newsletter_subscribers
  WHERE org_id = p_org_id
    AND email = v_email
    AND unsubscribed_at IS NULL
  ORDER BY subscribed_at DESC
  LIMIT 1;
  IF v_sub.id IS NULL THEN RETURN; END IF;

  UPDATE public.customers
     SET marketing_consent_at = COALESCE(marketing_consent_at, v_sub.subscribed_at),
         marketing_consent_source = COALESCE(marketing_consent_source, v_sub.source),
         updated_at = now()
   WHERE org_id = p_org_id
     AND lower(btrim(COALESCE(email, ''))) = v_email
     AND marketing_opt_out_at IS NULL
     AND marketing_consent_at IS NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_newsletter_consent_to_customer(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_newsletter_consent_to_customer(uuid, text) TO service_role;

-- ── Certificación ───────────────────────────────────────────────────────────
DO $guard$
BEGIN
  IF has_function_privilege('public', 'public.register_store_newsletter(text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'public (rol sin login) no puede suscribirse al newsletter';
  END IF;
  IF to_regprocedure('public.register_store_newsletter(text,text)') IS NULL THEN
    RAISE EXCEPTION 'register_store_newsletter no existe';
  END IF;
  IF to_regprocedure('public.sync_newsletter_consent_to_customer(uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'sync_newsletter_consent_to_customer no existe';
  END IF;
END $guard$;