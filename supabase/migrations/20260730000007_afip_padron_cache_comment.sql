-- `afip_padron_cache` tiene RLS habilitada y CERO policies A PROPÓSITO.
--
-- Es un caché global compartido entre organizaciones, con clave CUIT y sin
-- columna org_id. Los datos del padrón son públicos, pero *qué CUIT consultó
-- cada negocio* no lo es: una policy de lectura para `authenticated` dejaría
-- que cualquier org viera a quién le está facturando otra.
--
-- Deny-by-default es el comportamiento correcto: solo las Edge Functions
-- (service_role, que hace bypass de RLS) leen y escriben acá.
--
-- Este comentario existe para que una auditoría futura no lo "corrija"
-- agregando una policy permisiva. Idempotente.

COMMENT ON TABLE public.afip_padron_cache IS
  'Caché global del padrón AFIP (clave CUIT, sin org_id). RLS sin policies a propósito: solo accesible vía service_role desde Edge Functions. NO agregar policies para authenticated: filtraría qué CUIT consulta cada organización.';
