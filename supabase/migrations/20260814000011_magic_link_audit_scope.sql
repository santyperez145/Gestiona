-- D6 / F8: conservar el alcance del magic link en el momento de emitirlo.
--
-- La primera proyección de `organization_support_accesses` podía derivar el
-- tenant desde la membresía actual del destinatario. Eso deja de servir cuando
-- un miembro se va: el dueño perdería justamente el registro histórico que
-- necesita auditar. Desde esta migración el Edge Function guarda una fila por
-- organización alcanzada en `target_org_id`; las filas antiguas sin alcance
-- siguen apareciendo mientras la membresía exista.

CREATE OR REPLACE VIEW public.organization_support_accesses
WITH (security_invoker = false, security_barrier = true) AS
SELECT
  scoped_org.org_id,
  audit.id,
  audit.created_at,
  audit.admin_email AS staff_email,
  'magic_link_generated'::text AS event
FROM public.admin_audit_logs AS audit
JOIN LATERAL (
  SELECT audit.target_org_id AS org_id
  WHERE audit.target_org_id IS NOT NULL

  UNION

  SELECT membership.org_id
  FROM public.memberships AS membership
  WHERE audit.target_org_id IS NULL
    AND membership.user_id = audit.target_user_id
) AS scoped_org ON true
WHERE audit.action = 'generateMagicLink'
  AND EXISTS (
    SELECT 1
    FROM public.memberships AS viewer_membership
    WHERE viewer_membership.org_id = scoped_org.org_id
      AND viewer_membership.user_id = auth.uid()
      AND viewer_membership.role = 'owner'
  );

REVOKE ALL ON public.organization_support_accesses FROM PUBLIC;
REVOKE ALL ON public.organization_support_accesses FROM anon;
REVOKE ALL ON public.organization_support_accesses FROM authenticated;
GRANT SELECT ON public.organization_support_accesses TO authenticated;

COMMENT ON VIEW public.organization_support_accesses IS
  'Registro mínimo para dueños de magic links de soporte. Las nuevas filas usan target_org_id como alcance histórico; las anteriores sin alcance se derivan de la membresía actual. No expone enlaces, destinatarios ni details.';

-- La prueba usa un destinatario sin membresía: sólo puede aparecer para el
-- dueño por el alcance congelado en `target_org_id`, que es la propiedad que
-- evita borrar la historia al remover a un miembro. Todo se borra al terminar.
DO $verificar$
DECLARE
  v_staff_user uuid;
  v_owner_user uuid;
  v_org_id uuid;
  v_audit_id uuid := gen_random_uuid();
  v_visible integer;
BEGIN
  SELECT user_id INTO v_staff_user
  FROM public.platform_admins
  ORDER BY granted_at
  LIMIT 1;

  SELECT org_id, user_id INTO v_org_id, v_owner_user
  FROM public.memberships
  WHERE role = 'owner'
  ORDER BY created_at
  LIMIT 1;

  IF v_staff_user IS NULL OR v_owner_user IS NULL OR v_org_id IS NULL THEN
    RAISE EXCEPTION 'Falta staff de plataforma o dueño para verificar el alcance de magic links';
  END IF;

  INSERT INTO public.admin_audit_logs (
    id, admin_user_id, admin_email, action, target_org_id, target_user_id, details
  ) VALUES (
    v_audit_id,
    v_staff_user,
    'zz-soporte-historico@example.invalid',
    'generateMagicLink',
    v_org_id,
    gen_random_uuid(),
    jsonb_build_object('action_link', 'never-expose')
  );

  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', gen_random_uuid()::text, 'role', 'authenticated')::text,
    true
  );
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_visible
  FROM public.organization_support_accesses
  WHERE id = v_audit_id;
  EXECUTE 'RESET ROLE';

  IF v_visible <> 0 THEN
    RAISE EXCEPTION 'El alcance histórico del magic link se expuso a un usuario ajeno';
  END IF;

  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', v_owner_user::text, 'role', 'authenticated')::text,
    true
  );
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_visible
  FROM public.organization_support_accesses
  WHERE id = v_audit_id
    AND org_id = v_org_id
    AND staff_email = 'zz-soporte-historico@example.invalid'
    AND event = 'magic_link_generated';
  EXECUTE 'RESET ROLE';

  IF v_visible <> 1 THEN
    RAISE EXCEPTION 'El dueño no pudo ver el alcance histórico del magic link';
  END IF;

  DELETE FROM public.admin_audit_logs WHERE id = v_audit_id;

  IF EXISTS (SELECT 1 FROM public.admin_audit_logs WHERE id = v_audit_id) THEN
    RAISE EXCEPTION 'Quedó un log temporal ZZ al verificar magic_link_audit_scope';
  END IF;
END;
$verificar$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260814000011', 'magic_link_audit_scope') ON CONFLICT DO NOTHING;
