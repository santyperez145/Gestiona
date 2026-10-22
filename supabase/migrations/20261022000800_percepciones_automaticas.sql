-- Percepciones automáticas para agentes de percepción (IIBB e IVA).
--
-- Un comercio designado agente de percepción tiene que sumar la percepción
-- en cada factura a un cliente alcanzado. La de Ingresos Brutos depende del
-- padrón que publica el organismo (ARBA, AGIP) para cada CUIT; la de IVA, de
-- la alícuota del régimen. Hasta acá se cargaba a mano en cada factura.
--
--   1. `afip_credentials`: si es agente de IIBB (y de qué padrón), qué
--      alícuota aplicar a quien no está en el padrón (vacío = no percibir), la
--      base mínima, y si es agente de IVA con su alícuota.
--   2. `padron_iibb_alicuotas`: el padrón, sólo de los clientes del comercio
--      (el navegador filtra el archivo del organismo, que pesa cientos de MB).
--   3. `cargar_padron_iibb`: dueño o administrador, por tandas.
--   4. `percepciones_para_cliente`: las percepciones que corresponden a un
--      CUIT para una base y una fecha, listas para `p_fiscal.tributos`.
--   5. `configurar_percepciones` y `datos_percepciones`.
-- Reversible: DROP de la tabla, las funciones y las columnas nuevas.
BEGIN;

ALTER TABLE public.afip_credentials
  ADD COLUMN IF NOT EXISTS percepcion_iibb_agente boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS percepcion_iibb_padron text,
  ADD COLUMN IF NOT EXISTS percepcion_iibb_sin_padron numeric(5,2),
  ADD COLUMN IF NOT EXISTS percepcion_iibb_minimo numeric(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS percepcion_iva_agente boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS percepcion_iva_alicuota numeric(5,2);
ALTER TABLE public.afip_credentials DROP CONSTRAINT IF EXISTS afip_credentials_percepciones_check;
ALTER TABLE public.afip_credentials ADD CONSTRAINT afip_credentials_percepciones_check CHECK (
  (percepcion_iibb_padron IS NULL OR percepcion_iibb_padron IN ('ARBA', 'AGIP'))
  AND (percepcion_iibb_sin_padron IS NULL OR percepcion_iibb_sin_padron BETWEEN 0 AND 100)
  AND percepcion_iibb_minimo >= 0
  AND (percepcion_iva_alicuota IS NULL OR percepcion_iva_alicuota BETWEEN 0 AND 100)
  AND (NOT percepcion_iibb_agente OR percepcion_iibb_padron IS NOT NULL)
  AND (NOT percepcion_iva_agente OR percepcion_iva_alicuota IS NOT NULL));

CREATE TABLE IF NOT EXISTS public.padron_iibb_alicuotas (
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  padron text NOT NULL CHECK (padron IN ('ARBA', 'AGIP')),
  cuit text NOT NULL CHECK (cuit ~ '^[0-9]{11}$'),
  alicuota numeric(5,2) NOT NULL CHECK (alicuota BETWEEN 0 AND 100),
  vigencia_desde date NOT NULL,
  vigencia_hasta date NOT NULL,
  baja boolean NOT NULL DEFAULT false,
  actualizado_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, padron, cuit),
  CHECK (vigencia_desde <= vigencia_hasta)
);
ALTER TABLE public.padron_iibb_alicuotas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS padron_iibb_leer ON public.padron_iibb_alicuotas;
CREATE POLICY padron_iibb_leer ON public.padron_iibb_alicuotas
  FOR SELECT TO authenticated USING (public.has_permission(org_id, 'invoices', 'view'));
REVOKE ALL ON public.padron_iibb_alicuotas FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.padron_iibb_alicuotas FROM authenticated;
GRANT SELECT ON public.padron_iibb_alicuotas TO authenticated;
GRANT ALL ON public.padron_iibb_alicuotas TO service_role;

CREATE OR REPLACE FUNCTION public.cargar_padron_iibb(p_org uuid, p_padron text, p_filas jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $cp$
DECLARE v_n integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_org_role(p_org, auth.uid(), ARRAY['owner', 'admin']) THEN
    RAISE EXCEPTION 'Solo el dueno o un administrador cargan el padron' USING ERRCODE = '42501';
  END IF;
  IF p_padron NOT IN ('ARBA', 'AGIP') THEN RAISE EXCEPTION 'El padron es ARBA o AGIP' USING ERRCODE = '22023'; END IF;
  IF jsonb_typeof(p_filas) <> 'array' OR jsonb_array_length(p_filas) > 5000 THEN
    RAISE EXCEPTION 'Se cargan hasta 5000 filas por vez' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.padron_iibb_alicuotas (org_id, padron, cuit, alicuota, vigencia_desde, vigencia_hasta, baja, actualizado_at)
  SELECT p_org, p_padron, f->>'cuit', round((f->>'alicuota')::numeric, 2),
         (f->>'vigencia_desde')::date, (f->>'vigencia_hasta')::date, COALESCE((f->>'baja')::boolean, false), now()
    FROM jsonb_array_elements(p_filas) f
   WHERE f->>'cuit' ~ '^[0-9]{11}$'
  ON CONFLICT (org_id, padron, cuit) DO UPDATE
    SET alicuota = EXCLUDED.alicuota, vigencia_desde = EXCLUDED.vigencia_desde,
        vigencia_hasta = EXCLUDED.vigencia_hasta, baja = EXCLUDED.baja, actualizado_at = now();
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$cp$;

-- Las percepciones que corresponden a un cliente, en el formato de
-- `p_fiscal.tributos`: IIBB (tributo 7) según el padrón vigente o la
-- alícuota para quien no está; IVA (tributo 6) al receptor con CUIT.
CREATE OR REPLACE FUNCTION public.percepciones_para_cliente(p_org uuid, p_cuit text, p_base numeric, p_fecha date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $pc$
DECLARE
  c public.afip_credentials;
  v_cuit text := regexp_replace(COALESCE(p_cuit, ''), '\D', '', 'g');
  v_fecha date := COALESCE(p_fecha, (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date);
  v_alic numeric;
  v_padron public.padron_iibb_alicuotas;
  v_origen text;
  v_out jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_permission(p_org, 'invoices', 'view') THEN
    RAISE EXCEPTION 'No tenes permiso sobre la facturacion de este negocio' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO c FROM public.afip_credentials WHERE org_id = p_org;
  IF NOT FOUND OR length(v_cuit) <> 11 OR COALESCE(p_base, 0) <= 0 THEN RETURN v_out; END IF;

  IF c.percepcion_iibb_agente AND p_base >= c.percepcion_iibb_minimo THEN
    SELECT * INTO v_padron FROM public.padron_iibb_alicuotas
     WHERE org_id = p_org AND padron = c.percepcion_iibb_padron AND cuit = v_cuit;
    IF FOUND AND NOT v_padron.baja AND v_fecha BETWEEN v_padron.vigencia_desde AND v_padron.vigencia_hasta THEN
      v_alic := v_padron.alicuota; v_origen := 'padron';
    ELSIF NOT FOUND OR v_padron.baja THEN
      v_alic := c.percepcion_iibb_sin_padron; v_origen := 'sin_padron';
    ELSE
      v_alic := NULL; v_origen := 'padron_vencido';
    END IF;
    IF v_alic IS NOT NULL AND v_alic > 0 THEN
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'tipo', 7, 'descripcion', 'Percepción IIBB ' || c.percepcion_iibb_padron,
        'base', round(p_base, 2), 'alicuota', v_alic, 'importe', round(p_base * v_alic / 100, 2), 'origen', v_origen));
    ELSIF v_origen = 'padron_vencido' THEN
      v_out := v_out || jsonb_build_array(jsonb_build_object('tipo', 7, 'aviso',
        'El padron de ' || c.percepcion_iibb_padron || ' de este cliente no esta vigente: carga el padron del mes.'));
    END IF;
  END IF;

  IF c.percepcion_iva_agente AND c.percepcion_iva_alicuota > 0 THEN
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'tipo', 6, 'descripcion', 'Percepción IVA', 'base', round(p_base, 2),
      'alicuota', c.percepcion_iva_alicuota, 'importe', round(p_base * c.percepcion_iva_alicuota / 100, 2), 'origen', 'regimen'));
  END IF;
  RETURN v_out;
END;
$pc$;

CREATE OR REPLACE FUNCTION public.datos_percepciones(p_org uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $dp$
DECLARE c public.afip_credentials; v_clientes integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_org_member(p_org, auth.uid()) THEN
    RAISE EXCEPTION 'No perteneces a esta organizacion' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO c FROM public.afip_credentials WHERE org_id = p_org;
  SELECT count(*) INTO v_clientes FROM public.padron_iibb_alicuotas WHERE org_id = p_org AND padron = c.percepcion_iibb_padron;
  RETURN jsonb_build_object(
    'iibb_agente', COALESCE(c.percepcion_iibb_agente, false), 'iibb_padron', c.percepcion_iibb_padron,
    'iibb_sin_padron', c.percepcion_iibb_sin_padron, 'iibb_minimo', COALESCE(c.percepcion_iibb_minimo, 0),
    'iva_agente', COALESCE(c.percepcion_iva_agente, false), 'iva_alicuota', c.percepcion_iva_alicuota,
    'clientes_en_padron', v_clientes,
    'padron_hasta', (SELECT max(vigencia_hasta) FROM public.padron_iibb_alicuotas WHERE org_id = p_org AND padron = c.percepcion_iibb_padron));
END;
$dp$;

CREATE OR REPLACE FUNCTION public.configurar_percepciones(
  p_org uuid, p_iibb_agente boolean, p_iibb_padron text, p_iibb_sin_padron numeric, p_iibb_minimo numeric,
  p_iva_agente boolean, p_iva_alicuota numeric
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $cfp$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_org_role(p_org, auth.uid(), ARRAY['owner', 'admin']) THEN
    RAISE EXCEPTION 'Solo el dueno o un administrador configuran las percepciones' USING ERRCODE = '42501';
  END IF;
  IF p_iibb_agente AND COALESCE(p_iibb_padron, '') NOT IN ('ARBA', 'AGIP') THEN
    RAISE EXCEPTION 'Elegi el padron de Ingresos Brutos (ARBA o AGIP)' USING ERRCODE = '22023';
  END IF;
  IF p_iva_agente AND NOT COALESCE(p_iva_alicuota, 0) > 0 THEN
    RAISE EXCEPTION 'Indica la alicuota de la percepcion de IVA' USING ERRCODE = '22023';
  END IF;
  UPDATE public.afip_credentials
     SET percepcion_iibb_agente = COALESCE(p_iibb_agente, false),
         percepcion_iibb_padron = CASE WHEN p_iibb_agente THEN p_iibb_padron END,
         percepcion_iibb_sin_padron = CASE WHEN p_iibb_agente THEN p_iibb_sin_padron END,
         percepcion_iibb_minimo = COALESCE(p_iibb_minimo, 0),
         percepcion_iva_agente = COALESCE(p_iva_agente, false),
         percepcion_iva_alicuota = CASE WHEN p_iva_agente THEN p_iva_alicuota END,
         updated_at = now()
   WHERE org_id = p_org;
  IF NOT FOUND THEN RAISE EXCEPTION 'Configura primero la identidad fiscal del comercio' USING ERRCODE = '22023'; END IF;
  RETURN public.datos_percepciones(p_org);
END;
$cfp$;

REVOKE ALL ON FUNCTION public.cargar_padron_iibb(uuid, text, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.percepciones_para_cliente(uuid, text, numeric, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.datos_percepciones(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.configurar_percepciones(uuid, boolean, text, numeric, numeric, boolean, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cargar_padron_iibb(uuid, text, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.percepciones_para_cliente(uuid, text, numeric, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.datos_percepciones(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.configurar_percepciones(uuid, boolean, text, numeric, numeric, boolean, numeric) TO authenticated, service_role;

INSERT INTO public.security_function_contracts(function_name, identity_arguments, audience, rationale, definition_hash, reviewed_on)
SELECT p.proname, pg_get_function_identity_arguments(p.oid), 'authenticated_delegate',
       CASE p.proname
         WHEN 'cargar_padron_iibb' THEN 'Exige ser dueño o administrador; sólo carga el padrón de su negocio.'
         WHEN 'percepciones_para_cliente' THEN 'Exige ver la facturación del negocio; sólo lee su configuración y su padrón.'
         WHEN 'datos_percepciones' THEN 'Exige ser miembro del negocio; sólo devuelve su configuración de percepciones.'
         ELSE 'Exige ser dueño o administrador; sólo cambia la configuración de percepciones de su negocio.'
       END,
       md5(pg_get_functiondef(p.oid)), DATE '2026-10-22'
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname IN ('cargar_padron_iibb', 'percepciones_para_cliente', 'datos_percepciones', 'configurar_percepciones')
ON CONFLICT (function_name, identity_arguments) DO UPDATE
  SET definition_hash = EXCLUDED.definition_hash, reviewed_on = EXCLUDED.reviewed_on, rationale = EXCLUDED.rationale;

COMMIT;
