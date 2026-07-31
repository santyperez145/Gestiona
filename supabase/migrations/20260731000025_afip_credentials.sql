-- La clave privada de AFIP estaba donde cualquier empleado podía leerla.
--
-- `afip_certificate` y `afip_private_key` vivían en `settings`, que tiene una
-- policy `SELECT` para todos los miembros de la organización. RLS es a nivel
-- de fila, no de columna: quien puede leer la fila, lee la clave. Con esa clave
-- se emiten facturas a nombre del contribuyente — no es una credencial más.
--
-- Mismo patrón que `payment_connections` y `meli_connections`, ya probado en
-- este repo: tabla con RLS habilitada y **cero policies**, que sólo tocan las
-- Edge Functions con `service_role`. La UI lee una vista de estado que dice si
-- hay certificado cargado y cuándo vence, nunca el contenido.
--
-- Sobre OAuth: AFIP **no lo ofrece**. Su autenticación (WSAA) es un
-- certificado X.509 con el que se firma un ticket; no hay flujo de
-- autorización delegada al estilo MercadoPago. Lo más parecido es que el
-- contribuyente delegue el servicio WSFE al CUIT de la plataforma desde
-- "Administrador de Relaciones" de su Clave Fiscal — ahí el comercio no sube
-- ninguna clave. Esta tabla sirve para los dos modelos.
--
-- Idempotente.

CREATE TABLE IF NOT EXISTS public.afip_credentials (
  org_id        uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  cuit          text,
  -- PEM del certificado y de su clave privada. Nunca salen de acá.
  certificate   text,
  private_key   text,
  punto_venta   int  NOT NULL DEFAULT 1,
  environment   text NOT NULL DEFAULT 'homologacion'
                CHECK (environment IN ('homologacion', 'produccion')),
  tipo_emisor   text,
  razon_social  text,
  domicilio     text,
  -- Ticket de Acceso de WSAA: dura ~12 horas y se reusa mientras valga.
  ta_token      text,
  ta_sign       text,
  ta_expires_at timestamptz,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- RLS habilitada y sin una sola policy, a propósito: nadie llega por PostgREST.
ALTER TABLE public.afip_credentials ENABLE ROW LEVEL SECURITY;

-- Por si alguna corrida anterior dejó políticas.
DROP POLICY IF EXISTS "afip_credentials_org" ON public.afip_credentials;

-- ── Mudanza de lo que hubiera en settings ────────────────────────────────
-- Al aplicarse no había ninguna organización con datos cargados, pero se hace
-- igual: la migración tiene que servir en cualquier base, no sólo en ésta.
INSERT INTO public.afip_credentials (
  org_id, cuit, certificate, private_key, punto_venta, environment,
  tipo_emisor, razon_social, domicilio, ta_token, ta_sign, ta_expires_at
)
SELECT s.org_id, s.afip_cuit, s.afip_certificate, s.afip_private_key,
       COALESCE(s.afip_punto_venta, 1),
       COALESCE(NULLIF(s.afip_environment, ''), 'homologacion'),
       s.afip_tipo_emisor, s.afip_razon_social, s.afip_domicilio,
       s.afip_ta_token, s.afip_ta_sign, s.afip_ta_expires_at
FROM public.settings s
WHERE s.org_id IS NOT NULL
  AND (s.afip_cuit IS NOT NULL OR s.afip_certificate IS NOT NULL)
ON CONFLICT (org_id) DO NOTHING;

-- ── Vista de estado: lo que la UI necesita saber, y nada más ─────────────
-- SIN `security_invoker`: con él correría con los permisos de quien consulta,
-- y como la tabla de abajo no tiene policies devolvería siempre vacío. Ya pasó
-- con las vistas de estado de MercadoPago. El control lo hace el `WHERE`.
DROP VIEW IF EXISTS public.afip_connection_status;
CREATE VIEW public.afip_connection_status AS
SELECT
  c.org_id,
  c.cuit,
  c.punto_venta,
  c.environment,
  c.tipo_emisor,
  c.razon_social,
  (c.certificate IS NOT NULL AND c.private_key IS NOT NULL) AS configured,
  c.ta_expires_at,
  (c.ta_expires_at IS NOT NULL AND c.ta_expires_at > now())  AS ticket_vigente,
  c.updated_at
FROM public.afip_credentials c
WHERE public.is_org_member(c.org_id, auth.uid());

ALTER VIEW public.afip_connection_status SET (security_invoker = false);

REVOKE ALL   ON public.afip_connection_status FROM PUBLIC;
GRANT SELECT ON public.afip_connection_status TO authenticated;

-- ── Guardar la configuración que NO es secreta ───────────────────────────
-- El certificado y la clave entran por Edge Function; esto es para el resto.
CREATE OR REPLACE FUNCTION public.save_afip_config(
  p_cuit         text,
  p_punto_venta  int,
  p_environment  text,
  p_tipo_emisor  text DEFAULT NULL,
  p_razon_social text DEFAULT NULL,
  p_domicilio    text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_org uuid;
BEGIN
  SELECT m.org_id INTO v_org
  FROM public.memberships m
  WHERE m.user_id = auth.uid() AND m.role IN ('owner', 'admin')
  LIMIT 1;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Sólo el dueño o un administrador pueden configurar AFIP';
  END IF;

  IF p_environment NOT IN ('homologacion', 'produccion') THEN
    RAISE EXCEPTION 'Entorno inválido: %', p_environment;
  END IF;
  -- El CUIT sin guiones, 11 dígitos. Un CUIT mal cargado se descubre recién
  -- cuando AFIP rechaza la factura, que es el peor momento.
  IF p_cuit IS NOT NULL AND regexp_replace(p_cuit, '\D', '', 'g') !~ '^\d{11}$' THEN
    RAISE EXCEPTION 'El CUIT debe tener 11 dígitos';
  END IF;

  INSERT INTO public.afip_credentials AS a (
    org_id, cuit, punto_venta, environment, tipo_emisor, razon_social, domicilio
  ) VALUES (
    v_org, regexp_replace(COALESCE(p_cuit, ''), '\D', '', 'g'),
    GREATEST(1, COALESCE(p_punto_venta, 1)), p_environment,
    p_tipo_emisor, p_razon_social, p_domicilio
  )
  ON CONFLICT (org_id) DO UPDATE SET
    cuit         = COALESCE(NULLIF(EXCLUDED.cuit, ''), a.cuit),
    punto_venta  = EXCLUDED.punto_venta,
    -- Cambiar de entorno invalida el ticket: el de homologación no sirve en
    -- producción y viceversa.
    ta_token     = CASE WHEN a.environment <> EXCLUDED.environment THEN NULL ELSE a.ta_token END,
    ta_sign      = CASE WHEN a.environment <> EXCLUDED.environment THEN NULL ELSE a.ta_sign END,
    ta_expires_at= CASE WHEN a.environment <> EXCLUDED.environment THEN NULL ELSE a.ta_expires_at END,
    environment  = EXCLUDED.environment,
    tipo_emisor  = COALESCE(EXCLUDED.tipo_emisor, a.tipo_emisor),
    razon_social = COALESCE(EXCLUDED.razon_social, a.razon_social),
    domicilio    = COALESCE(EXCLUDED.domicilio, a.domicilio),
    updated_at   = now();

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL  ON FUNCTION public.save_afip_config(text, int, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_afip_config(text, int, text, text, text, text) TO authenticated;

-- ── Fuera de settings ────────────────────────────────────────────────────
ALTER TABLE public.settings
  DROP COLUMN IF EXISTS afip_certificate,
  DROP COLUMN IF EXISTS afip_private_key,
  DROP COLUMN IF EXISTS afip_ta_token,
  DROP COLUMN IF EXISTS afip_ta_sign;
