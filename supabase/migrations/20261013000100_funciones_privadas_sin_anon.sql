-- Funciones de pantallas con sesión que `anon` (cualquiera sin login, con la
-- clave pública de la app) podía ejecutar. Medido el 2026-10-13 con
-- `scripts/funciones-anonimas-probar.mjs`: de 150 funciones SECURITY DEFINER
-- ejecutables por anon, éstas no son de la tienda, del portal por token ni
-- triggers.
--
-- Dos eran fugas reales:
--   · ia_consumo_del_mes(org) saltea el chequeo de membresía cuando no hay
--     sesión (pensado para service_role) y le devolvía a cualquiera cuántas
--     consultas de IA hizo un negocio este mes.
--   · stock_disponible(producto, …) no mira permisos: con un id de producto
--     (la tienda los publica) devolvía el stock exacto, incluso de productos
--     no publicados. Sólo la llaman otras funciones SECURITY DEFINER, que
--     corren como dueño, así que tampoco la necesita `authenticated`.
-- El resto ya rechazaba sin sesión adentro; sacarles anon es defensa en
-- profundidad: una función privada no tiene por qué ser llamable sin login.
--
-- Idempotente: REVOKE sobre un permiso que no existe no falla.
BEGIN;

DO $$
DECLARE
  f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS firma, p.proname
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN (
         'api_key_revocar',
         'approve_support_diagnostic_access', 'revoke_support_diagnostic_access',
         'get_support_diagnostic_snapshot',
         'approve_platform_commission_rule', 'retire_platform_commission_rule',
         'finance_approve_expense_request', 'finance_cancel_expense_request',
         'finance_export_batch_csv', 'finance_export_mark_exported',
         'finance_list_approval_policies', 'finance_submit_expense_request',
         'get_audit_summary', 'ia_consumo_del_mes', 'impacto_cambio_de_precio',
         'ledger_resultado', 'ledger_resultado_diario', 'ledger_saldo',
         'outbox_reintentar', 'resolve_stock_reservation',
         'suscripcion_de_organizacion', 'void_activation_intervention',
         'stock_disponible'
       )
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', f.firma);
    IF f.proname = 'stock_disponible' THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM authenticated', f.firma);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f.firma);
    ELSE
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', f.firma);
    END IF;
  END LOOP;
END $$;

COMMIT;
