-- Verificación de publicación libera el pago (paridad Go-Marz).
--
-- Medido 2026-09-25 (go-marz.com): «Marz verifica la publicación y paga al
-- creador automáticamente» / «retenemos tu pago hasta que el creador publique.
-- Si no cumple, te devolvemos el dinero». La verificación ya existe en Nerqia
-- (`register_publication_proof`); lo que falta es el enlace: la publicación
-- verificada es la señal que habilita el pago de esa colaboración.
--
-- Traducción Nerqia (sin custodia de fondos — la plataforma no toca plata):
--   · `influencer_payments.release_condition` = 'publication_verified':
--     el pago queda retenido hasta la verificación de la publicación.
--   · Un trigger sobre `influencer_publication_proofs` libera los pagos del
--     mismo influencer+campaña: escribe `released_at` y queda visible como
--     «listo para pagar».
--   · La marca sigue ejecutando el pago (retiros → Mercado Pago): nadie mueve
--     plata solo. La señal habilita; el humano paga.

-- ── 1. Columna de retención en pagos ────────────────────────────────────────
ALTER TABLE public.influencer_payments
  ADD COLUMN IF NOT EXISTS campaign_id uuid
    REFERENCES public.influencer_campaigns(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS release_condition text
    NOT NULL DEFAULT 'manual'
    CHECK (release_condition IN ('manual', 'publication_verified')),
  ADD COLUMN IF NOT EXISTS released_at timestamptz,
  ADD COLUMN IF NOT EXISTS released_by_proof uuid
    REFERENCES public.influencer_publication_proofs(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.influencer_payments.release_condition IS
  'manual: la marca paga cuando decide. publication_verified: el pago espera la verificación de publicación del entregable.';

-- ── 2. La verificación libera los pagos retenidos del creador ───────────────
CREATE OR REPLACE FUNCTION public.release_payments_on_publication_proof()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count integer;
  v_creator_name text;
BEGIN
  IF new.verified_by IS NULL OR new.campaign_id IS NULL THEN
    RETURN new;
  END IF;

  -- Nombre humano para la alerta: nunca IDs crudos al usuario.
  SELECT COALESCE(i.name, 'el creador') INTO v_creator_name
  FROM public.influencers i
  WHERE i.id = new.influencer_id;

  -- Libera los pagos retenidos del mismo influencer que todavía no salieron.
  UPDATE public.influencer_payments p
     SET released_at = now(),
         released_by_proof = new.id
   WHERE p.org_id = new.org_id
     AND p.influencer_id = new.influencer_id
     AND p.campaign_id = new.campaign_id
     AND p.release_condition = 'publication_verified'
     AND p.released_at IS NULL
     AND p.status IN ('pending', 'processing');
  GET DIAGNOSTICS v_count = ROW_COUNT;

  IF v_count > 0 THEN
    INSERT INTO public.alert_events (org_id, rule_name, category, priority, title, message)
    VALUES (
      new.org_id,
      'Pago liberado por publicación verificada',
      'influencers',
      'low',
      'Pago listo para salir: publicación verificada',
      'La publicación de ' || v_creator_name || ' fue verificada. ' || v_count ||
      ' pago(s) retenido(s) quedaron habilitados para ejecutar desde Comisiones y pagos.'
    );
  END IF;

  RETURN new;
END;
$$;

REVOKE ALL ON FUNCTION public.release_payments_on_publication_proof() FROM PUBLIC, anon;
DROP TRIGGER IF EXISTS trg_release_payments_on_publication ON public.influencer_publication_proofs;
CREATE TRIGGER trg_release_payments_on_publication
  AFTER INSERT ON public.influencer_publication_proofs
  FOR EACH ROW EXECUTE FUNCTION public.release_payments_on_publication_proof();

-- ── 3. Crear el pago retenido server-side (la marca no elige liberar) ────────
CREATE OR REPLACE FUNCTION public.create_influencer_held_payment(
  p_org_id uuid,
  p_influencer_id uuid,
  p_campaign_id uuid,
  p_amount numeric,
  p_currency text DEFAULT 'ARS',
  p_payment_method text DEFAULT 'transfer',
  p_notes text DEFAULT NULL
)
RETURNS public.influencer_payments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.influencer_payments;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF NOT public.can_manage_influencers(p_org_id, 'edit') THEN
    RAISE EXCEPTION 'influencer_permission_denied' USING ERRCODE = '42501';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'invalid_amount' USING ERRCODE = '22023';
  END IF;
  IF p_payment_method NOT IN ('transfer', 'mp_money', 'cash', 'check', 'other') THEN
    RAISE EXCEPTION 'invalid_method' USING ERRCODE = '22023';
  END IF;
  IF p_campaign_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.influencer_campaign_creators cc
    JOIN public.influencer_campaigns c ON c.id = cc.campaign_id
    WHERE cc.org_id = p_org_id
      AND cc.campaign_id = p_campaign_id
      AND cc.influencer_id = p_influencer_id
      AND c.org_id = p_org_id
  ) THEN
    RAISE EXCEPTION 'creator_not_assigned_to_campaign' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.influencer_payments (
    org_id, influencer_id, campaign_id, influencer_name, amount, currency,
    payment_method, status, release_condition, notes, created_by
  )
  SELECT p_org_id, i.id, p_campaign_id, i.name, ROUND(p_amount, 2), COALESCE(p_currency, 'ARS'),
         p_payment_method, 'pending', 'publication_verified',
         NULLIF(btrim(COALESCE(p_notes, '')), ''), auth.uid()
  FROM public.influencers i
  WHERE i.id = p_influencer_id AND i.org_id = p_org_id
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'influencer_not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.create_influencer_held_payment(uuid, uuid, uuid, numeric, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_influencer_held_payment(uuid, uuid, uuid, numeric, text, text, text) TO authenticated;

-- ── 4. Estado visible del pago para la UI de marca y portal ─────────────────
CREATE OR REPLACE VIEW public.influencer_payment_release_status
WITH (security_invoker = true) AS
SELECT p.id, p.org_id, p.influencer_id, p.campaign_id, p.influencer_name, p.amount, p.currency,
       p.status, p.release_condition, p.released_at, p.released_by_proof,
       p.payment_method, p.notes, p.created_at, p.completed_at,
       (p.release_condition = 'publication_verified') AS is_held,
       (p.released_at IS NOT NULL OR p.status = 'completed') AS is_payable
FROM public.influencer_payments p;

GRANT SELECT ON TABLE public.influencer_payment_release_status TO authenticated;

-- ── 5. Contrato versionado de seguridad ─────────────────────────────────────
INSERT INTO public.security_function_contracts(
  function_name, identity_arguments, audience, rationale, definition_hash, reviewed_on
)
SELECT v.fn, v.args, v.aud, v.rat, md5(pg_get_functiondef(procedure.oid)), DATE '2026-09-25'
FROM (VALUES
  ('release_payments_on_publication_proof', '', 'security_helper',
   'La verificacion de publicacion habilita el pago retenido; no mueve plata: marca released_at y avisa.'),
  ('create_influencer_held_payment', 'p_org_id uuid, p_influencer_id uuid, p_campaign_id uuid, p_amount numeric, p_currency text, p_payment_method text, p_notes text', 'authenticated_delegate',
   'La marca crea el pago retenido que la verificacion de publicacion libera.')
) AS v(fn, args, aud, rat)
JOIN pg_proc procedure ON procedure.proname = v.fn
WHERE procedure.pronamespace = 'public'::regnamespace
  AND pg_get_function_identity_arguments(procedure.oid) = v.args
ON CONFLICT (function_name, identity_arguments) DO UPDATE
  SET rationale = EXCLUDED.rationale,
      definition_hash = EXCLUDED.definition_hash,
      reviewed_on = EXCLUDED.reviewed_on;
