-- Factura de exportación «E» (WSFEX): factura 19, nota de débito 20 y nota
-- de crédito 21 por operaciones con el exterior.
--
-- Contrato: «WSFEX – Manual para el desarrollador V 3.1.1» (ARCA, 08/2025).
--   1. `afip_credentials.punto_venta_exportacion`: el punto de venta de tipo
--      «Comprobantes de Exportación – Web Services», distinto del de CAE y del
--      de CAEA.
--   2. `invoices.exportacion` (tipo de exportación, país, cliente del
--      exterior, Incoterm, idioma, forma y fecha de pago, permisos de
--      embarque) y `invoices.fex_request_id`, el `Id` del pedido a WSFEX: se
--      guarda antes de llamar y reenviarlo recupera el mismo CAE en vez de
--      emitir otro comprobante. Ninguno se cambia desde el navegador, y el
--      detalle de exportación queda congelado con el CAE.
--   3. `crear_factura_manual` con `fiscal.exportacion`: tipo 19, cliente del
--      exterior (condición 9) y todos los renglones exentos.
--   4. Las notas de una factura E son E (21 crédito, 20 débito); la de débito
--      va exenta.
--   5. El snapshot fiscal pone el punto de venta de exportación y no informa
--      documento argentino del receptor.
--   6. `arca_parametros_fex`: países, Incoterms, monedas y puntos de venta que
--      publica ARCA, leídos por `arca-fex` y compartidos (no son secretos).
--   7. `configurar_exportacion` y `estado_exportacion` para la pantalla.
--   8. Un rechazo explícito de ARCA libera el número candidato (y el Id de
--      WSFEX): antes quedaba reservado y, si otra factura tomaba ese número,
--      la rechazada no podía volver a autorizarse.
-- Reversible: volver a las definiciones de 0600/0700/0900; DROP de lo nuevo.
BEGIN;

ALTER TABLE public.afip_credentials ADD COLUMN IF NOT EXISTS punto_venta_exportacion integer;
ALTER TABLE public.afip_credentials DROP CONSTRAINT IF EXISTS afip_credentials_exportacion_check;
ALTER TABLE public.afip_credentials ADD CONSTRAINT afip_credentials_exportacion_check CHECK (
  punto_venta_exportacion IS NULL OR (punto_venta_exportacion BETWEEN 1 AND 99998
    AND punto_venta_exportacion <> punto_venta
    AND punto_venta_exportacion IS DISTINCT FROM punto_venta_caea));

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS exportacion jsonb,
  ADD COLUMN IF NOT EXISTS fex_request_id bigint;
ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_exportacion_check;
ALTER TABLE public.invoices ADD CONSTRAINT invoices_exportacion_check CHECK (
  (exportacion IS NULL OR jsonb_typeof(exportacion) = 'object')
  AND (tipo_comprobante IS DISTINCT FROM 19 OR exportacion IS NOT NULL)
  AND (fex_request_id IS NULL OR (fex_request_id > 0 AND fex_request_id < 1000000000000000)));
CREATE UNIQUE INDEX IF NOT EXISTS invoices_fex_request_id_idx ON public.invoices (org_id, fex_request_id) WHERE fex_request_id IS NOT NULL;

ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_nota_debito_tipo;
ALTER TABLE public.invoices ADD CONSTRAINT invoices_nota_debito_tipo
  CHECK (nota_debito_de IS NULL OR (tipo_comprobante IN (2, 7, 12, 20, 202, 207, 212) AND nota_credito_de IS NULL));

-- El `Id` del pedido lo escribe sólo el servidor; el detalle de exportación,
-- nadie después del CAE.
CREATE OR REPLACE FUNCTION public.trg_exportacion_protegida()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $ep$
BEGIN
  IF NEW.fex_request_id IS DISTINCT FROM OLD.fex_request_id
     AND current_user NOT IN ('service_role', 'postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'El identificador del pedido a ARCA lo asigna el servidor' USING ERRCODE = '42501';
  END IF;
  IF NEW.exportacion IS DISTINCT FROM OLD.exportacion AND NULLIF(btrim(COALESCE(OLD.cae, '')), '') IS NOT NULL THEN
    RAISE EXCEPTION 'Una factura autorizada no cambia sus datos de exportacion';
  END IF;
  RETURN NEW;
END;
$ep$;
DROP TRIGGER IF EXISTS trg_exportacion_protegida ON public.invoices;
CREATE TRIGGER trg_exportacion_protegida BEFORE UPDATE OF exportacion, fex_request_id ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.trg_exportacion_protegida();

-- Lo que ARCA rechazaría de una factura E, normalizado. Espejo de
-- `erroresExportacion` (supabase/functions/_shared/wsfex.ts).
CREATE OR REPLACE FUNCTION public.datos_exportacion_validos(p jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $dx$
DECLARE
  v_tipo int; v_pais int; v_idioma int; v_permiso text; v_permisos jsonb := '[]'::jsonb; v_p jsonb;
  v_incoterms text; v_fecha_pago date; v_cuit_pais text; v_id_imp text; v_dom text; v_forma text;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) = 'null' THEN RETURN NULL; END IF;
  IF jsonb_typeof(p) <> 'object' THEN RAISE EXCEPTION 'Los datos de exportacion no son validos'; END IF;
  IF COALESCE(p->>'tipo_expo', '') !~ '^[124]$' THEN RAISE EXCEPTION 'Elegi si exportas bienes, servicios u otros'; END IF;
  v_tipo := (p->>'tipo_expo')::int;
  IF COALESCE(p->>'pais_destino', '') !~ '^[0-9]{1,3}$' OR (p->>'pais_destino')::int = 0 THEN RAISE EXCEPTION 'Elegi el pais de destino'; END IF;
  v_pais := (p->>'pais_destino')::int;
  v_dom := NULLIF(btrim(COALESCE(p->>'domicilio_cliente', '')), '');
  IF v_dom IS NULL OR length(v_dom) > 300 THEN RAISE EXCEPTION 'El domicilio del cliente del exterior es obligatorio (hasta 300 caracteres)'; END IF;
  v_id_imp := NULLIF(btrim(COALESCE(p->>'id_impositivo', '')), '');
  v_cuit_pais := NULLIF(regexp_replace(COALESCE(p->>'cuit_pais', ''), '\D', '', 'g'), '');
  IF v_id_imp IS NULL AND v_cuit_pais IS NULL THEN RAISE EXCEPTION 'Carga la identificacion tributaria del cliente o la CUIT del pais'; END IF;
  IF v_cuit_pais IS NOT NULL AND length(v_cuit_pais) <> 11 THEN RAISE EXCEPTION 'La CUIT del pais tiene 11 digitos'; END IF;
  IF length(COALESCE(v_id_imp, '')) > 50 THEN RAISE EXCEPTION 'La identificacion tributaria admite hasta 50 caracteres'; END IF;
  IF COALESCE(p->>'idioma', '') !~ '^[123]$' THEN RAISE EXCEPTION 'Elegi el idioma del comprobante'; END IF;
  v_idioma := (p->>'idioma')::int;
  v_forma := NULLIF(btrim(COALESCE(p->>'forma_pago', '')), '');
  IF v_forma IS NULL OR length(v_forma) > 50 THEN RAISE EXCEPTION 'La forma de pago es obligatoria (hasta 50 caracteres)'; END IF;
  v_incoterms := NULLIF(upper(btrim(COALESCE(p->>'incoterms', ''))), '');
  IF v_tipo = 1 AND v_incoterms IS NULL THEN RAISE EXCEPTION 'En una exportacion de bienes el Incoterm es obligatorio'; END IF;
  IF v_incoterms IS NOT NULL AND v_incoterms !~ '^[A-Z]{3}$' THEN RAISE EXCEPTION 'El Incoterm tiene 3 letras'; END IF;
  IF length(COALESCE(p->>'incoterms_ds', '')) > 20 THEN RAISE EXCEPTION 'La descripcion del Incoterm admite hasta 20 caracteres'; END IF;
  IF length(COALESCE(p->>'obs_comerciales', '')) > 4000 THEN RAISE EXCEPTION 'Las observaciones comerciales admiten hasta 4000 caracteres'; END IF;
  IF v_tipo = 1 THEN
    v_permiso := upper(COALESCE(p->>'permiso_existente', ''));
    IF v_permiso NOT IN ('S', 'N') THEN RAISE EXCEPTION 'Indica si ya tenes el permiso de embarque'; END IF;
    IF v_permiso = 'S' THEN
      IF jsonb_typeof(COALESCE(p->'permisos', '[]'::jsonb)) <> 'array' OR jsonb_array_length(COALESCE(p->'permisos', '[]'::jsonb)) = 0 THEN
        RAISE EXCEPTION 'Carga el permiso de embarque y el pais de destino de la mercaderia';
      END IF;
      FOR v_p IN SELECT value FROM jsonb_array_elements(p->'permisos') LOOP
        IF upper(COALESCE(v_p->>'id', '')) !~ '^[0-9]{5}[A-Z]{2}[A-Z0-9]{2}[0-9]{6}[A-Z]$' THEN
          RAISE EXCEPTION 'Un permiso de embarque no tiene el formato de ARCA (99999AAXX999999A)';
        END IF;
        IF COALESCE(v_p->>'destino', '') !~ '^[0-9]{1,3}$' THEN RAISE EXCEPTION 'Cada permiso necesita el pais de destino de la mercaderia'; END IF;
        v_permisos := v_permisos || jsonb_build_array(jsonb_build_object('id', upper(v_p->>'id'), 'destino', (v_p->>'destino')::int));
      END LOOP;
    END IF;
  ELSE
    IF COALESCE(p->>'fecha_pago', '') !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'En servicios y otros la fecha de pago es obligatoria'; END IF;
    v_fecha_pago := (p->>'fecha_pago')::date;
    IF v_fecha_pago < CURRENT_DATE THEN RAISE EXCEPTION 'La fecha de pago no puede ser anterior a la del comprobante'; END IF;
  END IF;
  RETURN jsonb_strip_nulls(jsonb_build_object(
    'tipo_expo', v_tipo, 'pais_destino', v_pais, 'domicilio_cliente', v_dom, 'id_impositivo', v_id_imp,
    'cuit_pais', v_cuit_pais, 'idioma', v_idioma, 'forma_pago', v_forma, 'incoterms', v_incoterms,
    'incoterms_ds', NULLIF(btrim(COALESCE(p->>'incoterms_ds', '')), ''),
    'permiso_existente', v_permiso, 'permisos', CASE WHEN v_permiso = 'S' THEN v_permisos END,
    'fecha_pago', v_fecha_pago, 'obs_comerciales', NULLIF(btrim(COALESCE(p->>'obs_comerciales', '')), '')));
END;
$dx$;

CREATE OR REPLACE FUNCTION public.tipo_nota_credito(p_tipo_factura int)
RETURNS int LANGUAGE sql IMMUTABLE AS $tnc$
  -- La nota de crédito lleva la MISMA clase que la factura que corrige; la de
  -- una FCE es FCE y la de una factura E, E (21).
  SELECT CASE p_tipo_factura
    WHEN 1 THEN 3 WHEN 6 THEN 8 WHEN 11 THEN 13
    WHEN 201 THEN 203 WHEN 206 THEN 208 WHEN 211 THEN 213
    WHEN 19 THEN 21
    ELSE NULL END;
$tnc$;

CREATE OR REPLACE FUNCTION public.tipo_nota_debito(p_tipo_factura int)
RETURNS int LANGUAGE sql IMMUTABLE AS $tnd$
  SELECT CASE p_tipo_factura
    WHEN 1 THEN 2 WHEN 6 THEN 7 WHEN 11 THEN 12
    WHEN 201 THEN 202 WHEN 206 THEN 207 WHEN 211 THEN 212
    WHEN 19 THEN 20 END;
$tnd$;

CREATE OR REPLACE FUNCTION public.crear_factura_manual(
  p_org uuid,
  p_customer jsonb,
  p_items jsonb,
  p_fiscal jsonb DEFAULT '{}'::jsonb,
  p_sale_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_user uuid := auth.uid();
  v_customer_name text;
  v_customer_email text;
  v_customer_address text;
  v_customer_tax_id text;
  v_customer_tax_digits text;
  v_due_text text;
  v_due_date date;
  v_notes text;
  v_fiscal_enabled boolean;
  v_receptor text;
  v_default_tax_pct numeric;
  v_emisor text;
  v_cbte jsonb;
  v_tipo integer;
  v_condicion integer := 5;
  v_number text;
  v_invoice_id uuid;
  v_item jsonb;
  v_description text;
  v_quantity numeric;
  v_unit_price numeric;
  v_line_total numeric;
  v_line_tax_rate numeric;
  v_line_tax_amount numeric;
  v_subtotal numeric := 0;
  v_tax_amount numeric := 0;
  v_total numeric := 0;
  v_rate_count integer := 0;
  v_header_tax_pct numeric := 0;
  v_lines jsonb := '[]'::jsonb;
  -- 20261022000600: concepto, servicio, exento/no gravado, tributos y moneda.
  v_concepto integer;
  v_serv_desde date;
  v_serv_hasta date;
  v_moneda text := 'ARS';
  v_cotizacion numeric;
  v_misma_moneda boolean := false;
  v_tratamiento text;
  v_exento numeric := 0;
  v_no_gravado numeric := 0;
  v_tributo jsonb;
  v_tributos jsonb := '[]'::jsonb;
  v_trib_tipo integer;
  v_trib_base numeric;
  v_trib_alic numeric;
  v_trib_importe numeric;
  v_importe_tributos numeric := 0;
  -- 20261022000700: factura de crédito electrónica MiPyME.
  v_fce boolean := false;
  v_fce_cbu text;
  v_fce_alias text;
  v_fce_transferencia text;
  -- 20261022001100: factura de exportación (WSFEX).
  v_expo jsonb;
BEGIN
  IF p_org IS NULL OR v_user IS NULL OR NOT public.is_org_member(p_org, v_user) THEN
    RAISE EXCEPTION 'No perteneces a esta organizacion'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM public.exigir_permiso(p_org, 'invoices', 'edit', 'crear facturas');

  IF p_sale_id IS NOT NULL THEN
    RAISE EXCEPTION 'Factura la venta desde su flujo de origen';
  END IF;
  IF jsonb_typeof(COALESCE(p_customer, '{}'::jsonb)) <> 'object'
     OR jsonb_typeof(COALESCE(p_fiscal, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'Los datos de la factura no son validos';
  END IF;

  v_customer_name := NULLIF(btrim(p_customer->>'name'), '');
  v_customer_email := NULLIF(btrim(p_customer->>'email'), '');
  v_customer_address := NULLIF(btrim(p_customer->>'address'), '');
  v_customer_tax_id := NULLIF(btrim(p_customer->>'tax_id'), '');
  v_due_text := NULLIF(btrim(p_customer->>'due_date'), '');
  v_notes := NULLIF(btrim(p_customer->>'notes'), '');
  v_fiscal_enabled := COALESCE((p_fiscal->>'enabled')::boolean, false);
  v_receptor := COALESCE(NULLIF(p_fiscal->>'receiver_condition', ''), 'consumidor_final');
  v_default_tax_pct := COALESCE(NULLIF(p_fiscal->>'tax_pct', '')::numeric, 0);
  v_expo := public.datos_exportacion_validos(p_fiscal->'exportacion');

  IF v_customer_name IS NULL THEN
    RAISE EXCEPTION 'El nombre o razon social del cliente es obligatorio';
  END IF;
  IF length(v_customer_name) > 200 THEN
    RAISE EXCEPTION 'El nombre del cliente es demasiado largo';
  END IF;
  IF v_customer_email IS NOT NULL
     AND v_customer_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'El email del cliente no es valido';
  END IF;
  IF v_due_text IS NOT NULL THEN
    IF v_due_text !~ '^\d{4}-\d{2}-\d{2}$' THEN
      RAISE EXCEPTION 'La fecha de vencimiento no es valida';
    END IF;
    v_due_date := v_due_text::date;
    IF v_due_date < CURRENT_DATE THEN
      RAISE EXCEPTION 'El vencimiento no puede ser anterior a la emision';
    END IF;
  END IF;

  -- Concepto y período del servicio (WSFE: FchServDesde/Hasta, FchVtoPago).
  IF NULLIF(p_fiscal->>'concepto', '') IS NOT NULL AND p_fiscal->>'concepto' !~ '^[123]$' THEN
    RAISE EXCEPTION 'El concepto tiene que ser productos, servicios o productos y servicios';
  END IF;
  -- Sin concepto, lo completa el trigger con el del comercio.
  v_concepto := NULLIF(p_fiscal->>'concepto', '')::integer;
  IF v_concepto IS NOT NULL AND v_concepto <> 1 THEN
    IF COALESCE(p_fiscal->>'servicio_desde', '') !~ '^\d{4}-\d{2}-\d{2}$'
       OR COALESCE(p_fiscal->>'servicio_hasta', '') !~ '^\d{4}-\d{2}-\d{2}$' THEN
      RAISE EXCEPTION 'Para facturar servicios indica el periodo del servicio (desde y hasta)';
    END IF;
    v_serv_desde := (p_fiscal->>'servicio_desde')::date;
    v_serv_hasta := (p_fiscal->>'servicio_hasta')::date;
    IF v_serv_desde > v_serv_hasta THEN
      RAISE EXCEPTION 'El periodo del servicio empieza despues de terminar';
    END IF;
  END IF;

  -- Moneda: pesos, dolares o euros. Sin cotizacion, ARCA usa la oficial al autorizar.
  v_moneda := upper(COALESCE(NULLIF(p_fiscal->>'moneda', ''), 'ARS'));
  IF v_moneda NOT IN ('ARS', 'USD', 'EUR') THEN
    RAISE EXCEPTION 'La moneda tiene que ser pesos, dolares o euros';
  END IF;
  IF v_moneda <> 'ARS' AND NULLIF(p_fiscal->>'cotizacion', '') IS NOT NULL THEN
    IF p_fiscal->>'cotizacion' !~ '^\d+(\.\d+)?$' OR (p_fiscal->>'cotizacion')::numeric <= 0 THEN
      RAISE EXCEPTION 'La cotizacion tiene que ser un numero mayor a cero';
    END IF;
    v_cotizacion := round((p_fiscal->>'cotizacion')::numeric, 6);
  END IF;
  v_misma_moneda := v_moneda <> 'ARS' AND COALESCE((p_fiscal->>'cancela_misma_moneda')::boolean, false);

  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Agrega al menos un item a la factura';
  END IF;
  IF jsonb_array_length(p_items) > 100 THEN
    RAISE EXCEPTION 'Una factura manual admite hasta 100 items';
  END IF;

  -- Factura E: al exterior y sin IVA. El tipo no depende de la condición
  -- del emisor ni el cliente tiene CUIT argentina.
  IF v_expo IS NOT NULL THEN
    IF NOT v_fiscal_enabled THEN
      RAISE EXCEPTION 'La factura de exportacion es un comprobante fiscal';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.afip_credentials WHERE org_id = p_org AND tipo_emisor IS NOT NULL) THEN
      RAISE EXCEPTION 'Configura la identidad fiscal antes de crear un comprobante ARCA';
    END IF;
    IF COALESCE((p_fiscal->>'fce')::boolean, false) THEN
      RAISE EXCEPTION 'Una factura de exportacion no es de credito MiPyME';
    END IF;
    IF jsonb_array_length(COALESCE(p_fiscal->'tributos', '[]'::jsonb)) > 0 THEN
      RAISE EXCEPTION 'La factura de exportacion no lleva percepciones ni otros tributos';
    END IF;
    v_fiscal_enabled := false;
    v_customer_address := COALESCE(v_customer_address, v_expo->>'domicilio_cliente');
    v_customer_tax_id := COALESCE(v_customer_tax_id, v_expo->>'id_impositivo', v_expo->>'cuit_pais');
  END IF;

  IF v_fiscal_enabled THEN
    IF v_receptor NOT IN ('responsable_inscripto', 'monotributo', 'exento', 'consumidor_final') THEN
      RAISE EXCEPTION 'La condicion frente al IVA del receptor no es valida';
    END IF;
    SELECT tipo_emisor INTO v_emisor
      FROM public.afip_credentials
     WHERE org_id = p_org;
    IF v_emisor IS NULL THEN
      RAISE EXCEPTION 'Configura la identidad fiscal antes de crear un comprobante ARCA';
    END IF;
    v_cbte := public.tipo_de_comprobante(v_emisor, v_receptor);
    v_tipo := (v_cbte->>'codigo_afip')::integer;
    v_condicion := public.condicion_iva_codigo(v_receptor);

    v_customer_tax_digits := regexp_replace(COALESCE(v_customer_tax_id, ''), '\D', '', 'g');
    IF v_receptor <> 'consumidor_final'
       AND (length(v_customer_tax_digits) <> 11 OR NOT public.cuit_valido(v_customer_tax_digits)) THEN
      RAISE EXCEPTION 'La condicion fiscal elegida requiere un CUIT valido del receptor';
    END IF;
    IF v_tipo NOT IN (11, 12, 13)
       AND v_default_tax_pct NOT IN (0, 2.5, 5, 10.5, 21, 27) THEN
      RAISE EXCEPTION 'La alicuota predeterminada no esta admitida por ARCA';
    END IF;
  ELSE
    v_tipo := NULL;
    v_condicion := 5;
  END IF;
  IF v_expo IS NOT NULL THEN
    v_tipo := 19;
    v_condicion := 9;  -- Cliente del exterior
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    IF jsonb_typeof(v_item) <> 'object' THEN
      RAISE EXCEPTION 'Cada item debe ser un objeto';
    END IF;
    v_description := NULLIF(btrim(v_item->>'description'), '');
    IF v_description IS NULL THEN
      RAISE EXCEPTION 'Todos los items necesitan una descripcion';
    END IF;
    IF length(v_description) > 500 THEN
      RAISE EXCEPTION 'La descripcion de un item supera los 500 caracteres';
    END IF;
    IF COALESCE(v_item->>'quantity', '') !~ '^\d+(\.\d+)?$'
       OR COALESCE(v_item->>'unit_price', '') !~ '^\d+(\.\d+)?$' THEN
      RAISE EXCEPTION 'Cantidad y precio deben ser numeros positivos';
    END IF;
    v_quantity := (v_item->>'quantity')::numeric;
    v_unit_price := (v_item->>'unit_price')::numeric;
    IF v_quantity <= 0 OR v_quantity > 1000000 THEN
      RAISE EXCEPTION 'La cantidad de cada item debe ser mayor que cero';
    END IF;
    IF v_unit_price < 0 OR v_unit_price > 999999999999 THEN
      RAISE EXCEPTION 'El precio unitario esta fuera del rango permitido';
    END IF;

    v_line_total := public.redondear_moneda(v_quantity * v_unit_price, 'ARS');
    -- Lo exportado no lleva IVA: cada renglón va como exento.
    v_tratamiento := CASE WHEN v_expo IS NOT NULL THEN 'exento'
      ELSE COALESCE(NULLIF(v_item->>'tratamiento', ''), 'gravado') END;
    IF v_tratamiento NOT IN ('gravado', 'exento', 'no_gravado') THEN
      RAISE EXCEPTION 'Cada renglon es gravado, exento o no gravado';
    END IF;
    IF v_tratamiento <> 'gravado' AND v_tipo IN (11, 12, 13) THEN
      RAISE EXCEPTION 'Un comprobante C no separa lo exento ni lo no gravado';
    END IF;
    IF v_tratamiento <> 'gravado' THEN
      v_line_tax_rate := CASE WHEN v_tipo IS NULL THEN NULL ELSE 0 END;
      v_line_tax_amount := 0;
      IF v_tratamiento = 'exento' THEN v_exento := v_exento + v_line_total; ELSE v_no_gravado := v_no_gravado + v_line_total; END IF;
    ELSIF v_tipo IS NULL THEN
      v_line_tax_rate := NULL;
      v_line_tax_amount := 0;
    ELSIF v_tipo IN (11, 12, 13) THEN
      v_line_tax_rate := 0;
      v_line_tax_amount := 0;
    ELSE
      v_line_tax_rate := COALESCE(NULLIF(v_item->>'tax_rate', '')::numeric, v_default_tax_pct);
      IF v_line_tax_rate NOT IN (0, 2.5, 5, 10.5, 21, 27) THEN
        RAISE EXCEPTION 'Un renglon tiene una alicuota no admitida por ARCA';
      END IF;
      v_line_tax_amount := public.redondear_moneda(v_line_total * v_line_tax_rate / 100, 'ARS');
    END IF;

    IF v_tratamiento = 'gravado' THEN
      v_subtotal := v_subtotal + v_line_total;
      v_tax_amount := v_tax_amount + v_line_tax_amount;
    END IF;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'description', v_description,
      'quantity', v_quantity,
      'unit_price', v_unit_price,
      'total', v_line_total,
      'tax_rate', v_line_tax_rate,
      'tax_amount', CASE WHEN v_line_tax_rate IS NULL THEN NULL ELSE v_line_tax_amount END,
      'tratamiento', v_tratamiento
    ));
  END LOOP;

  v_subtotal := public.redondear_moneda(v_subtotal, 'ARS');
  v_tax_amount := public.redondear_moneda(v_tax_amount, 'ARS');
  v_exento := public.redondear_moneda(v_exento, 'ARS');
  v_no_gravado := public.redondear_moneda(v_no_gravado, 'ARS');

  -- Percepciones y otros tributos (WSFE Tributos). El importe lo calcula la
  -- base: base por alicuota; con alicuota 0 se acepta un importe fijo.
  IF jsonb_typeof(COALESCE(p_fiscal->'tributos', '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'Los tributos no son validos';
  END IF;
  IF jsonb_array_length(COALESCE(p_fiscal->'tributos', '[]'::jsonb)) > 20 THEN
    RAISE EXCEPTION 'Una factura admite hasta 20 tributos';
  END IF;
  FOR v_tributo IN SELECT value FROM jsonb_array_elements(COALESCE(p_fiscal->'tributos', '[]'::jsonb)) LOOP
    IF COALESCE(v_tributo->>'tipo', '') !~ '^(1|2|3|4|5|6|7|8|9|13|99)$' THEN
      RAISE EXCEPTION 'El tipo de tributo no existe en ARCA';
    END IF;
    v_trib_tipo := (v_tributo->>'tipo')::integer;
    IF COALESCE(v_tributo->>'base', '') !~ '^\d+(\.\d+)?$' OR COALESCE(v_tributo->>'alicuota', '0') !~ '^\d+(\.\d+)?$' THEN
      RAISE EXCEPTION 'La base y la alicuota de un tributo tienen que ser numeros positivos';
    END IF;
    v_trib_base := public.redondear_moneda((v_tributo->>'base')::numeric, 'ARS');
    v_trib_alic := round(COALESCE(NULLIF(v_tributo->>'alicuota', ''), '0')::numeric, 2);
    IF v_trib_alic > 100 THEN RAISE EXCEPTION 'La alicuota de un tributo no puede superar el 100%%'; END IF;
    IF v_trib_alic > 0 THEN
      v_trib_importe := public.redondear_moneda(v_trib_base * v_trib_alic / 100, 'ARS');
    ELSE
      IF COALESCE(v_tributo->>'importe', '') !~ '^\d+(\.\d+)?$' THEN
        RAISE EXCEPTION 'Un tributo sin alicuota necesita su importe';
      END IF;
      v_trib_importe := public.redondear_moneda((v_tributo->>'importe')::numeric, 'ARS');
    END IF;
    IF v_trib_importe <= 0 THEN CONTINUE; END IF;
    v_importe_tributos := v_importe_tributos + v_trib_importe;
    v_tributos := v_tributos || jsonb_build_array(jsonb_build_object(
      'tipo', v_trib_tipo,
      'descripcion', left(NULLIF(btrim(COALESCE(v_tributo->>'descripcion', '')), ''), 80),
      'base', v_trib_base, 'alicuota', v_trib_alic, 'importe', v_trib_importe));
  END LOOP;

  v_total := public.redondear_moneda(v_subtotal + v_tax_amount + v_exento + v_no_gravado + v_importe_tributos, 'ARS');
  IF v_subtotal + v_exento + v_no_gravado <= 0 OR v_total <= 0 THEN
    RAISE EXCEPTION 'El total de la factura debe ser mayor que cero';
  END IF;

  IF v_tipo IS NOT NULL THEN
    SELECT count(DISTINCT (line->>'tax_rate')::numeric), min((line->>'tax_rate')::numeric)
      INTO v_rate_count, v_header_tax_pct
      FROM jsonb_array_elements(v_lines) line
     WHERE line->>'tratamiento' = 'gravado';
    IF v_rate_count <> 1 THEN v_header_tax_pct := 0; END IF;
  ELSE
    v_header_tax_pct := 0;
  END IF;

  -- Factura de Crédito Electrónica MiPyME (RG 4367): la misma clase + 200,
  -- sólo a una empresa con CUIT, con vencimiento del pago y CBU del emisor.
  v_fce := COALESCE((p_fiscal->>'fce')::boolean, false);
  IF v_fce THEN
    IF v_tipo IS NULL OR v_tipo NOT IN (1, 6, 11) THEN
      RAISE EXCEPTION 'La factura de credito MiPyME necesita la identidad fiscal configurada';
    END IF;
    IF v_receptor = 'consumidor_final' OR length(COALESCE(v_customer_tax_digits, '')) <> 11 THEN
      RAISE EXCEPTION 'La factura de credito MiPyME es para una empresa con CUIT';
    END IF;
    IF v_due_date IS NULL THEN
      RAISE EXCEPTION 'La factura de credito MiPyME necesita la fecha de vencimiento del pago';
    END IF;
    SELECT COALESCE(NULLIF(regexp_replace(COALESCE(p_fiscal->>'fce_cbu', ''), '\D', '', 'g'), ''), c.fce_cbu),
           COALESCE(NULLIF(btrim(COALESCE(p_fiscal->>'fce_alias', '')), ''), c.fce_alias),
           upper(COALESCE(NULLIF(p_fiscal->>'fce_transferencia', ''), c.fce_transferencia, 'SCA'))
      INTO v_fce_cbu, v_fce_alias, v_fce_transferencia
      FROM public.afip_credentials c WHERE c.org_id = p_org;
    IF NOT public.cbu_valido(v_fce_cbu) THEN
      RAISE EXCEPTION 'Carga un CBU valido del comercio para la factura de credito MiPyME';
    END IF;
    IF v_fce_transferencia NOT IN ('SCA', 'ADC') THEN
      RAISE EXCEPTION 'La transferencia de la factura de credito es SCA o ADC';
    END IF;
    v_tipo := v_tipo + 200;
  END IF;

  v_number := public.siguiente_numero_factura(p_org);
  INSERT INTO public.invoices (
    org_id, number, customer_name, customer_email, customer_address,
    customer_tax_id, issue_date, due_date, notes, status, currency,
    subtotal, tax_pct, tax_amount, total, created_by, tipo_comprobante,
    condicion_iva_receptor, afip_status, sale_id,
    concepto, servicio_desde, servicio_hasta, importe_no_gravado, importe_exento,
    importe_tributos, tributos, moneda_cotizacion, cancela_misma_moneda,
    fce_cbu, fce_alias, fce_transferencia, exportacion
  ) VALUES (
    p_org, v_number, v_customer_name, v_customer_email, v_customer_address,
    v_customer_tax_id, CURRENT_DATE, v_due_date, v_notes, 'draft', v_moneda,
    v_subtotal, COALESCE(v_header_tax_pct, 0), v_tax_amount, v_total, v_user, v_tipo,
    v_condicion, CASE WHEN v_tipo IS NULL THEN 'not_applicable' ELSE 'pending' END,
    NULL,
    v_concepto, v_serv_desde, v_serv_hasta, v_no_gravado, v_exento,
    v_importe_tributos, v_tributos, v_cotizacion, v_misma_moneda,
    CASE WHEN v_fce THEN v_fce_cbu END, CASE WHEN v_fce THEN left(v_fce_alias, 20) END, CASE WHEN v_fce THEN v_fce_transferencia END, v_expo
  ) RETURNING id INTO v_invoice_id;

  INSERT INTO public.invoice_items (
    invoice_id, description, quantity, unit_price, total, tax_rate, tax_amount, tratamiento
  )
  SELECT v_invoice_id, line->>'description', (line->>'quantity')::numeric,
    (line->>'unit_price')::numeric, (line->>'total')::numeric,
    NULLIF(line->>'tax_rate', '')::numeric, NULLIF(line->>'tax_amount', '')::numeric,
    line->>'tratamiento'
  FROM jsonb_array_elements(v_lines) line;

  IF v_tipo IS NOT NULL THEN
    PERFORM public.invoice_iva_groups(v_invoice_id);
    PERFORM public.emitir_evento(p_org, 'factura', v_invoice_id, 'factura.creada',
      jsonb_build_object(
        'invoice_id', v_invoice_id,
        'numero', v_number,
        'tipo', v_tipo,
        'total', v_total,
        'origen', 'manual',
        'concepto', v_concepto,
        'moneda', v_moneda,
        'tributos', v_importe_tributos,
        'fce', v_fce,
        'exportacion', v_expo IS NOT NULL,
        'alicuotas', (SELECT jsonb_agg(DISTINCT line->'tax_rate')
          FROM jsonb_array_elements(v_lines) line)
      ));
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'invoice_id', v_invoice_id,
    'number', v_number,
    'tipo_comprobante', v_tipo,
    'total', v_total,
    'already', false
  );
END;
$fn$;

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
    -- La factura E y sus notas van en el punto de venta de exportación
    -- (tipo «Comprobantes de Exportación – Web Services»).
    IF NEW.tipo_comprobante IN (19, 20, 21) THEN
      IF v_cred.punto_venta_exportacion IS NULL THEN
        RAISE EXCEPTION 'Configura el punto de venta de exportacion antes de autorizar una factura E';
      END IF;
      NEW.punto_venta := v_cred.punto_venta_exportacion;
    ELSIF NEW.codigo_autorizacion_tipo = 'A' THEN
      IF v_cred.punto_venta_caea IS NULL THEN
        RAISE EXCEPTION 'Configura el punto de venta de contingencia (CAEA) antes de emitir sin CAE';
      END IF;
      NEW.punto_venta := v_cred.punto_venta_caea;
    ELSE
      NEW.punto_venta := v_cred.punto_venta;
    END IF;
    -- El cliente del exterior no tiene documento argentino: el QR no lo lleva.
    NEW.receptor_tipo_documento := CASE
      WHEN NEW.tipo_comprobante IN (19, 20, 21) THEN 99
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

CREATE OR REPLACE FUNCTION public.emitir_nota_debito(p_invoice_id uuid, p_motivo text, p_importe numeric, p_tasa numeric DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_original public.invoices%ROWTYPE;
  v_type integer;
  v_rate numeric;
  v_amount numeric;
  v_split jsonb;
  v_exento numeric := 0;
  v_net numeric;
  v_vat numeric;
  v_id uuid;
  v_number text;
BEGIN
  SELECT * INTO v_original FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'La factura no existe'; END IF;
  IF auth.uid() IS NULL OR NOT public.is_org_member(v_original.org_id, auth.uid()) THEN
    RAISE EXCEPTION 'No perteneces a esta organizacion' USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM public.exigir_permiso(v_original.org_id, 'invoices', 'edit', 'emitir notas de debito');
  IF NULLIF(btrim(v_original.cae), '') IS NULL OR v_original.afip_status <> 'authorized' THEN
    RAISE EXCEPTION 'Solo se puede emitir una nota de debito sobre una factura autorizada por ARCA';
  END IF;
  IF COALESCE(btrim(p_motivo), '') = '' OR length(btrim(p_motivo)) > 500 THEN
    RAISE EXCEPTION 'La nota de debito necesita un motivo de hasta 500 caracteres';
  END IF;
  v_type := public.tipo_nota_debito(v_original.tipo_comprobante);
  IF v_type IS NULL OR v_original.nota_credito_de IS NOT NULL OR v_original.nota_debito_de IS NOT NULL THEN
    RAISE EXCEPTION 'El comprobante no admite una nota de debito';
  END IF;
  v_amount := public.redondear_moneda(p_importe, v_original.currency);
  IF v_amount IS NULL OR v_amount <= 0 THEN RAISE EXCEPTION 'El importe de la nota de debito debe ser mayor a cero'; END IF;

  -- Clase C no discrimina IVA; A/B usan la alícuota pedida o la única de la factura.
  -- La de exportación (20) no lleva IVA: todo el importe es exento.
  IF v_type = 20 THEN
    v_rate := 0;
  ELSIF v_type = 12 THEN
    v_rate := 0;
  ELSE
    v_rate := COALESCE(p_tasa, (SELECT CASE WHEN count(DISTINCT (g->>'rate')::numeric) = 1 THEN min((g->>'rate')::numeric) END
      FROM jsonb_array_elements(public.invoice_iva_groups(p_invoice_id)) g));
    IF v_rate IS NULL THEN RAISE EXCEPTION 'La factura tiene varias alícuotas: indicá la de la nota de debito'; END IF;
    IF v_rate NOT IN (0, 2.5, 5, 10.5, 21, 27) THEN RAISE EXCEPTION 'La alícuota no está admitida por ARCA'; END IF;
  END IF;
  IF v_type = 20 THEN
    v_net := 0;
    v_vat := 0;
    v_exento := v_amount;
  ELSE
    v_split := public.desglosar_iva(v_amount, v_rate, true);
    v_net := (v_split->>'neto')::numeric;
    v_vat := (v_split->>'iva')::numeric;
  END IF;

  v_number := public.siguiente_numero_factura(v_original.org_id);
  INSERT INTO public.invoices (org_id, number, nota_debito_de, motivo_nota_debito, customer_name, customer_email,
    customer_tax_id, customer_address, receptor_tipo_documento, issue_date, due_date, status, currency, subtotal, tax_pct, tax_amount,
    total, tipo_comprobante, condicion_iva_receptor, afip_status, notes, created_by,
    concepto, servicio_desde, servicio_hasta, cancela_misma_moneda, importe_exento)
  VALUES (v_original.org_id, v_number, p_invoice_id, btrim(p_motivo), v_original.customer_name, v_original.customer_email,
    v_original.customer_tax_id, v_original.customer_address, v_original.receptor_tipo_documento, CURRENT_DATE, CURRENT_DATE, 'draft',
    v_original.currency, v_net, v_rate, v_vat, v_amount, v_type, v_original.condicion_iva_receptor, 'pending',
    'Nota de debito de ' || v_original.number || ': ' || btrim(p_motivo), auth.uid(),
    -- La nota de un servicio lleva el concepto y el período de la factura.
    v_original.concepto, v_original.servicio_desde, v_original.servicio_hasta, v_original.cancela_misma_moneda, v_exento) RETURNING id INTO v_id;
  INSERT INTO public.invoice_items (invoice_id, description, quantity, unit_price, total, tax_rate, tax_amount, tratamiento)
  VALUES (v_id, 'Debito sobre ' || v_original.number || ': ' || btrim(p_motivo), 1,
    v_net + v_exento, v_net + v_exento, v_rate, v_vat, CASE WHEN v_type = 20 THEN 'exento' ELSE 'gravado' END);
  PERFORM public.invoice_iva_groups(v_id);
  PERFORM public.emitir_evento(v_original.org_id, 'factura', v_id, 'nota_debito.creada',
    jsonb_build_object('invoice_id', v_id, 'ajusta_a', p_invoice_id, 'numero', v_number,
      'tipo', v_type, 'importe', v_amount, 'motivo', btrim(p_motivo)));
  RETURN v_id;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.afip_autorizacion_resultado(
  p_invoice_id      uuid,
  p_status          text,
  p_cae             text DEFAULT NULL,
  p_cae_vencimiento date DEFAULT NULL,
  p_numero_afip     integer DEFAULT NULL,
  p_environment     text DEFAULT NULL,
  p_error           text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_invoice record;
BEGIN
  IF p_status NOT IN (
    'processing', 'authorized', 'rejected', 'error', 'config_error',
    'network_error', 'validation_error'
  ) THEN
    RAISE EXCEPTION 'Estado AFIP no válido: %', p_status;
  END IF;

  -- Never turn an ambiguous provider response into a free retry. The edge
  -- function already maps this value, but the database keeps the invariant
  -- for every future service-role caller too.
  IF p_status = 'network_error' THEN
    p_status := 'processing';
  END IF;

  IF p_status = 'authorized'
     AND (NULLIF(btrim(p_cae), '') IS NULL OR p_numero_afip IS NULL) THEN
    RAISE EXCEPTION 'Una autorización AFIP necesita CAE y número de comprobante';
  END IF;

  SELECT i.id, i.afip_status, i.cae, i.cae_vencimiento, i.numero_afip,
         i.afip_environment, i.afip_error
    INTO v_invoice
  FROM public.invoices i
  WHERE i.id = p_invoice_id
  FOR UPDATE;

  IF v_invoice.id IS NULL THEN
    RAISE EXCEPTION 'Factura no encontrada';
  END IF;

  IF NULLIF(btrim(v_invoice.cae), '') IS NOT NULL THEN
    DELETE FROM public.afip_authorization_locks WHERE invoice_id = p_invoice_id;
    RETURN jsonb_build_object(
      'ok', true, 'status', 'authorized', 'idempotent', true,
      'invoice_id', p_invoice_id, 'cae', v_invoice.cae,
      'cae_vencimiento', v_invoice.cae_vencimiento,
      'numero_afip', v_invoice.numero_afip,
      'environment', v_invoice.afip_environment
    );
  END IF;

  IF v_invoice.afip_status <> 'processing' THEN
    RETURN jsonb_build_object(
      'ok', true, 'status', v_invoice.afip_status, 'idempotent', true,
      'invoice_id', p_invoice_id, 'error', v_invoice.afip_error
    );
  END IF;

  UPDATE public.invoices
     SET afip_status = p_status,
         cae = CASE WHEN p_status = 'authorized' THEN p_cae ELSE NULL END,
         cae_vencimiento = CASE WHEN p_status = 'authorized' THEN p_cae_vencimiento ELSE NULL END,
         numero_afip = CASE WHEN p_status = 'authorized' THEN p_numero_afip ELSE NULL END,
         afip_environment = COALESCE(p_environment, afip_environment),
         afip_error = p_error,
         -- Un rechazo explícito de ARCA no consume el número ni el pedido: si
         -- quedaran, otra factura podría tomar ese número y ésta no volvería
         -- a cuadrar con la secuencia nunca más.
         afip_candidate_number = CASE WHEN p_status IN ('rejected', 'config_error', 'validation_error') THEN NULL ELSE afip_candidate_number END,
         afip_candidate_set_at = CASE WHEN p_status IN ('rejected', 'config_error', 'validation_error') THEN NULL ELSE afip_candidate_set_at END,
         fex_request_id = CASE WHEN p_status IN ('rejected', 'config_error', 'validation_error') THEN NULL ELSE fex_request_id END,
         updated_at = now()
   WHERE id = p_invoice_id;

  IF p_status <> 'processing' THEN
    DELETE FROM public.afip_authorization_locks WHERE invoice_id = p_invoice_id;
  ELSE
    UPDATE public.afip_authorization_locks
       SET expires_at = now() + interval '15 minutes'
     WHERE invoice_id = p_invoice_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'status', p_status, 'invoice_id', p_invoice_id,
    'cae', p_cae, 'cae_vencimiento', p_cae_vencimiento,
    'numero_afip', p_numero_afip, 'error', p_error
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.crear_factura_manual(uuid, jsonb, jsonb, jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crear_factura_manual(uuid, jsonb, jsonb, jsonb, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.emitir_nota_debito(uuid, text, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.emitir_nota_debito(uuid, text, numeric, numeric) TO authenticated, service_role;

-- Parámetros de WSFEX (países, Incoterms, monedas, puntos de venta): datos
-- públicos de ARCA, cacheados por ambiente. Escribe sólo el servidor.
CREATE TABLE IF NOT EXISTS public.arca_parametros_fex (
  environment text NOT NULL CHECK (environment IN ('homologacion', 'produccion')),
  tipo text NOT NULL CHECK (tipo IN ('paises', 'cuit_paises', 'incoterms', 'monedas')),
  datos jsonb NOT NULL CHECK (jsonb_typeof(datos) = 'array'),
  actualizado_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (environment, tipo)
);
ALTER TABLE public.arca_parametros_fex ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS arca_parametros_fex_leer ON public.arca_parametros_fex;
CREATE POLICY arca_parametros_fex_leer ON public.arca_parametros_fex FOR SELECT TO authenticated USING (true);
REVOKE ALL ON public.arca_parametros_fex FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.arca_parametros_fex FROM authenticated;
GRANT SELECT ON public.arca_parametros_fex TO authenticated;
GRANT ALL ON public.arca_parametros_fex TO service_role;

CREATE OR REPLACE FUNCTION public.estado_exportacion(p_org uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $ee$
DECLARE c public.afip_credentials;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_org_member(p_org, auth.uid()) THEN
    RAISE EXCEPTION 'No perteneces a esta organizacion' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO c FROM public.afip_credentials WHERE org_id = p_org;
  RETURN jsonb_build_object(
    'punto_venta_exportacion', c.punto_venta_exportacion, 'punto_venta', c.punto_venta,
    'environment', c.environment, 'modo', c.modo,
    'parametros_at', (SELECT min(actualizado_at) FROM public.arca_parametros_fex p WHERE p.environment = c.environment));
END;
$ee$;

CREATE OR REPLACE FUNCTION public.configurar_exportacion(p_org uuid, p_punto_venta_exportacion integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $ce$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_org_role(p_org, auth.uid(), ARRAY['owner', 'admin']) THEN
    RAISE EXCEPTION 'Solo el dueno o un administrador configuran la exportacion' USING ERRCODE = '42501';
  END IF;
  IF p_punto_venta_exportacion IS NOT NULL AND p_punto_venta_exportacion NOT BETWEEN 1 AND 99998 THEN
    RAISE EXCEPTION 'El punto de venta va de 1 a 99998' USING ERRCODE = '22023';
  END IF;
  UPDATE public.afip_credentials SET punto_venta_exportacion = p_punto_venta_exportacion, updated_at = now() WHERE org_id = p_org;
  IF NOT FOUND THEN RAISE EXCEPTION 'Configura primero la identidad fiscal del comercio' USING ERRCODE = '22023'; END IF;
  RETURN public.estado_exportacion(p_org);
EXCEPTION WHEN check_violation THEN
  RAISE EXCEPTION 'El punto de venta de exportacion tiene que ser distinto del de CAE y del de CAEA' USING ERRCODE = '22023';
END;
$ce$;

-- El `Id` del pedido a WSFEX, una sola vez por factura (sólo el servidor).
CREATE OR REPLACE FUNCTION public.afip_fex_asignar_id(p_invoice_id uuid, p_id bigint)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fi$
DECLARE v bigint;
BEGIN
  UPDATE public.invoices SET fex_request_id = COALESCE(fex_request_id, p_id)
   WHERE id = p_invoice_id AND tipo_comprobante IN (19, 20, 21)
  RETURNING fex_request_id INTO v;
  IF v IS NULL THEN RAISE EXCEPTION 'La factura no es de exportacion'; END IF;
  RETURN v;
END;
$fi$;

REVOKE ALL ON FUNCTION public.afip_fex_asignar_id(uuid, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.afip_fex_asignar_id(uuid, bigint) TO service_role;
REVOKE ALL ON FUNCTION public.estado_exportacion(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.configurar_exportacion(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.estado_exportacion(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.configurar_exportacion(uuid, integer) TO authenticated, service_role;

INSERT INTO public.security_function_contracts(function_name, identity_arguments, audience, rationale, definition_hash, reviewed_on)
SELECT p.proname, pg_get_function_identity_arguments(p.oid), 'authenticated_delegate',
       CASE p.proname
         WHEN 'configurar_exportacion' THEN 'Exige ser dueño o administrador; sólo cambia el punto de venta de exportación de su negocio.'
         ELSE 'Exige ser miembro del negocio; sólo devuelve su configuración de exportación.'
       END,
       md5(pg_get_functiondef(p.oid)), DATE '2026-10-22'
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname IN ('configurar_exportacion', 'estado_exportacion')
ON CONFLICT (function_name, identity_arguments) DO UPDATE
  SET definition_hash = EXCLUDED.definition_hash, reviewed_on = EXCLUDED.reviewed_on, rationale = EXCLUDED.rationale;

UPDATE public.security_function_contracts c
   SET definition_hash = md5(pg_get_functiondef(p.oid)), reviewed_on = DATE '2026-10-22'
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = c.function_name
   AND pg_get_function_identity_arguments(p.oid) = c.identity_arguments
   AND c.function_name IN ('crear_factura_manual', 'snapshot_identidad_fiscal_factura', 'emitir_nota_debito',
                           'tipo_nota_credito', 'tipo_nota_debito', 'afip_autorizacion_resultado');

COMMIT;
