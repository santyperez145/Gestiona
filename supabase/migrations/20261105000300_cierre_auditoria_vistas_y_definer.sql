-- Cierre del informe de la auditoría (2026-11-05).
--
-- 1. alert_summary corría con los permisos de su dueño y anon podía leerla:
--    cualquiera, sin sesión, veía cuántas alertas tenía cada organización y
--    de qué tipo. Pasa a invoker (RLS de alert_events) y sin anon. Nadie la
--    lee desde la app.
-- 2. Cuatro funciones de trigger SECURITY DEFINER sin search_path fijo. No
--    se pueden llamar directo, pero un search_path heredado podría resolver
--    a objetos de otro esquema: se fija en public.
-- Idempotente; si un objeto no existe en esta base se saltea.
BEGIN;

DO $$
BEGIN
  IF to_regclass('public.alert_summary') IS NOT NULL THEN
    ALTER VIEW public.alert_summary SET (security_invoker = true);
    REVOKE ALL ON public.alert_summary FROM PUBLIC, anon;
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.alert_summary FROM authenticated;
    GRANT SELECT ON public.alert_summary TO authenticated;
  END IF;
END $$;

DO $$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.record_price_change()',
    'public.trg_auto_loyalty_on_sale()',
    'public.trg_auto_loyalty_on_sale_delete()',
    'public.trg_seed_org_permissions()'
  ] LOOP
    IF to_regprocedure(f) IS NOT NULL THEN
      EXECUTE format('ALTER FUNCTION %s SET search_path = public', f);
    END IF;
  END LOOP;
END $$;

COMMIT;
