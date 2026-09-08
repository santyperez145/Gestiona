-- Rutas de entrega explícitas para la mensajería de plataforma.
-- Un intento usa Resend o SMTP, nunca ambos con el mismo remitente.

ALTER TABLE public.platform_messaging_config
  ADD COLUMN IF NOT EXISTS email_proveedor text NOT NULL DEFAULT 'resend_api',
  ADD COLUMN IF NOT EXISTS email_verificado_proveedor text;

ALTER TABLE public.platform_messaging_config
  DROP CONSTRAINT IF EXISTS platform_messaging_config_email_proveedor_check;

UPDATE public.platform_messaging_config
SET email_proveedor = CASE email_proveedor
  WHEN 'resend' THEN 'resend_api'
  WHEN 'smtp' THEN CASE
    WHEN lower(COALESCE(smtp_host, '')) = 'smtp.gmail.com' THEN 'gmail_smtp'
    WHEN lower(COALESCE(smtp_host, '')) = 'smtp.office365.com' THEN 'microsoft_smtp'
    WHEN lower(COALESCE(smtp_host, '')) IN ('smtp.zoho.com', 'smtppro.zoho.com') THEN 'zoho_smtp'
    ELSE 'smtp_personalizado'
  END
  ELSE email_proveedor
END;

ALTER TABLE public.platform_messaging_config
  ALTER COLUMN email_proveedor SET DEFAULT 'resend_api',
  ALTER COLUMN email_proveedor SET NOT NULL;

ALTER TABLE public.platform_messaging_config
  ADD CONSTRAINT platform_messaging_config_email_proveedor_check CHECK (
    email_proveedor IN (
      'resend_api', 'gmail_smtp', 'microsoft_smtp', 'zoho_smtp', 'smtp_personalizado'
    )
  );

ALTER TABLE public.platform_messaging_config
  DROP CONSTRAINT IF EXISTS platform_messaging_config_email_verificado_proveedor_check;

ALTER TABLE public.platform_messaging_config
  ADD CONSTRAINT platform_messaging_config_email_verificado_proveedor_check CHECK (
    email_verificado_proveedor IS NULL OR email_verificado_proveedor IN (
      'resend_api', 'gmail_smtp', 'microsoft_smtp', 'zoho_smtp', 'smtp_personalizado'
    )
  );

COMMENT ON COLUMN public.platform_messaging_config.email_proveedor IS
  'Ruta elegida por staff. Resend usa RESEND_API_KEY y las opciones SMTP usan SMTP_PASSWORD.';

-- La verificación histórica no demuestra qué ruta aceptó el mensaje.
UPDATE public.platform_messaging_config
SET email_verificado_at = NULL,
    email_verificado_proveedor = NULL
WHERE email_verificado_at IS NOT NULL
  AND email_verificado_proveedor IS NULL;

CREATE OR REPLACE FUNCTION public.mensajeria_de_plataforma()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_config public.platform_messaging_config%ROWTYPE;
  v_privileged boolean;
BEGIN
  SELECT config.* INTO v_config
  FROM public.platform_messaging_config config
  WHERE config.id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_privileged := auth.role() = 'service_role'
    OR (auth.uid() IS NOT NULL AND public.is_platform_admin(auth.uid()));

  RETURN jsonb_build_object(
    'email_proveedor', v_config.email_proveedor,
    'email_dominio', v_config.email_dominio,
    'email_nombre', v_config.email_nombre,
    'email_casillas', v_config.email_casillas,
    'email_listo', v_config.email_verificado_at IS NOT NULL
      AND v_config.email_verificado_proveedor = v_config.email_proveedor,
    'smtp_host', CASE WHEN v_privileged THEN v_config.smtp_host ELSE NULL END,
    'smtp_port', CASE WHEN v_privileged THEN v_config.smtp_port ELSE NULL END,
    'smtp_user', CASE WHEN v_privileged THEN v_config.smtp_user ELSE NULL END,
    'smtp_secure', CASE WHEN v_privileged THEN v_config.smtp_secure ELSE NULL END,
    'smtp_from_email', v_config.smtp_from_email,
    'smtp_configurado', v_config.smtp_host IS NOT NULL
      AND v_config.smtp_user IS NOT NULL
      AND v_config.smtp_from_email IS NOT NULL,
    'whatsapp_proveedor', CASE WHEN v_privileged THEN v_config.whatsapp_proveedor ELSE NULL END,
    'whatsapp_phone_number_id', CASE WHEN v_privileged THEN v_config.whatsapp_phone_number_id ELSE NULL END,
    'whatsapp_numero_visible', v_config.whatsapp_numero_visible,
    'whatsapp_listo', v_config.whatsapp_proveedor = 'meta_cloud'
      AND v_config.whatsapp_phone_number_id IS NOT NULL
      AND v_config.whatsapp_verificado_at IS NOT NULL
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.mensajeria_de_plataforma() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mensajeria_de_plataforma() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.mensajeria_guardar(p_cambios jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_proveedor text;
  v_clave text;
BEGIN
  IF jsonb_typeof(p_cambios) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Los cambios de mensajeria deben ser un objeto'
      USING ERRCODE = '22023';
  END IF;

  IF NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Solo el staff de plataforma configura la mensajeria'
      USING ERRCODE = '42501';
  END IF;

  IF p_cambios ?| ARRAY['smtp_pass', 'smtp_password', 'password', 'token', 'api_key'] THEN
    RAISE EXCEPTION 'Las contrasenas y tokens se guardan en secretos de Supabase'
      USING ERRCODE = '23514';
  END IF;

  SELECT clave INTO v_clave
  FROM jsonb_object_keys(p_cambios) AS claves(clave)
  WHERE clave <> ALL (ARRAY[
    'email_proveedor', 'email_dominio', 'email_nombre', 'email_casillas',
    'smtp_host', 'smtp_port', 'smtp_user', 'smtp_secure', 'smtp_from_email',
    'whatsapp_proveedor', 'whatsapp_phone_number_id', 'whatsapp_numero_visible'
  ])
  LIMIT 1;

  IF v_clave IS NOT NULL THEN
    RAISE EXCEPTION 'Campo de mensajeria no permitido: %', v_clave
      USING ERRCODE = '23514';
  END IF;

  v_proveedor := COALESCE(
    NULLIF(p_cambios->>'email_proveedor', ''),
    (SELECT email_proveedor FROM public.platform_messaging_config WHERE id)
  );

  IF v_proveedor NOT IN (
    'resend_api', 'gmail_smtp', 'microsoft_smtp', 'zoho_smtp', 'smtp_personalizado'
  ) THEN
    RAISE EXCEPTION 'Proveedor de correo desconocido'
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.platform_messaging_config c SET
    email_proveedor = v_proveedor,
    email_dominio = CASE WHEN p_cambios ? 'email_dominio'
      THEN NULLIF(btrim(p_cambios->>'email_dominio'), '') ELSE c.email_dominio END,
    email_nombre = CASE WHEN p_cambios ? 'email_nombre'
      THEN NULLIF(btrim(p_cambios->>'email_nombre'), '') ELSE c.email_nombre END,
    email_casillas = CASE WHEN p_cambios ? 'email_casillas'
      THEN p_cambios->'email_casillas' ELSE c.email_casillas END,
    smtp_host = CASE WHEN p_cambios ? 'smtp_host'
      THEN NULLIF(btrim(p_cambios->>'smtp_host'), '') ELSE c.smtp_host END,
    smtp_port = CASE WHEN p_cambios ? 'smtp_port'
      THEN (NULLIF(p_cambios->>'smtp_port', ''))::int ELSE c.smtp_port END,
    smtp_user = CASE WHEN p_cambios ? 'smtp_user'
      THEN NULLIF(btrim(p_cambios->>'smtp_user'), '') ELSE c.smtp_user END,
    smtp_secure = CASE WHEN p_cambios ? 'smtp_secure'
      THEN COALESCE((p_cambios->>'smtp_secure')::boolean, c.smtp_secure) ELSE c.smtp_secure END,
    smtp_from_email = CASE WHEN p_cambios ? 'smtp_from_email'
      THEN NULLIF(btrim(p_cambios->>'smtp_from_email'), '') ELSE c.smtp_from_email END,
    whatsapp_proveedor = CASE WHEN p_cambios ? 'whatsapp_proveedor'
      THEN NULLIF(p_cambios->>'whatsapp_proveedor', '') ELSE c.whatsapp_proveedor END,
    whatsapp_phone_number_id = CASE WHEN p_cambios ? 'whatsapp_phone_number_id'
      THEN NULLIF(p_cambios->>'whatsapp_phone_number_id', '') ELSE c.whatsapp_phone_number_id END,
    whatsapp_numero_visible = CASE WHEN p_cambios ? 'whatsapp_numero_visible'
      THEN NULLIF(p_cambios->>'whatsapp_numero_visible', '') ELSE c.whatsapp_numero_visible END,
    email_verificado_at = CASE
      WHEN v_proveedor IS DISTINCT FROM c.email_proveedor
        OR (v_proveedor = 'resend_api' AND p_cambios ? 'email_dominio'
          AND NULLIF(btrim(p_cambios->>'email_dominio'), '') IS DISTINCT FROM c.email_dominio)
        OR (v_proveedor <> 'resend_api' AND p_cambios ?| ARRAY[
          'smtp_host', 'smtp_port', 'smtp_user', 'smtp_secure', 'smtp_from_email'
        ])
      THEN NULL ELSE c.email_verificado_at END,
    email_verificado_proveedor = CASE
      WHEN v_proveedor IS DISTINCT FROM c.email_proveedor
        OR p_cambios ?| ARRAY[
          'email_dominio', 'smtp_host', 'smtp_port', 'smtp_user', 'smtp_secure', 'smtp_from_email'
        ]
      THEN NULL ELSE c.email_verificado_proveedor END,
    whatsapp_verificado_at = CASE
      WHEN p_cambios ? 'whatsapp_phone_number_id'
       AND NULLIF(p_cambios->>'whatsapp_phone_number_id', '') IS DISTINCT FROM c.whatsapp_phone_number_id
      THEN NULL ELSE c.whatsapp_verificado_at END,
    actualizado_por = auth.uid(),
    updated_at = now()
  WHERE c.id;

  RETURN public.mensajeria_de_plataforma();
END;
$function$;

REVOKE ALL ON FUNCTION public.mensajeria_guardar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mensajeria_guardar(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.mensajeria_marcar_verificado(p_canal text, p_ok boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF p_canal = 'email' THEN
    UPDATE public.platform_messaging_config
    SET email_verificado_at = CASE WHEN p_ok THEN now() ELSE NULL END,
        email_verificado_proveedor = CASE WHEN p_ok THEN email_proveedor ELSE NULL END,
        updated_at = now()
    WHERE id;
  ELSIF p_canal = 'whatsapp' THEN
    UPDATE public.platform_messaging_config
    SET whatsapp_verificado_at = CASE WHEN p_ok THEN now() ELSE NULL END,
        updated_at = now()
    WHERE id;
  ELSE
    RAISE EXCEPTION 'Canal desconocido: %', p_canal USING ERRCODE = '23514';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.mensajeria_marcar_verificado(text, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mensajeria_marcar_verificado(text, boolean)
  TO service_role;

DO $verify$
BEGIN
  ASSERT NOT EXISTS (
    SELECT 1 FROM public.platform_messaging_config
    WHERE email_proveedor NOT IN (
      'resend_api', 'gmail_smtp', 'microsoft_smtp', 'zoho_smtp', 'smtp_personalizado'
    )
  ), 'hay un proveedor de correo invalido';

  ASSERT has_function_privilege('service_role', 'public.mensajeria_marcar_verificado(text, boolean)', 'EXECUTE'),
    'service_role no puede registrar la prueba';
  ASSERT NOT has_function_privilege('authenticated', 'public.mensajeria_marcar_verificado(text, boolean)', 'EXECUTE'),
    'un usuario no puede marcar el proveedor como verificado';
END;
$verify$;
