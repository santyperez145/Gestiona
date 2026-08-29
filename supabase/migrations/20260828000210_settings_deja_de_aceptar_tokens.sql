-- Retira las últimas credenciales de integraciones que todavía figuraban en
-- `settings`, una tabla legible por todos los miembros de la organización.
--
-- Medición previa en producción (2026-08-29): las ocho columnas tenían cero
-- valores. Mercado Pago y MercadoLibre ya usan OAuth en tablas privadas;
-- Evolution ya fue migrado a `evolution_connections`; la API pública conserva
-- sólo hashes y scopes en `api_keys`.

DO $precondition$
DECLARE
  v_rows bigint;
BEGIN
  SELECT count(*) INTO v_rows
  FROM public.settings s
  WHERE NULLIF(btrim(to_jsonb(s)->>'api_key'), '') IS NOT NULL
     OR NULLIF(btrim(to_jsonb(s)->>'evolution_api_url'), '') IS NOT NULL
     OR NULLIF(btrim(to_jsonb(s)->>'evolution_api_key'), '') IS NOT NULL
     OR NULLIF(btrim(to_jsonb(s)->>'evolution_instance'), '') IS NOT NULL
     OR NULLIF(btrim(to_jsonb(s)->>'ml_access_token'), '') IS NOT NULL
     OR NULLIF(btrim(to_jsonb(s)->>'ml_refresh_token'), '') IS NOT NULL
     OR NULLIF(btrim(to_jsonb(s)->>'mp_access_token'), '') IS NOT NULL
     OR NULLIF(btrim(to_jsonb(s)->>'mp_webhook_secret'), '') IS NOT NULL;

  IF v_rows <> 0 THEN
    RAISE EXCEPTION
      'Hay % settings con credenciales heredadas; migrarlas antes de retirar columnas',
      v_rows;
  END IF;
END;
$precondition$;

-- Este trigger sólo existía para impedir que un cliente viejo repoblara los
-- tres campos de Evolution. Al desaparecer las columnas, el esquema mismo es
-- la barrera y la función ya no debe sobrevivir como dependencia fantasma.
DROP TRIGGER IF EXISTS trg_reject_legacy_evolution_settings_credentials ON public.settings;
DROP FUNCTION IF EXISTS public.reject_legacy_evolution_settings_credentials();

ALTER TABLE public.settings
  DROP COLUMN IF EXISTS api_key,
  DROP COLUMN IF EXISTS evolution_api_url,
  DROP COLUMN IF EXISTS evolution_api_key,
  DROP COLUMN IF EXISTS evolution_instance,
  DROP COLUMN IF EXISTS ml_access_token,
  DROP COLUMN IF EXISTS ml_refresh_token,
  DROP COLUMN IF EXISTS mp_access_token,
  DROP COLUMN IF EXISTS mp_webhook_secret;

-- RLS sin policies ya devuelve cero filas, pero no hace falta dejar una capa
-- menos: el navegador tampoco necesita privilegio de tabla. Las vistas de
-- estado sanitizadas conservan sus grants independientes.
REVOKE ALL ON TABLE public.payment_connections FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.meli_connections FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.evolution_connections FROM PUBLIC, anon, authenticated;

DO $verify$
DECLARE
  v_columns integer;
  v_private_tables integer;
BEGIN
  SELECT count(*) INTO v_columns
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'settings'
    AND column_name = ANY (ARRAY[
      'api_key',
      'evolution_api_url',
      'evolution_api_key',
      'evolution_instance',
      'ml_access_token',
      'ml_refresh_token',
      'mp_access_token',
      'mp_webhook_secret'
    ]);
  IF v_columns <> 0 THEN
    RAISE EXCEPTION 'Quedaron % columnas de credenciales heredadas en settings', v_columns;
  END IF;

  SELECT count(*) INTO v_private_tables
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = ANY (ARRAY['payment_connections', 'meli_connections', 'evolution_connections'])
    AND c.relrowsecurity = true
    AND NOT EXISTS (
      SELECT 1 FROM pg_policies p
      WHERE p.schemaname = n.nspname AND p.tablename = c.relname
    );
  IF v_private_tables <> 3 THEN
    RAISE EXCEPTION 'Las tres conexiones privadas no conservan RLS sin policies';
  END IF;

  IF has_table_privilege('anon', 'public.payment_connections', 'SELECT')
     OR has_table_privilege('authenticated', 'public.payment_connections', 'SELECT')
     OR has_table_privilege('anon', 'public.meli_connections', 'SELECT')
     OR has_table_privilege('authenticated', 'public.meli_connections', 'SELECT')
     OR has_table_privilege('anon', 'public.evolution_connections', 'SELECT')
     OR has_table_privilege('authenticated', 'public.evolution_connections', 'SELECT') THEN
    RAISE EXCEPTION 'Una tabla de conexiones privadas sigue legible por el navegador';
  END IF;
END;
$verify$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260828000210', 'settings_deja_de_aceptar_tokens')
ON CONFLICT DO NOTHING;
