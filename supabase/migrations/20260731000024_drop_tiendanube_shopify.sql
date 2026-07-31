-- Se van las integraciones que no se usan: Tiendanube (API) y Shopify.
--
-- Ninguna organización las tenía conectadas. Se verificó fila por fila antes
-- de borrar: `tiendanube_connections`, `tiendanube_integrations` y
-- `tiendanube_sync_log` en 0, y ninguna fila de `settings` con datos de
-- Shopify. Si alguna hubiera tenido algo, esto no se corría.
--
-- El motivo no es sólo higiene. Sostener OAuth, webhook y dos sincronizadores
-- de la plataforma con la que se compite es trabajo que no paga, y cada
-- endpoint desplegado es superficie de ataque que hay que cuidar. Lo que
-- **sí** queda es el importador de planillas de Tiendanube, que no usa API ni
-- credenciales: es el camino de entrada para un comercio que se cambia.
--
-- Destructiva a propósito. Es idempotente y se puede volver a correr.

-- ── Tiendanube ────────────────────────────────────────────────────────────
DROP TABLE IF EXISTS public.tiendanube_sync_log      CASCADE;
DROP TABLE IF EXISTS public.tiendanube_integrations  CASCADE;
DROP TABLE IF EXISTS public.tiendanube_connections   CASCADE;

-- ── Shopify ───────────────────────────────────────────────────────────────
-- Nunca hubo más que estas cuatro columnas: no llegó a tener tabla propia.
ALTER TABLE public.settings
  DROP COLUMN IF EXISTS shopify_store_url,
  DROP COLUMN IF EXISTS shopify_api_key,
  DROP COLUMN IF EXISTS shopify_api_secret,
  DROP COLUMN IF EXISTS shopify_enabled;

-- Los registros de actividad de esas integraciones dejan de tener sentido.
DELETE FROM public.integration_logs
 WHERE integration IN ('tiendanube', 'shopify');
