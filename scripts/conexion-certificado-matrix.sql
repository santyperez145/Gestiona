-- Simulacro de 20261015000700 (concatenar después de la migración sin
-- BEGIN/COMMIT; termina en ROLLBACK).
--   1. Con el certificado rechazado, Exentry ve la conexión no lista y el motivo.
--   2. Con el certificado aceptado, vuelve al motivo de siempre (delegación).
--   3. Otro negocio no ve la fila de Exentry; auditoría en cero.
DO $$
DECLARE v_org uuid := '026eb5d8-d21a-4a2a-9e0b-83d60ba4c285'; v_owner uuid; v_otro uuid; r record; n int;
BEGIN
  SELECT owner_user_id INTO v_owner FROM public.organizations WHERE id = v_org;
  SELECT id INTO v_otro FROM auth.users WHERE id NOT IN (SELECT user_id FROM public.memberships WHERE org_id = v_org) LIMIT 1;
  UPDATE public.afip_platform_credentials SET verificado_ok = false WHERE id = true;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT configured, motivo, plataforma_lista, plataforma_verificada INTO r FROM public.afip_connection_status WHERE org_id = v_org;
  RESET ROLE;
  IF r.configured OR r.motivo <> 'plataforma_rechazada' OR r.plataforma_lista OR r.plataforma_verificada IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'FALLA 1: %', row_to_json(r);
  END IF;

  UPDATE public.afip_platform_credentials SET verificado_ok = true WHERE id = true;
  SET LOCAL ROLE authenticated;
  SELECT configured, motivo, plataforma_verificada INTO r FROM public.afip_connection_status WHERE org_id = v_org;
  RESET ROLE;
  IF NOT r.configured OR r.motivo = 'plataforma_rechazada' OR r.plataforma_verificada IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FALLA 2: %', row_to_json(r);
  END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_otro, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.afip_connection_status WHERE org_id = v_org;
  RESET ROLE;
  IF n <> 0 THEN RAISE EXCEPTION 'FALLA 3: otro negocio ve la conexión de Exentry'; END IF;
  IF (SELECT count(*) FROM public.audit_vistas_abiertas) <> 0 OR (SELECT count(*) FROM public.audit_funciones_expuestas) <> 0 THEN
    RAISE EXCEPTION 'FALLA 3: auditoría de seguridad no está en cero';
  END IF;
  RAISE EXCEPTION 'OK 1-3 (con aceptado: motivo %)', r.motivo;
END $$;

ROLLBACK;
