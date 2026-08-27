-- La mensajería se configura en la plataforma, no en nueve archivos
--
-- ── Por qué «configuré Resend y no funciona» ──────────────────────────────
--
-- ⚠️ Medido el 2026-08-27: el remitente estaba **hardcodeado en cada función**,
-- con nueve direcciones distintas y todas del mismo dominio inventado:
--
--     noreply@gestiona.app          send-team-invite, send-drip-emails
--     marketing@gestiona.app        send-email-campaign
--     facturas@gestiona.app         send-invoice-email
--     pedidos@gestiona.app          send-supplier-po
--     digest@gestiona.app           weekly-performance-digest
--     automatizaciones@gestiona.app run-automation-flows
--     admin@gestiona.app            send-push
--     onboarding@resend.dev         precio-suscripcion
--
-- Resend sólo entrega desde un dominio **verificado en la cuenta**. Si el
-- dominio verificado es otro —o si todavía no hay ninguno— **todas** rechazan,
-- y cargar bien la `RESEND_API_KEY` no cambia nada: el código no lee ninguna
-- configuración, así que no hay dónde decirle cuál es el dominio.
--
-- 📌 Por eso el remitente pasa a ser un dato de la plataforma. Se configura una
-- vez, en un lugar, y las funciones lo leen. Es la misma regla que ya rige para
-- los permisos, los roles y el plan: **la misma decisión no se escribe en nueve
-- lugares**.
--
-- ⚠️ Y acá NO va ningún secreto. La API key sigue viviendo en el entorno de las
-- Edge Functions. Esta tabla guarda lo que no es secreto —el dominio, el nombre
-- que se muestra, la casilla de cada propósito— que es justamente lo que hoy no
-- se puede cambiar sin tocar código.

CREATE TABLE IF NOT EXISTS public.platform_messaging_config (
  id              boolean PRIMARY KEY DEFAULT true CHECK (id),  -- una sola fila
  -- Correo
  email_dominio   text,          -- el verificado en Resend, ej. 'gestiona.app'
  email_nombre    text NOT NULL DEFAULT 'Gestiona',
  email_casillas  jsonb NOT NULL DEFAULT '{}'::jsonb,  -- propósito → casilla local
  email_verificado_at timestamptz,
  -- WhatsApp
  whatsapp_proveedor text CHECK (whatsapp_proveedor IN ('meta_cloud', 'ninguno')),
  whatsapp_phone_number_id text,
  whatsapp_numero_visible  text,
  whatsapp_verificado_at   timestamptz,
  actualizado_por uuid REFERENCES auth.users(id),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.platform_messaging_config IS
  'Cómo sale el correo y el WhatsApp de la plataforma. Una sola fila. NO '
  'guarda secretos: la API key y el token viven en el entorno de las Edge '
  'Functions. Guarda lo que hoy está hardcodeado en nueve archivos y por eso '
  'no se puede cambiar sin tocar código.';

ALTER TABLE public.platform_messaging_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS platform_messaging_config_staff ON public.platform_messaging_config;
CREATE POLICY platform_messaging_config_staff ON public.platform_messaging_config
  FOR ALL USING (public.is_platform_admin(auth.uid()))
  WITH CHECK (public.is_platform_admin(auth.uid()));

-- La fila arranca con lo que el código usa hoy, para no cambiar el
-- comportamiento al aplicar esto: primero se mueve la decisión de lugar, y
-- recién después el dueño la corrige desde la consola.
INSERT INTO public.platform_messaging_config (id, email_dominio, email_nombre, email_casillas,
                                              whatsapp_proveedor)
VALUES (true, 'gestiona.app', 'Gestiona', jsonb_build_object(
    'default',        'noreply',
    'marketing',      'marketing',
    'facturas',       'facturas',
    'pedidos',        'pedidos',
    'digest',         'digest',
    'automatizaciones','automatizaciones',
    'admin',          'admin'
  ), 'ninguno')
ON CONFLICT (id) DO NOTHING;

-- ── Lo que leen las Edge Functions ────────────────────────────────────────

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

-- ── Guardar la configuración (sólo staff) ─────────────────────────────────

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

  UPDATE public.platform_messaging_config c SET
    email_dominio  = COALESCE(p_cambios->>'email_dominio', c.email_dominio),
    email_nombre   = COALESCE(p_cambios->>'email_nombre', c.email_nombre),
    email_casillas = COALESCE(p_cambios->'email_casillas', c.email_casillas),
    whatsapp_proveedor       = COALESCE(p_cambios->>'whatsapp_proveedor', c.whatsapp_proveedor),
    whatsapp_phone_number_id = COALESCE(p_cambios->>'whatsapp_phone_number_id', c.whatsapp_phone_number_id),
    whatsapp_numero_visible  = COALESCE(p_cambios->>'whatsapp_numero_visible', c.whatsapp_numero_visible),
    -- ⚠️ Cambiar el dominio invalida la verificación: lo que estaba probado era
    -- el dominio anterior. Decir «verificado» sobre algo que no se probó es la
    -- misma trampa que el checkbox de «ya delegué en ARCA».
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

-- Marcar verificado: SÓLO lo llama el servidor después de que el proveedor
-- aceptó un envío real. Nunca la pantalla.
CREATE OR REPLACE FUNCTION public.mensajeria_marcar_verificado(p_canal text, p_ok boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF p_canal = 'email' THEN
    UPDATE public.platform_messaging_config
       SET email_verificado_at = CASE WHEN p_ok THEN now() ELSE NULL END WHERE id;
  ELSIF p_canal = 'whatsapp' THEN
    UPDATE public.platform_messaging_config
       SET whatsapp_verificado_at = CASE WHEN p_ok THEN now() ELSE NULL END WHERE id;
  ELSE
    RAISE EXCEPTION 'Canal desconocido: %', p_canal USING ERRCODE = 'check_violation';
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.mensajeria_marcar_verificado(text, boolean)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mensajeria_marcar_verificado(text, boolean) TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- Verificación — en los dos sentidos
-- ═══════════════════════════════════════════════════════════════════════════

DO $verif$
DECLARE
  v_staff uuid;
  v_c jsonb;
  v_ajeno boolean;
BEGIN
  SELECT user_id INTO v_staff FROM public.platform_admins LIMIT 1;

  -- ── a. Arranca con lo que el código usaba, y NO verificado ──────────────
  v_c := public.mensajeria_de_plataforma();
  ASSERT v_c->>'email_dominio' = 'gestiona.app', 'no se sembró el dominio actual';
  ASSERT NOT (v_c->>'email_listo')::boolean,
    'arranca diciendo que el correo está listo sin haber probado un envío';

  -- ── b. ⚠️ Un usuario que no es staff no puede configurarla ──────────────
  BEGIN
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', gen_random_uuid()::text, 'role','authenticated')::text, true);
    PERFORM public.mensajeria_guardar('{"email_dominio":"zz-ajeno.test"}'::jsonb);
    v_ajeno := true;
  EXCEPTION WHEN insufficient_privilege THEN
    v_ajeno := false;
  END;
  PERFORM set_config('request.jwt.claims', NULL, true);
  ASSERT NOT v_ajeno, 'cualquiera pudo cambiar el remitente de toda la plataforma';

  -- ── c. Cambiar el dominio borra la verificación ─────────────────────────
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_staff::text, 'role','authenticated')::text, true);
  PERFORM public.mensajeria_marcar_verificado('email', true);
  ASSERT (public.mensajeria_de_plataforma()->>'email_listo')::boolean,
    'marcar verificado no tuvo efecto';

  PERFORM public.mensajeria_guardar('{"email_dominio":"zz-otro.test"}'::jsonb);
  ASSERT NOT (public.mensajeria_de_plataforma()->>'email_listo')::boolean,
    'el dominio cambió y la verificación del anterior siguió valiendo';

  -- ── d. Se deja como estaba ──────────────────────────────────────────────
  PERFORM public.mensajeria_guardar('{"email_dominio":"gestiona.app"}'::jsonb);
  PERFORM set_config('request.jwt.claims', NULL, true);
  ASSERT (SELECT email_dominio FROM public.platform_messaging_config WHERE id) = 'gestiona.app',
    'no se restauró el dominio';

  RAISE NOTICE 'OK: una sola fila, sólo staff, y cambiar el dominio invalida lo verificado';
END $verif$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260827000200', 'la_mensajeria_se_configura_en_la_plataforma')
ON CONFLICT DO NOTHING;
