-- Vistas que salteaban RLS. Medido 2026-10-13 con
-- `scripts/tablas-lectura-ajena-probar.mjs` y una prueba como anon:
--   · kardex_summary: SIN LOGIN se leían 1.662 filas del kardex de 2 negocios.
--   · ecommerce_funnel y stock_a_reponer: también legibles sin login.
--   · payment_operation_trace: cualquier usuario logueado veía la traza de
--     pagos de otros negocios.
--   · platform_revenue_monthly: los ingresos de la plataforma, legibles sin
--     login.
--   · audit_summary: el resumen de auditoría de TODOS los negocios, sin login.
-- Las vistas eran de `postgres` sin `security_invoker`, así que corrían con
-- los permisos del dueño y no con los de quien consulta. Ahora usan el RLS de
-- quien consulta: cada miembro ve lo de su negocio; el staff de finanzas ve
-- los ingresos por la política de payment_transactions; anon no ve nada.
-- Además: anon sin ningún permiso y authenticated sólo con SELECT (tenían
-- INSERT/UPDATE/DELETE/TRUNCATE por el grant por defecto).
-- Idempotente.
BEGIN;

DO $$
DECLARE v text;
BEGIN
  FOREACH v IN ARRAY ARRAY['kardex_summary', 'ecommerce_funnel', 'stock_a_reponer',
                           'payment_operation_trace', 'platform_revenue_monthly', 'audit_summary']
  LOOP
    EXECUTE format('ALTER VIEW public.%I SET (security_invoker = true)', v);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', v);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.%I FROM authenticated', v);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', v);
  END LOOP;
END $$;

COMMIT;
