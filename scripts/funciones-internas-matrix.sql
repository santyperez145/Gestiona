-- Matriz reversible de 20261011000200 (funciones internas sin anónimos).
--   node scripts/db.mjs --file scripts/funciones-internas-matrix.sql
-- Un anónimo no ejecuta ninguna de las 18 internas; un usuario con sesión sí
-- las 16 que verifican rol adentro, y ni `upsert_customer_from_order` ni
-- `configure_business_profile` (sólo el servidor); las
-- públicas de la tienda siguen públicas; las funciones que llaman por dentro a
-- `upsert_customer_from_order` siguen pudiendo (son del mismo dueño). Lee el
-- catálogo de permisos; se revierte.
BEGIN;
CREATE TEMP TABLE zz_fi (caso text, valor text) ON COMMIT DROP;

WITH internas AS (
  SELECT p.oid, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname IN (
    'anonymize_customer', 'api_key_emitir', 'configure_business_profile',
    'finance_create_expense_request', 'finance_export_create', 'finance_notify_approvers',
    'finance_reject_expense_request', 'finance_set_approval_policy', 'medio_de_pago_habilitar',
    'prepare_order_shipment', 'programar_cambio_de_precio', 'provision_platform_organization',
    'record_activation_intervention', 'request_support_diagnostic_access',
    'save_platform_commission_rule', 'seed_return_reasons', 'seed_store_pages', 'upsert_customer_from_order')
)
INSERT INTO zz_fi
SELECT 'internas que ejecuta un anónimo (0 de 18)', count(*) FILTER (WHERE has_function_privilege('anon', oid, 'EXECUTE')) || ' de ' || count(*) FROM internas
UNION ALL
SELECT 'internas que ejecuta un usuario con sesión (16)', count(*) FILTER (WHERE has_function_privilege('authenticated', oid, 'EXECUTE'))::text FROM internas
UNION ALL
SELECT 'sólo servidor, para usuarios (false,false)', string_agg(has_function_privilege('authenticated', oid, 'EXECUTE')::text, ',') FROM internas WHERE proname IN ('upsert_customer_from_order', 'configure_business_profile')
UNION ALL
SELECT 'sólo servidor, para el servidor (true,true)', string_agg(has_function_privilege('service_role', oid, 'EXECUTE')::text, ',') FROM internas WHERE proname IN ('upsert_customer_from_order', 'configure_business_profile');

INSERT INTO zz_fi
SELECT 'quien la llama por dentro es del mismo dueño (postgres)', string_agg(DISTINCT pg_get_userbyid(p.proowner), ',')
FROM pg_proc p WHERE p.proname IN ('mark_store_order_paid', 'trg_order_paid_to_crm', 'upsert_customer_from_order', 'provision_business_blueprint', 'configure_business_profile');

INSERT INTO zz_fi
SELECT 'públicas de la tienda que siguen para anónimos (12)', count(*)::text
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND has_function_privilege('anon', p.oid, 'EXECUTE') AND p.proname IN (
  'accept_influencer_contract_by_token', 'ask_product_question', 'process_drip_unsubscribe',
  'process_email_campaign_unsubscribe', 'register_store_newsletter', 'request_stock_alert',
  'request_store_return', 'respond_influencer_invitation', 'save_store_cart', 'toggle_wishlist',
  'upsert_product_review', 'upsert_store_customer');

SELECT * FROM zz_fi;
ROLLBACK;
