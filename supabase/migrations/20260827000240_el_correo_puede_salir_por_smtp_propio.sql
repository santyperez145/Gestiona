-- El correo de la plataforma puede salir por un SMTP propio
--
-- ── Por qué ───────────────────────────────────────────────────────────────
--
-- Resend sólo entrega desde un dominio verificado, y verificar un dominio pide
-- tocar el DNS. Mientras eso no esté, **no sale un solo mail** — y hay avisos
-- que ya dependen de que salgan: el fin de la prueba, el cambio de precio, el
-- acceso de soporte.
--
-- El código ya sabía mandar por SMTP: `_shared/smtpSender.ts` intenta SMTP
-- primero y cae a Resend. Lo que no existía era **dónde configurarlo para la
-- plataforma**: la única configuración SMTP es por comercio, en `settings`, y
-- eso es otra cosa (el correo que manda cada comercio a sus clientes).
--
-- ⚠️ **La contraseña NO va acá.** `platform_messaging_config` la lee el staff
-- desde el navegador; una contraseña ahí sería un secreto en una tabla que la
-- UI consulta. Va en el entorno de las Edge Functions, como `SMTP_PASSWORD`.
--
-- 📌 Y es la misma lección que dejó `settings.smtp_pass`: RLS es por fila, no
-- por columna, así que cualquier miembro de un comercio puede leer las columnas
-- de su fila. Hoy no hay ninguna contraseña cargada ahí (medido: 0 de 2), pero
-- la columna sigue siendo una invitación a guardar un secreto donde no va.

ALTER TABLE public.platform_messaging_config
  ADD COLUMN IF NOT EXISTS smtp_host       text,
  ADD COLUMN IF NOT EXISTS smtp_port       int,
  ADD COLUMN IF NOT EXISTS smtp_user       text,
  ADD COLUMN IF NOT EXISTS smtp_secure     boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS smtp_from_email text;

COMMENT ON COLUMN public.platform_messaging_config.smtp_user IS
  'Usuario del SMTP. La CONTRASEÑA no vive acá: va en el entorno de las Edge '
  'Functions como SMTP_PASSWORD. Esta tabla la lee el staff desde el navegador.';

-- ⚠️ Con Gmail y con casi cualquier SMTP, el `From` tiene que ser la misma
-- casilla que se autentica: mandar «desde» otra dirección hace que el servidor
-- rechace, o que el mensaje caiga en spam por DMARC. Por eso el remitente del
-- camino SMTP es `smtp_from_email` y no se arma con el dominio de Resend.
CREATE OR REPLACE FUNCTION public.mensajeria_de_plataforma()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object(
    'email_dominio',  c.email_dominio,
    'email_nombre',   c.email_nombre,
    'email_casillas', c.email_casillas,
    'email_listo',    c.email_dominio IS NOT NULL AND c.email_verificado_at IS NOT NULL,
    -- SMTP propio: alternativa a Resend mientras no haya dominio verificado.
    'smtp_host',       c.smtp_host,
    'smtp_port',       c.smtp_port,
    'smtp_user',       c.smtp_user,
    'smtp_secure',     c.smtp_secure,
    'smtp_from_email', c.smtp_from_email,
    'smtp_configurado', c.smtp_host IS NOT NULL AND c.smtp_user IS NOT NULL
                        AND c.smtp_from_email IS NOT NULL,
    'whatsapp_proveedor',       c.whatsapp_proveedor,
    'whatsapp_phone_number_id', c.whatsapp_phone_number_id,
    'whatsapp_numero_visible',  c.whatsapp_numero_visible,
    'whatsapp_listo',  c.whatsapp_proveedor = 'meta_cloud'
                       AND c.whatsapp_phone_number_id IS NOT NULL
                       AND c.whatsapp_verificado_at IS NOT NULL
  ) FROM public.platform_messaging_config c WHERE c.id;
$$;

REVOKE ALL ON FUNCTION public.mensajeria_de_plataforma() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.mensajeria_de_plataforma() TO service_role, authenticated;

-- Se amplía la allowlist de lo que el staff puede guardar.
CREATE OR REPLACE FUNCTION public.mensajeria_guardar(p_cambios jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Sólo el staff de plataforma configura la mensajería'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- ⚠️ Si llega algo que parece una contraseña, se rechaza en vez de guardarla.
  -- Un campo que "no debería" recibir secretos termina recibiéndolos.
  IF p_cambios ?| ARRAY['smtp_pass', 'smtp_password', 'password', 'token', 'api_key'] THEN
    RAISE EXCEPTION 'Las contraseñas y tokens no se guardan acá: van en el entorno de las funciones'
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.platform_messaging_config c SET
    email_dominio  = COALESCE(p_cambios->>'email_dominio', c.email_dominio),
    email_nombre   = COALESCE(p_cambios->>'email_nombre', c.email_nombre),
    email_casillas = COALESCE(p_cambios->'email_casillas', c.email_casillas),
    smtp_host       = COALESCE(NULLIF(p_cambios->>'smtp_host', ''), c.smtp_host),
    smtp_port       = COALESCE((NULLIF(p_cambios->>'smtp_port', ''))::int, c.smtp_port),
    smtp_user       = COALESCE(NULLIF(p_cambios->>'smtp_user', ''), c.smtp_user),
    smtp_secure     = COALESCE((p_cambios->>'smtp_secure')::boolean, c.smtp_secure),
    smtp_from_email = COALESCE(NULLIF(p_cambios->>'smtp_from_email', ''), c.smtp_from_email),
    whatsapp_proveedor       = COALESCE(p_cambios->>'whatsapp_proveedor', c.whatsapp_proveedor),
    whatsapp_phone_number_id = COALESCE(p_cambios->>'whatsapp_phone_number_id', c.whatsapp_phone_number_id),
    whatsapp_numero_visible  = COALESCE(p_cambios->>'whatsapp_numero_visible', c.whatsapp_numero_visible),
    email_verificado_at = CASE
      WHEN p_cambios ? 'email_dominio'
       AND p_cambios->>'email_dominio' IS DISTINCT FROM c.email_dominio
      THEN NULL ELSE c.email_verificado_at END,
    whatsapp_verificado_at = CASE
      WHEN p_cambios ? 'whatsapp_phone_number_id'
       AND p_cambios->>'whatsapp_phone_number_id' IS DISTINCT FROM c.whatsapp_phone_number_id
      THEN NULL ELSE c.whatsapp_verificado_at END,
    actualizado_por = auth.uid(),
    updated_at = now()
  WHERE c.id;

  RETURN public.mensajeria_de_plataforma();
END $$;

GRANT EXECUTE ON FUNCTION public.mensajeria_guardar(jsonb) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- Verificación — en los dos sentidos
-- ═══════════════════════════════════════════════════════════════════════════

DO $verif$
DECLARE
  v_staff uuid;
  v_c jsonb;
  v_guardo_secreto boolean;
BEGIN
  SELECT user_id INTO v_staff FROM public.platform_admins LIMIT 1;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_staff::text, 'role','authenticated')::text, true);

  -- ── a. Se puede configurar un SMTP ──────────────────────────────────────
  v_c := public.mensajeria_guardar(jsonb_build_object(
    'smtp_host', 'smtp.zz-prueba.test', 'smtp_port', '465',
    'smtp_user', 'zz@zz-prueba.test', 'smtp_from_email', 'zz@zz-prueba.test'));
  ASSERT (v_c->>'smtp_configurado')::boolean, 'no quedó configurado el SMTP';
  ASSERT v_c->>'smtp_host' = 'smtp.zz-prueba.test', 'no se guardó el host';

  -- ── b. ⚠️ Pero una contraseña se RECHAZA ────────────────────────────────
  -- Un campo que «no debería» recibir secretos termina recibiéndolos, y esta
  -- tabla la lee el staff desde el navegador.
  BEGIN
    PERFORM public.mensajeria_guardar('{"smtp_pass":"zz-secreto"}'::jsonb);
    v_guardo_secreto := true;
  EXCEPTION WHEN check_violation THEN
    v_guardo_secreto := false;
  END;
  ASSERT NOT v_guardo_secreto,
    'se pudo guardar una contraseña en una tabla que la consola lee';

  -- ── c. Y no quedó ninguna columna con la contraseña ─────────────────────
  ASSERT NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='platform_messaging_config'
       AND column_name IN ('smtp_pass','smtp_password','password')),
    'apareció una columna de contraseña en la configuración de mensajería';

  -- ── d. Se deja como estaba ──────────────────────────────────────────────
  UPDATE public.platform_messaging_config
     SET smtp_host = NULL, smtp_port = NULL, smtp_user = NULL, smtp_from_email = NULL
   WHERE id;
  PERFORM set_config('request.jwt.claims', NULL, true);
  ASSERT NOT (public.mensajeria_de_plataforma()->>'smtp_configurado')::boolean,
    'no se limpió la configuración de prueba';

  RAISE NOTICE 'OK: se configura el SMTP, y una contraseña se rechaza';
END $verif$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260827000240', 'el_correo_puede_salir_por_smtp_propio')
ON CONFLICT DO NOTHING;
