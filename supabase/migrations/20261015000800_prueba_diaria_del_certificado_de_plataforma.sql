-- Prueba diaria del certificado de ARCA de la plataforma.
--
-- `afip-platform-cert` prueba el certificado contra WSAA y guarda el resultado
-- en `verificado_*`, que leen Platform y la conexión de cada comercio
-- (motivo `plataforma_rechazada`). Sin una prueba periódica, un vencimiento o
-- una revocación en ARCA se descubría recién cuando un comercio fallaba al
-- facturar. Si el ticket vigente sigue sirviendo no se vuelve a pedir a WSAA.
-- Idempotente. Reversible: cron.unschedule('certificado-arca-prueba-diaria').
BEGIN;

DO $$
BEGIN
  PERFORM cron.unschedule('certificado-arca-prueba-diaria')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'certificado-arca-prueba-diaria');
  PERFORM cron.schedule('certificado-arca-prueba-diaria', '7 6 * * *', 'SELECT public.invoke_edge_function(''afip-platform-cert'');');
END $$;

COMMIT;
