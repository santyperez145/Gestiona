-- Verificación real del SMTP privado. Inserta una credencial ficticia dentro
-- de una transacción, evalúa el acceso como authenticated y hace ROLLBACK.
-- No abre conexiones SMTP ni envía correos.
--
-- Ejecutar:
--   npx supabase db query --linked --file supabase/verificaciones/20260829_smtp_del_comercio_privado.sql

BEGIN;

SELECT set_config(
  'gestiona.fixture_org',
  (SELECT org_id::text FROM public.memberships
   WHERE role IN ('owner', 'admin') ORDER BY created_at LIMIT 1),
  true
);
SELECT set_config(
  'gestiona.fixture_user',
  (SELECT user_id::text FROM public.memberships
   WHERE org_id = current_setting('gestiona.fixture_org')::uuid
     AND role IN ('owner', 'admin') ORDER BY created_at LIMIT 1),
  true
);

INSERT INTO public.merchant_smtp_connections(
  org_id, host, port, username, password, secure, from_name, from_email, updated_by
)
VALUES (
  current_setting('gestiona.fixture_org')::uuid,
  'smtp.zz-verificacion.example',
  587,
  'zz-verificacion@example.com',
  'ZZ-clave-que-nunca-sale',
  false,
  'ZZ Gestiona',
  'zz-verificacion@example.com',
  current_setting('gestiona.fixture_user')::uuid
);

DO $catalog_contract$
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.merchant_smtp_connections'::regclass) THEN
    RAISE EXCEPTION 'merchant_smtp_connections no tiene RLS';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'merchant_smtp_connections'
  ) THEN
    RAISE EXCEPTION 'La tabla privada tiene una policy de navegador';
  END IF;
  IF has_table_privilege('anon', 'public.merchant_smtp_connections', 'SELECT')
     OR has_table_privilege('authenticated', 'public.merchant_smtp_connections', 'SELECT') THEN
    RAISE EXCEPTION 'La tabla privada concede SELECT al navegador';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'merchant_smtp_connection_status'
      AND column_name = 'password'
  ) THEN
    RAISE EXCEPTION 'La vista saneada expone la contraseña';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'settings'
      AND column_name LIKE 'smtp_%'
  ) THEN
    RAISE EXCEPTION 'settings todavía contiene columnas SMTP';
  END IF;
END;
$catalog_contract$;

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', current_setting('gestiona.fixture_user'),
    'role', 'authenticated'
  )::text,
  true
);

DO $member_contract$
DECLARE
  v_blocked boolean := false;
BEGIN
  IF (SELECT count(*) FROM public.merchant_smtp_connection_status
      WHERE org_id = current_setting('gestiona.fixture_org')::uuid
        AND host = 'smtp.zz-verificacion.example') <> 1 THEN
    RAISE EXCEPTION 'El miembro no ve el estado saneado de su conexión';
  END IF;

  BEGIN
    PERFORM password FROM public.merchant_smtp_connections
    WHERE org_id = current_setting('gestiona.fixture_org')::uuid;
  EXCEPTION WHEN insufficient_privilege THEN
    v_blocked := true;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'El miembro leyó la credencial SMTP cruda';
  END IF;
END;
$member_contract$;

SELECT set_config(
  'request.jwt.claims',
  json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text,
  true
);

DO $outsider_contract$
BEGIN
  IF (SELECT count(*) FROM public.merchant_smtp_connection_status
      WHERE org_id = current_setting('gestiona.fixture_org')::uuid) <> 0 THEN
    RAISE EXCEPTION 'Un outsider vio el estado SMTP de otro tenant';
  END IF;
END;
$outsider_contract$;

RESET ROLE;
ROLLBACK;

SELECT
  'merchant_smtp_private' AS check_name,
  (SELECT count(*) FROM public.merchant_smtp_connections) AS conexiones_reales,
  (SELECT count(*) FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'settings'
     AND column_name LIKE 'smtp_%') AS columnas_smtp_en_settings,
  (SELECT count(*) FROM supabase_migrations.schema_migrations) AS migraciones,
  0 AS restos;
