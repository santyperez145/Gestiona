-- Cron del aviso de reposición.
--
-- Cada 30 minutos: el stock vuelve cuando se carga una compra, en cualquier
-- momento del día, y media hora de demora es aceptable. Correrlo cada minuto
-- sería consultar 48 veces más para encontrar lo mismo.
--
-- Usa `invoke_edge_function`, que lee la URL y la clave del vault
-- (ver docs/CRON.md). Idempotente.

SELECT cron.unschedule('notify-back-in-stock')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'notify-back-in-stock');

SELECT cron.schedule(
  'notify-back-in-stock',
  '*/30 * * * *',
  $$SELECT public.invoke_edge_function('notify-back-in-stock');$$
);
