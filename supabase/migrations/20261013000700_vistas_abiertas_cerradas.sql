-- ADR 006, acción 1: las 14 vistas sin `security_invoker`, legibles desde el
-- navegador y sin filtro por usuario en su definición (medido 2026-10-13).
--
-- Pasan a invoker (respetan el RLS de quien consulta), sin anon y con
-- authenticated sólo en SELECT:
--   · por negocio, sin uso en la app pero abiertas incluso a anon:
--     active_promotions, contracts_expiring_soon, crm_pending_followups,
--     crm_pipeline_forecast, deal_outcome_stats, vendor_pending_summary.
--     Hoy dan 0 filas porque nadie usa esos módulos; iban a filtrar después.
--   · desvio_de_comisiones: por negocio (Ajustes → Costo de cobrar).
--   · tarifas_a_verificar y platform_gross_profit_resumen: internas, sin uso.
--
-- Se quedan corriendo como dueño, marcadas en su comentario para que
-- `audit_vistas_abiertas` las acepte (convención del ADR 006):
--   @publica  → datos de referencia, iguales para todos.
--   @revisada → filtra adentro por otra vía; el motivo va escrito.
-- Y pierden escritura por el grant por defecto (anon/authenticated tenían
-- INSERT/UPDATE/DELETE/TRUNCATE).
-- Idempotente.
BEGIN;

DO $$
DECLARE v text;
BEGIN
  FOREACH v IN ARRAY ARRAY['active_promotions', 'contracts_expiring_soon', 'crm_pending_followups',
                           'crm_pipeline_forecast', 'deal_outcome_stats', 'vendor_pending_summary',
                           'desvio_de_comisiones', 'tarifas_a_verificar', 'platform_gross_profit_resumen']
  LOOP
    EXECUTE format('ALTER VIEW public.%I SET (security_invoker = true)', v);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', v);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.%I FROM authenticated', v);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', v);
  END LOOP;
END $$;

DO $$
DECLARE
  r record;
  v_actual text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('planes_contratables', '@publica: planes y precios que se muestran en Mi plan y en Precios.'),
    ('planes_de_cuotas_posibles', '@publica: tarifas de cuotas de los procesadores, iguales para todos los comercios.'),
    ('merchant_integration_catalog', '@publica: catálogo de integraciones disponibles, sin datos de ningún comercio.'),
    ('store_catalog_products', '@publica: sólo productos de tiendas activas; la tienda los lee por get_store_catalog_products(slug).'),
    ('platform_activation_cohorts', '@revisada: lee platform_activation_cohort_members, que filtra por staff de plataforma.')
  ) AS t(vista, marca)
  LOOP
    v_actual := obj_description(format('public.%I', r.vista)::regclass, 'pg_class');
    IF v_actual IS NULL OR v_actual NOT LIKE '@%' THEN
      EXECUTE format('COMMENT ON VIEW public.%I IS %L', r.vista,
        r.marca || COALESCE(' ' || v_actual, ''));
    END IF;
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.%I FROM anon, authenticated', r.vista);
  END LOOP;
END $$;

COMMIT;
