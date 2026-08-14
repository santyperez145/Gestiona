-- D6 / F8: transparencia sobre accesos de soporte a una organización.
--
-- `generateMagicLink` se audita en `admin_audit_logs`, pero hasta ahora sólo
-- podía leerlo el staff de plataforma. Los magic links históricos se guardaron
-- contra el usuario destino (no contra la organización), así que la vista
-- deriva la organización desde su membresía actual y deja ver el evento sólo a
-- sus dueños.
--
-- Es una proyección deliberadamente mínima: no expone el enlace de un solo
-- uso, el correo/ID de la persona destinataria ni `details`, que puede contener
-- metadatos internos. La generación del enlace demuestra que soporte habilitó
-- ese acceso; no pretende afirmar que el enlace fue abierto.

CREATE OR REPLACE VIEW public.organization_support_accesses
WITH (security_invoker = false, security_barrier = true) AS
SELECT
  target_membership.org_id,
  audit.id,
  audit.created_at,
  audit.admin_email AS staff_email,
  'magic_link_generated'::text AS event
FROM public.admin_audit_logs AS audit
JOIN public.memberships AS target_membership
  ON target_membership.user_id = audit.target_user_id
WHERE audit.action = 'generateMagicLink'
  AND EXISTS (
    SELECT 1
    FROM public.memberships AS viewer_membership
    WHERE viewer_membership.org_id = target_membership.org_id
      AND viewer_membership.user_id = auth.uid()
      AND viewer_membership.role = 'owner'
  );

REVOKE ALL ON public.organization_support_accesses FROM PUBLIC;
REVOKE ALL ON public.organization_support_accesses FROM anon;
REVOKE ALL ON public.organization_support_accesses FROM authenticated;
GRANT SELECT ON public.organization_support_accesses TO authenticated;

COMMENT ON VIEW public.organization_support_accesses IS
  'Registro mínimo para dueños: generación de magic links de soporte hacia miembros de su organización. No expone enlaces, destinatarios ni details; generar no prueba que el enlace haya sido abierto.';

-- Verificación con un único evento ZZ transaccional. Prueba que un usuario
-- ajeno no recibe la fila, que el dueño sí la ve y que ninguna columna sensible
-- llegó a la proyección. El log temporal se borra antes de confirmar.
DO $verificar$
DECLARE
  v_staff_user uuid;
  v_owner_user uuid;
  v_org_id uuid;
  v_audit_id uuid := gen_random_uuid();
  v_visible integer;
  v_columns integer;
  v_anon_can_select boolean;
  v_authenticated_can_select boolean;
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
    RAISE EXCEPTION 'Falta staff de plataforma o dueño para verificar organization_support_accesses';
  END IF;

  INSERT INTO public.admin_audit_logs (
    id, admin_user_id, admin_email, action, target_user_id, details
  ) VALUES (
    v_audit_id,
    v_staff_user,
    'zz-soporte-auditoria@example.invalid',
    'generateMagicLink',
    v_owner_user,
    jsonb_build_object('email', 'zz-destinatario@example.invalid', 'action_link', 'never-expose')
  );

  SELECT count(*) INTO v_columns
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'organization_support_accesses';

  IF v_columns <> 5 OR EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'organization_support_accesses'
      AND column_name IN ('target_user_id', 'details', 'action_link', 'admin_user_id')
  ) THEN
    RAISE EXCEPTION 'organization_support_accesses expone columnas fuera del contrato mínimo';
  END IF;

  SELECT has_table_privilege('anon', 'public.organization_support_accesses', 'SELECT')
  INTO v_anon_can_select;
  SELECT has_table_privilege('authenticated', 'public.organization_support_accesses', 'SELECT')
  INTO v_authenticated_can_select;

  IF v_anon_can_select OR NOT v_authenticated_can_select THEN
    RAISE EXCEPTION 'ACL incorrecta en organization_support_accesses';
  END IF;

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
    RAISE EXCEPTION 'organization_support_accesses expuso un acceso de soporte a un usuario ajeno';
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
    AND staff_email = 'zz-soporte-auditoria@example.invalid'
    AND event = 'magic_link_generated';
  EXECUTE 'RESET ROLE';

  IF v_visible <> 1 THEN
    RAISE EXCEPTION 'El dueño no pudo ver exactamente su acceso de soporte temporal';
  END IF;

  DELETE FROM public.admin_audit_logs WHERE id = v_audit_id;

  IF EXISTS (SELECT 1 FROM public.admin_audit_logs WHERE id = v_audit_id) THEN
    RAISE EXCEPTION 'Quedó un log temporal ZZ al verificar organization_support_accesses';
  END IF;
END;
$verificar$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260814000010', 'organization_support_accesses') ON CONFLICT DO NOTHING;
