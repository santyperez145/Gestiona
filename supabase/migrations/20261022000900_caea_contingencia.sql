-- CAEA de contingencia: facturar cuando ARCA no responde.
--
-- Con WSFE caído, una factura queda sin CAE y el comercio no puede entregar
-- el comprobante. ARCA prevé el CAEA: un código por quincena que se pide por
-- adelantado (FECAEASolicitar) y con el que se emiten comprobantes en un
-- punto de venta habilitado para CAEA; después se informan uno por uno
-- (FECAEARegInformativo) antes de la fecha tope, y si un punto de venta no
-- tuvo movimiento se informa eso (FECAEASinMovimientoInformar).
--
--   1. `afip_caea`: el CAEA de cada quincena (vigencia y tope de informe).
--   2. `afip_credentials`: si la contingencia está habilitada y su punto de
--      venta CAEA.
--   3. `afip_caea_emitir` (sólo el servidor): numera en el punto de venta
--      CAEA y deja la factura autorizada con autorización «A». Se niega si
--      hay un pedido de CAE sin confirmar: ese CAE podría existir y habría
--      dos comprobantes por la misma venta.
--   4. `invoices.caea_informado_at` / `caea_informe_error`, y
--      `afip_caea_informado` para registrarlo.
--   5. El snapshot fiscal pone el punto de venta CAEA y conserva la «A».
--   6. `configurar_contingencia` y `estado_contingencia` para la pantalla.
--   7. Cron cada 6 horas a `arca-caea`: pide el CAEA de la quincena en curso
--      y de la siguiente, informa los comprobantes y los puntos de venta sin
--      movimiento.
-- Reversible: volver al snapshot de 20261022000600; DROP de lo nuevo.
BEGIN;

ALTER TABLE public.afip_credentials
  ADD COLUMN IF NOT EXISTS contingencia_caea boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS punto_venta_caea integer;
ALTER TABLE public.afip_credentials DROP CONSTRAINT IF EXISTS afip_credentials_caea_check;
ALTER TABLE public.afip_credentials ADD CONSTRAINT afip_credentials_caea_check CHECK (
  (punto_venta_caea IS NULL OR punto_venta_caea BETWEEN 1 AND 99999)
  AND (NOT contingencia_caea OR punto_venta_caea IS NOT NULL)
  AND (punto_venta_caea IS NULL OR punto_venta_caea <> punto_venta));

CREATE TABLE IF NOT EXISTS public.afip_caea (
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  environment text NOT NULL CHECK (environment IN ('homologacion', 'produccion')),
  periodo integer NOT NULL CHECK (periodo BETWEEN 200001 AND 299912),
  orden smallint NOT NULL CHECK (orden IN (1, 2)),
  caea text NOT NULL CHECK (caea ~ '^[0-9]{14}$'),
  vig_desde date NOT NULL,
  vig_hasta date NOT NULL,
  tope_informe date NOT NULL,
  sin_movimiento_informado_at timestamptz,
  obtenido_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, environment, periodo, orden)
);
ALTER TABLE public.afip_caea ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS afip_caea_leer ON public.afip_caea;
CREATE POLICY afip_caea_leer ON public.afip_caea FOR SELECT TO authenticated USING (public.has_permission(org_id, 'invoices', 'view'));
REVOKE ALL ON public.afip_caea FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.afip_caea FROM authenticated;
GRANT SELECT ON public.afip_caea TO authenticated;
GRANT ALL ON public.afip_caea TO service_role;

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS caea_informado_at timestamptz,
  ADD COLUMN IF NOT EXISTS caea_informe_error text;
CREATE INDEX IF NOT EXISTS invoices_caea_pendiente_idx ON public.invoices (org_id)
  WHERE codigo_autorizacion_tipo = 'A' AND caea_informado_at IS NULL AND cae IS NOT NULL;

CREATE OR REPLACE FUNCTION public.snapshot_identidad_fiscal_factura()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_cred public.afip_credentials;
  v_doc text;
  v_doc_num numeric;
  v_moneda text;
BEGIN
  -- Cada intento nuevo toma los datos vigentes. Una factura rechazada todavía
  -- no fue emitida y puede corregirse; una autorizada nunca vuelve a entrar.
  IF NEW.afip_status = 'processing'
     AND NULLIF(btrim(COALESCE(NEW.cae, '')), '') IS NULL THEN
    SELECT * INTO v_cred
      FROM public.afip_credentials
     WHERE org_id = NEW.org_id;

    IF v_cred.org_id IS NULL
       OR NULLIF(btrim(COALESCE(v_cred.cuit, '')), '') IS NULL
       OR NULLIF(btrim(COALESCE(v_cred.razon_social, '')), '') IS NULL
       OR NULLIF(btrim(COALESCE(v_cred.domicilio, '')), '') IS NULL
       OR NULLIF(btrim(COALESCE(v_cred.tipo_emisor, '')), '') IS NULL THEN
      RAISE EXCEPTION 'La identidad fiscal está incompleta: cargá CUIT, razón social, domicilio y condición frente al IVA antes de autorizar';
    END IF;

    -- En producción la representación debe contener estos datos. En
    -- homologación se permite probar el circuito sin inventarlos.
    IF v_cred.environment = 'produccion'
       AND NULLIF(btrim(COALESCE(v_cred.ingresos_brutos, '')), '') IS NULL THEN
      RAISE EXCEPTION 'Falta declarar Ingresos Brutos o la condición de no inscripto para emitir en producción';
    END IF;
    IF v_cred.environment = 'produccion' AND v_cred.inicio_actividades IS NULL THEN
      RAISE EXCEPTION 'Falta declarar la fecha de inicio de actividades para emitir en producción';
    END IF;

    v_doc := regexp_replace(COALESCE(NEW.customer_tax_id, ''), '\D', '', 'g');
    NEW.emisor_razon_social := btrim(v_cred.razon_social);
    NEW.emisor_cuit := regexp_replace(v_cred.cuit, '\D', '', 'g');
    NEW.emisor_domicilio := btrim(v_cred.domicilio);
    NEW.emisor_condicion_iva := v_cred.tipo_emisor;
    NEW.emisor_ingresos_brutos := NULLIF(btrim(v_cred.ingresos_brutos), '');
    NEW.emisor_inicio_actividades := v_cred.inicio_actividades;
    -- Un comprobante de contingencia (CAEA, tipo de autorización «A») va en
    -- el punto de venta habilitado para CAEA, no en el de CAE.
    IF NEW.codigo_autorizacion_tipo = 'A' THEN
      IF v_cred.punto_venta_caea IS NULL THEN
        RAISE EXCEPTION 'Configura el punto de venta de contingencia (CAEA) antes de emitir sin CAE';
      END IF;
      NEW.punto_venta := v_cred.punto_venta_caea;
    ELSE
      NEW.punto_venta := v_cred.punto_venta;
    END IF;
    NEW.receptor_tipo_documento := CASE
      WHEN length(v_doc) = 11 THEN 80
      WHEN length(v_doc) IN (7, 8) THEN 96
      ELSE 99
    END;
    NEW.moneda_cotizacion := CASE WHEN NEW.currency = 'ARS' THEN 1 ELSE NEW.moneda_cotizacion END;
    NEW.codigo_autorizacion_tipo := CASE WHEN NEW.codigo_autorizacion_tipo = 'A' THEN 'A' ELSE 'E' END;
    NEW.fiscal_snapshot_source := 'authorization';
  END IF;

  -- CAE, número y snapshot entran juntos. El JSON es el especificado por ARCA
  -- y queda congelado con el documento, no reconstruido desde Ajustes.
  IF NEW.afip_status = 'authorized'
     AND NULLIF(btrim(COALESCE(NEW.cae, '')), '') IS NOT NULL
     AND NEW.numero_afip IS NOT NULL
     AND NEW.arca_qr_payload IS NULL THEN
    IF NULLIF(btrim(COALESCE(NEW.emisor_cuit, '')), '') IS NULL
       OR NEW.punto_venta IS NULL THEN
      RAISE EXCEPTION 'No se puede guardar un CAE sin snapshot del CUIT y punto de venta del emisor';
    END IF;

    v_doc := regexp_replace(COALESCE(NEW.customer_tax_id, ''), '\D', '', 'g');
    v_doc_num := CASE WHEN v_doc <> '' THEN v_doc::numeric ELSE 0 END;
    -- El QR lleva el código de moneda de ARCA (PES, DOL, 060), no ISO.
    v_moneda := CASE NEW.currency WHEN 'ARS' THEN 'PES' WHEN 'USD' THEN 'DOL' WHEN 'EUR' THEN '060' ELSE NEW.currency END;

    NEW.codigo_autorizacion_tipo := COALESCE(NEW.codigo_autorizacion_tipo, 'E');
    NEW.moneda_cotizacion := COALESCE(NEW.moneda_cotizacion, CASE WHEN NEW.currency = 'ARS' THEN 1 ELSE NULL END);
    NEW.fiscal_issued_at := COALESCE(NEW.fiscal_issued_at, now());
    NEW.arca_qr_payload := jsonb_strip_nulls(jsonb_build_object(
      'ver', 1,
      'fecha', NEW.issue_date,
      'cuit', NEW.emisor_cuit::numeric,
      'ptoVta', NEW.punto_venta,
      'tipoCmp', NEW.tipo_comprobante,
      'nroCmp', NEW.numero_afip,
      'importe', round(NEW.total, 2),
      'moneda', v_moneda,
      'ctz', NEW.moneda_cotizacion,
      'tipoDocRec', CASE WHEN COALESCE(NEW.receptor_tipo_documento, 99) = 99 THEN NULL ELSE NEW.receptor_tipo_documento END,
      'nroDocRec', CASE WHEN COALESCE(NEW.receptor_tipo_documento, 99) = 99 THEN NULL ELSE v_doc_num END,
      'tipoCodAut', NEW.codigo_autorizacion_tipo,
      'codAut', NEW.cae::numeric
    ));
  END IF;

  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.afip_caea_emitir(p_invoice_id uuid, p_requested_by uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $ce$
DECLARE
  v_inv public.invoices;
  v_cred public.afip_credentials;
  v_caea public.afip_caea;
  v_env text;
  v_numero integer;
BEGIN
  SELECT * INTO v_inv FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Factura no encontrada'; END IF;
  -- La llama el servidor con el usuario de la sesión: emitir sin CAE es
  -- decisión del dueño o de un administrador.
  IF p_requested_by IS NULL OR NOT public.has_org_role(v_inv.org_id, p_requested_by, ARRAY['owner', 'admin']) THEN
    RAISE EXCEPTION 'Solo el dueno o un administrador emiten en contingencia' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(btrim(v_inv.cae), '') IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'status', 'authorized', 'idempotent', true, 'cae', v_inv.cae, 'numero_afip', v_inv.numero_afip);
  END IF;
  IF v_inv.tipo_comprobante IS NULL THEN RAISE EXCEPTION 'Este comprobante no es fiscal'; END IF;
  IF v_inv.tipo_comprobante BETWEEN 201 AND 213 THEN
    RAISE EXCEPTION 'La Factura de Credito MiPyME no se emite en contingencia';
  END IF;
  -- Un pedido de CAE con número reservado pudo haber llegado a ARCA: si se
  -- emitiera también por CAEA, la venta tendría dos comprobantes.
  IF v_inv.afip_candidate_number IS NOT NULL THEN
    RAISE EXCEPTION 'Hay un pedido de CAE sin confirmar para esta factura: espera la verificacion antes de emitir en contingencia';
  END IF;
  IF v_inv.afip_status = 'processing' AND v_inv.updated_at > now() - interval '15 minutes' THEN
    RAISE EXCEPTION 'La factura tiene una autorizacion en curso';
  END IF;

  SELECT * INTO v_cred FROM public.afip_credentials WHERE org_id = v_inv.org_id;
  IF NOT COALESCE(v_cred.contingencia_caea, false) OR v_cred.punto_venta_caea IS NULL THEN
    RAISE EXCEPTION 'La contingencia CAEA no esta habilitada para este comercio';
  END IF;
  v_env := v_cred.environment;
  SELECT * INTO v_caea FROM public.afip_caea
   WHERE org_id = v_inv.org_id AND environment = v_env AND v_inv.issue_date BETWEEN vig_desde AND vig_hasta;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No hay un CAEA vigente para la fecha de la factura';
  END IF;

  -- Numeración propia del punto de venta CAEA, uno a la vez.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_inv.org_id::text || ':caea:' || v_cred.punto_venta_caea || ':' || v_inv.tipo_comprobante, 0));
  SELECT COALESCE(max(numero_afip), 0) + 1 INTO v_numero FROM public.invoices
   WHERE org_id = v_inv.org_id AND codigo_autorizacion_tipo = 'A' AND afip_environment = v_env
     AND punto_venta = v_cred.punto_venta_caea AND tipo_comprobante = v_inv.tipo_comprobante AND cae IS NOT NULL;

  -- Primero el snapshot fiscal (estado processing, autorización «A»), después el código.
  UPDATE public.invoices
     SET afip_status = 'processing', codigo_autorizacion_tipo = 'A', afip_environment = v_env,
         afip_authorization_requested_by = p_requested_by, afip_authorization_started_at = now(), afip_error = NULL
   WHERE id = p_invoice_id;
  UPDATE public.invoices
     SET cae = v_caea.caea, cae_vencimiento = v_caea.vig_hasta, numero_afip = v_numero,
         afip_status = 'authorized', status = CASE WHEN status = 'draft' THEN 'sent' ELSE status END,
         caea_informado_at = NULL, caea_informe_error = NULL
   WHERE id = p_invoice_id
  RETURNING * INTO v_inv;
  RETURN jsonb_build_object('ok', true, 'status', 'authorized', 'caea', v_caea.caea, 'numero_afip', v_numero,
    'punto_venta', v_inv.punto_venta, 'tope_informe', v_caea.tope_informe);
END;
$ce$;

CREATE OR REPLACE FUNCTION public.afip_caea_informado(p_invoice_id uuid, p_ok boolean, p_detalle text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $ci$
BEGIN
  UPDATE public.invoices
     SET caea_informado_at = CASE WHEN p_ok THEN now() ELSE caea_informado_at END,
         caea_informe_error = CASE WHEN p_ok THEN NULL ELSE left(p_detalle, 500) END
   WHERE id = p_invoice_id AND codigo_autorizacion_tipo = 'A';
END;
$ci$;

CREATE OR REPLACE FUNCTION public.configurar_contingencia(p_org uuid, p_habilitada boolean, p_punto_venta_caea integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $cc$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_org_role(p_org, auth.uid(), ARRAY['owner', 'admin']) THEN
    RAISE EXCEPTION 'Solo el dueno o un administrador configuran la contingencia' USING ERRCODE = '42501';
  END IF;
  IF p_habilitada AND (p_punto_venta_caea IS NULL OR p_punto_venta_caea NOT BETWEEN 1 AND 99999) THEN
    RAISE EXCEPTION 'Indica el punto de venta habilitado para CAEA' USING ERRCODE = '22023';
  END IF;
  UPDATE public.afip_credentials
     SET contingencia_caea = COALESCE(p_habilitada, false),
         punto_venta_caea = CASE WHEN p_habilitada THEN p_punto_venta_caea ELSE punto_venta_caea END,
         updated_at = now()
   WHERE org_id = p_org;
  IF NOT FOUND THEN RAISE EXCEPTION 'Configura primero la identidad fiscal del comercio' USING ERRCODE = '22023'; END IF;
  RETURN public.estado_contingencia(p_org);
EXCEPTION WHEN check_violation THEN
  RAISE EXCEPTION 'El punto de venta CAEA tiene que ser distinto del de CAE' USING ERRCODE = '22023';
END;
$cc$;

CREATE OR REPLACE FUNCTION public.estado_contingencia(p_org uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $ec$
DECLARE c public.afip_credentials; v_hoy date := (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_org_member(p_org, auth.uid()) THEN
    RAISE EXCEPTION 'No perteneces a esta organizacion' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO c FROM public.afip_credentials WHERE org_id = p_org;
  RETURN jsonb_build_object(
    'habilitada', COALESCE(c.contingencia_caea, false), 'punto_venta_caea', c.punto_venta_caea, 'punto_venta', c.punto_venta,
    'caea_vigente', (SELECT to_jsonb(a) - 'org_id' FROM public.afip_caea a WHERE a.org_id = p_org AND a.environment = c.environment
                       AND v_hoy BETWEEN a.vig_desde AND a.vig_hasta),
    'caea_proximo', (SELECT to_jsonb(a) - 'org_id' FROM public.afip_caea a WHERE a.org_id = p_org AND a.environment = c.environment
                       AND a.vig_desde > v_hoy ORDER BY a.vig_desde LIMIT 1),
    'pendientes_de_informar', (SELECT count(*) FROM public.invoices i WHERE i.org_id = p_org AND i.codigo_autorizacion_tipo = 'A'
                                 AND i.cae IS NOT NULL AND i.caea_informado_at IS NULL),
    'rechazados', (SELECT count(*) FROM public.invoices i WHERE i.org_id = p_org AND i.codigo_autorizacion_tipo = 'A'
                     AND i.caea_informado_at IS NULL AND i.caea_informe_error IS NOT NULL));
END;
$ec$;

REVOKE ALL ON FUNCTION public.afip_caea_emitir(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.afip_caea_informado(uuid, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.afip_caea_emitir(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.afip_caea_informado(uuid, boolean, text) TO service_role;
REVOKE ALL ON FUNCTION public.configurar_contingencia(uuid, boolean, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.estado_contingencia(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.configurar_contingencia(uuid, boolean, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.estado_contingencia(uuid) TO authenticated, service_role;

INSERT INTO public.security_function_contracts(function_name, identity_arguments, audience, rationale, definition_hash, reviewed_on)
SELECT p.proname, pg_get_function_identity_arguments(p.oid), 'authenticated_delegate',
       CASE p.proname
         WHEN 'configurar_contingencia' THEN 'Exige ser dueño o administrador; sólo cambia la contingencia CAEA de su negocio.'
         ELSE 'Exige ser miembro del negocio; sólo devuelve el estado de su contingencia CAEA.'
       END,
       md5(pg_get_functiondef(p.oid)), DATE '2026-10-22'
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname IN ('configurar_contingencia', 'estado_contingencia')
ON CONFLICT (function_name, identity_arguments) DO UPDATE
  SET definition_hash = EXCLUDED.definition_hash, reviewed_on = EXCLUDED.reviewed_on, rationale = EXCLUDED.rationale;

UPDATE public.security_function_contracts c
   SET definition_hash = md5(pg_get_functiondef(p.oid)), reviewed_on = DATE '2026-10-22'
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = c.function_name
   AND pg_get_function_identity_arguments(p.oid) = c.identity_arguments
   AND c.function_name = 'snapshot_identidad_fiscal_factura';

-- 7 ────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  PERFORM cron.unschedule('arca-caea-ciclo') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'arca-caea-ciclo');
  PERFORM cron.schedule('arca-caea-ciclo', '41 */6 * * *', 'SELECT public.invoke_edge_function(''arca-caea'');');
END $$;

COMMIT;
