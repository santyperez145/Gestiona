-- Factura de Crédito Electrónica MiPyME (FCE, RG 4367).
--
-- Una pyme que le vende a una empresa grande por encima del monto que fija
-- ARCA tiene que emitir FCE: los tipos 201/206/211 (factura A/B/C), 202/207/
-- 212 (débito) y 203/208/213 (crédito). La factura lleva el vencimiento del
-- pago, el CBU del emisor (opcional 2101), su alias (2102) y la modalidad de
-- transferencia (27: SCA o ADC); sus notas asocian la FCE con CUIT y fecha, y
-- dicen si la anulan (opcional 22). Nerqia no la tenía.
--
--   1. `invoices`: CBU, alias, transferencia y anulación de la FCE.
--   2. `afip_credentials`: el CBU, alias y transferencia del comercio, que
--      la factura toma por defecto (se cargan en ARCA › Facturación).
--   3. `crear_factura_manual` recibe `fce` en `p_fiscal`: misma clase + 200.
--   4. Las notas de una FCE son FCE (`tipo_nota_credito`/`tipo_nota_debito`),
--      y las reglas de clase (C sin IVA, notas) incluyen los tipos nuevos.
--   5. `afip_ta_por_servicio`: el ticket de WSAA de cada comercio para otros
--      servicios de ARCA (WSFECRED, para saber si un cliente está obligado a
--      recibir FCE). Sólo el servidor lo lee.
-- Reversible: volver a las definiciones de 20261022000600, 20260825000040,
-- 20261009000600 y 20260930000230; DROP de las columnas, la tabla y las
-- funciones nuevas.
BEGIN;

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS fce_cbu text,
  ADD COLUMN IF NOT EXISTS fce_alias text,
  ADD COLUMN IF NOT EXISTS fce_transferencia text,
  ADD COLUMN IF NOT EXISTS fce_anulacion boolean NOT NULL DEFAULT false;
ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_fce_check;
ALTER TABLE public.invoices ADD CONSTRAINT invoices_fce_check CHECK (
  (fce_cbu IS NULL OR fce_cbu ~ '^[0-9]{22}$')
  AND (fce_transferencia IS NULL OR fce_transferencia IN ('SCA', 'ADC'))
  AND (fce_alias IS NULL OR length(fce_alias) <= 20)
  AND (tipo_comprobante IS NULL OR tipo_comprobante NOT IN (201, 206, 211)
       OR (fce_cbu IS NOT NULL AND fce_transferencia IS NOT NULL AND due_date IS NOT NULL)));

ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_nota_debito_tipo;
ALTER TABLE public.invoices ADD CONSTRAINT invoices_nota_debito_tipo
  CHECK (nota_debito_de IS NULL OR (tipo_comprobante IN (2, 7, 12, 202, 207, 212) AND nota_credito_de IS NULL));

ALTER TABLE public.afip_credentials
  ADD COLUMN IF NOT EXISTS fce_cbu text,
  ADD COLUMN IF NOT EXISTS fce_alias text,
  ADD COLUMN IF NOT EXISTS fce_transferencia text NOT NULL DEFAULT 'SCA';
ALTER TABLE public.afip_credentials DROP CONSTRAINT IF EXISTS afip_credentials_fce_check;
ALTER TABLE public.afip_credentials ADD CONSTRAINT afip_credentials_fce_check CHECK (
  (fce_cbu IS NULL OR fce_cbu ~ '^[0-9]{22}$') AND fce_transferencia IN ('SCA', 'ADC')
  AND (fce_alias IS NULL OR length(fce_alias) <= 20));

-- CBU con sus dos dígitos verificadores (BCRA). Espejo de `cbuValido`.
CREATE OR REPLACE FUNCTION public.cbu_valido(p_cbu text)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $cbu$
DECLARE
  d text := regexp_replace(COALESCE(p_cbu, ''), '\D', '', 'g');
  p1 int[] := ARRAY[7, 1, 3, 9, 7, 1, 3];
  p2 int[] := ARRAY[3, 9, 7, 1, 3, 9, 7, 1, 3, 9, 7, 1, 3];
  s int := 0;
  i int;
BEGIN
  IF length(d) <> 22 THEN RETURN false; END IF;
  FOR i IN 1..7 LOOP s := s + substr(d, i, 1)::int * p1[i]; END LOOP;
  IF (10 - s % 10) % 10 <> substr(d, 8, 1)::int THEN RETURN false; END IF;
  s := 0;
  FOR i IN 1..13 LOOP s := s + substr(d, 8 + i, 1)::int * p2[i]; END LOOP;
  RETURN (10 - s % 10) % 10 = substr(d, 22, 1)::int;
END;
$cbu$;

CREATE OR REPLACE FUNCTION public.tipo_nota_credito(p_tipo_factura int)
RETURNS int LANGUAGE sql IMMUTABLE AS $tnc$
  -- La nota de crédito lleva la MISMA clase que la factura que corrige; la de
  -- una FCE es FCE.
  SELECT CASE p_tipo_factura
    WHEN 1 THEN 3 WHEN 6 THEN 8 WHEN 11 THEN 13
    WHEN 201 THEN 203 WHEN 206 THEN 208 WHEN 211 THEN 213
    ELSE NULL END;
$tnc$;

CREATE OR REPLACE FUNCTION public.tipo_nota_debito(p_tipo_factura int)
RETURNS int LANGUAGE sql IMMUTABLE AS $tnd$
  SELECT CASE p_tipo_factura
    WHEN 1 THEN 2 WHEN 6 THEN 7 WHEN 11 THEN 12
    WHEN 201 THEN 202 WHEN 206 THEN 207 WHEN 211 THEN 212 END;
$tnd$;

CREATE OR REPLACE FUNCTION public.validar_alicuota_factura()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $va$
BEGIN
  IF NEW.tipo_comprobante IS NOT NULL
     AND COALESCE(NEW.tax_pct, -1) NOT IN (0, 2.5, 5, 10.5, 21, 27) THEN
    RAISE EXCEPTION 'La alicuota de IVA no esta admitida por ARCA';
  END IF;
  IF NEW.tipo_comprobante IN (11, 12, 13, 211, 212, 213)
     AND (COALESCE(NEW.tax_pct, 0) <> 0 OR COALESCE(NEW.tax_amount, 0) <> 0) THEN
    RAISE EXCEPTION 'Los comprobantes C no discriminan IVA';
  END IF;
  RETURN NEW;
END;
$va$;

CREATE OR REPLACE FUNCTION public.invoice_iva_groups(p_invoice_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $iva$
DECLARE
  v_invoice public.invoices%ROWTYPE;
  v_count integer;
  v_detailed integer;
  v_groups jsonb;
  v_net numeric;
  v_vat numeric;
BEGIN
  SELECT * INTO v_invoice FROM public.invoices WHERE id = p_invoice_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Factura no encontrada'; END IF;
  -- Total = neto gravado + IVA + no gravado + exento + tributos (20261022000600).
  IF round(v_invoice.subtotal + v_invoice.tax_amount + v_invoice.importe_no_gravado
           + v_invoice.importe_exento + v_invoice.importe_tributos, 2) <> round(v_invoice.total, 2) THEN
    RAISE EXCEPTION 'El total no es la suma de neto gravado, IVA, no gravado, exento y tributos';
  END IF;
  IF round(COALESCE((SELECT sum((t->>'importe')::numeric) FROM jsonb_array_elements(v_invoice.tributos) t), 0), 2)
     <> round(v_invoice.importe_tributos, 2) THEN
    RAISE EXCEPTION 'Los tributos no suman el importe de tributos';
  END IF;
  IF EXISTS (SELECT 1 FROM public.invoice_items WHERE invoice_id = p_invoice_id) AND (
       round(COALESCE((SELECT sum(total) FROM public.invoice_items WHERE invoice_id = p_invoice_id AND tratamiento = 'exento'), 0), 2)
         <> round(v_invoice.importe_exento, 2)
    OR round(COALESCE((SELECT sum(total) FROM public.invoice_items WHERE invoice_id = p_invoice_id AND tratamiento = 'no_gravado'), 0), 2)
         <> round(v_invoice.importe_no_gravado, 2)) THEN
    RAISE EXCEPTION 'Los renglones exentos o no gravados no coinciden con la cabecera';
  END IF;
  -- Sólo lo gravado se desglosa por alícuota.
  SELECT count(*), count(*) FILTER (WHERE tax_rate IS NOT NULL AND tax_amount IS NOT NULL)
    INTO v_count, v_detailed FROM public.invoice_items WHERE invoice_id = p_invoice_id AND tratamiento = 'gravado';
  IF v_count = 0 AND v_invoice.subtotal <> 0 THEN RAISE EXCEPTION 'El comprobante no tiene renglones gravados'; END IF;
  IF v_count = 0 AND NOT EXISTS (SELECT 1 FROM public.invoice_items WHERE invoice_id = p_invoice_id) THEN
    RAISE EXCEPTION 'El comprobante no tiene renglones';
  END IF;
  IF v_detailed > 0 THEN
    IF v_detailed <> v_count THEN RAISE EXCEPTION 'El desglose de IVA esta incompleto'; END IF;
    IF EXISTS (SELECT 1 FROM public.invoice_items WHERE invoice_id = p_invoice_id AND tratamiento = 'gravado'
      AND (total < 0 OR (tax_rate = 0 AND tax_amount <> 0) OR
        (v_invoice.tipo_comprobante NOT IN (3, 8, 13, 203, 208, 213) AND abs(tax_amount - round(total * tax_rate / 100, 2)) > 0.01))) THEN
      RAISE EXCEPTION 'El IVA de un renglon no corresponde a su alicuota';
    END IF;
    SELECT sum(total), sum(tax_amount) INTO v_net, v_vat FROM public.invoice_items WHERE invoice_id = p_invoice_id AND tratamiento = 'gravado';
    IF round(v_net, 2) <> round(v_invoice.subtotal, 2) OR round(v_vat, 2) <> round(v_invoice.tax_amount, 2) THEN
      RAISE EXCEPTION 'Los renglones no coinciden con la cabecera fiscal';
    END IF;
    SELECT jsonb_agg(jsonb_build_object('rate', rate, 'base', base, 'amount', amount) ORDER BY rate)
    INTO v_groups FROM (
      SELECT tax_rate AS rate, round(sum(total), 2) AS base, round(sum(tax_amount), 2) AS amount
      FROM public.invoice_items WHERE invoice_id = p_invoice_id AND tratamiento = 'gravado' GROUP BY tax_rate
    ) groups;
  ELSE
    IF v_invoice.tax_pct NOT IN (0, 2.5, 5, 10.5, 21, 27) OR
      (v_invoice.tax_pct = 0 AND v_invoice.tax_amount <> 0) OR
      (v_invoice.tipo_comprobante NOT IN (3, 8, 13, 203, 208, 213) AND
        abs(v_invoice.tax_amount - round(v_invoice.subtotal * v_invoice.tax_pct / 100, 2)) > 0.01) THEN
      RAISE EXCEPTION 'La alicuota no coincide con el IVA del comprobante';
    END IF;
    v_groups := jsonb_build_array(jsonb_build_object('rate', v_invoice.tax_pct,
      'base', v_invoice.subtotal, 'amount', v_invoice.tax_amount));
  END IF;
  IF v_invoice.tipo_comprobante IN (11, 12, 13, 211, 212, 213) AND
    (v_invoice.tax_pct <> 0 OR v_invoice.tax_amount <> 0 OR v_invoice.importe_exento <> 0 OR v_invoice.importe_no_gravado <> 0 OR
      EXISTS (SELECT 1 FROM jsonb_array_elements(v_groups) g WHERE (g->>'rate')::numeric <> 0)) THEN
    RAISE EXCEPTION 'Los comprobantes C no discriminan IVA';
  END IF;
  RETURN v_groups;
END;
$iva$;

CREATE OR REPLACE FUNCTION public.trg_factura_autorizada_inmutable()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
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
     OR NEW.fiscal_issued_at IS DISTINCT FROM OLD.fiscal_issued_at
     OR NEW.afip_candidate_number IS DISTINCT FROM OLD.afip_candidate_number
     OR NEW.afip_candidate_set_at IS DISTINCT FROM OLD.afip_candidate_set_at
     OR NEW.concepto IS DISTINCT FROM OLD.concepto
     OR NEW.servicio_desde IS DISTINCT FROM OLD.servicio_desde
     OR NEW.servicio_hasta IS DISTINCT FROM OLD.servicio_hasta
     OR NEW.due_date IS DISTINCT FROM OLD.due_date AND OLD.concepto <> 1
     OR NEW.importe_no_gravado IS DISTINCT FROM OLD.importe_no_gravado
     OR NEW.importe_exento IS DISTINCT FROM OLD.importe_exento
     OR NEW.importe_tributos IS DISTINCT FROM OLD.importe_tributos
     OR NEW.tributos IS DISTINCT FROM OLD.tributos
     OR NEW.cancela_misma_moneda IS DISTINCT FROM OLD.cancela_misma_moneda
     OR NEW.fce_cbu IS DISTINCT FROM OLD.fce_cbu
     OR NEW.fce_alias IS DISTINCT FROM OLD.fce_alias
     OR NEW.fce_transferencia IS DISTINCT FROM OLD.fce_transferencia
     OR NEW.fce_anulacion IS DISTINCT FROM OLD.fce_anulacion THEN
    RAISE EXCEPTION
      'La factura % ya fue autorizada por ARCA (CAE %) y no se puede modificar. Para corregirla, emitir una nota de credito.',
      OLD.number, OLD.cae USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$fn$;

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
    v_tratamiento := COALESCE(NULLIF(v_item->>'tratamiento', ''), 'gravado');
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
    fce_cbu, fce_alias, fce_transferencia
  ) VALUES (
    p_org, v_number, v_customer_name, v_customer_email, v_customer_address,
    v_customer_tax_id, CURRENT_DATE, v_due_date, v_notes, 'draft', v_moneda,
    v_subtotal, COALESCE(v_header_tax_pct, 0), v_tax_amount, v_total, v_user, v_tipo,
    v_condicion, CASE WHEN v_tipo IS NULL THEN 'not_applicable' ELSE 'pending' END,
    NULL,
    v_concepto, v_serv_desde, v_serv_hasta, v_no_gravado, v_exento,
    v_importe_tributos, v_tributos, v_cotizacion, v_misma_moneda,
    CASE WHEN v_fce THEN v_fce_cbu END, CASE WHEN v_fce THEN left(v_fce_alias, 20) END, CASE WHEN v_fce THEN v_fce_transferencia END
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

-- CBU, alias y transferencia del comercio para la FCE.
CREATE OR REPLACE FUNCTION public.datos_fce(p_org uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $df$
DECLARE r public.afip_credentials;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_org_member(p_org, auth.uid()) THEN
    RAISE EXCEPTION 'No perteneces a esta organizacion' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO r FROM public.afip_credentials WHERE org_id = p_org;
  RETURN jsonb_build_object('cbu', r.fce_cbu, 'alias', r.fce_alias, 'transferencia', COALESCE(r.fce_transferencia, 'SCA'));
END;
$df$;

CREATE OR REPLACE FUNCTION public.configurar_fce(p_org uuid, p_cbu text, p_alias text, p_transferencia text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $cf$
DECLARE
  v_cbu text := NULLIF(regexp_replace(COALESCE(p_cbu, ''), '\D', '', 'g'), '');
  v_transferencia text := upper(COALESCE(NULLIF(p_transferencia, ''), 'SCA'));
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_org_role(p_org, auth.uid(), ARRAY['owner', 'admin']) THEN
    RAISE EXCEPTION 'Solo el dueno o un administrador cargan los datos de la factura de credito' USING ERRCODE = '42501';
  END IF;
  IF v_cbu IS NOT NULL AND NOT public.cbu_valido(v_cbu) THEN
    RAISE EXCEPTION 'El CBU no es valido: revisa los 22 numeros' USING ERRCODE = '22023';
  END IF;
  IF v_transferencia NOT IN ('SCA', 'ADC') THEN
    RAISE EXCEPTION 'La transferencia es SCA o ADC' USING ERRCODE = '22023';
  END IF;
  UPDATE public.afip_credentials
     SET fce_cbu = v_cbu, fce_alias = left(NULLIF(btrim(COALESCE(p_alias, '')), ''), 20),
         fce_transferencia = v_transferencia, updated_at = now()
   WHERE org_id = p_org;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Configura primero la identidad fiscal del comercio' USING ERRCODE = '22023';
  END IF;
  RETURN public.datos_fce(p_org);
END;
$cf$;

-- Ticket de WSAA por comercio y servicio (WSFECRED y los que vengan). Es un
-- secreto: sin políticas, sólo service_role.
CREATE TABLE IF NOT EXISTS public.afip_ta_por_servicio (
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  servicio text NOT NULL,
  environment text NOT NULL CHECK (environment IN ('homologacion', 'produccion')),
  token text NOT NULL,
  sign text NOT NULL,
  expires_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, servicio, environment)
);
ALTER TABLE public.afip_ta_por_servicio ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.afip_ta_por_servicio FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.afip_ta_por_servicio TO service_role;

REVOKE ALL ON FUNCTION public.invoice_iva_groups(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invoice_iva_groups(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.validar_alicuota_factura() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.crear_factura_manual(uuid, jsonb, jsonb, jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crear_factura_manual(uuid, jsonb, jsonb, jsonb, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.datos_fce(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.configurar_fce(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.datos_fce(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.configurar_fce(uuid, text, text, text) TO authenticated, service_role;

INSERT INTO public.security_function_contracts(function_name, identity_arguments, audience, rationale, definition_hash, reviewed_on)
SELECT p.proname, pg_get_function_identity_arguments(p.oid), 'authenticated_delegate',
       CASE p.proname
         WHEN 'datos_fce' THEN 'Exige ser miembro del negocio; sólo devuelve su CBU, alias y transferencia de FCE.'
         ELSE 'Exige ser dueño o administrador del negocio; sólo cambia sus datos de FCE y valida el CBU.'
       END,
       md5(pg_get_functiondef(p.oid)), DATE '2026-10-22'
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname IN ('datos_fce', 'configurar_fce')
ON CONFLICT (function_name, identity_arguments) DO UPDATE
  SET definition_hash = EXCLUDED.definition_hash, reviewed_on = EXCLUDED.reviewed_on, rationale = EXCLUDED.rationale;

UPDATE public.security_function_contracts c
   SET definition_hash = md5(pg_get_functiondef(p.oid)), reviewed_on = DATE '2026-10-22'
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = c.function_name
   AND pg_get_function_identity_arguments(p.oid) = c.identity_arguments
   AND c.function_name IN ('crear_factura_manual', 'invoice_iva_groups', 'trg_factura_autorizada_inmutable',
                           'tipo_nota_credito', 'tipo_nota_debito', 'validar_alicuota_factura', 'cbu_valido');

COMMIT;
