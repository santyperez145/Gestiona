-- Simulacro de 20261015000600 (concatenar después de la migración sin
-- BEGIN/COMMIT; termina en ROLLBACK).
--   1. El staff de plataforma ve el estado (sin clave ni ticket).
--   2. Un usuario común no ve nada.
--   3. Un pedido escrito en claro queda cifrado por la base.
--   4. Vistas abiertas y funciones expuestas siguen en cero.
DO $$
DECLARE v_admin uuid; v_comun uuid; n int; v_clave text;
BEGIN
  SELECT user_id INTO v_admin FROM public.platform_admins LIMIT 1;
  SELECT id INTO v_comun FROM auth.users WHERE id NOT IN (SELECT user_id FROM public.platform_admins) LIMIT 1;
  UPDATE public.afip_platform_credentials SET pedido_clave = '-----BEGIN PRIVATE KEY-----ZZ', pedido_csr = '-----BEGIN CERTIFICATE REQUEST-----ZZ', pedido_ambiente = 'produccion', pedido_creado_at = now() WHERE id = true;
  SELECT pedido_clave INTO v_clave FROM public.afip_platform_credentials WHERE id = true;
  IF v_clave NOT LIKE 'nerqia:v1:%' THEN RAISE EXCEPTION 'FALLA 3: el pedido quedó en claro'; END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.afip_platform_status WHERE pedido_pendiente AND pedido_csr LIKE '-----BEGIN CERTIFICATE REQUEST%';
  RESET ROLE;
  IF n <> 1 THEN RAISE EXCEPTION 'FALLA 1: el staff no ve el estado (% filas)', n; END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_comun, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.afip_platform_status;
  RESET ROLE;
  IF n <> 0 THEN RAISE EXCEPTION 'FALLA 2: un usuario común ve % filas', n; END IF;
  IF (SELECT count(*) FROM public.audit_vistas_abiertas) <> 0 OR (SELECT count(*) FROM public.audit_funciones_expuestas) <> 0 THEN
    RAISE EXCEPTION 'FALLA 4: auditoría de seguridad no está en cero';
  END IF;
  RAISE EXCEPTION 'OK 1-4';
END $$;

ROLLBACK;
