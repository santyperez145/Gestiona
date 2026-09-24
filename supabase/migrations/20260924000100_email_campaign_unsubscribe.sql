-- Baja real (unsubscribe) para campañas de email.
--
-- ── Por qué ────────────────────────────────────────────────────────────────
-- El footer de campañas tenía el placeholder `{{unsubscribe_url}}` que **nunca
-- se reemplazaba**: el mail salía con el texto literal y ningún enlace real.
-- Sin baja uno-clic, una campaña masiva viola CAN-SPAM / Ley 26.652 de datos
-- personales, Resend la suspende por rebotes/quejas, y el dominio del comercio
-- queda quemado para todo el correo transaccional.
--
-- El drip ya tenía su token (20260529000006); las campañas masivas no.
-- Acá se agrega la misma pieza para `email_campaigns`, con la misma semántica
-- de un solo uso y expiración de 90 días, y una Edge Function pública que
-- procesa la baja.

CREATE TABLE IF NOT EXISTS public.email_campaign_unsubscribe_tokens (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  token         text        NOT NULL UNIQUE,
  campaign_id   uuid        NOT NULL REFERENCES public.email_campaigns(id) ON DELETE CASCADE,
  org_id        uuid        NOT NULL,
  email         text        NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL DEFAULT (now() + interval '90 days'),
  used_at       timestamptz,
  user_agent    text,
  ip_address    inet
);

CREATE INDEX IF NOT EXISTS idx_campaign_unsub_token
  ON public.email_campaign_unsubscribe_tokens(token);
CREATE INDEX IF NOT EXISTS idx_campaign_unsub_org_email
  ON public.email_campaign_unsubscribe_tokens(org_id, email);

ALTER TABLE public.email_campaign_unsubscribe_tokens ENABLE ROW LEVEL SECURITY;

-- RLS sin policies: sólo service_role la consulta. La Edge Function pública
-- es la única puerta y validación del token vive en el RPC.
REVOKE ALL ON public.email_campaign_unsubscribe_tokens FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.email_campaign_unsubscribe_tokens TO service_role;

-- ─── RPC: procesar la baja (llamado por la Edge Function pública) ─────────
CREATE OR REPLACE FUNCTION public.process_email_campaign_unsubscribe(
  p_token text,
  p_user_agent text DEFAULT NULL,
  p_ip inet DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_token public.email_campaign_unsubscribe_tokens%ROWTYPE;
BEGIN
  SELECT * INTO v_token
  FROM public.email_campaign_unsubscribe_tokens
  WHERE token = p_token
  LIMIT 1;

  IF v_token.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'token_not_found');
  END IF;

  IF v_token.expires_at < now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'token_expired');
  END IF;

  -- Idempotente: un segundo click no vuelve a insertar la baja.
  UPDATE public.email_campaign_unsubscribe_tokens
     SET used_at = COALESCE(used_at, now()),
         user_agent = COALESCE(user_agent, p_user_agent),
         ip_address = COALESCE(ip_address, p_ip)
   WHERE id = v_token.id;

  -- La baja es global para la organización: opt-out del canal de campañas.
  INSERT INTO public.email_unsubscribes (org_id, email, unsubscribed_at)
  VALUES (v_token.org_id, LOWER(TRIM(v_token.email)), COALESCE(v_token.used_at, now()))
  ON CONFLICT (org_id, email) DO UPDATE
    SET unsubscribed_at = LEAST(public.email_unsubscribes.unsubscribed_at, EXCLUDED.unsubscribed_at);

  RETURN jsonb_build_object('ok', true, 'email', LOWER(TRIM(v_token.email)));
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_email_campaign_unsubscribe(text, text, inet)
  TO anon, authenticated;