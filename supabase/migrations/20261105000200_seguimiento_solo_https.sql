-- El enlace de seguimiento sólo http(s) (2026-11-05).
--
-- carriers.tracking_url es la plantilla que arma el «Seguirlo» de la página
-- del pedido en la tienda. Aceptaba cualquier texto: un «javascript:…» se
-- ejecutaba en el origen de Nerqia al tocar el enlace. La tienda ya filtra
-- (esUrlSegura) y la CSP lo bloquea; esto cierra la entrada. NOT VALID: no
-- toca filas existentes, sólo impide escribir nuevas.

ALTER TABLE public.carriers
  DROP CONSTRAINT IF EXISTS carriers_tracking_url_http;
ALTER TABLE public.carriers
  ADD CONSTRAINT carriers_tracking_url_http
  CHECK (tracking_url IS NULL OR tracking_url ~* '^https?://[^[:space:]]+$') NOT VALID;
