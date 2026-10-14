-- ADR 006, acción 3: lo nuevo no le da nada a anon.
--
-- Medido 2026-10-13 en pg_default_acl: toda tabla o vista que crea `postgres`
-- en `public` nacía con `arwdDxtm` para anon y authenticated, y cada
-- secuencia con `rwU`. En tablas lo frena RLS (`ensure_rls`), pero en vistas
-- no hay RLS: así quedó el kardex legible sin login. Igual que se hizo con
-- las funciones el 2026-10-01 (20261001000300), anon sale de los privilegios
-- por defecto. Lo público se concede en la migración que lo crea:
--   GRANT SELECT ON public.mi_vista_publica TO anon;
-- Falla cerrado: un olvido da «permiso denegado», no una fuga.
--
-- authenticated conserva sus defaults: las tablas tienen RLS forzado y las
-- vistas nuevas quedan invoker (20261013000800).
-- Sólo afecta a objetos que se creen desde ahora; lo existente no cambia.
-- Idempotente.
BEGIN;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon;

COMMIT;
