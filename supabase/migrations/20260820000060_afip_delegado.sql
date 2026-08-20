-- ═══════════════════════════════════════════════════════════════════════════
-- C14 — AFIP delegado: un certificado en la plataforma, ninguno en el comercio
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Hoy `afip_credentials` tiene `certificate` y `private_key` **por comercio**.
-- Eso significa que cada uno tendría que generar una clave privada con openssl,
-- armar un CSR, subirlo a WSASS, crear un alias y asociar el servicio. Nadie que
-- quiera vender perfumes va a hacer eso. El onboarding se muere ahí.
--
-- `CLAUDE.md` ya decía cuál era el modelo correcto —"lo más parecido al modelo
-- marketplace es que cada comercio delegue el servicio WSFE al CUIT de la
-- plataforma desde Administrador de Relaciones"— y el código hacía lo contrario.
--
-- ── Cómo funciona la delegación ────────────────────────────────────────────
--
-- El certificado identifica a un **computador**, no a un contribuyente. El
-- Ticket de Acceso que devuelve WSAA es por (certificado, servicio) y **no
-- menciona ningún CUIT**. Quién factura se decide después, en el campo `Cuit`
-- del `<Auth>` de FECAESolicitar. ARCA acepta ese CUIT si el contribuyente
-- delegó `wsfe` al CUIT dueño del certificado.
--
-- ⚠️ **Consecuencia que no es una optimización sino una condición.** WSAA
-- rechaza pedir un TA nuevo mientras hay uno vigente para el mismo par. Con un
-- certificado compartido, pedir un TA por comercio chocaría entre sí apenas
-- haya dos facturando el mismo día — es el mismo error que ya nos hizo perder
-- una tarde en la sesión 114, cuando `test_connection` pedía TA nuevo siempre.
-- El TA de plataforma es **uno solo, para todos**, y por eso vive en su propia
-- tabla y no en la fila del comercio.
--
-- ── ⚠️ Lo que NO está verificado ───────────────────────────────────────────
--
-- Que ARCA acepte emitir con el CUIT del delegante usando el certificado del
-- delegado. Es como funcionan los servicios de facturación que existen y es lo
-- que documenta el "Administrador de Relaciones", pero **no lo probamos contra
-- el organismo**. Por eso esto **no borra** el camino del certificado propio:
-- convive. Un comercio que ya tiene su certificado sigue funcionando igual, y
-- si la delegación no resultara aceptable, lo único que se pierde es el modo
-- cómodo, no la facturación.
--
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. El certificado de la plataforma ─────────────────────────────────────
--
-- Una sola fila, con candado en la PK: dos certificados activos serían dos TA
-- peleando por el mismo par (certificado, servicio).

CREATE TABLE IF NOT EXISTS public.afip_platform_credentials (
  id            boolean PRIMARY KEY DEFAULT true CHECK (id),
  cuit          text NOT NULL,
  razon_social  text,
  certificate   text,
  private_key   text,
  environment   text NOT NULL DEFAULT 'homologacion'
                CHECK (environment IN ('homologacion','produccion')),
  -- El TA compartido. Ver arriba: es uno para toda la plataforma.
  ta_token      text,
  ta_sign       text,
  ta_expires_at timestamptz,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.afip_platform_credentials IS
  'Certificado de AFIP de la plataforma. Una sola fila. RLS habilitada y CERO policies a proposito: solo lo toca la Edge Function con service_role.';

-- ⚠️ RLS habilitada y **cero policies**, igual que `afip_credentials`,
-- `payment_connections` y `meli_connections`. La clave privada de acá adentro
-- es el permiso para facturar en nombre de todos los comercios: es el secreto
-- más valioso del sistema. Ni siquiera un platform_admin la lee — mira la
-- vista.
ALTER TABLE public.afip_platform_credentials ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.afip_platform_credentials FROM anon, authenticated;

-- ── 2. El comercio elige modo ──────────────────────────────────────────────

ALTER TABLE public.afip_credentials
  ADD COLUMN IF NOT EXISTS modo text NOT NULL DEFAULT 'delegado';

DO $blk$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'afip_credentials_modo_check') THEN
    ALTER TABLE public.afip_credentials
      ADD CONSTRAINT afip_credentials_modo_check CHECK (modo IN ('delegado','propio'));
  END IF;
END $blk$;

COMMENT ON COLUMN public.afip_credentials.modo IS
  'delegado = factura con el certificado de la plataforma, el comercio solo carga CUIT y razon social. propio = subio su propio certificado.';

-- Quien ya tenía certificado propio se queda como estaba. Cambiarle el modo por
-- el default lo habría dejado facturando por un camino que no eligió.
UPDATE public.afip_credentials SET modo = 'propio'
 WHERE certificate IS NOT NULL AND modo = 'delegado';

-- ── 3. Qué ve el superadmin ────────────────────────────────────────────────

DROP VIEW IF EXISTS public.afip_platform_status CASCADE;
CREATE VIEW public.afip_platform_status AS
SELECT
  c.cuit,
  c.razon_social,
  c.environment,
  (c.certificate IS NOT NULL AND c.private_key IS NOT NULL) AS configured,
  c.ta_expires_at,
  (c.ta_expires_at IS NOT NULL AND c.ta_expires_at > now())  AS ticket_vigente,
  c.updated_at,
  (SELECT count(*) FROM public.afip_credentials a WHERE a.modo = 'delegado')::int AS comercios_delegados
FROM public.afip_platform_credentials c
WHERE public.is_platform_admin(auth.uid());

COMMENT ON VIEW public.afip_platform_status IS
  'Estado del certificado de plataforma para el superadmin. Nunca expone el PEM ni la clave privada.';

GRANT SELECT ON public.afip_platform_status TO authenticated;

-- ── 4. Qué ve el comercio ──────────────────────────────────────────────────
--
-- La vista anterior calculaba `configured` mirando el certificado propio. Con
-- el modo delegado eso diría "sin configurar" para un comercio que puede
-- facturar perfectamente. `configured` pasa a significar **"puede emitir"**,
-- que es la pregunta que el panel quiere contestar.

DROP VIEW IF EXISTS public.afip_connection_status CASCADE;
CREATE VIEW public.afip_connection_status AS
SELECT
  a.org_id,
  a.cuit,
  a.punto_venta,
  a.environment,
  a.tipo_emisor,
  a.razon_social,
  a.domicilio,
  a.modo,
  (a.cuit IS NOT NULL AND btrim(a.cuit) <> '' AND
   CASE a.modo
     WHEN 'propio' THEN a.certificate IS NOT NULL AND a.private_key IS NOT NULL
     ELSE EXISTS (SELECT 1 FROM public.afip_platform_credentials p
                   WHERE p.certificate IS NOT NULL AND p.private_key IS NOT NULL)
   END) AS configured,
  -- Se expone aparte para poder decirle al comercio *por qué* no puede emitir:
  -- "falta que delegues el servicio" es distinto de "la plataforma todavía no
  -- está lista", y son de dos responsables distintos.
  EXISTS (SELECT 1 FROM public.afip_platform_credentials p
           WHERE p.certificate IS NOT NULL AND p.private_key IS NOT NULL) AS plataforma_lista,
  CASE a.modo
    WHEN 'propio' THEN a.ta_expires_at
    ELSE (SELECT p.ta_expires_at FROM public.afip_platform_credentials p LIMIT 1)
  END AS ta_expires_at,
  CASE a.modo
    WHEN 'propio' THEN (a.ta_expires_at IS NOT NULL AND a.ta_expires_at > now())
    ELSE (SELECT p.ta_expires_at > now() FROM public.afip_platform_credentials p LIMIT 1)
  END AS ticket_vigente,
  a.updated_at
FROM public.afip_credentials a
WHERE public.is_org_member(a.org_id, auth.uid());

COMMENT ON VIEW public.afip_connection_status IS
  'Estado de AFIP por organizacion. `configured` significa PUEDE EMITIR, no "subio un certificado": en modo delegado el certificado es el de la plataforma. Nunca expone el PEM ni la clave privada.';

GRANT SELECT ON public.afip_connection_status TO authenticated;

-- ── 5. El comercio carga su identidad fiscal, y nada más ───────────────────
--
-- Sin esto el comercio no puede escribir su propio CUIT: `afip_credentials` no
-- tiene policies. Guarda **sólo** los campos de identidad; `certificate` y
-- `private_key` no están en la firma, así que este camino no puede escribirlos
-- aunque alguien lo llame a mano con otro payload.

CREATE OR REPLACE FUNCTION public.guardar_identidad_afip(
  p_org          uuid,
  p_cuit         text,
  p_razon_social text,
  p_domicilio    text,
  p_tipo_emisor  text,
  p_punto_venta  int DEFAULT 1,
  p_environment  text DEFAULT 'homologacion')
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_cuit text := regexp_replace(COALESCE(p_cuit,''), '[^0-9]', '', 'g');
BEGIN
  IF p_org IS NULL THEN
    RAISE EXCEPTION 'Falta la organizacion';
  END IF;
  IF NOT public.has_org_role(p_org, auth.uid(), ARRAY['owner','admin']) THEN
    RAISE EXCEPTION 'Solo el dueno o un administrador pueden configurar la facturacion';
  END IF;

  -- El CUIT se valida acá y no sólo en el formulario: un dígito verificador mal
  -- hace que ARCA rechace la **factura**, no el alta, y el error aparecería
  -- recién cuando haya una venta real que facturar.
  IF NOT public.cuit_valido(v_cuit) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'El CUIT no es valido (digito verificador)');
  END IF;

  IF p_tipo_emisor IS NOT NULL
     AND p_tipo_emisor NOT IN ('responsable_inscripto','monotributo','exento') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Tipo de emisor desconocido: ' || p_tipo_emisor);
  END IF;

  INSERT INTO public.afip_credentials
    (org_id, cuit, razon_social, domicilio, tipo_emisor, punto_venta, environment, modo, updated_at)
  VALUES
    (p_org, v_cuit, NULLIF(btrim(p_razon_social),''), NULLIF(btrim(p_domicilio),''),
     p_tipo_emisor, GREATEST(COALESCE(p_punto_venta,1),1), p_environment, 'delegado', now())
  ON CONFLICT (org_id) DO UPDATE SET
    cuit         = EXCLUDED.cuit,
    razon_social = EXCLUDED.razon_social,
    domicilio    = EXCLUDED.domicilio,
    tipo_emisor  = EXCLUDED.tipo_emisor,
    punto_venta  = EXCLUDED.punto_venta,
    environment  = EXCLUDED.environment,
    -- ⚠️ NO toca `modo`: un comercio con certificado propio que edita su razón
    -- social no debe quedar delegado de rebote.
    updated_at   = now();

  -- `settings` mantiene el espejo que leen el trigger de facturación y el
  -- checkout. No es duplicación por descuido: `tipo_de_comprobante` lo consulta
  -- desde SQL y `afip_credentials` no tiene policies.
  UPDATE public.settings SET
    afip_cuit         = v_cuit,
    afip_razon_social = NULLIF(btrim(p_razon_social),''),
    afip_domicilio    = NULLIF(btrim(p_domicilio),''),
    afip_tipo_emisor  = p_tipo_emisor,
    afip_punto_venta  = GREATEST(COALESCE(p_punto_venta,1),1),
    afip_environment  = p_environment
  WHERE org_id = p_org;

  RETURN jsonb_build_object(
    'ok', true, 'cuit', v_cuit,
    'modo', (SELECT modo FROM public.afip_credentials WHERE org_id = p_org));
END;
$fn$;

REVOKE ALL ON FUNCTION public.guardar_identidad_afip(uuid,text,text,text,text,int,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guardar_identidad_afip(uuid,text,text,text,text,int,text) TO authenticated;
