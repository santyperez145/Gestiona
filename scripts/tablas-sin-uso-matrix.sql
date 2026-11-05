-- Simulacro de 20261105000600 (concatenar sin BEGIN/COMMIT; termina en ROLLBACK).
--   1. En la base reconstruida (vacía) no queda ninguna de las 33 tablas.
--   2. Las dos que quedan afuera a propósito siguen.
DO $$
DECLARE
  v_quedan text;
BEGIN
  SELECT string_agg(t, ', ') INTO v_quedan
    FROM unnest(ARRAY[
      'affiliate_payouts', 'afip_alicuotas', 'alert_subscriptions', 'anomaly_detections',
      'asset_depreciation_entries', 'bi_drilldowns', 'breakeven_analysis', 'budget_transactions',
      'demand_forecasts', 'dynamic_price_events', 'dynamic_price_rules', 'forecast_accuracy',
      'invoice_sequences', 'margin_targets', 'ocr_line_items', 'ocr_supplier_patterns',
      'org_currencies', 'plm_quality_checks', 'plm_stage_history', 'plm_versions',
      'portal_configs', 'portal_ticket_messages', 'pricing_experiments', 'recipe_ingredients',
      'recipe_productions', 'report_schedules', 'sales_forecasts', 'stripe_events',
      'team_messages', 'vendor_catalog_items', 'vendor_messages', 'vendor_portal_access',
      'webhooks_advanced'
    ]) t
   WHERE to_regclass('public.' || quote_ident(t)) IS NOT NULL;
  IF v_quedan IS NOT NULL THEN
    RAISE EXCEPTION 'FALLA 1: siguen (filas o dependencias): %', v_quedan;
  END IF;

  IF to_regclass('public.finance_bank_reconciliations') IS NULL
     OR to_regclass('public.ecommerce_orders_iva_backup') IS NULL THEN
    RAISE EXCEPTION 'FALLA 2: se borró una de las que quedan afuera';
  END IF;

  RAISE EXCEPTION 'OK 1 2';
END $$;
ROLLBACK;
