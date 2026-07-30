-- ============================================================================
-- Migración suelta: 20260731000003_platform_staff_reads.sql
--
-- Va aparte porque el bundle 01 ya se aplicó. Pegar esto en el SQL Editor.
-- Requiere que 01 esté aplicado (usa `has_platform_role`, que crea 026).
--
-- Arregla que el panel de plataforma reportaba el MRR y los conteos de una sola
-- organización como si fueran de toda la plataforma.
-- ============================================================================

BEGIN;

DROP POLICY IF EXISTS "platform_staff_read_subscriptions" ON public.subscriptions;
CREATE POLICY "platform_staff_read_subscriptions" ON public.subscriptions
  FOR SELECT TO authenticated
  USING (public.has_platform_role(ARRAY['support', 'finance']));

DROP POLICY IF EXISTS "platform_staff_read_memberships" ON public.memberships;
CREATE POLICY "platform_staff_read_memberships" ON public.memberships
  FOR SELECT TO authenticated
  USING (public.has_platform_role(ARRAY['support', 'finance']));

COMMENT ON POLICY "platform_staff_read_subscriptions" ON public.subscriptions IS
  'Staff de plataforma: sólo lectura. Los cambios de plan van por platform-admin-action, que audita.';
COMMENT ON POLICY "platform_staff_read_memberships" ON public.memberships IS
  'Staff de plataforma: sólo lectura. Alta/baja de miembros va por platform-admin-action, que audita.';

DO $registro$
BEGIN
  INSERT INTO supabase_migrations.schema_migrations (version)
  SELECT '20260731000003'
  WHERE NOT EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20260731000003'
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'No se pudo registrar en schema_migrations (%). El esquema SI quedo aplicado.', SQLERRM;
END
$registro$;

COMMIT;

-- ── Verificación ────────────────────────────────────────────────────────────
-- Esperado: las dos en true. Si alguna da false, la política no se creó.
SELECT
  EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
          AND tablename='subscriptions' AND policyname='platform_staff_read_subscriptions') AS subs_ok,
  EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
          AND tablename='memberships'  AND policyname='platform_staff_read_memberships')  AS mems_ok;

-- Y el chequeo que importa: cuántas suscripciones y membresías ve tu usuario.
-- Si sos staff de plataforma, esto tiene que devolver TODAS las de la
-- plataforma, no sólo las de tu organización.
SELECT
  (SELECT count(*) FROM public.organizations) AS orgs_visibles,
  (SELECT count(*) FROM public.subscriptions) AS suscripciones_visibles,
  (SELECT count(*) FROM public.memberships)   AS membresias_visibles;
