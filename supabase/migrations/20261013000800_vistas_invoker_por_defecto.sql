-- ADR 006, acción 2: toda vista nueva en `public` respeta el RLS de quien
-- consulta, salvo que declare lo contrario.
--
-- Las vistas corren como su dueño si no dicen `security_invoker`, y los
-- privilegios por defecto les dan SELECT a anon y authenticated. Por eso cada
-- vista nueva nacía salteando RLS: el 2026-10-07 se cerró `org_members` y el
-- 2026-10-13 aparecieron otras 20 (kardex legible sin login, entre otras).
-- Este event trigger es el espejo de `ensure_rls` (que activa RLS en cada
-- tabla nueva): si la vista no declara `security_invoker`, queda en `true`.
--
-- Para que una vista corra como dueño hay que escribirlo:
--   CREATE VIEW ... WITH (security_invoker = false) AS ...
-- y dejar el motivo en su comentario (`@publica:` o `@revisada:`).
--
-- ⚠️ `CREATE OR REPLACE VIEW` sin `WITH` borra las opciones (probado el
-- 2026-10-13). Al reemplazar una de las 17 vistas que hoy corren como dueño
-- hay que repetir `WITH (security_invoker = false)`; si se olvida, queda
-- invoker. Es el lado seguro: se ve vacía, no filtra.
--
-- Si el ALTER falla, la creación de la vista falla: mejor un error en la
-- migración que una vista abierta en producción.
-- Idempotente.
BEGIN;

CREATE OR REPLACE FUNCTION public.vistas_invoker_por_defecto()
RETURNS event_trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  cmd record;
  v_opciones text[];
BEGIN
  FOR cmd IN
    SELECT * FROM pg_event_trigger_ddl_commands()
     WHERE command_tag = 'CREATE VIEW' AND object_type = 'view' AND schema_name = 'public'
  LOOP
    SELECT reloptions INTO v_opciones FROM pg_class WHERE oid = cmd.objid;
    IF NOT EXISTS (SELECT 1 FROM unnest(coalesce(v_opciones, '{}')) o WHERE o LIKE 'security_invoker=%') THEN
      EXECUTE format('ALTER VIEW %s SET (security_invoker = true)', cmd.object_identity);
      RAISE LOG 'vistas_invoker_por_defecto: % quedó con security_invoker', cmd.object_identity;
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.vistas_invoker_por_defecto() FROM PUBLIC, anon, authenticated;

DROP EVENT TRIGGER IF EXISTS vistas_invoker_por_defecto;
CREATE EVENT TRIGGER vistas_invoker_por_defecto
  ON ddl_command_end
  WHEN TAG IN ('CREATE VIEW')
  EXECUTE FUNCTION public.vistas_invoker_por_defecto();

COMMIT;
