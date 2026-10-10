-- Progreso de tutoriales. Datos ZZ; ROLLBACK.
BEGIN;
CREATE TEMP TABLE zz_tut_ctx(a uuid, b uuid);
INSERT INTO zz_tut_ctx SELECT (SELECT id FROM auth.users ORDER BY created_at LIMIT 1), (SELECT id FROM auth.users ORDER BY created_at OFFSET 1 LIMIT 1);
GRANT SELECT ON zz_tut_ctx TO authenticated;
SET LOCAL ROLE authenticated;
DO $$
DECLARE c record; v_denied boolean := false;
BEGIN
  SELECT * INTO c FROM zz_tut_ctx;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', c.a, 'role', 'authenticated')::text, true);
  INSERT INTO public.tutorial_progress(tutorial_id, estado) VALUES ('zz.caja', 'completado')
    ON CONFLICT (user_id, tutorial_id) DO UPDATE SET estado = EXCLUDED.estado, updated_at = now();
  ASSERT (SELECT count(*) FROM public.tutorial_progress WHERE tutorial_id = 'zz.caja') = 1, 'No guardó el progreso propio';

  BEGIN INSERT INTO public.tutorial_progress(user_id, tutorial_id, estado) VALUES (c.b, 'zz.ajeno', 'completado');
  EXCEPTION WHEN insufficient_privilege THEN v_denied := true; END;
  ASSERT v_denied, 'Escribió progreso de otro usuario';

  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', c.b, 'role', 'authenticated')::text, true);
  ASSERT (SELECT count(*) FROM public.tutorial_progress WHERE tutorial_id = 'zz.caja') = 0, 'Vio el progreso de otro usuario';
END;
$$;
RESET ROLE;
SELECT 'progreso_tutoriales OK' AS resultado;
ROLLBACK;
