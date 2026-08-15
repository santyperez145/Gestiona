-- D8a — respaldo gestionado por organización, privado y verificable.
--
-- El export portátil conserva el derecho de acceso; este registro guarda la
-- evidencia de snapshots completos que la Edge Function deja en el bucket
-- privado. La tabla nunca entrega la ruta ni el hash al navegador: la función
-- verifica owner, firma la descarga y prueba integridad antes de reportarla.
-- No implementa una restauración destructiva en producción: ésa sólo se marca
-- completa cuando haya un drill de restore aislado, no una promesa de UI.

CREATE TABLE IF NOT EXISTS public.organization_backup_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  trigger text NOT NULL CHECK (trigger IN ('manual', 'scheduled')),
  status text NOT NULL CHECK (status IN ('processing', 'completed', 'failed')),
  storage_path text,
  snapshot_schema_version integer NOT NULL DEFAULT 1 CHECK (snapshot_schema_version > 0),
  checksum_sha256 text CHECK (checksum_sha256 IS NULL OR checksum_sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes bigint CHECK (size_bytes IS NULL OR size_bytes >= 0),
  table_count integer NOT NULL DEFAULT 0 CHECK (table_count >= 0),
  total_rows bigint NOT NULL DEFAULT 0 CHECK (total_rows >= 0),
  manifest jsonb NOT NULL DEFAULT '{}'::jsonb,
  failure_reason text,
  last_verified_at timestamptz,
  last_verification_status text CHECK (last_verification_status IS NULL OR last_verification_status IN ('passed', 'failed')),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '56 days',
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organization_backup_completed_file CHECK (
    status <> 'completed' OR (storage_path IS NOT NULL AND checksum_sha256 IS NOT NULL AND size_bytes IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS organization_backup_snapshots_org_created_idx
  ON public.organization_backup_snapshots (org_id, created_at DESC);

ALTER TABLE public.organization_backup_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners can read their organization backup history" ON public.organization_backup_snapshots;
CREATE POLICY "Owners can read their organization backup history"
ON public.organization_backup_snapshots FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.memberships m
    WHERE m.org_id = organization_backup_snapshots.org_id
      AND m.user_id = auth.uid()
      AND m.role = 'owner'
  )
);

-- Sólo la Edge Function con service_role escribe estados, rutas y hashes.
REVOKE ALL ON TABLE public.organization_backup_snapshots FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.organization_backup_snapshots TO authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.organization_backup_snapshots FROM authenticated;

-- La programación sólo nace si el secreto ya está en Vault. El secreto no se
-- mete en SQL ni en el navegador: se carga también como BACKUP_CRON_SECRET de
-- la Edge Function y el helper lo envía como header privado.
DO $cron$
DECLARE
  v_job record;
  v_secret_configured boolean;
BEGIN
  IF to_regprocedure('public.invoke_edge_function_with_secret(text,text,text)') IS NULL THEN
    RAISE NOTICE 'weekly-org-backups no se programa: falta invoke_edge_function_with_secret';
    RETURN;
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM vault.decrypted_secrets WHERE name = 'BACKUP_CRON_SECRET'
  ) INTO v_secret_configured;

  FOR v_job IN SELECT jobid FROM cron.job WHERE jobname = 'weekly-org-backups' LOOP
    PERFORM cron.unschedule(v_job.jobid);
  END LOOP;

  IF NOT v_secret_configured THEN
    RAISE NOTICE 'weekly-org-backups no se programa: falta BACKUP_CRON_SECRET en Vault';
    RETURN;
  END IF;

  PERFORM cron.schedule(
    'weekly-org-backups',
    '30 3 * * 0',
    $$SELECT public.invoke_edge_function_with_secret('weekly-backup', 'BACKUP_CRON_SECRET', 'x-backup-cron-secret');$$
  );
END
$cron$;

CREATE TEMP TABLE IF NOT EXISTS zz_organization_backup_verification (
  check_name text PRIMARY KEY,
  passed boolean NOT NULL,
  detail text NOT NULL
);
TRUNCATE zz_organization_backup_verification;

DO $verify$
DECLARE
  v_suffix text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
  v_owner uuid;
  v_org uuid;
  v_snapshot uuid;
  v_owner_reads integer;
  v_stranger_reads integer;
  v_anon_denied boolean := false;
  v_anon_select boolean;
  v_authenticated_insert boolean;
  v_restos integer;
BEGIN
  SELECT id INTO v_owner FROM auth.users ORDER BY created_at LIMIT 1;
  IF v_owner IS NULL THEN
    RAISE NOTICE 'Organization backup verification omitted: no auth user exists';
    RETURN;
  END IF;

  INSERT INTO public.organizations (name, slug, owner_user_id)
  VALUES ('ZZ backup organización ' || v_suffix, 'zz-org-backup-' || v_suffix, v_owner)
  RETURNING id INTO v_org;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_owner, 'owner');
  INSERT INTO public.organization_backup_snapshots (
    org_id, created_by, trigger, status, storage_path, snapshot_schema_version,
    checksum_sha256, size_bytes, table_count, total_rows, manifest, completed_at
  ) VALUES (
    v_org, v_owner, 'manual', 'completed', 'org/' || v_org::text || '/ZZ.json', 1,
    repeat('a', 64), 42, 3, 7, '{"tables":[]}'::jsonb, now()
  ) RETURNING id INTO v_snapshot;

  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_owner::text, 'role', 'authenticated'
  )::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_owner_reads FROM public.organization_backup_snapshots WHERE org_id = v_org;
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated'
  )::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_stranger_reads FROM public.organization_backup_snapshots WHERE org_id = v_org;
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claims', json_build_object(
    'role', 'anon'
  )::text, true);
  EXECUTE 'SET LOCAL ROLE anon';
  BEGIN
    PERFORM 1 FROM public.organization_backup_snapshots WHERE org_id = v_org;
  EXCEPTION WHEN insufficient_privilege THEN
    v_anon_denied := true;
  END;
  EXECUTE 'RESET ROLE';

  SELECT has_table_privilege('anon', 'public.organization_backup_snapshots', 'SELECT')
    INTO v_anon_select;
  SELECT has_table_privilege('authenticated', 'public.organization_backup_snapshots', 'INSERT')
    INTO v_authenticated_insert;

  IF v_owner_reads <> 1 OR v_stranger_reads <> 0 OR NOT v_anon_denied
     OR v_anon_select OR v_authenticated_insert THEN
    RAISE EXCEPTION 'RLS backup inválida: owner %, ajeno %, anon denied %, anon select %, auth insert %',
      v_owner_reads, v_stranger_reads, v_anon_denied, v_anon_select, v_authenticated_insert;
  END IF;

  DELETE FROM public.organizations WHERE id = v_org;
  SELECT count(*) INTO v_restos FROM public.organization_backup_snapshots WHERE id = v_snapshot;
  IF v_restos <> 0 THEN
    RAISE EXCEPTION 'D8 dejó % snapshots ZZ', v_restos;
  END IF;

  INSERT INTO zz_organization_backup_verification VALUES
    ('rls_owner', true, 'sólo el owner lee su historial; ajeno ve cero y anon queda sin permiso'),
    ('write_authority', true, 'anon no selecciona y authenticated no inserta snapshots'),
    ('zz_restos', true, 'el cascade de la organización limpia el snapshot temporal');
END
$verify$;

SELECT check_name, passed, detail
FROM zz_organization_backup_verification
ORDER BY check_name;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260815000008', 'organization_managed_backups') ON CONFLICT DO NOTHING;
