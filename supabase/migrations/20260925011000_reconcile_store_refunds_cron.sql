-- ============================================================================
-- Cron de reconciliación de reintegros de tienda (MercadoPago).
--
-- El webhook de MP ya reconcilia en caliente los reintegros que quedaron
-- `processing` tras un timeout del POST. Pero si la notificación se pierde —
-- y se pierden— el dinero queda atrapado: el cliente no lo recibe, el RMA no
-- cierra y nadie se entera hasta que alguien abre el portal de devoluciones.
--
-- Este job barre cada 10 minutos todas las reintegraciones `processing` de
-- todas las organizaciones y consulta la lista oficial de refunds del
-- proveedor. La lógica es la misma del webhook
-- (`_shared/storeRefundReconciliation.ts`) y la autoridad final sigue siendo
-- SQL: `pago_reintegro_resultado` revalida org, monto y estado antes de
-- asentar. Idempotente: sin pendientes, no hace nada.
-- ============================================================================

SELECT cron.unschedule('reconcile-store-refunds')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'reconcile-store-refunds');

SELECT cron.schedule('reconcile-store-refunds', '*/10 * * * *',
  $$SELECT public.invoke_edge_function('reconcile-store-refunds')$$);