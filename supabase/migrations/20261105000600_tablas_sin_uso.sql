-- Tablas sin uso (2026-11-05).
--
-- Estudio de las 438 tablas vivas al final de las migraciones: estas 33 no
-- las lee ni escribe el panel, ninguna función edge, ninguna función ni vista
-- SQL, ningún script ni E2E. Son de módulos que se crearon en mayo y nunca se
-- usaron (afiliados, PLM, OCR, BI, pronósticos, portal de proveedores, chat
-- interno, Stripe, multimoneda, recetas…). Sólo ocupan lugar, suman superficie
-- de ataque y confunden a quien lee el esquema.
--
-- Guardas, por tabla:
--   · sólo se borra si está VACÍA: si en producción tiene filas, queda y se
--     avisa (NOTICE). Nunca se pierde un dato.
--   · sin CASCADE: si algo depende de ella, se saltea.
--   · se reintenta en varias vueltas, para que las hijas caigan antes que las
--     madres.
-- Quedan afuera a propósito: finance_bank_reconciliations (bank_transactions
-- la referencia) y ecommerce_orders_iva_backup (respaldo con datos de la
-- corrección de IVA de agosto).
BEGIN;

DO $$
DECLARE
  v_pendientes text[] := ARRAY[
    'affiliate_payouts', 'afip_alicuotas', 'alert_subscriptions', 'anomaly_detections',
    'asset_depreciation_entries', 'bi_drilldowns', 'breakeven_analysis', 'budget_transactions',
    'demand_forecasts', 'dynamic_price_events', 'dynamic_price_rules', 'forecast_accuracy',
    'invoice_sequences', 'margin_targets', 'ocr_line_items', 'ocr_supplier_patterns',
    'org_currencies', 'plm_quality_checks', 'plm_stage_history', 'plm_versions',
    'portal_configs', 'portal_ticket_messages', 'pricing_experiments', 'recipe_ingredients',
    'recipe_productions', 'report_schedules', 'sales_forecasts', 'stripe_events',
    'team_messages', 'vendor_catalog_items', 'vendor_messages', 'vendor_portal_access',
    'webhooks_advanced'
  ];
  v_siguen text[];
  v_t text;
  v_hay boolean;
  v_vuelta int := 0;
BEGIN
  LOOP
    v_vuelta := v_vuelta + 1;
    v_siguen := ARRAY[]::text[];
    FOREACH v_t IN ARRAY v_pendientes LOOP
      CONTINUE WHEN to_regclass('public.' || quote_ident(v_t)) IS NULL;
      EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I)', v_t) INTO v_hay;
      IF v_hay THEN
        RAISE NOTICE 'tablas sin uso: % tiene filas, queda', v_t;
        CONTINUE;
      END IF;
      BEGIN
        EXECUTE format('DROP TABLE public.%I', v_t);
      EXCEPTION WHEN dependent_objects_still_exist THEN
        v_siguen := v_siguen || v_t;
      END;
    END LOOP;
    EXIT WHEN cardinality(v_siguen) = 0 OR cardinality(v_siguen) = cardinality(v_pendientes) OR v_vuelta >= 5;
    v_pendientes := v_siguen;
  END LOOP;
  IF cardinality(v_siguen) > 0 THEN
    RAISE NOTICE 'tablas sin uso: quedan por dependencias: %', array_to_string(v_siguen, ', ');
  END IF;
END $$;

COMMIT;
