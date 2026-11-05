-- El staff de plataforma opera con segundo factor (2026-11-05).
--
-- El staff ve y opera sobre todos los comercios. El panel le pedía el código
-- de su app (MfaGate), pero la base no: con la contraseña sola, una sesión
-- AAL1 llamaba a la API y pasaba is_platform_admin / has_platform_role, que
-- usan 127 políticas y funciones. Una contraseña filtrada abría todo.
--
-- Ahora, cuando se pregunta por el usuario de la sesión, una sesión que dice
-- explícitamente aal1 no cuenta como staff. No cambian:
--   · las llamadas de servidor (sin JWT de usuario: crons, service role);
--   · las consultas sobre OTRO usuario (p. ej. «¿este destinatario es staff?»).
-- Las funciones edge que verifican el rol con la llave de servicio hacen el
-- mismo chequeo con el token (_shared/staffConSegundoFactor.ts). El panel deja
-- de ofrecer «recordar este dispositivo» al staff de plataforma.
BEGIN;

CREATE OR REPLACE FUNCTION public.sesion_sin_segundo_factor()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'aal', '') = 'aal1';
$$;

COMMENT ON FUNCTION public.sesion_sin_segundo_factor() IS
  'true si la sesión del request se autenticó sólo con contraseña (aal1). Sin JWT de usuario: false.';

REVOKE ALL ON FUNCTION public.sesion_sin_segundo_factor() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sesion_sin_segundo_factor() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.is_platform_admin(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = _user_id)
     AND NOT (_user_id IS NOT DISTINCT FROM auth.uid() AND public.sesion_sin_segundo_factor())
$$;

CREATE OR REPLACE FUNCTION public.has_platform_role(_roles text[], _user_id uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.platform_admins
    WHERE user_id = _user_id
      AND (role = 'superadmin' OR role = ANY(_roles))
  )
  AND NOT (_user_id IS NOT DISTINCT FROM auth.uid() AND public.sesion_sin_segundo_factor())
$$;

UPDATE public.security_function_contracts sfc
   SET definition_hash = md5(pg_get_functiondef(p.oid)), reviewed_on = DATE '2026-11-05'
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN ('is_platform_admin', 'has_platform_role')
   AND sfc.function_name = p.proname
   AND sfc.identity_arguments = pg_get_function_identity_arguments(p.oid);

COMMIT;
