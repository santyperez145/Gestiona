-- Cron de recuperación de carritos abandonados.
--
-- Cada hora busca sesiones activas con email y sin aviso previo, y manda el
-- correo de recuperación. Usa el helper `invoke_edge_function` (ver
-- docs/CRON.md), que lee la URL y la clave del vault.
--
-- Cada hora y no cada 15 minutos: el filtro ya exige una hora de inactividad,
-- y correr más seguido solo agrega llamadas sin encontrar nada nuevo.
-- Idempotente.

SELECT cron.schedule(
  'recover-abandoned-carts',
  '15 * * * *',
  $$SELECT public.invoke_edge_function('recover-abandoned-carts');$$
);
