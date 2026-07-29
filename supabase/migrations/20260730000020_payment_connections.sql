-- Conexiones de cobro por organización, vía OAuth.
--
-- Hoy cada comercio pega su Access Token de MercadoPago a mano en Integraciones
-- y queda guardado en `settings.mp_access_token`. Eso tiene tres problemas:
--   * el comercio tiene que entrar al panel de desarrolladores de MP y copiar
--     un secreto, algo que la mayoría no sabe hacer ni debería;
--   * el token vive en una columna que el propio comercio puede leer desde el
--     navegador vía PostgREST;
--   * no se renueva solo, y cuando vence los cobros dejan de funcionar sin
--     aviso.
--
-- Así funcionan Tiendanube y Empretienda: la PLATAFORMA registra una sola
-- aplicación y cada tienda conecta su cuenta con un clic. Nosotros nunca vemos
-- las credenciales del comercio, solo un token delegado que se puede revocar.
--
-- La tabla es agnóstica del proveedor (`provider`) para poder sumar Stripe,
-- MODO o lo que venga sin rehacer el modelo.
--
-- Seguridad: RLS habilitada y CERO policies, igual que `meli_connections`.
-- Los tokens solo los tocan las Edge Functions con service_role; el navegador
-- lee la vista `payment_connection_status`, que no los expone.
-- Idempotente.

CREATE TABLE IF NOT EXISTS public.payment_connections (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  provider       text NOT NULL CHECK (provider IN ('mercadopago', 'stripe')),
  -- Identificador de la cuenta del comercio en el proveedor.
  external_id    text,
  nickname       text,
  email          text,
  access_token   text,
  refresh_token  text,
  public_key     text,
  expires_at     timestamptz,
  scopes         text,
  -- false = credenciales de prueba (sandbox).
  live_mode      boolean NOT NULL DEFAULT true,
  connected_at   timestamptz NOT NULL DEFAULT now(),
  last_error     text,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, provider)
);

ALTER TABLE public.payment_connections ENABLE ROW LEVEL SECURITY;
-- Sin policies a propósito.

COMMENT ON TABLE public.payment_connections IS
  'Tokens OAuth de los medios de cobro de cada comercio. RLS sin policies a propósito: solo service_role desde Edge Functions. La UI usa payment_connection_status. NO agregar policies para authenticated: expondría el token de cobro al navegador.';

CREATE INDEX IF NOT EXISTS payment_connections_org_idx ON public.payment_connections(org_id);

-- ── Estado visible para la UI, sin tokens ─────────────────────────────────
CREATE OR REPLACE VIEW public.payment_connection_status
WITH (security_invoker = true) AS
SELECT
  c.org_id,
  c.provider,
  c.nickname,
  c.email,
  c.external_id,
  c.live_mode,
  c.connected_at,
  c.last_error,
  (c.access_token IS NOT NULL)                                AS conectado,
  (c.expires_at IS NULL OR c.expires_at > now())              AS vigente,
  c.expires_at
FROM public.payment_connections c
WHERE public.is_org_member(c.org_id, auth.uid());

GRANT SELECT ON public.payment_connection_status TO authenticated;

-- ── Estados OAuth de corta vida (anti-CSRF) ───────────────────────────────
-- El parámetro `state` del redirect se guarda acá para verificar, al volver,
-- que el flujo lo inició esta misma app y para esta organización. Sin esto,
-- alguien podría inducir a un comercio a conectar una cuenta ajena.
CREATE TABLE IF NOT EXISTS public.oauth_states (
  state       text PRIMARY KEY,
  org_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  provider    text NOT NULL,
  user_id     uuid,
  redirect_to text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL DEFAULT now() + interval '15 minutes'
);

ALTER TABLE public.oauth_states ENABLE ROW LEVEL SECURITY;
-- Sin policies: solo service_role.

CREATE INDEX IF NOT EXISTS oauth_states_expires_idx ON public.oauth_states(expires_at);

-- Limpieza de estados vencidos, para que la tabla no crezca sin control.
CREATE OR REPLACE FUNCTION public.purge_expired_oauth_states()
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_n int;
BEGIN
  DELETE FROM public.oauth_states WHERE expires_at < now();
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;
