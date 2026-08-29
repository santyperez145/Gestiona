-- Verificación RLS contra la base real. Usa un miembro existente, crea sólo
-- una fila ZZ del catálogo de Storage y la elimina dentro de la transacción.
-- No sube bytes ni toca un gasto.
--
-- Ejecutar con:
--   npx supabase db query --linked --file supabase/verificaciones/20260829_comprobantes_privados.sql

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
SELECT set_config('gestiona.fixture_object', gen_random_uuid()::text, true);
SELECT set_config(
  'gestiona.fixture_path',
  format(
    '%s/%s/%s.pdf',
    current_setting('gestiona.fixture_org'),
    current_setting('gestiona.fixture_user'),
    current_setting('gestiona.fixture_object')
  ),
  true
);

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', current_setting('gestiona.fixture_user'),
    'role', 'authenticated'
  )::text,
  true
);

-- El camino real de upload entra con permiso create y path org/actor/uuid.
INSERT INTO storage.objects(id, bucket_id, name, owner, owner_id, metadata)
VALUES (
  current_setting('gestiona.fixture_object')::uuid,
  'expense-receipts',
  current_setting('gestiona.fixture_path'),
  auth.uid(),
  auth.uid()::text,
  '{"mimetype":"application/pdf","size":1,"zz_fixture":true}'::jsonb
);

DO $member_can_read$
BEGIN
  IF (SELECT count(*) FROM storage.objects
      WHERE id = current_setting('gestiona.fixture_object')::uuid) <> 1 THEN
    RAISE EXCEPTION 'El miembro no puede leer su comprobante';
  END IF;
END;
$member_can_read$;

-- Un path cuyo segundo segmento no es el actor queda bloqueado aunque use el
-- org correcto y el usuario tenga permiso create.
DO $wrong_actor_is_blocked$
DECLARE
  v_blocked boolean := false;
BEGIN
  BEGIN
    INSERT INTO storage.objects(bucket_id, name, owner, owner_id, metadata)
    VALUES (
      'expense-receipts',
      format(
        '%s/%s/%s.pdf',
        current_setting('gestiona.fixture_org'),
        gen_random_uuid(),
        gen_random_uuid()
      ),
      auth.uid(),
      auth.uid()::text,
      '{"zz_fixture":true}'::jsonb
    );
  EXCEPTION WHEN insufficient_privilege THEN
    v_blocked := true;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'Un miembro escribió en la carpeta de otro actor';
  END IF;
END;
$wrong_actor_is_blocked$;

-- Cambiar sólo el JWT simula otro usuario real bajo el rol authenticated. RLS
-- no debe confundir saber el path con tener acceso al tenant.
SELECT set_config(
  'request.jwt.claims',
  json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text,
  true
);

DO $outsider_cannot_read$
BEGIN
  IF (SELECT count(*) FROM storage.objects
      WHERE id = current_setting('gestiona.fixture_object')::uuid) <> 0 THEN
    RAISE EXCEPTION 'Un outsider leyó el comprobante conociendo el path';
  END IF;
END;
$outsider_cannot_read$;

-- No se borra directamente del catálogo: `storage.protect_delete()` lo
-- prohíbe correctamente porque un DELETE SQL dejaría bytes huérfanos. La UI
-- usa Storage API, que sí evalúa nuestra policy DELETE y retira ambas partes.
ROLLBACK;

SELECT
  'expense_receipts_private' AS check_name,
  (SELECT public = false FROM storage.buckets WHERE id = 'expense-receipts') AS private_bucket,
  (SELECT count(*) FROM storage.objects
   WHERE metadata ->> 'zz_fixture' = 'true') AS restos;
