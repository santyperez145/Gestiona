-- Proveedor de correo explicito: Resend puede convivir con un SMTP de respaldo.
--
-- Antes, la mera presencia de una configuracion SMTP lo convertia para siempre
-- en el proveedor activo. La consola no podia volver a Resend sin borrar datos
-- directamente en SQL. Eso hacia que verificar nerqia.app en Resend no cambiara
-- el canal real de salida.

ALTER TABLE public.platform_messaging_config
  ADD COLUMN IF NOT EXISTS email_proveedor text;

-- Preservar la ruta efectiva existente durante el despliegue. Las instalaciones
-- nuevas nacen en Resend, que es el proveedor transaccional de la plataforma.
UPDATE public.platform_messaging_config
SET email_proveedor = CASE
  WHEN smtp_host IS NOT NULL
   AND smtp_user IS NOT NULL
   AND smtp_from_email IS NOT NULL THEN 'smtp'
  ELSE 'resend'
END
WHERE email_proveedor IS NULL;

ALTER TABLE public.platform_messaging_config
  ALTER COLUMN email_proveedor SET DEFAULT 'resend',
  ALTER COLUMN email_proveedor SET NOT NULL;

DO $constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.platform_messaging_config'::regclass
      AND conname = 'platform_messaging_config_email_proveedor_check'
  ) THEN
    ALTER TABLE public.platform_messaging_config
      ADD CONSTRAINT platform_messaging_config_email_proveedor_check
      CHECK (email_proveedor IN ('resend', 'smtp'));
  END IF;
END
$constraint$;

-- Los comercios conocen el estado del canal, pero la topologia SMTP sigue
-- visible unicamente para service_role y staff de plataforma.
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
  v_smtp_configurado boolean;
BEGIN
  SELECT config.* INTO v_config
  FROM public.platform_messaging_config config
  WHERE config.id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_privileged := auth.role() = 'service_role'
    OR (auth.uid() IS NOT NULL AND public.is_platform_admin(auth.uid()));
  v_smtp_configurado := v_config.smtp_host IS NOT NULL
    AND v_config.smtp_user IS NOT NULL
    AND v_config.smtp_from_email IS NOT NULL;

  RETURN jsonb_build_object(
    'email_proveedor', v_config.email_proveedor,
    'email_dominio', v_config.email_dominio,
    'email_nombre', v_config.email_nombre,
    'email_casillas', v_config.email_casillas,
    'email_listo', v_config.email_verificado_at IS NOT NULL AND CASE
      WHEN v_config.email_proveedor = 'smtp' THEN v_smtp_configurado
      ELSE v_config.email_dominio IS NOT NULL
    END,
    'smtp_host', CASE WHEN v_privileged THEN v_config.smtp_host ELSE NULL END,
    'smtp_port', CASE WHEN v_privileged THEN v_config.smtp_port ELSE NULL END,
    'smtp_user', CASE WHEN v_privileged THEN v_config.smtp_user ELSE NULL END,
    'smtp_secure', CASE WHEN v_privileged THEN v_config.smtp_secure ELSE NULL END,
    'smtp_from_email', v_config.smtp_from_email,
    'smtp_configurado', v_smtp_configurado,
    'whatsapp_proveedor', CASE
      WHEN v_privileged THEN v_config.whatsapp_proveedor ELSE NULL END,
    'whatsapp_phone_number_id', CASE
      WHEN v_privileged THEN v_config.whatsapp_phone_number_id ELSE NULL END,
    'whatsapp_numero_visible', v_config.whatsapp_numero_visible,
    'whatsapp_listo', v_config.whatsapp_proveedor = 'meta_cloud'
      AND v_config.whatsapp_phone_number_id IS NOT NULL
      AND v_config.whatsapp_verificado_at IS NOT NULL
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.mensajeria_de_plataforma() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mensajeria_de_plataforma()
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.mensajeria_guardar(p_cambios jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_clave text;
BEGIN
  IF NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Solo el staff de plataforma configura la mensajeria'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF jsonb_typeof(p_cambios) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Los cambios de mensajeria deben ser un objeto'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Rechazar tanto secretos como typos. Un campo ignorado silenciosamente deja
  -- la pantalla diciendo Guardado cuando en realidad no cambio nada.
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
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.platform_messaging_config c SET
    email_proveedor = CASE WHEN p_cambios ? 'email_proveedor'
      THEN p_cambios->>'email_proveedor' ELSE c.email_proveedor END,
    email_dominio = CASE WHEN p_cambios ? 'email_dominio'
      THEN NULLIF(btrim(p_cambios->>'email_dominio'), '') ELSE c.email_dominio END,
    email_nombre = CASE WHEN p_cambios ? 'email_nombre'
      THEN COALESCE(NULLIF(btrim(p_cambios->>'email_nombre'), ''), c.email_nombre)
      ELSE c.email_nombre END,
    email_casillas = CASE WHEN p_cambios ? 'email_casillas'
      THEN COALESCE(p_cambios->'email_casillas', c.email_casillas)
      ELSE c.email_casillas END,
    smtp_host = CASE WHEN p_cambios ? 'smtp_host'
      THEN NULLIF(btrim(p_cambios->>'smtp_host'), '') ELSE c.smtp_host END,
    smtp_port = CASE WHEN p_cambios ? 'smtp_port'
      THEN (NULLIF(p_cambios->>'smtp_port', ''))::int ELSE c.smtp_port END,
    smtp_user = CASE WHEN p_cambios ? 'smtp_user'
      THEN NULLIF(btrim(p_cambios->>'smtp_user'), '') ELSE c.smtp_user END,
    smtp_secure = CASE WHEN p_cambios ? 'smtp_secure'
      THEN COALESCE((p_cambios->>'smtp_secure')::boolean, c.smtp_secure)
      ELSE c.smtp_secure END,
    smtp_from_email = CASE WHEN p_cambios ? 'smtp_from_email'
      THEN NULLIF(btrim(p_cambios->>'smtp_from_email'), '') ELSE c.smtp_from_email END,
    whatsapp_proveedor = CASE WHEN p_cambios ? 'whatsapp_proveedor'
      THEN NULLIF(p_cambios->>'whatsapp_proveedor', '') ELSE c.whatsapp_proveedor END,
    whatsapp_phone_number_id = CASE WHEN p_cambios ? 'whatsapp_phone_number_id'
      THEN NULLIF(btrim(p_cambios->>'whatsapp_phone_number_id'), '')
      ELSE c.whatsapp_phone_number_id END,
    whatsapp_numero_visible = CASE WHEN p_cambios ? 'whatsapp_numero_visible'
      THEN NULLIF(btrim(p_cambios->>'whatsapp_numero_visible'), '')
      ELSE c.whatsapp_numero_visible END,
    email_verificado_at = CASE WHEN
      (p_cambios ? 'email_proveedor' AND p_cambios->>'email_proveedor' IS DISTINCT FROM c.email_proveedor)
      OR (p_cambios ? 'email_dominio' AND NULLIF(btrim(p_cambios->>'email_dominio'), '') IS DISTINCT FROM c.email_dominio)
      OR (p_cambios ? 'smtp_host' AND NULLIF(btrim(p_cambios->>'smtp_host'), '') IS DISTINCT FROM c.smtp_host)
      OR (p_cambios ? 'smtp_port' AND (NULLIF(p_cambios->>'smtp_port', ''))::int IS DISTINCT FROM c.smtp_port)
      OR (p_cambios ? 'smtp_user' AND NULLIF(btrim(p_cambios->>'smtp_user'), '') IS DISTINCT FROM c.smtp_user)
      OR (p_cambios ? 'smtp_secure' AND (p_cambios->>'smtp_secure')::boolean IS DISTINCT FROM c.smtp_secure)
      OR (p_cambios ? 'smtp_from_email' AND NULLIF(btrim(p_cambios->>'smtp_from_email'), '') IS DISTINCT FROM c.smtp_from_email)
      THEN NULL ELSE c.email_verificado_at END,
    whatsapp_verificado_at = CASE
      WHEN p_cambios ? 'whatsapp_phone_number_id'
       AND NULLIF(btrim(p_cambios->>'whatsapp_phone_number_id'), '')
         IS DISTINCT FROM c.whatsapp_phone_number_id
      THEN NULL ELSE c.whatsapp_verificado_at END,
    actualizado_por = auth.uid(),
    updated_at = now()
  WHERE c.id;

  RETURN public.mensajeria_de_plataforma();
END;
$function$;

REVOKE ALL ON FUNCTION public.mensajeria_guardar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mensajeria_guardar(jsonb) TO authenticated;

DO $verify$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'platform_messaging_config'
      AND column_name = 'email_proveedor'
      AND is_nullable = 'NO'
  ), 'email_proveedor debe ser obligatorio';

  ASSERT NOT EXISTS (
    SELECT 1 FROM public.platform_messaging_config
    WHERE email_proveedor NOT IN ('resend', 'smtp')
  ), 'hay un proveedor de correo invalido';

  ASSERT NOT has_function_privilege('anon',
    'public.mensajeria_guardar(jsonb)', 'EXECUTE'),
    'anon puede cambiar la mensajeria';
END;
$verify$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260904000150', 'email_provider_selection')
ON CONFLICT DO NOTHING;
