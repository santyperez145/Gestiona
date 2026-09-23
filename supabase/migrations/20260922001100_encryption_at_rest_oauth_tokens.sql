-- ============================================================================
-- Cifrado en reposo de tokens OAuth (Mercado Pago y Mercado Libre).
--
-- ── Por qué en su propia migración ────────────────────────────────────────
-- A diferencia de SMTP y AFIP, `payment_connections` y `meli_connections`
-- tienen lecturas y escrituras desde varias Edge Functions. El cifrado es el
-- mismo envelope `nerqia:v1` de 20260922000900; lo que cambia es que hay que
-- actualizar cada lector para descifrar y cada escritor para cifrar, sin
-- romper la renovación silenciosa de tokens.
--
-- ── Qué se cifra ──────────────────────────────────────────────────────────
-- `access_token` y `refresh_token` de ambas tablas. `public_key` de Mercado
-- Pago es la clave pública del Brick: no es secreta y el navegador la usa, así
-- que queda en claro. El resto de las columnas son metadatos.
--
-- ── Compatibilidad ─────────────────────────────────────────────────────────
-- `secret_decrypt` devuelve tal cual un valor sin el prefijo `nerqia:v1:`, así
-- que un deploy de la Edge que se adelante a esta migración sigue leyendo los
-- tokens viejos. El backfill es idempotente.
-- ============================================================================

-- Backfill: sólo cifra lo que está en claro.
UPDATE public.payment_connections
SET access_token = public.secret_encrypt(access_token)
WHERE access_token NOT LIKE 'nerqia:v1:%' AND access_token IS NOT NULL AND access_token <> '';

UPDATE public.payment_connections
SET refresh_token = public.secret_encrypt(refresh_token)
WHERE refresh_token NOT LIKE 'nerqia:v1:%' AND refresh_token IS NOT NULL AND refresh_token <> '';

UPDATE public.meli_connections
SET access_token = public.secret_encrypt(access_token)
WHERE access_token NOT LIKE 'nerqia:v1:%' AND access_token IS NOT NULL AND access_token <> '';

UPDATE public.meli_connections
SET refresh_token = public.secret_encrypt(refresh_token)
WHERE refresh_token NOT LIKE 'nerqia:v1:%' AND refresh_token IS NOT NULL AND refresh_token <> '';

-- Ninguna función nueva: `secret_encrypt`/`secret_decrypt` ya existen y son
-- exclusivas de service_role. El cifrado usa la misma clave de Vault.

-- ── Certificación ────────────────────────────────────────────────────────────
DO $verify$
DECLARE
  v_en_claro int;
BEGIN
  SELECT count(*) INTO v_en_claro FROM public.payment_connections
   WHERE (access_token IS NOT NULL AND access_token <> '' AND access_token NOT LIKE 'nerqia:v1:%')
      OR (refresh_token IS NOT NULL AND refresh_token <> '' AND refresh_token NOT LIKE 'nerqia:v1:%');
  ASSERT v_en_claro = 0, format('quedan %s tokens de Mercado Pago sin cifrar', v_en_claro);

  SELECT count(*) INTO v_en_claro FROM public.meli_connections
   WHERE (access_token IS NOT NULL AND access_token <> '' AND access_token NOT LIKE 'nerqia:v1:%')
      OR (refresh_token IS NOT NULL AND refresh_token <> '' AND refresh_token NOT LIKE 'nerqia:v1:%');
  ASSERT v_en_claro = 0, format('quedan %s tokens de Mercado Libre sin cifrar', v_en_claro);

  -- Ningún rol web puede descifrar ni leer las tablas directamente.
  ASSERT NOT has_table_privilege('authenticated', 'public.payment_connections', 'SELECT'),
    'authenticated puede leer payment_connections';
  ASSERT NOT has_table_privilege('anon', 'public.meli_connections', 'SELECT'),
    'anon puede leer meli_connections';
END;
$verify$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260922001100', 'encryption_at_rest_oauth_tokens') ON CONFLICT DO NOTHING;
