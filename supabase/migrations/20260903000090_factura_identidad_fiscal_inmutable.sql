-- Facturas profesionales: la identidad fiscal no cambia después de emitir
--
-- La representación PDF leía CUIT, razón social, domicilio y punto de venta
-- desde `afip_connection_status` en el momento de descargar. Si el comercio
-- corregía su configuración, una factura YA autorizada se volvía a dibujar con
-- los datos nuevos. La historia fiscal no puede depender del estado presente.
--
-- Esta migración guarda una foto del emisor y del receptor al reservar la
-- autorización, y arma el payload QR en la misma transición que persiste el
-- CAE. El navegador sólo representa ese documento server-authoritative.

ALTER TABLE public.afip_credentials
  ADD COLUMN IF NOT EXISTS ingresos_brutos text,
  ADD COLUMN IF NOT EXISTS inicio_actividades date;

COMMENT ON COLUMN public.afip_credentials.ingresos_brutos IS
  'Número de Ingresos Brutos, Convenio Multilateral o condición declarada (por ejemplo, No inscripto). Dato visible del comprobante; nunca se adivina.';
COMMENT ON COLUMN public.afip_credentials.inicio_actividades IS
  'Fecha de inicio de actividades declarada por el emisor. Dato visible del comprobante; nunca se adivina.';

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS emisor_razon_social text,
  ADD COLUMN IF NOT EXISTS emisor_cuit text,
  ADD COLUMN IF NOT EXISTS emisor_domicilio text,
  ADD COLUMN IF NOT EXISTS emisor_condicion_iva text,
  ADD COLUMN IF NOT EXISTS emisor_ingresos_brutos text,
  ADD COLUMN IF NOT EXISTS emisor_inicio_actividades date,
  ADD COLUMN IF NOT EXISTS punto_venta integer,
  ADD COLUMN IF NOT EXISTS receptor_tipo_documento integer,
  ADD COLUMN IF NOT EXISTS moneda_cotizacion numeric(19,6),
  ADD COLUMN IF NOT EXISTS codigo_autorizacion_tipo text,
  ADD COLUMN IF NOT EXISTS arca_qr_payload jsonb,
  ADD COLUMN IF NOT EXISTS fiscal_snapshot_source text,
  ADD COLUMN IF NOT EXISTS fiscal_issued_at timestamptz;

ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_punto_venta_valido;
ALTER TABLE public.invoices ADD CONSTRAINT invoices_punto_venta_valido
  CHECK (punto_venta IS NULL OR punto_venta BETWEEN 1 AND 99999);
ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_receptor_tipo_documento_valido;
ALTER TABLE public.invoices ADD CONSTRAINT invoices_receptor_tipo_documento_valido
  CHECK (receptor_tipo_documento IS NULL OR receptor_tipo_documento IN (80, 86, 96, 99));
ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_codigo_autorizacion_tipo_valido;
ALTER TABLE public.invoices ADD CONSTRAINT invoices_codigo_autorizacion_tipo_valido
  CHECK (codigo_autorizacion_tipo IS NULL OR codigo_autorizacion_tipo IN ('A', 'E'));
ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_fiscal_snapshot_source_valido;
ALTER TABLE public.invoices ADD CONSTRAINT invoices_fiscal_snapshot_source_valido
  CHECK (fiscal_snapshot_source IS NULL OR fiscal_snapshot_source IN ('authorization', 'legacy_backfill'));

COMMENT ON COLUMN public.invoices.emisor_razon_social IS 'Snapshot fiscal inmutable de la razón social al autorizar.';
COMMENT ON COLUMN public.invoices.emisor_cuit IS 'Snapshot fiscal inmutable del CUIT emisor al autorizar.';
COMMENT ON COLUMN public.invoices.emisor_domicilio IS 'Snapshot fiscal inmutable del domicilio comercial/fiscal al autorizar.';
COMMENT ON COLUMN public.invoices.arca_qr_payload IS 'JSON v1 del QR oficial de ARCA, construido en servidor al guardar CAE y número.';
COMMENT ON COLUMN public.invoices.fiscal_snapshot_source IS 'authorization = capturado al emitir; legacy_backfill = reconstruido para un comprobante histórico y debe tratarse como tal.';

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
    NEW.punto_venta := v_cred.punto_venta;
    NEW.receptor_tipo_documento := CASE
      WHEN length(v_doc) = 11 THEN 80
      WHEN length(v_doc) IN (7, 8) THEN 96
      ELSE 99
    END;
    NEW.moneda_cotizacion := CASE WHEN NEW.currency = 'ARS' THEN 1 ELSE NEW.moneda_cotizacion END;
    NEW.codigo_autorizacion_tipo := 'E';
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
    v_moneda := CASE NEW.currency WHEN 'ARS' THEN 'PES' ELSE NEW.currency END;

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

DROP TRIGGER IF EXISTS trg_snapshot_identidad_fiscal_factura ON public.invoices;
CREATE TRIGGER trg_snapshot_identidad_fiscal_factura
BEFORE UPDATE OF afip_status, cae, numero_afip ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.snapshot_identidad_fiscal_factura();

-- Los únicos comprobantes existentes son históricos de homologación. Se
-- reconstruyen explícitamente y quedan marcados como legacy: no se presenta
-- este backfill como evidencia de qué domicilio tenían al emitir.
UPDATE public.invoices i SET
  emisor_razon_social = COALESCE(i.emisor_razon_social, a.razon_social),
  emisor_cuit = COALESCE(i.emisor_cuit, regexp_replace(a.cuit, '\D', '', 'g')),
  emisor_domicilio = COALESCE(i.emisor_domicilio, a.domicilio),
  emisor_condicion_iva = COALESCE(i.emisor_condicion_iva, a.tipo_emisor),
  emisor_ingresos_brutos = COALESCE(i.emisor_ingresos_brutos, a.ingresos_brutos),
  emisor_inicio_actividades = COALESCE(i.emisor_inicio_actividades, a.inicio_actividades),
  punto_venta = COALESCE(i.punto_venta, a.punto_venta),
  receptor_tipo_documento = COALESCE(i.receptor_tipo_documento,
    CASE
      WHEN length(regexp_replace(COALESCE(i.customer_tax_id, ''), '\D', '', 'g')) = 11 THEN 80
      WHEN length(regexp_replace(COALESCE(i.customer_tax_id, ''), '\D', '', 'g')) IN (7, 8) THEN 96
      ELSE 99
    END),
  moneda_cotizacion = COALESCE(i.moneda_cotizacion, CASE WHEN i.currency = 'ARS' THEN 1 ELSE NULL END),
  codigo_autorizacion_tipo = COALESCE(i.codigo_autorizacion_tipo, 'E'),
  fiscal_snapshot_source = COALESCE(i.fiscal_snapshot_source, 'legacy_backfill')
FROM public.afip_credentials a
WHERE i.org_id = a.org_id
  AND NULLIF(btrim(COALESCE(i.cae, '')), '') IS NOT NULL
  AND i.fiscal_snapshot_source IS NULL;

-- Fuerza una actualización inocua para construir el payload de los
-- comprobantes históricos con los campos recién backfilleados.
UPDATE public.invoices
   SET afip_status = afip_status
 WHERE cae IS NOT NULL AND arca_qr_payload IS NULL;

-- La guarda preexistente se amplía con cada campo del snapshot. Sin esto una
-- llamada directa a PostgREST podría cambiar la razón social dibujada aunque
-- total, CAE y número siguieran bloqueados.
CREATE OR REPLACE FUNCTION public.trg_factura_autorizada_inmutable()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
  IF OLD.cae IS NULL THEN RETURN NEW; END IF;

  IF NEW.total IS DISTINCT FROM OLD.total
     OR NEW.subtotal IS DISTINCT FROM OLD.subtotal
     OR NEW.tax_amount IS DISTINCT FROM OLD.tax_amount
     OR NEW.tax_pct IS DISTINCT FROM OLD.tax_pct
     OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.issue_date IS DISTINCT FROM OLD.issue_date
     OR NEW.customer_tax_id IS DISTINCT FROM OLD.customer_tax_id
     OR NEW.customer_name IS DISTINCT FROM OLD.customer_name
     OR NEW.tipo_comprobante IS DISTINCT FROM OLD.tipo_comprobante
     OR NEW.condicion_iva_receptor IS DISTINCT FROM OLD.condicion_iva_receptor
     OR NEW.numero_afip IS DISTINCT FROM OLD.numero_afip
     OR NEW.cae IS DISTINCT FROM OLD.cae
     OR NEW.cae_vencimiento IS DISTINCT FROM OLD.cae_vencimiento
     OR NEW.emisor_razon_social IS DISTINCT FROM OLD.emisor_razon_social
     OR NEW.emisor_cuit IS DISTINCT FROM OLD.emisor_cuit
     OR NEW.emisor_domicilio IS DISTINCT FROM OLD.emisor_domicilio
     OR NEW.emisor_condicion_iva IS DISTINCT FROM OLD.emisor_condicion_iva
     OR NEW.emisor_ingresos_brutos IS DISTINCT FROM OLD.emisor_ingresos_brutos
     OR NEW.emisor_inicio_actividades IS DISTINCT FROM OLD.emisor_inicio_actividades
     OR NEW.punto_venta IS DISTINCT FROM OLD.punto_venta
     OR NEW.receptor_tipo_documento IS DISTINCT FROM OLD.receptor_tipo_documento
     OR NEW.moneda_cotizacion IS DISTINCT FROM OLD.moneda_cotizacion
     OR NEW.codigo_autorizacion_tipo IS DISTINCT FROM OLD.codigo_autorizacion_tipo
     OR NEW.arca_qr_payload IS DISTINCT FROM OLD.arca_qr_payload
     OR NEW.fiscal_snapshot_source IS DISTINCT FROM OLD.fiscal_snapshot_source
     OR NEW.fiscal_issued_at IS DISTINCT FROM OLD.fiscal_issued_at THEN
    RAISE EXCEPTION
      'La factura % ya fue autorizada por ARCA (CAE %) y no se puede modificar. Para corregirla, emitir una nota de credito.',
      OLD.number, OLD.cae USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$fn$;

-- La configuración segura mantiene una sola firma RPC. Los dos datos nuevos
-- son opcionales en homologación y obligatorios para pasar a producción.
DROP FUNCTION IF EXISTS public.save_afip_config(uuid, text, integer, text, text, text, text);
DROP FUNCTION IF EXISTS public.save_afip_config(uuid, text, integer, text, text, text, text, text, date);

CREATE FUNCTION public.save_afip_config(
  p_org_id uuid, p_cuit text, p_punto_venta integer, p_environment text,
  p_tipo_emisor text DEFAULT NULL, p_razon_social text DEFAULT NULL,
  p_domicilio text DEFAULT NULL, p_ingresos_brutos text DEFAULT NULL,
  p_inicio_actividades date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_actor uuid := auth.uid();
  v_old_values jsonb;
  v_new_values jsonb;
BEGIN
  IF p_org_id IS NULL OR NOT public.is_org_member(p_org_id, v_actor) THEN
    RAISE EXCEPTION 'No pertenecés a esta organización'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM public.exigir_permiso(
    p_org_id, 'invoices', 'edit', 'configurar la identidad fiscal de AFIP'
  );

  IF p_environment NOT IN ('homologacion', 'produccion') THEN RAISE EXCEPTION 'Entorno inválido: %', p_environment; END IF;
  IF regexp_replace(COALESCE(p_cuit, ''), '\D', '', 'g') !~ '^\d{11}$' THEN RAISE EXCEPTION 'El CUIT debe tener 11 dígitos'; END IF;
  IF NOT public.cuit_valido(regexp_replace(p_cuit, '\D', '', 'g')) THEN RAISE EXCEPTION 'El CUIT no es válido (dígito verificador)'; END IF;
  IF p_punto_venta IS NULL OR p_punto_venta NOT BETWEEN 1 AND 99999 THEN RAISE EXCEPTION 'El punto de venta debe estar entre 1 y 99999'; END IF;
  IF p_tipo_emisor IS NULL OR p_tipo_emisor NOT IN ('monotributo', 'responsable_inscripto', 'exento') THEN RAISE EXCEPTION 'Elegí la condición frente al IVA del emisor'; END IF;
  IF NULLIF(trim(p_razon_social), '') IS NULL THEN RAISE EXCEPTION 'Falta la razón social'; END IF;
  IF NULLIF(trim(p_domicilio), '') IS NULL THEN RAISE EXCEPTION 'Falta el domicilio fiscal'; END IF;
  IF p_environment = 'produccion' AND NULLIF(trim(p_ingresos_brutos), '') IS NULL THEN RAISE EXCEPTION 'Falta Ingresos Brutos o la condición de no inscripto'; END IF;
  IF p_environment = 'produccion' AND p_inicio_actividades IS NULL THEN RAISE EXCEPTION 'Falta la fecha de inicio de actividades'; END IF;
  IF p_inicio_actividades IS NOT NULL AND p_inicio_actividades > CURRENT_DATE THEN RAISE EXCEPTION 'La fecha de inicio de actividades no puede estar en el futuro'; END IF;

  SELECT jsonb_build_object(
    'cuit', c.cuit, 'punto_venta', c.punto_venta, 'environment', c.environment,
    'tipo_emisor', c.tipo_emisor, 'razon_social', c.razon_social,
    'domicilio', c.domicilio, 'ingresos_brutos', c.ingresos_brutos,
    'inicio_actividades', c.inicio_actividades
  ) INTO v_old_values FROM public.afip_credentials c WHERE c.org_id = p_org_id;

  INSERT INTO public.afip_credentials AS c (
    org_id, cuit, punto_venta, environment, tipo_emisor, razon_social,
    domicilio, ingresos_brutos, inicio_actividades
  ) VALUES (
    p_org_id, regexp_replace(p_cuit, '\D', '', 'g'), p_punto_venta,
    p_environment, p_tipo_emisor, NULLIF(trim(p_razon_social), ''),
    NULLIF(trim(p_domicilio), ''), NULLIF(trim(p_ingresos_brutos), ''),
    p_inicio_actividades
  ) ON CONFLICT (org_id) DO UPDATE SET
    cuit = EXCLUDED.cuit,
    punto_venta = EXCLUDED.punto_venta,
    ta_token = CASE WHEN c.environment <> EXCLUDED.environment THEN NULL ELSE c.ta_token END,
    ta_sign = CASE WHEN c.environment <> EXCLUDED.environment THEN NULL ELSE c.ta_sign END,
    ta_expires_at = CASE WHEN c.environment <> EXCLUDED.environment THEN NULL ELSE c.ta_expires_at END,
    environment = EXCLUDED.environment,
    tipo_emisor = EXCLUDED.tipo_emisor,
    razon_social = EXCLUDED.razon_social,
    domicilio = EXCLUDED.domicilio,
    -- Una llamada vieja (por ejemplo, el generador legal) no borra datos que
    -- no conoce. Vaciar un valor se hace explícitamente desde la pantalla fiscal.
    ingresos_brutos = COALESCE(EXCLUDED.ingresos_brutos, c.ingresos_brutos),
    inicio_actividades = COALESCE(EXCLUDED.inicio_actividades, c.inicio_actividades),
    updated_at = now();

  SELECT jsonb_build_object(
    'cuit', c.cuit, 'punto_venta', c.punto_venta, 'environment', c.environment,
    'tipo_emisor', c.tipo_emisor, 'razon_social', c.razon_social,
    'domicilio', c.domicilio, 'ingresos_brutos', c.ingresos_brutos,
    'inicio_actividades', c.inicio_actividades
  ) INTO v_new_values FROM public.afip_credentials c WHERE c.org_id = p_org_id;

  INSERT INTO public.audit_logs (
    user_id, org_id, action, entity_type, entity_id,
    old_values, new_values, details, severity, tags
  ) VALUES (
    v_actor, p_org_id, 'update', 'fiscal_configuration', p_org_id::text,
    v_old_values, v_new_values,
    jsonb_build_object('permission', 'invoices.edit', 'source', 'save_afip_config'),
    'warning', ARRAY['fiscal','configuration']::text[]
  );

  RETURN jsonb_build_object('ok', true, 'modo',
    (SELECT modo FROM public.afip_credentials WHERE org_id = p_org_id));
END;
$fn$;

REVOKE ALL ON FUNCTION public.save_afip_config(uuid, text, integer, text, text, text, text, text, date)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_afip_config(uuid, text, integer, text, text, text, text, text, date)
  TO authenticated;

-- Vista segura: expone metadatos de impresión, nunca certificados ni tickets.
CREATE OR REPLACE VIEW public.afip_connection_status AS
SELECT a.org_id, a.cuit, a.punto_venta, a.environment, a.tipo_emisor,
  a.razon_social, a.domicilio, a.modo,
  a.cuit IS NOT NULL AND btrim(a.cuit) <> '' AND
    CASE a.modo
      WHEN 'propio' THEN a.certificate IS NOT NULL AND a.private_key IS NOT NULL
      ELSE EXISTS (SELECT 1 FROM public.afip_platform_credentials p WHERE p.certificate IS NOT NULL AND p.private_key IS NOT NULL)
    END AS configured,
  EXISTS (SELECT 1 FROM public.afip_platform_credentials p WHERE p.certificate IS NOT NULL AND p.private_key IS NOT NULL) AS plataforma_lista,
  (SELECT p.cuit FROM public.afip_platform_credentials p WHERE p.certificate IS NOT NULL LIMIT 1) AS plataforma_cuit,
  (SELECT p.razon_social FROM public.afip_platform_credentials p WHERE p.certificate IS NOT NULL LIMIT 1) AS plataforma_razon_social,
  CASE a.modo WHEN 'propio' THEN a.ta_expires_at ELSE (SELECT p.ta_expires_at FROM public.afip_platform_credentials p LIMIT 1) END AS ta_expires_at,
  CASE a.modo WHEN 'propio' THEN a.ta_expires_at IS NOT NULL AND a.ta_expires_at > now()
    ELSE (SELECT p.ta_expires_at > now() FROM public.afip_platform_credentials p LIMIT 1) END AS ticket_vigente,
  CASE
    WHEN a.cuit IS NULL OR btrim(a.cuit) = '' THEN 'falta_datos_fiscales'
    WHEN a.modo = 'propio' AND (a.certificate IS NULL OR a.private_key IS NULL) THEN 'falta_certificado_propio'
    WHEN a.modo <> 'propio' AND NOT EXISTS (SELECT 1 FROM public.afip_platform_credentials p WHERE p.certificate IS NOT NULL AND p.private_key IS NOT NULL) THEN 'falta_plataforma'
    WHEN a.modo <> 'propio' AND COALESCE(a.delegacion_verificada, false) = false
      AND regexp_replace(COALESCE(a.cuit, ''), '\D', '', 'g') =
          regexp_replace(COALESCE((SELECT p.cuit FROM public.afip_platform_credentials p WHERE p.certificate IS NOT NULL LIMIT 1), ''), '\D', '', 'g')
      THEN 'sin_delegacion_necesaria'
    WHEN a.modo <> 'propio' AND COALESCE(a.delegacion_verificada, false) = false THEN 'falta_delegar'
    ELSE 'listo'
  END AS motivo,
  a.delegacion_verificada, a.delegacion_verificada_at, a.last_error,
  -- CREATE OR REPLACE VIEW exige preservar el orden de las columnas existentes;
  -- los campos nuevos se agregan al final para no renombrar `modo` por accidente.
  a.ingresos_brutos, a.inicio_actividades
FROM public.afip_credentials a
WHERE public.is_org_member(a.org_id, auth.uid());

GRANT SELECT ON public.afip_connection_status TO authenticated;

DO $guard$
DECLARE v_cols int; v_trigger int; v_firmas int;
BEGIN
  SELECT count(*) INTO v_cols FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'invoices'
     AND column_name IN ('emisor_razon_social','emisor_cuit','emisor_domicilio',
       'emisor_condicion_iva','emisor_ingresos_brutos','emisor_inicio_actividades',
       'punto_venta','receptor_tipo_documento','moneda_cotizacion',
       'codigo_autorizacion_tipo','arca_qr_payload','fiscal_snapshot_source','fiscal_issued_at');
  SELECT count(*) INTO v_trigger FROM pg_trigger
   WHERE tgrelid = 'public.invoices'::regclass
     AND tgname = 'trg_snapshot_identidad_fiscal_factura' AND NOT tgisinternal;
  SELECT count(*) INTO v_firmas FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'save_afip_config';
  IF v_cols <> 13 OR v_trigger <> 1 OR v_firmas <> 1 THEN
    RAISE EXCEPTION 'factura fiscal incompleta: columnas %, trigger %, firmas save %', v_cols, v_trigger, v_firmas;
  END IF;
END;
$guard$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260903000090', 'factura_identidad_fiscal_inmutable')
ON CONFLICT DO NOTHING;
