-- Padrón de ARCA (ws_sr_constancia_inscripcion).
--
-- Con un CUIT, la Edge `arca-padron` trae nombre, condición frente al IVA y
-- domicilio fiscal para completar clientes y el alta fiscal del comercio.
-- * afip_ta_servicios: Ticket de Acceso de la plataforma por servicio (el de
--   wsfe sigue en afip_platform_credentials). Secreto: sólo service_role.
-- * arca_padron_cache: datos públicos del padrón, 30 días, compartidos.
-- * arca_padron_consultas: quién consultó qué y cuándo, para el tope diario.

CREATE TABLE IF NOT EXISTS public.afip_ta_servicios (
  servicio text PRIMARY KEY CHECK (servicio ~ '^[a-z0-9_]{2,60}$'),
  token text NOT NULL,
  sign text NOT NULL,
  expires_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.arca_padron_cache (
  cuit text PRIMARY KEY CHECK (cuit ~ '^\d{11}$'),
  datos jsonb NOT NULL,
  consultado_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.arca_padron_consultas (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  cuit text NOT NULL,
  desde_cache boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS arca_padron_consultas_org_fecha ON public.arca_padron_consultas(org_id, created_at);

ALTER TABLE public.afip_ta_servicios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.arca_padron_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.arca_padron_consultas ENABLE ROW LEVEL SECURITY;

-- Sin políticas: el navegador no lee ni escribe; todo pasa por la Edge.
REVOKE ALL ON public.afip_ta_servicios, public.arca_padron_cache, public.arca_padron_consultas FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.afip_ta_servicios, public.arca_padron_cache, public.arca_padron_consultas TO service_role;
