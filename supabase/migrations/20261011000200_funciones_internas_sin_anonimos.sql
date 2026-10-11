-- ═══════════════════════════════════════════════════════════════════════════
-- Funciones internas: nadie anónimo las ejecuta
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ROADMAP P0.2 («revisar funciones expuestas, permisos RPC»). Medido
-- 2026-10-11: 30 funciones SECURITY DEFINER que escriben datos se podían
-- ejecutar sin sesión (rol anon). Doce son públicas a propósito y quedan
-- igual: la tienda (preguntas, carrito, favoritos, reseñas, newsletter,
-- avisos de stock, devoluciones, alta de comprador) y los enlaces con token
-- (bajas de email, contratos e invitaciones de influencers).
--
-- Las otras 18 son internas. 16 verifican quién llama (sesión y rol), así
-- que sin sesión fallan adentro; igual no tiene sentido que un anónimo pueda
-- invocarlas: se les quita la ejecución pública y quedan para usuarios con
-- sesión (ya la tenían). Dos quedan sólo para el servidor:
--   · `upsert_customer_from_order(p_order_id)` no verifica nada: crea o
--     actualiza el cliente de un pedido de cualquier comercio. Sólo la
--     llaman, por dentro, `mark_store_order_paid` y `trg_order_paid_to_crm`.
--   · `configure_business_profile` ya no la ejecutaban los usuarios con
--     sesión (se les había quitado), pero sí los anónimos. Sólo la llama, por
--     dentro, `provision_business_blueprint`.
-- Las que las llaman son SECURITY DEFINER del mismo dueño (postgres) y no
-- cambian. No se le abre la ejecución a nadie que no la tuviera.
--
-- Idempotente. Reversible: GRANT EXECUTE ... TO anon (y authenticated en
-- upsert_customer_from_order).
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

DO $$
DECLARE
  v_nombre text;
  v_firma regprocedure;
BEGIN
  FOREACH v_nombre IN ARRAY ARRAY[
    'anonymize_customer', 'api_key_emitir',
    'finance_create_expense_request', 'finance_export_create', 'finance_notify_approvers',
    'finance_reject_expense_request', 'finance_set_approval_policy', 'medio_de_pago_habilitar',
    'prepare_order_shipment', 'programar_cambio_de_precio', 'provision_platform_organization',
    'record_activation_intervention', 'request_support_diagnostic_access',
    'save_platform_commission_rule', 'seed_return_reasons', 'seed_store_pages'
  ] LOOP
    FOR v_firma IN
      SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = v_nombre
    LOOP
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', v_firma);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', v_firma);
    END LOOP;
  END LOOP;

  FOR v_firma IN
    SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN ('upsert_customer_from_order', 'configure_business_profile')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', v_firma);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', v_firma);
  END LOOP;
END $$;

COMMIT;
