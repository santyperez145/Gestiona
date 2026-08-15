-- AFIP: la configuración fiscal y la organización activa deben tener una sola
-- fuente de verdad. `afip_config` es una tabla heredada que contenía un
-- certificado y una clave bajo una policy de miembros: RLS es por fila, por lo
-- que un empleado podía leer los dos. La UI actual usa `afip_credentials`,
-- tabla con RLS y cero policies, y la vista saneada `afip_connection_status`.
--
-- Esta migración rescata cualquier configuración de la tabla vieja sin pisar
-- una configuración más nueva, borra los secretos heredados y bloquea el
-- acceso de PostgREST a la tabla obsoleta. También reemplaza el RPC que elegía
-- arbitrariamente la primera organización owner/admin de una persona: el
-- llamador ahora debe indicar y poder administrar la organización activa.
--
-- Idempotente. Se verifica al final sin crear ni modificar datos de negocio.

-- Puede existir una instalación vieja donde la pantalla AFIP escribió acá.
-- Se copian los valores sólo si todavía faltan en la fuente segura; una
-- configuración creada luego desde Ajustes siempre gana.
INSERT INTO public.afip_credentials AS credentials (
  org_id,
  cuit,
  certificate,
  private_key,
  punto_venta,
  environment,
  razon_social,
  updated_at
)
SELECT
  legacy.org_id,
  NULLIF(regexp_replace(COALESCE(legacy.cuit, ''), '\D', '', 'g'), ''),
  legacy.cert_pem,
  legacy.key_pem,
  COALESCE(NULLIF(legacy.punto_venta, 0), 1),
  CASE WHEN legacy.ambiente IN ('homologacion', 'produccion')
       THEN legacy.ambiente ELSE 'homologacion' END,
  legacy.razon_social,
  now()
FROM public.afip_config AS legacy
ON CONFLICT (org_id) DO UPDATE SET
  cuit = COALESCE(NULLIF(credentials.cuit, ''), EXCLUDED.cuit),
  certificate = COALESCE(credentials.certificate, EXCLUDED.certificate),
  private_key = COALESCE(credentials.private_key, EXCLUDED.private_key),
  razon_social = COALESCE(credentials.razon_social, EXCLUDED.razon_social),
  updated_at = CASE
    WHEN credentials.certificate IS NULL AND EXCLUDED.certificate IS NOT NULL
      OR credentials.private_key IS NULL AND EXCLUDED.private_key IS NOT NULL
      OR credentials.cuit IS NULL AND EXCLUDED.cuit IS NOT NULL
    THEN now()
    ELSE credentials.updated_at
  END;

-- La versión heredada aceptaba CUIT con guiones. Si quedó alguno de esa vía,
-- se normaliza al formato de 11 dígitos que espera WSAA, sin alterar otro dato.
UPDATE public.afip_credentials
SET cuit = regexp_replace(cuit, '\D', '', 'g')
WHERE cuit IS NOT NULL
  AND cuit <> regexp_replace(cuit, '\D', '', 'g');

-- Después de la copia no queda un secreto recuperable por una policy antigua.
UPDATE public.afip_config
SET cert_pem = NULL,
    key_pem = NULL
WHERE cert_pem IS NOT NULL OR key_pem IS NOT NULL;

-- La tabla queda como evidencia histórica hasta que una futura migración la
-- retire, pero el navegador no puede leerla ni escribirla. La UI usa la vista
-- saneada y el RPC de abajo.
ALTER TABLE public.afip_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_afip_config" ON public.afip_config;
REVOKE ALL ON TABLE public.afip_config FROM PUBLIC;
REVOKE ALL ON TABLE public.afip_config FROM anon, authenticated;

-- El RPC anterior no recibía org_id y hacía SELECT ... LIMIT 1. En una cuenta
-- con más de un comercio podía guardar el CUIT/certificado de la tienda A en
-- la B. Se quita para que ningún cliente viejo conserve ese comportamiento.
DROP FUNCTION IF EXISTS public.save_afip_config(text, integer, text, text, text, text);

CREATE OR REPLACE FUNCTION public.save_afip_config(
  p_org_id       uuid,
  p_cuit         text,
  p_punto_venta  integer,
  p_environment  text,
  p_tipo_emisor  text DEFAULT NULL,
  p_razon_social text DEFAULT NULL,
  p_domicilio    text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_org_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.memberships AS membership
    WHERE membership.org_id = p_org_id
      AND membership.user_id = auth.uid()
      AND membership.role IN ('owner', 'admin')
  ) THEN
    RAISE EXCEPTION 'Sólo el dueño o un administrador pueden configurar AFIP para esta organización';
  END IF;

  IF p_environment NOT IN ('homologacion', 'produccion') THEN
    RAISE EXCEPTION 'Entorno inválido: %', p_environment;
  END IF;

  IF regexp_replace(COALESCE(p_cuit, ''), '\D', '', 'g') !~ '^\d{11}$' THEN
    RAISE EXCEPTION 'El CUIT debe tener 11 dígitos';
  END IF;

  IF p_punto_venta IS NULL OR p_punto_venta NOT BETWEEN 1 AND 9999 THEN
    RAISE EXCEPTION 'El punto de venta debe estar entre 1 y 9999';
  END IF;

  IF p_tipo_emisor IS NOT NULL
     AND p_tipo_emisor NOT IN ('monotributo', 'responsable_inscripto') THEN
    RAISE EXCEPTION 'Tipo de emisor inválido';
  END IF;

  INSERT INTO public.afip_credentials AS credentials (
    org_id, cuit, punto_venta, environment, tipo_emisor, razon_social, domicilio
  ) VALUES (
    p_org_id,
    regexp_replace(p_cuit, '\D', '', 'g'),
    p_punto_venta,
    p_environment,
    p_tipo_emisor,
    NULLIF(trim(p_razon_social), ''),
    NULLIF(trim(p_domicilio), '')
  )
  ON CONFLICT (org_id) DO UPDATE SET
    cuit = EXCLUDED.cuit,
    punto_venta = EXCLUDED.punto_venta,
    ta_token = CASE
      WHEN credentials.environment <> EXCLUDED.environment THEN NULL
      ELSE credentials.ta_token
    END,
    ta_sign = CASE
      WHEN credentials.environment <> EXCLUDED.environment THEN NULL
      ELSE credentials.ta_sign
    END,
    ta_expires_at = CASE
      WHEN credentials.environment <> EXCLUDED.environment THEN NULL
      ELSE credentials.ta_expires_at
    END,
    environment = EXCLUDED.environment,
    tipo_emisor = EXCLUDED.tipo_emisor,
    razon_social = EXCLUDED.razon_social,
    domicilio = EXCLUDED.domicilio,
    updated_at = now();

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.save_afip_config(uuid, text, integer, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_afip_config(uuid, text, integer, text, text, text, text) TO authenticated;

DO $$
DECLARE
  v_legacy_secrets integer;
BEGIN
  SELECT count(*) INTO v_legacy_secrets
  FROM public.afip_config
  WHERE cert_pem IS NOT NULL OR key_pem IS NOT NULL;

  IF v_legacy_secrets <> 0 THEN
    RAISE EXCEPTION 'Quedaron % secretos en afip_config', v_legacy_secrets;
  END IF;

  IF has_table_privilege('authenticated', 'public.afip_config', 'SELECT')
     OR has_table_privilege('anon', 'public.afip_config', 'SELECT') THEN
    RAISE EXCEPTION 'afip_config sigue siendo legible por un rol del navegador';
  END IF;

  IF to_regprocedure('public.save_afip_config(text,integer,text,text,text,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'Sigue existiendo la versión de save_afip_config sin org_id';
  END IF;
END;
$$;
