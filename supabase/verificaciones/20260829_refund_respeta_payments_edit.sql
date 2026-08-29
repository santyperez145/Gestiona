-- Verificación destructiva-cero de la política funcional de reintegros.
-- No crea un RMA, no llama la Edge Function y nunca contacta a Mercado Pago:
-- comprueba la misma autoridad `has_permission` que la Edge evalúa antes de
-- tocar la service role o el proveedor.
--
-- Ejecutar con:
--   npx supabase db query --linked --file supabase/verificaciones/20260829_refund_respeta_payments_edit.sql

DO $verification$
DECLARE
  v_user uuid;
  v_org uuid := gen_random_uuid();
  v_other_org uuid := gen_random_uuid();
  v_suffix text := substr(gen_random_uuid()::text, 1, 8);
  v_allowed boolean;
  v_restos integer;
BEGIN
  SELECT user_account.id INTO v_user
  FROM auth.users user_account
  ORDER BY user_account.created_at
  LIMIT 1;
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'La verificación necesita un usuario existente';
  END IF;

  BEGIN
    INSERT INTO public.organizations(id, name, slug, owner_user_id)
    VALUES
      (v_org, 'ZZ Refund configurable', 'zz-refund-' || v_suffix, v_user),
      (v_other_org, 'ZZ Refund ajeno', 'zz-refund-ajeno-' || v_suffix, v_user);
    INSERT INTO public.memberships(org_id, user_id, role)
    VALUES (v_org, v_user, 'vendedor');

    -- Fija la matriz de la fixture incluso si cambian los defaults de alta.
    INSERT INTO public.role_permissions(
      org_id, role, module, can_view, can_create, can_edit, can_delete, can_export
    ) VALUES (v_org, 'vendedor', 'payments', true, false, false, false, false)
    ON CONFLICT (org_id, role, module) DO UPDATE SET can_edit = false;

    PERFORM set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', v_user, 'role', 'authenticated')::text,
      true
    );

    -- Ser miembro no basta: payments.edit desmarcado deniega.
    EXECUTE 'SET LOCAL ROLE authenticated';
    v_allowed := public.has_permission(v_org, 'payments', 'edit');
    EXECUTE 'RESET ROLE';
    IF v_allowed THEN
      RAISE EXCEPTION 'Un vendedor sin payments.edit quedó autorizado';
    END IF;

    -- La organización habilita el permiso: la misma persona queda autorizada.
    UPDATE public.role_permissions
    SET can_edit = true
    WHERE org_id = v_org AND role = 'vendedor' AND module = 'payments';

    EXECUTE 'SET LOCAL ROLE authenticated';
    v_allowed := public.has_permission(v_org, 'payments', 'edit');
    EXECUTE 'RESET ROLE';
    IF NOT v_allowed THEN
      RAISE EXCEPTION 'payments.edit no habilitó al vendedor';
    END IF;

    -- La matriz también puede revocar a un administrador. Una lista fija de
    -- roles fallaría esta mitad aunque pasara la anterior.
    UPDATE public.memberships
    SET role = 'admin'
    WHERE org_id = v_org AND user_id = v_user;
    INSERT INTO public.role_permissions(
      org_id, role, module, can_view, can_create, can_edit, can_delete, can_export
    ) VALUES (v_org, 'admin', 'payments', true, true, false, false, false)
    ON CONFLICT (org_id, role, module) DO UPDATE SET can_edit = false;

    EXECUTE 'SET LOCAL ROLE authenticated';
    v_allowed := public.has_permission(v_org, 'payments', 'edit');
    EXECUTE 'RESET ROLE';
    IF v_allowed THEN
      RAISE EXCEPTION 'Un administrador con payments.edit revocado quedó autorizado';
    END IF;

    -- El permiso de una organización nunca cruza a otra.
    EXECUTE 'SET LOCAL ROLE authenticated';
    v_allowed := public.has_permission(v_other_org, 'payments', 'edit');
    EXECUTE 'RESET ROLE';
    IF v_allowed THEN
      RAISE EXCEPTION 'payments.edit cruzó de una organización a otra';
    END IF;

    RAISE EXCEPTION USING ERRCODE = 'ZX001', MESSAGE = 'rollback verification data';
  EXCEPTION WHEN SQLSTATE 'ZX001' THEN
    NULL;
  END;

  SELECT
    (SELECT count(*) FROM public.organizations WHERE id IN (v_org, v_other_org))
    + (SELECT count(*) FROM public.memberships WHERE org_id IN (v_org, v_other_org))
    + (SELECT count(*) FROM public.role_permissions WHERE org_id IN (v_org, v_other_org))
  INTO v_restos;
  IF v_restos <> 0 THEN
    RAISE EXCEPTION 'La verificación de reintegros dejó % restos', v_restos;
  END IF;

  RAISE NOTICE 'Refund verificado: vendedor denegado, payments.edit habilita, revocación admin respetada, cross-tenant bloqueado, restos=0';
END;
$verification$;
