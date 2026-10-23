-- Las vistas son de sólo lectura y nadie trunca tablas desde la API.
--
-- La auditoría sobre la base reconstruida (scripts/auditoria-local.mjs)
-- encontró que los privilegios por defecto de `public` le dieron INSERT,
-- UPDATE y DELETE a anon y authenticated sobre 13 vistas que corren con los
-- permisos de su dueño y son auto-actualizables (afip_connection_status,
-- payment_connection_status, meli_connection_status, ventas_sin_asentar, …):
-- a través de ellas se podía escribir en la tabla de abajo sin pasar por RLS
-- (por ejemplo, marcar verificado un certificado de ARCA). Ninguna pantalla ni
-- función escribe por una vista: las escrituras van por tablas con RLS o por
-- funciones con permisos propios.
--   1. Toda vista de `public`: sin INSERT, UPDATE, DELETE ni TRUNCATE para
--      PUBLIC, anon y authenticated (el SELECT queda como estaba).
--   2. Toda tabla de `public`: sin TRUNCATE, REFERENCES ni TRIGGER para esos
--      roles (TRUNCATE no lo frena RLS).
--   3. Lo mismo para lo que se cree de acá en adelante.
-- Reversible: volver a otorgar los privilegios a mano (no hay uso legítimo).
BEGIN;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.relname, c.relkind
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('v', 'm', 'r', 'p')
  LOOP
    IF r.relkind IN ('v', 'm') THEN
      EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.%I FROM PUBLIC, anon, authenticated', r.relname);
    ELSE
      EXECUTE format('REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.%I FROM PUBLIC, anon, authenticated', r.relname);
    END IF;
  END LOOP;
END $$;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM PUBLIC, anon, authenticated;

COMMIT;
