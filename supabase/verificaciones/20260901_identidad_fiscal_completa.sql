-- Conectar AFIP exige razón social y domicilio.
--
--   npm run db -- --file supabase/verificaciones/20260901_identidad_fiscal_completa.sql
--
-- Crea un comercio ZZ, habilita invoices.edit, y comprueba que vacío / sólo
-- espacios fallan y que con los dos datos sí escribe. Borra todo. Restos = 0.

DO $verification$
DECLARE
  v_user uuid;
  v_org uuid := gen_random_uuid();
  v_suffix text := substr(gen_random_uuid()::text, 1, 8);
  v_blocked boolean;
  v_result jsonb;
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
    VALUES (v_org, 'ZZ Identidad fiscal', 'zz-id-fiscal-' || v_suffix, v_user);
    INSERT INTO public.memberships(org_id, user_id, role)
    VALUES (v_org, v_user, 'vendedor');

    PERFORM set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', v_user, 'role', 'authenticated')::text,
      true
    );

    UPDATE public.role_permissions
    SET can_edit = true
    WHERE org_id = v_org AND role = 'vendedor' AND module = 'invoices';

    v_blocked := false;
    BEGIN
      PERFORM public.save_afip_config(
        v_org, '20123456786', 1, 'homologacion',
        'monotributo', 'ZZ Razón fiscal', ''
      );
    EXCEPTION WHEN OTHERS THEN
      v_blocked := position('domicilio fiscal' in SQLERRM) > 0;
      IF NOT v_blocked THEN RAISE; END IF;
    END;
    IF NOT v_blocked OR EXISTS (
      SELECT 1 FROM public.afip_credentials WHERE org_id = v_org
    ) THEN
      RAISE EXCEPTION 'save_afip_config aceptó domicilio vacío';
    END IF;

    v_blocked := false;
    BEGIN
      PERFORM public.save_afip_config(
        v_org, '20123456786', 1, 'homologacion',
        'monotributo', '   ', 'ZZ Domicilio fiscal'
      );
    EXCEPTION WHEN OTHERS THEN
      v_blocked := position('razón social' in SQLERRM) > 0;
      IF NOT v_blocked THEN RAISE; END IF;
    END;
    IF NOT v_blocked THEN
      RAISE EXCEPTION 'save_afip_config aceptó razón social vacía';
    END IF;

    v_result := public.save_afip_config(
      v_org, '20123456786', 1, 'homologacion',
      'monotributo', 'ZZ Razón fiscal', 'ZZ Domicilio fiscal'
    );
    IF v_result->>'ok' <> 'true' OR NOT EXISTS (
      SELECT 1 FROM public.afip_credentials
      WHERE org_id = v_org
        AND razon_social = 'ZZ Razón fiscal'
        AND domicilio = 'ZZ Domicilio fiscal'
    ) THEN
      RAISE EXCEPTION 'con los dos datos no guardó: %', v_result;
    END IF;

    RAISE EXCEPTION USING ERRCODE = 'ZX001', MESSAGE = 'rollback verification data';
  EXCEPTION WHEN SQLSTATE 'ZX001' THEN
    NULL;
  END;

  SELECT
    (SELECT count(*) FROM public.organizations WHERE id = v_org)
    + (SELECT count(*) FROM public.afip_credentials WHERE org_id = v_org)
    + (SELECT count(*) FROM public.audit_logs WHERE org_id = v_org)
  INTO v_restos;
  IF v_restos <> 0 THEN
    RAISE EXCEPTION 'La verificación de identidad fiscal dejó % restos', v_restos;
  END IF;

  RAISE NOTICE 'Identidad fiscal: domicilio vacío rechazado, razón vacía rechazada, ambos aceptados, restos=0';
END;
$verification$;
