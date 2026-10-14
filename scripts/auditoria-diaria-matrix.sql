-- Simulacro de 20261014000100 (concatenar después de la migración sin
-- BEGIN/COMMIT; termina en ROLLBACK).
--   1. Con los contratos y la marca, los auditores críticos quedan en cero y
--      la corrida diaria no anota nada.
--   2. Una vista nueva abierta a propósito (definer, sin marca) aparece en
--      audit_vistas_abiertas y la corrida la deja en app_errores.
--   3. Una política abierta no declarada también.
--   4. La función y el auditor no son accesibles desde el navegador; el cron existe.
DO $$
DECLARE v_r jsonb; v_n int;
BEGIN
  v_r := public.auditoria_de_seguridad_diaria();
  IF v_r->'hallazgos' <> '{}'::jsonb THEN RAISE EXCEPTION 'FALLA 1: %', v_r->'hallazgos'; END IF;

  CREATE VIEW public.zz_abierta WITH (security_invoker = false) AS SELECT id, org_id FROM public.products;
  GRANT SELECT ON public.zz_abierta TO authenticated;
  CREATE TABLE public.zz_politica (id int);
  ALTER TABLE public.zz_politica ENABLE ROW LEVEL SECURITY;
  CREATE POLICY zz_todo ON public.zz_politica FOR SELECT USING (true);

  v_r := public.auditoria_de_seguridad_diaria();
  IF NOT (v_r->'hallazgos' ? 'audit_vistas_abiertas') THEN RAISE EXCEPTION 'FALLA 2: %', v_r; END IF;
  IF NOT (v_r->'hallazgos' ? 'rls_audit_open_policies') THEN RAISE EXCEPTION 'FALLA 3: %', v_r; END IF;
  SELECT count(*) INTO v_n FROM public.app_errores
   WHERE dia = current_date AND ruta = 'cron:auditoria-de-seguridad' AND mensaje LIKE '%zz_abierta%';
  IF v_n <> 1 THEN RAISE EXCEPTION 'FALLA 2: no quedó en app_errores'; END IF;

  IF has_function_privilege('authenticated', 'public.auditoria_de_seguridad_diaria()', 'EXECUTE')
     OR has_table_privilege('authenticated', 'public.audit_vistas_abiertas', 'SELECT') THEN
    RAISE EXCEPTION 'FALLA 4: accesible desde el navegador';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'auditoria-de-seguridad-diaria') THEN RAISE EXCEPTION 'FALLA 4: sin cron'; END IF;
  RAISE EXCEPTION 'OK 1-4';
END $$;

ROLLBACK;
