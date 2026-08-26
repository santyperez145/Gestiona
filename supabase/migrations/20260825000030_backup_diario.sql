-- ═══════════════════════════════════════════════════════════════════════════
-- P0-06 — el RPO era de siete días y nadie lo había elegido
-- ═══════════════════════════════════════════════════════════════════════════
--
-- El restore drill probaba que el backup **se puede recuperar** —RTO 1.306 ms,
-- 148 tablas, 0 restos— pero no medía **cuánto se pierde** si la base se cae
-- ahora. Eso lo dice la antigüedad del último snapshot verificado, y medido el
-- 2026-08-25 daba **69,3 horas**.
--
-- La causa no era un incidente: los backups corrían `30 3 * * 0`, domingos. Con
-- eso el RPO real es de **hasta 7 días**, y un desastre el sábado cuesta seis
-- días de ventas, de stock y de asientos. Nadie eligió ese número: era la
-- consecuencia de la frecuencia del cron.
--
-- ── Por qué diario y no algo más fino ──────────────────────────────────────
--
-- Medido: 17 snapshots ocupan **4,04 MB** en total y la base entera pesa 47 MB.
-- Pasar de semanal a diario multiplica por siete un costo que hoy es de
-- milésimas, y baja el RPO de 168 h a 24 h. No hay decisión difícil acá.
--
-- Algo más fino que diario —WAL continuo, PITR— sí es una decisión con costo y
-- con plan de Supabase de por medio. Queda como opción, no como pendiente
-- silencioso: con 34 ventas de mostrador y 6 órdenes online, 24 h de pérdida
-- máxima es proporcional. Cuando el volumen lo justifique, se revisa.
--
-- ⚠️ El drill ahora **falla** si el snapshot verificado supera las 36 horas
-- (24 h del cron + margen para una corrida que no salió). Es lo que convierte
-- el RPO en una garantía y no en una aspiración: hasta hoy el número no existía
-- en ningún lado.
--
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

DO $blk$
DECLARE
  v_command text;
BEGIN
  SELECT command INTO v_command FROM cron.job WHERE jobname = 'weekly-org-backups';

  IF v_command IS NOT NULL THEN
    -- El nombre decía "weekly" y habría quedado mintiendo. Se reemplaza por uno
    -- que describe lo que hace: un cron mal nombrado es la próxima confusión.
    PERFORM cron.unschedule('weekly-org-backups');
    PERFORM cron.schedule('daily-org-backups', '30 3 * * *', v_command);

  ELSIF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'daily-org-backups') THEN
    -- Reejecución sobre una base donde ya se renombró: no hay nada que hacer.
    RAISE NOTICE 'No existe el cron de backups; nada que reprogramar';
  END IF;
END $blk$;

-- Verificación en la misma migración: si quedó en otro horario, se ve acá.
DO $blk$
DECLARE v_sched text;
BEGIN
  SELECT schedule INTO v_sched FROM cron.job WHERE jobname = 'daily-org-backups';
  IF v_sched IS DISTINCT FROM '30 3 * * *' THEN
    RAISE EXCEPTION 'El backup diario quedó en %, no en 30 3 * * *', COALESCE(v_sched, '(inexistente)');
  END IF;
END $blk$;
