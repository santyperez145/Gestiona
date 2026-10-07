-- Compatibility alias, not a second identity/membership authority.
-- The hosted legacy view used definer privileges and browser write grants.
BEGIN;

CREATE OR REPLACE VIEW public.org_members WITH (security_invoker = true) AS
  SELECT id, org_id, user_id, role, joined_at, invited_by FROM public.memberships;

REVOKE ALL ON public.org_members FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.org_members TO authenticated, service_role;
COMMENT ON VIEW public.org_members IS
  'Read-only compatibility alias. Memberships is canonical; invoker RLS applies.';

DO $guard$
BEGIN
  ASSERT NOT has_table_privilege('anon','public.org_members','SELECT');
  ASSERT NOT has_table_privilege('authenticated','public.org_members','INSERT');
  ASSERT NOT has_table_privilege('authenticated','public.org_members','UPDATE');
  ASSERT NOT has_table_privilege('authenticated','public.org_members','DELETE');
  ASSERT (SELECT 'security_invoker=true' = ANY (reloptions)
    FROM pg_class WHERE oid='public.org_members'::regclass);
  ASSERT (SELECT relrowsecurity FROM pg_class WHERE oid='public.memberships'::regclass);
END;
$guard$;

INSERT INTO supabase_migrations.schema_migrations(version, name)
VALUES ('20261007000000', 'legacy_membership_view_security') ON CONFLICT DO NOTHING;
NOTIFY pgrst, 'reload schema';
COMMIT;
