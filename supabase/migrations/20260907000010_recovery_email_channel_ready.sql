-- Honestidad de canal para recuperación de carritos (Shopify Abandoned checkouts).
-- El cron envía con SMTP del comercio o con el correo de plataforma; el badge
-- «Pendiente de aviso» no puede mentir si ninguno está listo.
--
-- Sólo booleans: ningún host, casilla ni secreto sale al navegador.

CREATE OR REPLACE FUNCTION public.recovery_email_channel_ready(p_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_merchant boolean := false;
  v_platform boolean := false;
BEGIN
  IF p_org_id IS NULL THEN
    RAISE EXCEPTION 'org requerida';
  END IF;
  IF auth.uid() IS NULL OR NOT public.is_org_member(p_org_id, auth.uid()) THEN
    RAISE EXCEPTION 'sin permiso';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.merchant_smtp_connections m
    WHERE m.org_id = p_org_id
      AND nullif(btrim(m.host), '') IS NOT NULL
      AND nullif(btrim(m.password), '') IS NOT NULL
  ) INTO v_merchant;

  -- Espejo del criterio producto de mensajería: dominio verificado (Resend) o
  -- SMTP de plataforma con host. No leemos secretos del vault.
  SELECT EXISTS (
    SELECT 1
    FROM public.platform_messaging_config c
    WHERE (
      (c.email_dominio IS NOT NULL AND c.email_verificado_at IS NOT NULL)
      OR nullif(btrim(c.smtp_host), '') IS NOT NULL
    )
  ) INTO v_platform;

  RETURN jsonb_build_object(
    'merchant_smtp', v_merchant,
    'platform_email', v_platform,
    'ready', (v_merchant OR v_platform)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.recovery_email_channel_ready(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recovery_email_channel_ready(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.recovery_email_channel_ready(uuid) IS
  'Si el cron de carritos abandonados o back-in-stock puede enviar email (SMTP comercio o correo plataforma). Sin secretos.';

DO $$
BEGIN
  ASSERT to_regprocedure('public.recovery_email_channel_ready(uuid)') IS NOT NULL,
    'falta recovery_email_channel_ready';
  ASSERT has_function_privilege('authenticated', 'public.recovery_email_channel_ready(uuid)', 'EXECUTE'),
    'authenticated debe ejecutar recovery_email_channel_ready';
  ASSERT NOT has_function_privilege('anon', 'public.recovery_email_channel_ready(uuid)', 'EXECUTE'),
    'anon no debe ejecutar recovery_email_channel_ready';
END $$;
