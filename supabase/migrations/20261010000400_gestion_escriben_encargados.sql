-- ═══════════════════════════════════════════════════════════════════════════
-- Configuración y registros de gestión: escriben dueño y admin
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Segunda vuelta del barrido de `pg_policies` (ver 20261010000300). Quedaban
-- ~135 tablas con escritura para cualquier miembro. No todas son un error: un
-- vendedor vende, carga clientes, anota tareas y despacha. Así que se
-- restringe sólo donde se puede demostrar que no se rompe nada.
--
-- Criterio medido el 2026-10-10, tabla por tabla:
--
--   1. Una sola política, FOR ALL, de membresía de organización (no de
--      «es mío», como push_subscriptions o profiles).
--   2. Ninguna función de la base la escribe con el rol de quien llama:
--      todas las que la escriben son SECURITY DEFINER.
--   3. Ninguna edge function la escribe (podría hacerlo con el token del
--      usuario, y ahí sí aplica la política).
--   4. Desde la app, todo lo que la escribe sólo es alcanzable desde rutas
--      sólo-admin (árbol de imports de cada ruta del manifiesto), o nada la
--      escribe.
--
-- Quedan 65. Se excluyeron seis tablas hijas sin org_id (plm_quality_checks,
-- plm_stage_history, plm_versions, portal_ticket_messages,
-- purchase_request_items, recipe_ingredients): su política pasa por la tabla
-- padre y van aparte. Y a mano `loyalty_points`: Clientes —que usa un
-- vendedor— reasigna puntos al fusionar clientes con un nombre de tabla en
-- variable, que el criterio 4 no ve.
--
-- Leer sigue igual (miembros). Crear, editar y borrar: dueño y admin. Entre
-- ellas: proveedores y deudas con proveedores, activos fijos y amortización,
-- cotizaciones de moneda, inscripciones de IIBB, solicitudes de gasto,
-- tipos de producto y atributos, transportistas, depósitos y ubicaciones, y
-- la lista de bajas de email —un vendedor podía borrar a quien pidió no
-- recibir más mails—.
--
-- Idempotente. Reversible: recrear la política original de cada tabla.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_tabla text;
  v_previa text;
  v_originales constant jsonb := '{
    "affiliate_conversions": "org_aff_conversions",
    "ai_chat_messages": "org_ai_messages",
    "ai_prompts_library": "org_ai_prompts",
    "ai_recommendations": "org_ai_recommendations",
    "anomaly_detections": "org_anomalies",
    "asset_depreciation_entries": "org_asset_depr",
    "attribute_definitions": "attribute_definitions_org_access",
    "breakeven_analysis": "org_breakeven",
    "budget_transactions": "org_budget_txns",
    "carriers": "org_carriers",
    "cash_projections": "org_cash_proj",
    "cashflow_entries": "org_cashflow",
    "content_ideas": "org_content_ideas",
    "crm_activities": "org_crm_activities",
    "crm_contacts": "org_crm_contacts",
    "currency_price_updates": "org_cpu",
    "custom_field_defs": "org_custom_field_defs",
    "customer_referrals": "referrals_org_access",
    "demand_forecasts": "org_forecasts",
    "demand_signals": "org_demand_signals",
    "document_versions": "org_doc_versions",
    "documents": "org_documents",
    "drip_sequence_steps": "org_drip_steps",
    "drip_sequences": "org_drip_sequences",
    "ecommerce_cart_sessions": "org_ecom_carts",
    "email_suppressions": "org_suppressions_all",
    "exchange_rates": "org_rates",
    "finance_expense_requests": "finance_expense_requests_org",
    "financial_line_items": "org_fin_line_items",
    "financial_scenarios": "org_fin_scenarios",
    "fixed_assets": "org_fixed_assets",
    "forecast_accuracy": "org_forecast_accuracy",
    "forecast_configs": "org_forecast_configs",
    "hashtag_sets": "org_hashtag_sets",
    "iibb_registrations": "org_iibb",
    "inventory_abc": "org_inventory_abc",
    "inventory_transfer_items": "org_inventory_transfer_items",
    "kpi_alerts": "org_kpi_alerts",
    "kpi_goals": "org_kpi_goals",
    "kpi_widgets": "org_kpi_widgets",
    "notification_log": "org_notif_log",
    "plm_products": "org_plm_products",
    "portal_configs": "org_portal_configs",
    "portal_sessions": "org_portal_sessions",
    "portal_tickets": "org_portal_tickets",
    "product_attribute_values": "product_attribute_values_org_access",
    "product_types": "product_types_org_access",
    "recipe_productions": "org_recipe_prod",
    "recipes": "org_recipes",
    "recommendation_events": "org_rec_events",
    "recommendation_rules": "org_rec_rules",
    "sales_forecasts": "org_forecasts",
    "service_order_items": "org_service_order_items",
    "shipments": "org_shipments",
    "stock_transfers": "stock_transfers_org_access",
    "supplier_debts": "org_members_manage_supplier_debts",
    "suppliers": "suppliers_org",
    "territories": "org_territories_all",
    "territory_rules": "org_territory_rules_all",
    "vendor_catalog_items": "org_vendor_catalog",
    "vendor_invoices": "org_vendor_invoices",
    "vendor_messages": "org_vendor_messages",
    "vendor_portal_access": "org_vendor_access",
    "warehouse_bins": "org_wh_bins",
    "warehouse_zones": "org_wh_zones"
  }'::jsonb;
  v_encargado constant text := $e$public.has_org_role(org_id, auth.uid(), ARRAY['owner', 'admin'])$e$;
BEGIN
  FOR v_tabla, v_previa IN SELECT key, value #>> '{}' FROM jsonb_each(v_originales) LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_previa, v_tabla);
    EXECUTE format('DROP POLICY IF EXISTS %1$s_leer ON public.%1$I', v_tabla);
    EXECUTE format('DROP POLICY IF EXISTS %1$s_crear ON public.%1$I', v_tabla);
    EXECUTE format('DROP POLICY IF EXISTS %1$s_editar ON public.%1$I', v_tabla);
    EXECUTE format('DROP POLICY IF EXISTS %1$s_borrar ON public.%1$I', v_tabla);

    EXECUTE format('CREATE POLICY %1$s_leer ON public.%1$I FOR SELECT TO authenticated USING (public.is_org_member(org_id, auth.uid()))', v_tabla);
    EXECUTE format('CREATE POLICY %1$s_crear ON public.%1$I FOR INSERT TO authenticated WITH CHECK (%2$s)', v_tabla, v_encargado);
    EXECUTE format('CREATE POLICY %1$s_editar ON public.%1$I FOR UPDATE TO authenticated USING (%2$s) WITH CHECK (%2$s)', v_tabla, v_encargado);
    EXECUTE format('CREATE POLICY %1$s_borrar ON public.%1$I FOR DELETE TO authenticated USING (%2$s)', v_tabla, v_encargado);
  END LOOP;
END $$;
