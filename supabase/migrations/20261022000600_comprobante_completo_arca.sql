-- La factura completa para ARCA: concepto y servicios, exento y no gravado,
-- percepciones y otros tributos, y moneda extranjera.
--
-- Hasta acá cada factura salía como «productos», en pesos, con todo gravado
-- y sin tributos (`afip-authorize` mandaba ImpTotConc, ImpOpEx e ImpTrib en
-- cero y MonId PES). Eso dejaba afuera a los comercios de servicios (concepto
-- 2 y 3 exigen el período del servicio y el vencimiento del pago), lo exento
-- o no gravado (se declaraba como IVA al 0 %, que no es lo mismo), a los
-- agentes de percepción y la factura en dólares o euros.
--
--   1. `invoices` suma concepto, período del servicio, no gravado, exento,
--      tributos (detalle en jsonb) y si se cancela en la misma moneda. La
--      moneda y la cotización ya existían (`currency`, `moneda_cotizacion`).
--   2. `invoice_items.tratamiento`: gravado (por defecto), exento o no gravado.
--   3. `invoice_iva_groups`: el total es neto gravado + IVA + no gravado +
--      exento + tributos, y sólo lo gravado se desglosa por alícuota.
--   4. `crear_factura_manual` recibe todo eso en `p_fiscal` y en los renglones.
--   5. La factura autorizada no puede cambiar ninguno de esos campos.
--   6. Las notas de crédito prorratean todo (gravado, exento, no gravado y
--      cada tributo) y, como las de débito, copian concepto y período.
--   7. El QR fiscal lleva el código de moneda de ARCA (DOL, 060), no USD/EUR.
--
-- Las facturas existentes no cambian: quedan como productos, en su moneda,
-- todo gravado y sin tributos, que es lo que se autorizó.
-- El concepto por defecto del comercio (afip_credentials.concepto_predeterminado)
-- lo completa un trigger en toda factura nueva que no lo traiga.
-- Reversible: volver a las definiciones de 20261001000100, 20260925000900,
-- 20261002000500 y 20261009000600 y DROP COLUMN de los campos nuevos.
BEGIN;

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS concepto smallint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS servicio_desde date,
  ADD COLUMN IF NOT EXISTS servicio_hasta date,
  ADD COLUMN IF NOT EXISTS importe_no_gravado numeric(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS importe_exento numeric(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS importe_tributos numeric(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tributos jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS cancela_misma_moneda boolean NOT NULL DEFAULT false;

-- Las facturas existentes quedan en 1 (productos, lo que se autorizó). Las
-- nuevas toman el concepto que mande quien la crea o, si no lo dice, el del
-- comercio (trigger más abajo): una facturación de servicios no tiene que
-- elegirlo en cada venta, y las que salen solas de la caja o la tienda
-- también lo llevan.
ALTER TABLE public.invoices ALTER COLUMN concepto DROP DEFAULT;

ALTER TABLE public.afip_credentials
  ADD COLUMN IF NOT EXISTS concepto_predeterminado smallint NOT NULL DEFAULT 1;
ALTER TABLE public.afip_credentials DROP CONSTRAINT IF EXISTS afip_credentials_concepto_check;
ALTER TABLE public.afip_credentials ADD CONSTRAINT afip_credentials_concepto_check CHECK (concepto_predeterminado IN (1, 2, 3));

ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_concepto_check;
ALTER TABLE public.invoices ADD CONSTRAINT invoices_concepto_check CHECK (concepto IN (1, 2, 3));
ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_servicio_check;
ALTER TABLE public.invoices ADD CONSTRAINT invoices_servicio_check CHECK (
  concepto = 1 OR (servicio_desde IS NOT NULL AND servicio_hasta IS NOT NULL AND servicio_desde <= servicio_hasta));
ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_importes_extra_check;
ALTER TABLE public.invoices ADD CONSTRAINT invoices_importes_extra_check CHECK (
  importe_no_gravado >= 0 AND importe_exento >= 0 AND importe_tributos >= 0 AND jsonb_typeof(tributos) = 'array');

COMMENT ON COLUMN public.invoices.concepto IS 'WSFE Concepto: 1 productos, 2 servicios, 3 productos y servicios. 2 y 3 exigen servicio_desde/hasta; due_date es el vencimiento del pago (FchVtoPago).';
COMMENT ON COLUMN public.invoices.subtotal IS 'Neto gravado (WSFE ImpNeto). El total suma además IVA, no gravado, exento y tributos.';
COMMENT ON COLUMN public.invoices.tributos IS 'Percepciones y otros tributos (WSFE Tributos): [{tipo, descripcion, base, alicuota, importe}]. Suman importe_tributos.';

CREATE OR REPLACE FUNCTION public.trg_invoice_concepto_predeterminado()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $cp$
BEGIN
  IF NEW.concepto IS NULL THEN
    SELECT concepto_predeterminado INTO NEW.concepto FROM public.afip_credentials WHERE org_id = NEW.org_id;
    NEW.concepto := COALESCE(NEW.concepto, 1);
  END IF;
  -- Un servicio sin período: el del día de la factura (se puede corregir antes de autorizar).
  IF NEW.concepto <> 1 THEN
    NEW.servicio_desde := COALESCE(NEW.servicio_desde, NEW.issue_date);
    NEW.servicio_hasta := COALESCE(NEW.servicio_hasta, NEW.issue_date);
  END IF;
  RETURN NEW;
END;
$cp$;
REVOKE ALL ON FUNCTION public.trg_invoice_concepto_predeterminado() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_invoice_concepto_predeterminado ON public.invoices;
CREATE TRIGGER trg_invoice_concepto_predeterminado BEFORE INSERT ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.trg_invoice_concepto_predeterminado();

-- Leer y fijar el concepto del comercio. Leer: cualquier miembro (lo muestra la
-- factura manual). Fijar: dueño o administrador.
CREATE OR REPLACE FUNCTION public.concepto_de_facturacion(p_org uuid)
RETURNS smallint LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $lc$
DECLARE v smallint;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_org_member(p_org, auth.uid()) THEN
    RAISE EXCEPTION 'No perteneces a esta organizacion' USING ERRCODE = '42501';
  END IF;
  SELECT concepto_predeterminado INTO v FROM public.afip_credentials WHERE org_id = p_org;
  RETURN COALESCE(v, 1);
END;
$lc$;

CREATE OR REPLACE FUNCTION public.configurar_concepto_de_facturacion(p_org uuid, p_concepto smallint)
RETURNS smallint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fc$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_org_role(p_org, auth.uid(), ARRAY['owner', 'admin']) THEN
    RAISE EXCEPTION 'Solo el dueno o un administrador cambian el concepto de facturacion' USING ERRCODE = '42501';
  END IF;
  IF p_concepto IS NULL OR p_concepto NOT IN (1, 2, 3) THEN
    RAISE EXCEPTION 'El concepto tiene que ser productos, servicios o productos y servicios' USING ERRCODE = '22023';
  END IF;
  UPDATE public.afip_credentials SET concepto_predeterminado = p_concepto, updated_at = now() WHERE org_id = p_org;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Configura primero la identidad fiscal del comercio' USING ERRCODE = '22023';
  END IF;
  RETURN p_concepto;
END;
$fc$;
REVOKE ALL ON FUNCTION public.concepto_de_facturacion(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.configurar_concepto_de_facturacion(uuid, smallint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.concepto_de_facturacion(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.configurar_concepto_de_facturacion(uuid, smallint) TO authenticated, service_role;

INSERT INTO public.security_function_contracts(function_name, identity_arguments, audience, rationale, definition_hash, reviewed_on)
SELECT p.proname, pg_get_function_identity_arguments(p.oid), 'authenticated_delegate',
       CASE p.proname
         WHEN 'concepto_de_facturacion' THEN 'Exige ser miembro del negocio; sólo devuelve su concepto de facturación.'
         ELSE 'Exige ser dueño o administrador del negocio; sólo cambia su concepto de facturación.'
       END,
       md5(pg_get_functiondef(p.oid)), DATE '2026-10-22'
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname IN ('concepto_de_facturacion', 'configurar_concepto_de_facturacion')
ON CONFLICT (function_name, identity_arguments) DO UPDATE
  SET definition_hash = EXCLUDED.definition_hash, reviewed_on = EXCLUDED.reviewed_on, rationale = EXCLUDED.rationale;

-- La cotización oficial que usó `afip-authorize` queda en la factura antes de
-- pedir el CAE (el QR fiscal y el Libro IVA la necesitan). Sólo el servidor,
-- sólo sin CAE y sólo si la factura no traía una.
CREATE OR REPLACE FUNCTION public.afip_fijar_cotizacion(p_invoice_id uuid, p_cotizacion numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fx$
BEGIN
  IF p_cotizacion IS NULL OR p_cotizacion <= 0 THEN RAISE EXCEPTION 'Cotizacion invalida'; END IF;
  UPDATE public.invoices SET moneda_cotizacion = round(p_cotizacion, 6)
   WHERE id = p_invoice_id AND cae IS NULL AND currency <> 'ARS' AND moneda_cotizacion IS NULL;
END;
$fx$;
REVOKE ALL ON FUNCTION public.afip_fijar_cotizacion(uuid, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.afip_fijar_cotizacion(uuid, numeric) TO service_role;

ALTER TABLE public.invoice_items
  ADD COLUMN IF NOT EXISTS tratamiento text NOT NULL DEFAULT 'gravado';
ALTER TABLE public.invoice_items DROP CONSTRAINT IF EXISTS invoice_items_tratamiento_check;
ALTER TABLE public.invoice_items ADD CONSTRAINT invoice_items_tratamiento_check CHECK (
  tratamiento IN ('gravado', 'exento', 'no_gravado')
  AND (tratamiento = 'gravado' OR (COALESCE(tax_rate, 0) = 0 AND COALESCE(tax_amount, 0) = 0)));

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
        (v_invoice.tipo_comprobante NOT IN (3, 8, 13) AND abs(tax_amount - round(total * tax_rate / 100, 2)) > 0.01))) THEN
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
      (v_invoice.tipo_comprobante NOT IN (3, 8, 13) AND
        abs(v_invoice.tax_amount - round(v_invoice.subtotal * v_invoice.tax_pct / 100, 2)) > 0.01) THEN
      RAISE EXCEPTION 'La alicuota no coincide con el IVA del comprobante';
    END IF;
    v_groups := jsonb_build_array(jsonb_build_object('rate', v_invoice.tax_pct,
      'base', v_invoice.subtotal, 'amount', v_invoice.tax_amount));
  END IF;
  IF v_invoice.tipo_comprobante IN (11, 12, 13) AND
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
     OR NEW.cancela_misma_moneda IS DISTINCT FROM OLD.cancela_misma_moneda THEN
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

  v_number := public.siguiente_numero_factura(p_org);
  INSERT INTO public.invoices (
    org_id, number, customer_name, customer_email, customer_address,
    customer_tax_id, issue_date, due_date, notes, status, currency,
    subtotal, tax_pct, tax_amount, total, created_by, tipo_comprobante,
    condicion_iva_receptor, afip_status, sale_id,
    concepto, servicio_desde, servicio_hasta, importe_no_gravado, importe_exento,
    importe_tributos, tributos, moneda_cotizacion, cancela_misma_moneda
  ) VALUES (
    p_org, v_number, v_customer_name, v_customer_email, v_customer_address,
    v_customer_tax_id, CURRENT_DATE, v_due_date, v_notes, 'draft', v_moneda,
    v_subtotal, COALESCE(v_header_tax_pct, 0), v_tax_amount, v_total, v_user, v_tipo,
    v_condicion, CASE WHEN v_tipo IS NULL THEN 'not_applicable' ELSE 'pending' END,
    NULL,
    v_concepto, v_serv_desde, v_serv_hasta, v_no_gravado, v_exento,
    v_importe_tributos, v_tributos, v_cotizacion, v_misma_moneda
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

-- Nota de crédito: prorratea todo lo que tiene la factura, no sólo lo
-- gravado. Antes, sobre una factura con exento, no gravado o percepciones, la
-- nota sólo podía acreditar la parte gravada. Copia el concepto y el período
-- del servicio de la factura (ARCA los pide en la nota de un servicio).
CREATE OR REPLACE FUNCTION public.emitir_nota_credito(p_invoice_id uuid, p_motivo text, p_importe numeric DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $nc$
DECLARE
  v_original public.invoices%ROWTYPE;
  v_type integer;
  v_previous public.invoices%ROWTYPE;
  v_groups jsonb;
  v_group jsonb;
  v_previous_group jsonb;
  v_credit_lines jsonb := '[]'::jsonb;
  v_weights numeric[] := '{}';
  v_allocated numeric[];
  v_amount numeric;
  v_available numeric;
  v_net numeric := 0;
  v_vat numeric := 0;
  v_line_net numeric;
  v_line_vat numeric;
  v_group_gross numeric;
  v_rate numeric;
  v_single_rate numeric;
  v_index integer := 0;
  v_ngroups integer;
  v_exento_disp numeric;
  v_no_grav_disp numeric;
  v_trib_disp jsonb;
  v_trib jsonb;
  v_trib_imp numeric;
  v_exento numeric := 0;
  v_no_gravado numeric := 0;
  v_tributos jsonb := '[]'::jsonb;
  v_trib_total numeric := 0;
  v_id uuid;
  v_number text;
BEGIN
  SELECT * INTO v_original FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'La factura no existe'; END IF;
  IF auth.uid() IS NULL OR NOT public.is_org_member(v_original.org_id, auth.uid()) THEN
    RAISE EXCEPTION 'No perteneces a esta organizacion' USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM public.exigir_permiso(v_original.org_id, 'invoices', 'edit', 'emitir notas de credito');
  IF NULLIF(btrim(v_original.cae), '') IS NULL OR v_original.afip_status <> 'authorized' THEN
    RAISE EXCEPTION 'Solo se puede emitir una nota de credito sobre una factura autorizada por ARCA';
  END IF;
  IF COALESCE(btrim(p_motivo), '') = '' OR length(btrim(p_motivo)) > 500 THEN
    RAISE EXCEPTION 'La nota de credito necesita un motivo de hasta 500 caracteres';
  END IF;
  v_type := public.tipo_nota_credito(v_original.tipo_comprobante);
  IF v_original.nota_credito_de IS NOT NULL OR v_type IS NULL THEN
    RAISE EXCEPTION 'El comprobante no admite una nota de credito';
  END IF;

  -- Lo disponible: el desglose de la factura menos lo que ya reservaron las
  -- notas anteriores (incluso borradores), parte por parte.
  v_groups := public.invoice_iva_groups(p_invoice_id);
  v_exento_disp := v_original.importe_exento;
  v_no_grav_disp := v_original.importe_no_gravado;
  SELECT COALESCE(jsonb_agg(t.value || jsonb_build_object('importe_original', t.value->'importe') ORDER BY t.ord), '[]'::jsonb)
    INTO v_trib_disp FROM jsonb_array_elements(v_original.tributos) WITH ORDINALITY t(value, ord);
  FOR v_previous IN SELECT * FROM public.invoices WHERE nota_credito_de = p_invoice_id
  LOOP
    FOR v_previous_group IN SELECT * FROM jsonb_array_elements(public.invoice_iva_groups(v_previous.id))
    LOOP
      SELECT jsonb_agg(CASE WHEN (g->>'rate')::numeric = (v_previous_group->>'rate')::numeric
        THEN g || jsonb_build_object('base', (g->>'base')::numeric - (v_previous_group->>'base')::numeric,
          'amount', (g->>'amount')::numeric - (v_previous_group->>'amount')::numeric)
        ELSE g END ORDER BY (g->>'rate')::numeric) INTO v_groups
      FROM jsonb_array_elements(v_groups) g;
    END LOOP;
    v_exento_disp := v_exento_disp - v_previous.importe_exento;
    v_no_grav_disp := v_no_grav_disp - v_previous.importe_no_gravado;
    SELECT COALESCE(jsonb_agg(t.value || jsonb_build_object('importe', (t.value->>'importe')::numeric - COALESCE((
      SELECT sum((p->>'importe')::numeric) FROM jsonb_array_elements(v_previous.tributos) p
       WHERE p->>'tipo' = t.value->>'tipo' AND COALESCE(p->>'descripcion', '') = COALESCE(t.value->>'descripcion', '')), 0))
      ORDER BY t.ord), '[]'::jsonb)
      INTO v_trib_disp FROM jsonb_array_elements(v_trib_disp) WITH ORDINALITY t(value, ord);
  END LOOP;

  FOR v_group IN SELECT * FROM jsonb_array_elements(v_groups)
  LOOP
    IF (v_group->>'base')::numeric < 0 OR (v_group->>'amount')::numeric < 0 THEN
      RAISE EXCEPTION 'Las notas anteriores exceden el desglose fiscal de la factura';
    END IF;
    v_weights := array_append(v_weights, (v_group->>'base')::numeric + (v_group->>'amount')::numeric);
  END LOOP;
  v_ngroups := COALESCE(array_length(v_weights, 1), 0);
  IF v_exento_disp < 0 OR v_no_grav_disp < 0 THEN
    RAISE EXCEPTION 'Las notas anteriores exceden lo exento o no gravado de la factura';
  END IF;
  v_weights := array_append(array_append(v_weights, v_exento_disp), v_no_grav_disp);
  FOR v_trib IN SELECT value FROM jsonb_array_elements(v_trib_disp)
  LOOP
    IF (v_trib->>'importe')::numeric < 0 THEN RAISE EXCEPTION 'Las notas anteriores exceden los tributos de la factura'; END IF;
    v_weights := array_append(v_weights, (v_trib->>'importe')::numeric);
  END LOOP;

  SELECT sum(weight) INTO v_available FROM unnest(v_weights) weight;
  v_amount := public.redondear_moneda(COALESCE(p_importe, v_available), v_original.currency);
  IF v_amount <= 0 THEN RAISE EXCEPTION 'La factura ya esta acreditada por completo'; END IF;
  IF v_amount > v_available THEN RAISE EXCEPTION 'El importe supera el saldo disponible de la factura'; END IF;
  v_allocated := public.prorratear(v_amount, v_weights, v_original.currency);

  FOR v_group IN SELECT * FROM jsonb_array_elements(v_groups)
  LOOP
    v_index := v_index + 1;
    IF v_allocated[v_index] <= 0 THEN CONTINUE; END IF;
    v_rate := (v_group->>'rate')::numeric;
    v_group_gross := v_weights[v_index];
    v_line_vat := CASE WHEN v_allocated[v_index] = v_group_gross THEN (v_group->>'amount')::numeric
      ELSE round((v_group->>'amount')::numeric * v_allocated[v_index] / v_group_gross, 2) END;
    v_line_net := v_allocated[v_index] - v_line_vat;
    v_net := v_net + v_line_net;
    v_vat := v_vat + v_line_vat;
    v_credit_lines := v_credit_lines || jsonb_build_array(jsonb_build_object('tax_rate', v_rate,
      'total', v_line_net, 'tax_amount', v_line_vat, 'tratamiento', 'gravado'));
  END LOOP;
  v_exento := COALESCE(v_allocated[v_ngroups + 1], 0);
  v_no_gravado := COALESCE(v_allocated[v_ngroups + 2], 0);
  IF v_exento > 0 THEN
    v_credit_lines := v_credit_lines || jsonb_build_array(jsonb_build_object('tax_rate', 0, 'total', v_exento, 'tax_amount', 0, 'tratamiento', 'exento'));
  END IF;
  IF v_no_gravado > 0 THEN
    v_credit_lines := v_credit_lines || jsonb_build_array(jsonb_build_object('tax_rate', 0, 'total', v_no_gravado, 'tax_amount', 0, 'tratamiento', 'no_gravado'));
  END IF;
  v_index := v_ngroups + 2;
  FOR v_trib IN SELECT value FROM jsonb_array_elements(v_trib_disp)
  LOOP
    v_index := v_index + 1;
    v_trib_imp := COALESCE(v_allocated[v_index], 0);
    IF v_trib_imp <= 0 THEN CONTINUE; END IF;
    v_trib_total := v_trib_total + v_trib_imp;
    -- La base se recalcula para que base por alícuota dé el importe acreditado.
    v_tributos := v_tributos || jsonb_build_array(jsonb_build_object(
      'tipo', (v_trib->>'tipo')::integer, 'descripcion', v_trib->>'descripcion',
      'alicuota', (v_trib->>'alicuota')::numeric, 'importe', v_trib_imp,
      'base', CASE WHEN (v_trib->>'alicuota')::numeric > 0
        THEN round(v_trib_imp * 100 / (v_trib->>'alicuota')::numeric, 2)
        ELSE round((v_trib->>'base')::numeric * v_trib_imp / NULLIF((v_trib->>'importe_original')::numeric, 0), 2) END));
  END LOOP;

  SELECT CASE WHEN count(DISTINCT (line->>'tax_rate')::numeric) = 1 THEN min((line->>'tax_rate')::numeric) ELSE 0 END
  INTO v_single_rate FROM jsonb_array_elements(v_credit_lines) line WHERE line->>'tratamiento' = 'gravado';
  v_number := public.siguiente_numero_factura(v_original.org_id);
  INSERT INTO public.invoices (org_id, number, nota_credito_de, motivo_nota_credito, customer_name, customer_email,
    customer_tax_id, customer_address, issue_date, due_date, status, currency, subtotal, tax_pct, tax_amount,
    total, tipo_comprobante, condicion_iva_receptor, afip_status, notes, created_by,
    concepto, servicio_desde, servicio_hasta, importe_exento, importe_no_gravado, importe_tributos, tributos, cancela_misma_moneda)
  VALUES (v_original.org_id, v_number, p_invoice_id, btrim(p_motivo), v_original.customer_name, v_original.customer_email,
    v_original.customer_tax_id, v_original.customer_address, CURRENT_DATE, CURRENT_DATE, 'draft', v_original.currency,
    v_net, COALESCE(v_single_rate, 0), v_vat, v_amount, v_type, v_original.condicion_iva_receptor, 'pending',
    'Nota de credito de ' || v_original.number || ': ' || btrim(p_motivo), auth.uid(),
    v_original.concepto, v_original.servicio_desde, v_original.servicio_hasta, v_exento, v_no_gravado, v_trib_total,
    v_tributos, v_original.cancela_misma_moneda) RETURNING id INTO v_id;
  INSERT INTO public.invoice_items (invoice_id, description, quantity, unit_price, total, tax_rate, tax_amount, tratamiento)
  SELECT v_id, 'Credito sobre ' || v_original.number || ': ' || btrim(p_motivo), 1,
    (line->>'total')::numeric, (line->>'total')::numeric,
    (line->>'tax_rate')::numeric, (line->>'tax_amount')::numeric, line->>'tratamiento'
  FROM jsonb_array_elements(v_credit_lines) line;
  PERFORM public.invoice_iva_groups(v_id);
  PERFORM public.emitir_evento(v_original.org_id, 'factura', v_id, 'nota_credito.creada',
    jsonb_build_object('invoice_id', v_id, 'corrige_a', p_invoice_id, 'numero', v_number,
      'tipo', v_type, 'importe', v_amount, 'motivo', btrim(p_motivo)));
  RETURN v_id;
END;
$nc$;

CREATE OR REPLACE FUNCTION public.emitir_nota_debito(p_invoice_id uuid, p_motivo text, p_importe numeric, p_tasa numeric DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_original public.invoices%ROWTYPE;
  v_type integer;
  v_rate numeric;
  v_amount numeric;
  v_split jsonb;
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
  IF v_type = 12 THEN
    v_rate := 0;
  ELSE
    v_rate := COALESCE(p_tasa, (SELECT CASE WHEN count(DISTINCT (g->>'rate')::numeric) = 1 THEN min((g->>'rate')::numeric) END
      FROM jsonb_array_elements(public.invoice_iva_groups(p_invoice_id)) g));
    IF v_rate IS NULL THEN RAISE EXCEPTION 'La factura tiene varias alícuotas: indicá la de la nota de debito'; END IF;
    IF v_rate NOT IN (0, 2.5, 5, 10.5, 21, 27) THEN RAISE EXCEPTION 'La alícuota no está admitida por ARCA'; END IF;
  END IF;
  v_split := public.desglosar_iva(v_amount, v_rate, true);
  v_net := (v_split->>'neto')::numeric;
  v_vat := (v_split->>'iva')::numeric;

  v_number := public.siguiente_numero_factura(v_original.org_id);
  INSERT INTO public.invoices (org_id, number, nota_debito_de, motivo_nota_debito, customer_name, customer_email,
    customer_tax_id, customer_address, receptor_tipo_documento, issue_date, due_date, status, currency, subtotal, tax_pct, tax_amount,
    total, tipo_comprobante, condicion_iva_receptor, afip_status, notes, created_by,
    concepto, servicio_desde, servicio_hasta, cancela_misma_moneda)
  VALUES (v_original.org_id, v_number, p_invoice_id, btrim(p_motivo), v_original.customer_name, v_original.customer_email,
    v_original.customer_tax_id, v_original.customer_address, v_original.receptor_tipo_documento, CURRENT_DATE, CURRENT_DATE, 'draft',
    v_original.currency, v_net, v_rate, v_vat, v_amount, v_type, v_original.condicion_iva_receptor, 'pending',
    'Nota de debito de ' || v_original.number || ': ' || btrim(p_motivo), auth.uid(),
    -- La nota de un servicio lleva el concepto y el período de la factura.
    v_original.concepto, v_original.servicio_desde, v_original.servicio_hasta, v_original.cancela_misma_moneda) RETURNING id INTO v_id;
  INSERT INTO public.invoice_items (invoice_id, description, quantity, unit_price, total, tax_rate, tax_amount)
  VALUES (v_id, 'Debito sobre ' || v_original.number || ': ' || btrim(p_motivo), 1, v_net, v_net, v_rate, v_vat);
  PERFORM public.invoice_iva_groups(v_id);
  PERFORM public.emitir_evento(v_original.org_id, 'factura', v_id, 'nota_debito.creada',
    jsonb_build_object('invoice_id', v_id, 'ajusta_a', p_invoice_id, 'numero', v_number,
      'tipo', v_type, 'importe', v_amount, 'motivo', btrim(p_motivo)));
  RETURN v_id;
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

REVOKE ALL ON FUNCTION public.invoice_iva_groups(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invoice_iva_groups(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.crear_factura_manual(uuid, jsonb, jsonb, jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crear_factura_manual(uuid, jsonb, jsonb, jsonb, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.emitir_nota_credito(uuid, text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.emitir_nota_credito(uuid, text, numeric) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.emitir_nota_debito(uuid, text, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.emitir_nota_debito(uuid, text, numeric, numeric) TO authenticated, service_role;

-- El contrato de la función que llama el navegador sigue a su definición nueva.
UPDATE public.security_function_contracts c
   SET definition_hash = md5(pg_get_functiondef(p.oid)), reviewed_on = DATE '2026-10-22'
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = c.function_name
   AND pg_get_function_identity_arguments(p.oid) = c.identity_arguments
   AND c.function_name IN ('crear_factura_manual', 'invoice_iva_groups', 'trg_factura_autorizada_inmutable', 'emitir_nota_credito', 'emitir_nota_debito');

COMMIT;
