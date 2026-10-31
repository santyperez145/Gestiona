-- La base trabaja en el día argentino (2026-10-30).
--
-- La base corría en UTC. Todo lo que saca un día de un instante caía en el día
-- siguiente entre las 21 y las 24 h de Argentina:
--   · los asientos (`occurred_at::date`, `created_at::date`, CURRENT_DATE):
--     una venta de la noche del 31 entraba al Libro Diario de noviembre;
--   · los valores por defecto «hoy» (gastos, pagos, compras);
--   · los filtros del panel con una fecha sin hora sobre un instante
--     (`date >= '2026-10-30'` era la medianoche UTC: las 21 h del día antes).
-- El cliente trabaja con el día argentino desde el 15/10 (src/lib/fechaAR.ts),
-- así que a esa hora panel y base ni siquiera coincidían entre sí.
-- 20261030001600 ya fechaba las facturas en el día argentino; esto lo hace
-- para todo.
--
-- Argentina no tiene horario de verano desde 2009: es UTC-3 todo el año.
--   · Las sesiones nuevas (PostgREST, pg_cron, funciones) usan el día
--     argentino para CURRENT_DATE, `::date` de un instante y las fechas sin
--     hora de los filtros.
--   · Los instantes guardados no cambian (timestamptz es absoluto); la API los
--     devuelve con -03:00 en vez de +00:00: el mismo instante.
--   · pg_cron agenda con su propia zona (cron.timezone): los horarios de las
--     tareas no se mueven.
--   · Lo ya fechado (facturas, asientos) no se reescribe.
--
-- Supabase documenta el cambio por base. Si al restaurar el rol no puede
-- alterar la base, se fija en los roles que abren sesión (mismo efecto).

BEGIN;

DO $$
DECLARE
  v_rol text;
BEGIN
  BEGIN
    EXECUTE format('ALTER DATABASE %I SET timezone TO %L', current_database(), 'America/Argentina/Buenos_Aires');
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE WARNING 'Sin permiso para fijar la zona horaria de la base: se fija por rol.';
    FOREACH v_rol IN ARRAY ARRAY['authenticator', 'authenticated', 'anon', 'service_role', 'postgres'] LOOP
      BEGIN
        EXECUTE format('ALTER ROLE %I SET timezone TO %L', v_rol, 'America/Argentina/Buenos_Aires');
      EXCEPTION WHEN undefined_object OR insufficient_privilege THEN
        RAISE WARNING 'No se pudo fijar la zona horaria del rol %: %', v_rol, SQLERRM;
      END;
    END LOOP;
  END;
END $$;

-- La sesión que aplica las migraciones, también: lo que sigue ya corre en el
-- día argentino, como va a correr en producción.
SET timezone TO 'America/Argentina/Buenos_Aires';

COMMIT;
