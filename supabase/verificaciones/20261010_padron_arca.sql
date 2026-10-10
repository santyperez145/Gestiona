-- Padrón de ARCA: tablas sólo para el servicio. ROLLBACK.
BEGIN;
SET LOCAL ROLE authenticated;
DO $$
DECLARE v int := 0;
BEGIN
  BEGIN PERFORM 1 FROM public.afip_ta_servicios; EXCEPTION WHEN insufficient_privilege THEN v := v + 1; END;
  BEGIN PERFORM 1 FROM public.arca_padron_cache; EXCEPTION WHEN insufficient_privilege THEN v := v + 1; END;
  BEGIN PERFORM 1 FROM public.arca_padron_consultas; EXCEPTION WHEN insufficient_privilege THEN v := v + 1; END;
  ASSERT v = 3, 'El navegador accede a tablas del padrón: ' || v;
END;
$$;
RESET ROLE;
SELECT 'padron_arca OK' AS resultado;
ROLLBACK;
