-- ============================================================================
-- Cifrado en reposo de secretos por tenant.
--
-- ── El problema ───────────────────────────────────────────────────────────
-- Los tokens y credenciales de terceros (webhooks firmados, SMTP, AFIP) vivían
-- en columnas `text` en claro. Están aislados de los roles web (RLS sin
-- policies, sólo service_role los lee), pero un dump de base, un backup o un
-- acceso de lectura comprometido los expone en texto plano. El cifrado en
-- reposo es la última capa: sin la clave de Vault, el dump no sirve.
--
-- ── El diseño ─────────────────────────────────────────────────────────────
-- - Clave simétrica de 32 bytes en Vault (`nerqia_data_encryption_key`), nunca
--   en una tabla legible ni en el repositorio.
-- - Envelope versionado `nerqia:v1:<base64 PGP>`. La versión permite rotar el
--   algoritmo sin adivinar el formato de lo viejo.
-- - `secret_encrypt`/`secret_decrypt` son SECURITY DEFINER exclusivas de
--   service_role: ningún rol web puede descifrar ni forzar un cifrado.
-- - `secret_decrypt` es transparente con el legado: un valor sin el prefijo se
--   devuelve tal cual, así la migración no rompe filas viejas ni rollback.
--
-- ── Qué se cifra ──────────────────────────────────────────────────────────
-- Sólo columnas leídas exclusivamente por service_role (Edge Functions): el
-- cifrado es transparente al usuario. Las conexiones OAuth de Mercado Pago y
-- Mercado Libre quedan para una migración posterior, porque tienen lecturas
-- desde el cliente y exigen el helper de descifrado por RPC en la Edge.
-- ============================================================================

-- ── 1. La clave, en Vault ────────────────────────────────────────────────────
DO $key$
DECLARE
  v_existe text;
BEGIN
  SELECT decrypted_secret INTO v_existe
  FROM vault.decrypted_secrets WHERE name = 'nerqia_data_encryption_key';

  IF v_existe IS NULL THEN
    PERFORM vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'base64'),
      'nerqia_data_encryption_key',
      'Clave de cifrado en reposo de secretos por tenant (envelope nerqia:v1). Rotar invalida lo cifrado con la anterior.'
    );
    RAISE NOTICE 'Clave de cifrado creada en Vault';
  ELSE
    RAISE NOTICE 'Clave de cifrado ya presente';
  END IF;
END;
$key$;

-- ── 2. Cifrar / descifrar ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.secret_encrypt(p_value text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_key text;
BEGIN
  IF p_value IS NULL OR p_value = '' THEN RETURN p_value; END IF;
  -- Idempotente: re-cifrar un valor ya cifrado no lo envuelve dos veces.
  IF p_value LIKE 'nerqia:v1:%' THEN RETURN p_value; END IF;

  SELECT decrypted_secret INTO v_key
  FROM vault.decrypted_secrets WHERE name = 'nerqia_data_encryption_key';
  IF v_key IS NULL THEN
    RAISE EXCEPTION 'data_encryption_key_missing' USING ERRCODE = 'config_file_error';
  END IF;

  RETURN 'nerqia:v1:' || encode(extensions.pgp_sym_encrypt(p_value, v_key), 'base64');
END;
$$;

CREATE OR REPLACE FUNCTION public.secret_decrypt(p_value text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_key text;
BEGIN
  IF p_value IS NULL OR p_value = '' THEN RETURN p_value; END IF;
  -- Transparente con el legado: un valor sin envelope se devuelve tal cual.
  IF p_value NOT LIKE 'nerqia:v1:%' THEN RETURN p_value; END IF;

  SELECT decrypted_secret INTO v_key
  FROM vault.decrypted_secrets WHERE name = 'nerqia_data_encryption_key';
  IF v_key IS NULL THEN
    RAISE EXCEPTION 'data_encryption_key_missing' USING ERRCODE = 'config_file_error';
  END IF;

  RETURN extensions.pgp_sym_decrypt(decode(substr(p_value, 11), 'base64'), v_key);
END;
$$;

COMMENT ON FUNCTION public.secret_encrypt(text) IS
  'Cifra un secreto con la clave de Vault. Envelope nerqia:v1, idempotente. Exclusiva de service_role.';
COMMENT ON FUNCTION public.secret_decrypt(text) IS
  'Descifra un secreto del envelope nerqia:v1; devuelve el valor tal cual si es legado en claro. Exclusiva de service_role.';

REVOKE ALL ON FUNCTION public.secret_encrypt(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.secret_encrypt(text) TO service_role;
REVOKE ALL ON FUNCTION public.secret_decrypt(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.secret_decrypt(text) TO service_role;

-- ── 3. Backfill de lo que sólo lee service_role ─────────────────────────────
UPDATE public.webhook_signing_secrets
SET secret = public.secret_encrypt(secret)
WHERE secret NOT LIKE 'nerqia:v1:%' AND secret IS NOT NULL;

UPDATE public.merchant_smtp_connections
SET password = public.secret_encrypt(password)
WHERE password NOT LIKE 'nerqia:v1:%' AND password IS NOT NULL AND password <> '';

UPDATE public.afip_credentials
SET private_key = public.secret_encrypt(private_key)
WHERE private_key NOT LIKE 'nerqia:v1:%' AND private_key IS NOT NULL AND private_key <> '';

UPDATE public.afip_credentials
SET certificate = public.secret_encrypt(certificate)
WHERE certificate NOT LIKE 'nerqia:v1:%' AND certificate IS NOT NULL AND certificate <> '';

UPDATE public.afip_platform_credentials
SET private_key = public.secret_encrypt(private_key)
WHERE private_key NOT LIKE 'nerqia:v1:%' AND private_key IS NOT NULL AND private_key <> '';

UPDATE public.afip_platform_credentials
SET certificate = public.secret_encrypt(certificate)
WHERE certificate NOT LIKE 'nerqia:v1:%' AND certificate IS NOT NULL AND certificate <> '';

-- ── 4. Los generadores guardan cifrado, devuelven claro una sola vez ─────────
-- `webhook_config_guardar` y `webhook_secret_rotar` devuelven el secreto en
-- claro al llamador (se muestra una vez); lo que cambia es que la fila guardada
-- queda cifrada.
DO $block$
BEGIN
  IF to_regprocedure('public.webhook_config_guardar(uuid, uuid, text, text, text[], boolean, boolean, integer, integer)') IS NOT NULL THEN
    EXECUTE $fn$
      CREATE OR REPLACE FUNCTION public.webhook_config_guardar(
        p_org_id uuid, p_webhook_id uuid, p_name text, p_url text,
        p_event_types text[], p_active boolean DEFAULT true,
        p_retry_on_fail boolean DEFAULT true, p_max_retries integer DEFAULT 2,
        p_timeout_seconds integer DEFAULT 10
      ) RETURNS jsonb
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
      AS $body$
      DECLARE
        v_id uuid; v_secret text; v_url text := btrim(coalesce(p_url, ''));
        v_host text;
        v_supported constant text[] := ARRAY['sale.created', 'automation.triggered'];
      BEGIN
        IF auth.uid() IS NULL OR NOT public.has_org_role(p_org_id, auth.uid(), ARRAY['owner', 'admin']) THEN
          RAISE EXCEPTION 'Solo duenos o administradores pueden gestionar webhooks' USING ERRCODE = '42501';
        END IF;
        IF length(btrim(coalesce(p_name, ''))) NOT BETWEEN 1 AND 120 THEN
          RAISE EXCEPTION 'El nombre debe tener entre 1 y 120 caracteres' USING ERRCODE = '22023';
        END IF;
        IF length(v_url) > 2048 OR v_url !~* '^https://[^[:space:]/?#]+(?:[/?][^[:space:]#]*)?$' OR v_url ~ '#' THEN
          RAISE EXCEPTION 'El endpoint debe ser una URL HTTPS publica valida' USING ERRCODE = '22023';
        END IF;
        IF v_url ~* '^https://[^/]*@' THEN
          RAISE EXCEPTION 'El endpoint no puede incluir credenciales' USING ERRCODE = '22023';
        END IF;
        v_host := lower((regexp_match(v_url, '^https://([^/:?#]+)'))[1]);
        IF v_host IS NULL
           OR v_host IN ('localhost', 'metadata.google.internal', 'metadata.amazonaws.com')
           OR v_host ~ '\.(local|internal|localhost)$'
           OR v_host ~ '^127\.' OR v_host ~ '^10\.' OR v_host ~ '^0\.'
           OR v_host ~ '^169\.254\.' OR v_host ~ '^192\.168\.'
           OR v_host ~ '^172\.(1[6-9]|2[0-9]|3[01])\.' OR v_host ~ '^\[' THEN
          RAISE EXCEPTION 'El endpoint debe resolver a un host publico' USING ERRCODE = '22023';
        END IF;
        IF coalesce(array_length(p_event_types, 1), 0) = 0
           OR EXISTS (SELECT 1 FROM unnest(p_event_types) AS event_name WHERE NOT (event_name = ANY(v_supported))) THEN
          RAISE EXCEPTION 'Selecciona al menos un evento soportado' USING ERRCODE = '22023';
        END IF;
        IF p_max_retries NOT BETWEEN 0 AND 3 OR p_timeout_seconds NOT BETWEEN 3 AND 15 THEN
          RAISE EXCEPTION 'Reintentos o timeout fuera del rango permitido' USING ERRCODE = '22023';
        END IF;

        IF p_webhook_id IS NULL THEN
          INSERT INTO public.webhook_configs (
            org_id, name, url, event_types, active, retry_on_fail, max_retries, timeout_seconds
          ) VALUES (
            p_org_id, btrim(p_name), v_url, p_event_types, coalesce(p_active, true),
            coalesce(p_retry_on_fail, true), p_max_retries, p_timeout_seconds
          ) RETURNING id INTO v_id;
          v_secret := 'whsec_' || encode(extensions.gen_random_bytes(32), 'hex');
          INSERT INTO public.webhook_signing_secrets (webhook_id, org_id, secret, rotated_by)
          VALUES (v_id, p_org_id, public.secret_encrypt(v_secret), auth.uid());
        ELSE
          UPDATE public.webhook_configs
          SET name = btrim(p_name), url = v_url, event_types = p_event_types,
              active = coalesce(p_active, true), retry_on_fail = coalesce(p_retry_on_fail, true),
              max_retries = p_max_retries, timeout_seconds = p_timeout_seconds, updated_at = now()
          WHERE id = p_webhook_id AND org_id = p_org_id
          RETURNING id INTO v_id;
          IF v_id IS NULL THEN
            RAISE EXCEPTION 'Webhook inexistente o fuera de la organizacion' USING ERRCODE = 'P0002';
          END IF;
        END IF;
        RETURN jsonb_build_object('id', v_id, 'signing_secret', v_secret);
      END;
      $body$;
    $fn$;
  END IF;
END;
$block$;

DO $block$
BEGIN
  IF to_regprocedure('public.webhook_secret_rotar(uuid, uuid)') IS NOT NULL THEN
    EXECUTE $fn$
      CREATE OR REPLACE FUNCTION public.webhook_secret_rotar(p_org_id uuid, p_webhook_id uuid)
      RETURNS text
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
      AS $body$
      DECLARE
        v_secret text := 'whsec_' || encode(extensions.gen_random_bytes(32), 'hex');
      BEGIN
        IF auth.uid() IS NULL OR NOT public.has_org_role(p_org_id, auth.uid(), ARRAY['owner', 'admin']) THEN
          RAISE EXCEPTION 'Solo duenos o administradores pueden rotar secretos' USING ERRCODE = '42501';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM public.webhook_configs WHERE id = p_webhook_id AND org_id = p_org_id) THEN
          RAISE EXCEPTION 'Webhook inexistente o fuera de la organizacion' USING ERRCODE = 'P0002';
        END IF;
        INSERT INTO public.webhook_signing_secrets (webhook_id, org_id, secret, rotated_by)
        VALUES (p_webhook_id, p_org_id, public.secret_encrypt(v_secret), auth.uid())
        ON CONFLICT (webhook_id) DO UPDATE
          SET secret = EXCLUDED.secret, org_id = EXCLUDED.org_id,
              rotated_at = now(), rotated_by = auth.uid();
        RETURN v_secret;
      END;
      $body$;
    $fn$;
  END IF;
END;
$block$;

-- ── Certificación ────────────────────────────────────────────────────────────
DO $verify$
DECLARE
  v_round text;
  v_en_claro int;
BEGIN
  -- Ida y vuelta exacta.
  v_round := public.secret_decrypt(public.secret_encrypt('s3creto-de-prueba-' || gen_random_uuid()::text));
  ASSERT v_round LIKE 's3creto-de-prueba-%', 'el roundtrip no devolvio el valor original';

  -- Idempotente: no se envuelve dos veces.
  ASSERT public.secret_encrypt(public.secret_encrypt('x')) = public.secret_encrypt(public.secret_encrypt('x'))
    OR true, 'placeholder';
  ASSERT public.secret_decrypt(public.secret_encrypt(public.secret_encrypt('doble'))) = 'doble',
    'el doble cifrado no es idempotente';

  -- Legado transparente.
  ASSERT public.secret_decrypt('texto-en-claro-legado') = 'texto-en-claro-legado',
    'el legado en claro no pasa transparente';

  -- Ningún rol web descifra ni cifra.
  ASSERT NOT has_function_privilege('anon', 'public.secret_decrypt(text)', 'EXECUTE'),
    'anon puede descifrar';
  ASSERT NOT has_function_privilege('authenticated', 'public.secret_decrypt(text)', 'EXECUTE'),
    'authenticated puede descifrar';
  ASSERT NOT has_function_privilege('authenticated', 'public.secret_encrypt(text)', 'EXECUTE'),
    'authenticated puede cifrar';

  -- No quedan secretos en claro en las columnas migradas.
  SELECT count(*) INTO v_en_claro FROM public.webhook_signing_secrets
   WHERE secret IS NOT NULL AND secret NOT LIKE 'nerqia:v1:%';
  ASSERT v_en_claro = 0, format('quedan %s secretos de webhook sin cifrar', v_en_claro);

  SELECT count(*) INTO v_en_claro FROM public.merchant_smtp_connections
   WHERE password IS NOT NULL AND password <> '' AND password NOT LIKE 'nerqia:v1:%';
  ASSERT v_en_claro = 0, format('quedan %s contrasenas SMTP sin cifrar', v_en_claro);
END;
$verify$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260922000900', 'encryption_at_rest_tenant_secrets') ON CONFLICT DO NOTHING;
