-- El aviso de cambio de precio corre solo, una vez por día
--
-- `precio-suscripcion` hace dos cosas en orden: avisa a quien todavía no fue
-- avisado, y aplica en MercadoPago lo que ya rige. Una vez por día alcanza y
-- sobra: un cambio de precio se programa con 30 días de anticipación.
--
-- 📌 A las 9 de la mañana de Argentina (12 UTC) y no de madrugada: es un mail
-- que el comercio tiene que leer, y uno que llega a las 4 AM se pierde entre
-- las notificaciones de la noche.
--
-- ⚠️ Que el cron diga `succeeded` NO significa que la función corrió:
-- `invoke_edge_function` termina en `net.http_post`, que es asíncrono. El
-- resultado real se mira en `platform_edge_invocation_health`.

SELECT cron.unschedule('precio-suscripcion')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'precio-suscripcion');

SELECT cron.schedule('precio-suscripcion', '0 12 * * *',
  $$SELECT public.invoke_edge_function('precio-suscripcion')$$);

-- ═══════════════════════════════════════════════════════════════════════════
-- Verificación
-- ═══════════════════════════════════════════════════════════════════════════

DO $verif$
DECLARE
  v_agenda text;
BEGIN
  SELECT schedule INTO v_agenda FROM cron.job WHERE jobname = 'precio-suscripcion';
  ASSERT v_agenda = '0 12 * * *',
    'el cron del aviso de precio no quedo agendado: ' || COALESCE(v_agenda, 'no existe');

  -- ⚠️ El vault es lo que hace que TODOS los crons funcionen o fallen juntos.
  -- Si falta un secreto, esto no avisa a nadie y tampoco hace ruido.
  ASSERT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL'),
    'falta SUPABASE_URL en el vault: el cron no va a poder llamar a la funcion';
  ASSERT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'SUPABASE_ANON_KEY'),
    'falta SUPABASE_ANON_KEY en el vault';

  RAISE NOTICE 'OK: agendado 9 AM Argentina, con los secretos que necesita';
END $verif$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260827000170', 'el_aviso_de_precio_corre_solo')
ON CONFLICT DO NOTHING;
