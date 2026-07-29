-- Las vistas de estado de conexión no devolvían NADA.
--
-- `payment_connection_status` y `meli_connection_status` se crearon con
-- `security_invoker = true`, que hace que la vista corra con los permisos de
-- quien consulta. Pero las tablas de abajo (`payment_connections`,
-- `meli_connections`) tienen RLS habilitada y CERO policies a propósito —para
-- que los tokens nunca lleguen al navegador—, así que el usuario no puede leer
-- ni una fila y la vista salía siempre vacía.
--
-- Efecto práctico: el panel mostraba "sin conectar" aunque la cuenta estuviera
-- vinculada, y no había forma de desconectarla desde la UI.
--
-- Corrección: las vistas pasan a ejecutarse con los permisos de su dueño
-- (comportamiento por defecto de Postgres para vistas), y el control de acceso
-- lo hace su propia cláusula WHERE con `is_org_member`. Se sigue sin exponer
-- ningún token: las vistas solo seleccionan columnas seguras.
-- Idempotente.

CREATE OR REPLACE VIEW public.payment_connection_status AS
SELECT
  c.org_id,
  c.provider,
  c.nickname,
  c.email,
  c.external_id,
  c.live_mode,
  c.connected_at,
  c.last_error,
  (c.access_token IS NOT NULL)                   AS conectado,
  (c.expires_at IS NULL OR c.expires_at > now()) AS vigente,
  c.expires_at
FROM public.payment_connections c
WHERE public.is_org_member(c.org_id, auth.uid());

ALTER VIEW public.payment_connection_status SET (security_invoker = false);

CREATE OR REPLACE VIEW public.meli_connection_status AS
SELECT
  c.org_id,
  c.nickname,
  c.site_id,
  c.meli_user_id,
  c.connected_at,
  c.last_error,
  (c.access_token IS NOT NULL) AS conectado,
  (c.expires_at > now())       AS token_vigente,
  c.expires_at
FROM public.meli_connections c
WHERE public.is_org_member(c.org_id, auth.uid());

ALTER VIEW public.meli_connection_status SET (security_invoker = false);

GRANT SELECT ON public.payment_connection_status TO authenticated;
GRANT SELECT ON public.meli_connection_status    TO authenticated;
