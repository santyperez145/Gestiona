-- Retención de Ingresos Brutos al pagar a proveedores (agente de retención).
--
-- Un comercio designado agente de retención tiene que retener IIBB en cada
-- pago a un proveedor alcanzado, con la alícuota del padrón de retenciones
-- del organismo (ARBA, AGIP), y entregarle el certificado. Hasta acá la orden
-- de pago aceptaba una «retención» cargada a mano con su número.
--
--   1. `afip_credentials`: si es agente de retención de IIBB, de qué padrón,
--      qué alícuota aplicar a quien no está (vacío = no retener) y la base
--      mínima.
--   2. `padron_iibb_retenciones`: el padrón de retenciones, sólo de los
--      proveedores del comercio (el navegador filtra el archivo).
--   3. `retencion_iibb_calculada` (interna) y `retencion_para_proveedor`
--      (lo que se le propone al que paga).
--   4. `emitir_orden_de_pago`: un medio «retencion» con `automatica` se
--      recalcula en la base, numera la retención por jurisdicción y queda en
--      `withholding_records` («Retenemos»), atado a la orden. En ARBA ese
--      número es el «Nro. transacción Agente» del lote A-122R: desde el
--      1/12/2025 (RN ARBA 22/2025) el único comprobante válido es el A-122R
--      que genera ARBA al cargar la retención. En AGIP es el certificado
--      propio del agente.
--   5. `configurar_retenciones`, `datos_retenciones` y
--      `cargar_padron_iibb_retencion`.
-- Requiere 20261022001300 (`suppliers.cuit`) y 20261022001400.
-- Reversible: DROP de la tabla, las funciones nuevas y las columnas; volver
-- `emitir_orden_de_pago` a 20261022001400.
BEGIN;

-- 1 ──────────────────────────────────────────────────────────────────────────
ALTER TABLE public.afip_credentials
  ADD COLUMN IF NOT EXISTS retencion_iibb_agente boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS retencion_iibb_padron text,
  ADD COLUMN IF NOT EXISTS retencion_iibb_sin_padron numeric(5,2),
  ADD COLUMN IF NOT EXISTS retencion_iibb_minimo numeric(15,2) NOT NULL DEFAULT 0;
ALTER TABLE public.afip_credentials DROP CONSTRAINT IF EXISTS afip_credentials_retenciones_check;
ALTER TABLE public.afip_credentials ADD CONSTRAINT afip_credentials_retenciones_check CHECK (
  (retencion_iibb_padron IS NULL OR retencion_iibb_padron IN ('ARBA', 'AGIP'))
  AND (retencion_iibb_sin_padron IS NULL OR retencion_iibb_sin_padron BETWEEN 0 AND 100)
  AND retencion_iibb_minimo >= 0
  AND (NOT retencion_iibb_agente OR retencion_iibb_padron IS NOT NULL));

ALTER TABLE public.withholding_records
  ADD COLUMN IF NOT EXISTS jurisdiccion text,
  ADD COLUMN IF NOT EXISTS certificado_numero bigint;
CREATE UNIQUE INDEX IF NOT EXISTS withholding_records_certificado_idx
  ON public.withholding_records (org_id, withholding_type, jurisdiccion, certificado_numero)
  WHERE certificado_numero IS NOT NULL;

-- 2 ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.padron_iibb_retenciones (
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
ALTER TABLE public.padron_iibb_retenciones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS padron_iibb_retenciones_leer ON public.padron_iibb_retenciones;
CREATE POLICY padron_iibb_retenciones_leer ON public.padron_iibb_retenciones
  FOR SELECT TO authenticated USING (public.has_permission(org_id, 'purchases', 'view'));
REVOKE ALL ON public.padron_iibb_retenciones FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.padron_iibb_retenciones FROM authenticated;
GRANT SELECT ON public.padron_iibb_retenciones TO authenticated;
GRANT ALL ON public.padron_iibb_retenciones TO service_role;

CREATE OR REPLACE FUNCTION public.cargar_padron_iibb_retencion(p_org uuid, p_padron text, p_filas jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $cr$
DECLARE v_n integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_org_role(p_org, auth.uid(), ARRAY['owner', 'admin']) THEN
    RAISE EXCEPTION 'Solo el dueno o un administrador cargan el padron' USING ERRCODE = '42501';
  END IF;
  IF p_padron NOT IN ('ARBA', 'AGIP') THEN RAISE EXCEPTION 'El padron es ARBA o AGIP' USING ERRCODE = '22023'; END IF;
  IF jsonb_typeof(p_filas) <> 'array' OR jsonb_array_length(p_filas) > 5000 THEN
    RAISE EXCEPTION 'Se cargan hasta 5000 filas por vez' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.padron_iibb_retenciones (org_id, padron, cuit, alicuota, vigencia_desde, vigencia_hasta, baja, actualizado_at)
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
$cr$;

-- 3 ──────────────────────────────────────────────────────────────────────────
-- Interna: sin permisos propios, la llaman las funciones que ya los exigieron.
CREATE OR REPLACE FUNCTION public.retencion_iibb_calculada(p_org uuid, p_cuit text, p_base numeric, p_fecha date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $rc$
DECLARE
  c public.afip_credentials;
  v_cuit text := regexp_replace(COALESCE(p_cuit, ''), '\D', '', 'g');
  v_padron public.padron_iibb_retenciones;
  v_alic numeric;
  v_origen text;
BEGIN
  SELECT * INTO c FROM public.afip_credentials WHERE org_id = p_org;
  IF NOT FOUND OR NOT c.retencion_iibb_agente THEN
    RETURN jsonb_build_object('aplica', false, 'motivo', 'no_agente');
  END IF;
  IF length(v_cuit) <> 11 THEN
    RETURN jsonb_build_object('aplica', false, 'motivo', 'sin_cuit', 'jurisdiccion', c.retencion_iibb_padron,
      'aviso', 'El proveedor no tiene CUIT: cargalo en su ficha para calcular la retencion.');
  END IF;
  IF COALESCE(p_base, 0) <= 0 OR p_base < c.retencion_iibb_minimo THEN
    RETURN jsonb_build_object('aplica', false, 'motivo', 'bajo_minimo', 'jurisdiccion', c.retencion_iibb_padron, 'minimo', c.retencion_iibb_minimo);
  END IF;
  SELECT * INTO v_padron FROM public.padron_iibb_retenciones
   WHERE org_id = p_org AND padron = c.retencion_iibb_padron AND cuit = v_cuit;
  IF FOUND AND NOT v_padron.baja AND p_fecha BETWEEN v_padron.vigencia_desde AND v_padron.vigencia_hasta THEN
    v_alic := v_padron.alicuota; v_origen := 'padron';
  ELSIF NOT FOUND OR v_padron.baja THEN
    v_alic := c.retencion_iibb_sin_padron; v_origen := 'sin_padron';
  ELSE
    RETURN jsonb_build_object('aplica', false, 'motivo', 'padron_vencido', 'jurisdiccion', c.retencion_iibb_padron,
      'aviso', 'El padron de retenciones de ' || c.retencion_iibb_padron || ' de este proveedor no esta vigente: carga el del mes.');
  END IF;
  IF v_alic IS NULL OR v_alic <= 0 THEN
    RETURN jsonb_build_object('aplica', false, 'motivo', 'alicuota_cero', 'jurisdiccion', c.retencion_iibb_padron, 'origen', v_origen);
  END IF;
  RETURN jsonb_build_object('aplica', true, 'jurisdiccion', c.retencion_iibb_padron, 'base', round(p_base, 2),
    'alicuota', v_alic, 'importe', round(p_base * v_alic / 100, 2), 'origen', v_origen);
END;
$rc$;
REVOKE ALL ON FUNCTION public.retencion_iibb_calculada(uuid, text, numeric, date) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.retencion_para_proveedor(p_org uuid, p_supplier uuid, p_base numeric, p_fecha date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $rp$
DECLARE v_cuit text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_permission(p_org, 'purchases', 'view') THEN
    RAISE EXCEPTION 'No tenes permiso sobre las compras de este negocio' USING ERRCODE = '42501';
  END IF;
  SELECT cuit INTO v_cuit FROM public.suppliers WHERE id = p_supplier AND org_id = p_org;
  IF NOT FOUND THEN RAISE EXCEPTION 'El proveedor no es de este negocio' USING ERRCODE = '22023'; END IF;
  RETURN public.retencion_iibb_calculada(p_org, v_cuit, p_base,
    COALESCE(p_fecha, (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date));
END;
$rp$;

-- 5 ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.datos_retenciones(p_org uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $dr$
DECLARE c public.afip_credentials;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_org_member(p_org, auth.uid()) THEN
    RAISE EXCEPTION 'No perteneces a esta organizacion' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO c FROM public.afip_credentials WHERE org_id = p_org;
  RETURN jsonb_build_object(
    'iibb_agente', COALESCE(c.retencion_iibb_agente, false), 'iibb_padron', c.retencion_iibb_padron,
    'iibb_sin_padron', c.retencion_iibb_sin_padron, 'iibb_minimo', COALESCE(c.retencion_iibb_minimo, 0),
    'proveedores_en_padron', (SELECT count(*) FROM public.padron_iibb_retenciones WHERE org_id = p_org AND padron = c.retencion_iibb_padron),
    'padron_hasta', (SELECT max(vigencia_hasta) FROM public.padron_iibb_retenciones WHERE org_id = p_org AND padron = c.retencion_iibb_padron),
    'proveedores_sin_cuit', (SELECT count(*) FROM public.suppliers WHERE org_id = p_org AND active IS NOT FALSE AND cuit IS NULL));
END;
$dr$;

CREATE OR REPLACE FUNCTION public.configurar_retenciones(
  p_org uuid, p_iibb_agente boolean, p_iibb_padron text, p_iibb_sin_padron numeric, p_iibb_minimo numeric
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $cfr$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_org_role(p_org, auth.uid(), ARRAY['owner', 'admin']) THEN
    RAISE EXCEPTION 'Solo el dueno o un administrador configuran las retenciones' USING ERRCODE = '42501';
  END IF;
  IF p_iibb_agente AND COALESCE(p_iibb_padron, '') NOT IN ('ARBA', 'AGIP') THEN
    RAISE EXCEPTION 'Elegi el padron de Ingresos Brutos (ARBA o AGIP)' USING ERRCODE = '22023';
  END IF;
  IF p_iibb_sin_padron IS NOT NULL AND p_iibb_sin_padron NOT BETWEEN 0 AND 100 THEN
    RAISE EXCEPTION 'La alicuota va de 0 a 100' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(p_iibb_minimo, 0) < 0 THEN RAISE EXCEPTION 'La base minima no puede ser negativa' USING ERRCODE = '22023'; END IF;
  UPDATE public.afip_credentials
     SET retencion_iibb_agente = COALESCE(p_iibb_agente, false),
         retencion_iibb_padron = CASE WHEN p_iibb_agente THEN p_iibb_padron END,
         retencion_iibb_sin_padron = CASE WHEN p_iibb_agente THEN p_iibb_sin_padron END,
         retencion_iibb_minimo = COALESCE(p_iibb_minimo, 0),
         updated_at = now()
   WHERE org_id = p_org;
  IF NOT FOUND THEN RAISE EXCEPTION 'Configura primero la identidad fiscal del comercio' USING ERRCODE = '22023'; END IF;
  RETURN public.datos_retenciones(p_org);
END;
$cfr$;

-- 4 ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.emitir_orden_de_pago(p_org uuid, p_datos jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $op$
DECLARE
  v_key text := btrim(COALESCE(p_datos->>'idempotency_key', ''));
  v_previa public.ordenes_de_pago%ROWTYPE;
  v_supplier public.suppliers%ROWTYPE;
  v_fecha date := COALESCE(NULLIF(p_datos->>'fecha', '')::date, current_date);
  v_imp jsonb;
  v_med jsonb;
  v_debt public.supplier_debts%ROWTYPE;
  v_cheque public.cheques%ROWTYPE;
  v_importe numeric;
  v_imputado numeric := 0;
  v_pagado numeric := 0;
  v_numero bigint;
  v_orden uuid;
  v_cheque_id uuid;
  v_medio text;
  v_vistas uuid[] := '{}';
  v_calc jsonb;
  v_ret jsonb := NULL;
  v_ret_base numeric;
  v_cert bigint;
  v_referencia text;
  v_retenciones jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_org_member(p_org, auth.uid()) OR NOT public.has_permission(p_org, 'purchases', 'edit') THEN
    RAISE EXCEPTION 'No tenes permiso para pagar a proveedores' USING ERRCODE = '42501';
  END IF;
  IF length(v_key) NOT BETWEEN 8 AND 128 THEN RAISE EXCEPTION 'Falta la clave de idempotencia' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_previa FROM public.ordenes_de_pago WHERE org_id = p_org AND idempotency_key = v_key;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'idempotente', true, 'orden_id', v_previa.id, 'numero', v_previa.numero, 'total', v_previa.total);
  END IF;

  SELECT * INTO v_supplier FROM public.suppliers WHERE id = NULLIF(p_datos->>'supplier_id', '')::uuid AND org_id = p_org;
  IF NOT FOUND THEN RAISE EXCEPTION 'Elegi el proveedor' USING ERRCODE = '22023'; END IF;
  IF jsonb_typeof(p_datos->'imputaciones') <> 'array' OR jsonb_array_length(p_datos->'imputaciones') NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'Elegi de una a cincuenta deudas para pagar' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_datos->'medios') <> 'array' OR jsonb_array_length(p_datos->'medios') NOT BETWEEN 1 AND 20 THEN
    RAISE EXCEPTION 'Indica con que se paga (de uno a veinte medios)' USING ERRCODE = '22023';
  END IF;
  IF length(COALESCE(p_datos->>'notas', '')) > 1000 THEN RAISE EXCEPTION 'Las notas admiten hasta 1000 caracteres' USING ERRCODE = '22023'; END IF;

  -- Lo que se paga.
  FOR v_imp IN SELECT value FROM jsonb_array_elements(p_datos->'imputaciones') ORDER BY value->>'deuda_id' LOOP
    SELECT * INTO v_debt FROM public.supplier_debts WHERE id = NULLIF(v_imp->>'deuda_id', '')::uuid AND org_id = p_org FOR UPDATE;
    IF NOT FOUND OR v_debt.supplier_id IS DISTINCT FROM v_supplier.id THEN
      RAISE EXCEPTION 'Una de las deudas no es de este proveedor' USING ERRCODE = '22023';
    END IF;
    IF v_debt.id = ANY(v_vistas) THEN RAISE EXCEPTION 'Una deuda esta repetida' USING ERRCODE = '22023'; END IF;
    v_vistas := v_vistas || v_debt.id;
    v_importe := round(COALESCE(NULLIF(v_imp->>'importe', '')::numeric, 0), 2);
    IF v_importe <= 0 OR v_importe > v_debt.remaining_ars THEN
      RAISE EXCEPTION 'El importe a pagar de «%» tiene que ser mayor a cero y no superar su saldo', v_debt.description USING ERRCODE = '22023';
    END IF;
    v_imputado := v_imputado + v_importe;
  END LOOP;

  -- Con qué se paga.
  FOR v_med IN SELECT value FROM jsonb_array_elements(p_datos->'medios') LOOP
    v_medio := v_med->>'medio';
    IF v_medio NOT IN ('efectivo', 'transferencia', 'cheque_propio', 'cheque_tercero', 'retencion', 'otro') THEN
      RAISE EXCEPTION 'Medio de pago no admitido' USING ERRCODE = '22023';
    END IF;
    v_importe := round(COALESCE(NULLIF(v_med->>'importe', '')::numeric, 0), 2);
    IF v_importe <= 0 THEN RAISE EXCEPTION 'Cada medio de pago necesita un importe mayor a cero' USING ERRCODE = '22023'; END IF;
    IF v_medio = 'retencion' AND COALESCE((v_med->>'automatica')::boolean, false) THEN
      -- Retención de Ingresos Brutos como agente: la calcula la base, con el
      -- padrón vigente del proveedor; el navegador sólo propone.
      IF v_ret IS NOT NULL THEN RAISE EXCEPTION 'Una orden lleva una sola retencion automatica' USING ERRCODE = '22023'; END IF;
      v_ret_base := round(COALESCE(NULLIF(v_med->>'base', '')::numeric, 0), 2);
      IF v_ret_base <= 0 OR v_ret_base > round(v_imputado, 2) THEN
        RAISE EXCEPTION 'La base de la retencion tiene que ser mayor a cero y no superar lo que se paga' USING ERRCODE = '22023';
      END IF;
      v_calc := public.retencion_iibb_calculada(p_org, v_supplier.cuit, v_ret_base, v_fecha);
      IF NOT COALESCE((v_calc->>'aplica')::boolean, false) THEN
        RAISE EXCEPTION 'A este pago no le corresponde retencion de Ingresos Brutos (%)', COALESCE(v_calc->>'aviso', v_calc->>'motivo') USING ERRCODE = '22023';
      END IF;
      IF (v_calc->>'importe')::numeric <> v_importe THEN
        RAISE EXCEPTION 'La retencion que corresponde es % (% %% sobre %)', v_calc->>'importe', v_calc->>'alicuota', v_ret_base USING ERRCODE = '22023';
      END IF;
      v_ret := v_calc;
    ELSIF v_medio = 'retencion' AND btrim(COALESCE(v_med->>'referencia', '')) = '' THEN
      RAISE EXCEPTION 'La retencion necesita el numero de certificado' USING ERRCODE = '22023';
    END IF;
    v_pagado := v_pagado + v_importe;
  END LOOP;
  IF round(v_pagado, 2) <> round(v_imputado, 2) THEN
    RAISE EXCEPTION 'Los medios de pago suman % y lo que se paga suma %: tienen que coincidir', round(v_pagado, 2), round(v_imputado, 2) USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('orden_de_pago:' || p_org::text, 0));
  SELECT COALESCE(max(numero), 0) + 1 INTO v_numero FROM public.ordenes_de_pago WHERE org_id = p_org;
  INSERT INTO public.ordenes_de_pago (org_id, numero, fecha, supplier_id, proveedor_nombre, proveedor_cuit, total, notas, idempotency_key)
  VALUES (p_org, v_numero, v_fecha, v_supplier.id, v_supplier.name, v_supplier.cuit, round(v_imputado, 2),
          NULLIF(btrim(COALESCE(p_datos->>'notas', '')), ''), v_key)
  RETURNING id INTO v_orden;

  FOR v_med IN SELECT value FROM jsonb_array_elements(p_datos->'medios') LOOP
    v_medio := v_med->>'medio';
    v_importe := round((v_med->>'importe')::numeric, 2);
    v_cheque_id := NULL;
    v_referencia := NULLIF(btrim(COALESCE(v_med->>'referencia', v_med->>'numero', '')), '');
    IF v_medio = 'retencion' AND COALESCE((v_med->>'automatica')::boolean, false) THEN
      -- El certificado se numera por jurisdicción, en la misma transacción
      -- (y bajo el mismo candado) que la orden.
      SELECT COALESCE(max(certificado_numero), 0) + 1 INTO v_cert FROM public.withholding_records
       WHERE org_id = p_org AND withholding_type = 'iibb' AND direction = 'applied' AND jurisdiccion = v_ret->>'jurisdiccion';
      v_referencia := CASE WHEN v_ret->>'jurisdiccion' = 'ARBA'
        THEN 'Retención IIBB ARBA · transacción N.º ' || lpad(v_cert::text, 8, '0') || ' (comprobante A-122R)'
        ELSE 'Certificado IIBB ' || (v_ret->>'jurisdiccion') || ' N.º ' || lpad(v_cert::text, 8, '0') END;
      INSERT INTO public.withholding_records (org_id, withholding_type, counterpart_name, counterpart_cuit, amount, rate_pct, base_amount,
             direction, date, certificate_number, reference_type, reference_id, notes, jurisdiccion, certificado_numero)
      VALUES (p_org, 'iibb', v_supplier.name, v_supplier.cuit, v_importe, (v_ret->>'alicuota')::numeric, (v_ret->>'base')::numeric,
             'applied', v_fecha, (v_ret->>'jurisdiccion') || '-' || lpad(v_cert::text, 8, '0'), 'orden_de_pago', v_orden,
             'Orden de pago ' || v_numero || ' · ' || (v_ret->>'origen'), v_ret->>'jurisdiccion', v_cert);
      v_retenciones := v_retenciones || jsonb_build_array(v_ret || jsonb_build_object('certificado', v_cert));
    ELSIF v_medio = 'cheque_tercero' THEN
      SELECT * INTO v_cheque FROM public.cheques WHERE id = NULLIF(v_med->>'cheque_id', '')::uuid AND org_id = p_org FOR UPDATE;
      IF NOT FOUND OR v_cheque.type <> 'received' OR v_cheque.status <> 'pending' THEN
        RAISE EXCEPTION 'El cheque de terceros tiene que estar en cartera (recibido y pendiente)' USING ERRCODE = '22023';
      END IF;
      IF round(v_cheque.amount_ars, 2) <> v_importe THEN
        RAISE EXCEPTION 'Un cheque de terceros se entrega por su importe completo' USING ERRCODE = '22023';
      END IF;
      UPDATE public.cheques SET status = 'endorsed', entregado_a_supplier_id = v_supplier.id, orden_de_pago_id = v_orden,
             notes = concat_ws(' · ', NULLIF(notes, ''), 'Entregado a ' || v_supplier.name || ' en la orden de pago ' || v_numero)
       WHERE id = v_cheque.id;
      v_cheque_id := v_cheque.id;
    ELSIF v_medio = 'cheque_propio' THEN
      IF btrim(COALESCE(v_med->>'numero', '')) = '' OR COALESCE(v_med->>'vencimiento', '') !~ '^\d{4}-\d{2}-\d{2}$' THEN
        RAISE EXCEPTION 'El cheque propio necesita numero y fecha de pago' USING ERRCODE = '22023';
      END IF;
      INSERT INTO public.cheques (org_id, type, customer_name, bank_name, check_number, amount_ars, issue_date, due_date, notes, orden_de_pago_id)
      VALUES (p_org, 'issued', v_supplier.name, NULLIF(btrim(COALESCE(v_med->>'banco', '')), ''), btrim(v_med->>'numero'), v_importe,
              v_fecha, (v_med->>'vencimiento')::date, 'Orden de pago ' || v_numero, v_orden)
      RETURNING id INTO v_cheque_id;
    END IF;
    INSERT INTO public.orden_de_pago_medios (orden_id, org_id, medio, importe, referencia, cheque_id)
    VALUES (v_orden, p_org, v_medio, v_importe, v_referencia, v_cheque_id);
  END LOOP;

  FOR v_imp IN SELECT value FROM jsonb_array_elements(p_datos->'imputaciones') LOOP
    SELECT * INTO v_debt FROM public.supplier_debts WHERE id = (v_imp->>'deuda_id')::uuid;
    v_importe := round((v_imp->>'importe')::numeric, 2);
    INSERT INTO public.orden_de_pago_imputaciones (orden_id, org_id, supplier_debt_id, descripcion, importe)
    VALUES (v_orden, p_org, v_debt.id, v_debt.description, v_importe);
    INSERT INTO public.supplier_payments (org_id, supplier_debt_id, amount_ars, method, note, orden_de_pago_id, idempotency_key)
    VALUES (p_org, v_debt.id, v_importe, 'orden_de_pago', 'Orden de pago ' || v_numero, v_orden, v_key || ':' || v_debt.id);
    UPDATE public.supplier_debts SET paid_ars = round(paid_ars + v_importe, 2),
           status = CASE WHEN round(paid_ars + v_importe, 2) >= amount_ars THEN 'paid' ELSE 'partial' END, updated_at = now()
     WHERE id = v_debt.id;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'orden_id', v_orden, 'numero', v_numero, 'total', round(v_imputado, 2), 'retenciones', v_retenciones);
END;
$op$;

REVOKE ALL ON FUNCTION public.cargar_padron_iibb_retencion(uuid, text, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.retencion_para_proveedor(uuid, uuid, numeric, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.datos_retenciones(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.configurar_retenciones(uuid, boolean, text, numeric, numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.emitir_orden_de_pago(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cargar_padron_iibb_retencion(uuid, text, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.retencion_para_proveedor(uuid, uuid, numeric, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.datos_retenciones(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.configurar_retenciones(uuid, boolean, text, numeric, numeric) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.emitir_orden_de_pago(uuid, jsonb) TO authenticated, service_role;

INSERT INTO public.security_function_contracts(function_name, identity_arguments, audience, rationale, definition_hash, reviewed_on)
SELECT p.proname, pg_get_function_identity_arguments(p.oid), 'authenticated_delegate',
       CASE p.proname
         WHEN 'cargar_padron_iibb_retencion' THEN 'Exige ser dueño o administrador; sólo carga el padrón de retenciones de su negocio.'
         WHEN 'retencion_para_proveedor' THEN 'Exige ver las compras del negocio; sólo calcula para un proveedor suyo con su configuración y su padrón.'
         WHEN 'datos_retenciones' THEN 'Exige ser miembro del negocio; sólo devuelve su configuración de retenciones.'
         WHEN 'configurar_retenciones' THEN 'Exige ser dueño o administrador; sólo cambia la configuración de retenciones de su negocio.'
         ELSE 'Exige permiso de editar compras; paga sólo deudas del proveedor elegido en su negocio, con cheques de su propia cartera, y recalcula la retención automática con su padrón.'
       END,
       md5(pg_get_functiondef(p.oid)), DATE '2026-10-22'
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname IN ('cargar_padron_iibb_retencion', 'retencion_para_proveedor', 'datos_retenciones', 'configurar_retenciones', 'emitir_orden_de_pago')
ON CONFLICT (function_name, identity_arguments) DO UPDATE
  SET definition_hash = EXCLUDED.definition_hash, reviewed_on = EXCLUDED.reviewed_on, rationale = EXCLUDED.rationale;

COMMIT;
