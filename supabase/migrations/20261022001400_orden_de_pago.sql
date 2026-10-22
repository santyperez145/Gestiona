-- Orden de pago: pagar una o varias deudas de un proveedor con varios medios.
--
-- Hasta acá cada deuda se pagaba sola y con un solo medio, sin comprobante
-- para el proveedor ni rastro de con qué se pagó. Ahora:
--   1. `ordenes_de_pago` (numeradas por negocio), sus medios y sus
--      imputaciones a deudas. Se escriben sólo por `emitir_orden_de_pago`.
--   2. Medios: efectivo, transferencia, cheque propio (se emite en la
--      cartera), cheque de terceros (sale de la cartera: queda «entregado» al
--      proveedor), retención (con su certificado) u otro.
--   3. Los medios suman exactamente lo imputado; cada imputación es un pago de
--      la deuda (`supplier_payments` apunta a la orden). Todo en una
--      transacción, con clave de idempotencia: un doble clic no paga dos veces.
--   4. Cheques: estado nuevo «endorsed» (entregado a un proveedor), final, sólo
--      desde pendiente y sólo para cheques recibidos.
-- Reversible: DROP de las tablas y la función; volver la guarda de cheques a
-- 20261014001400.
BEGIN;

-- 4 ──────────────────────────────────────────────────────────────────────────
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT conname FROM pg_constraint
            WHERE conrelid = 'public.cheques'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%deposited%'
  LOOP
    EXECUTE format('ALTER TABLE public.cheques DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;
ALTER TABLE public.cheques ADD CONSTRAINT cheques_status_check
  CHECK (status IN ('pending', 'deposited', 'cleared', 'bounced', 'cancelled', 'endorsed'));
ALTER TABLE public.cheques
  ADD COLUMN IF NOT EXISTS entregado_a_supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS orden_de_pago_id uuid;

CREATE OR REPLACE FUNCTION public.guard_cheque_estado()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ok boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status IS DISTINCT FROM 'pending' THEN
      RAISE EXCEPTION 'Un cheque nuevo entra como pendiente' USING ERRCODE = '22023';
    END IF;
    IF NEW.customer_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.customers WHERE id = NEW.customer_id AND org_id = NEW.org_id) THEN
      RAISE EXCEPTION 'El cliente no es de este negocio' USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status IS DISTINCT FROM 'pending' AND (
       NEW.type IS DISTINCT FROM OLD.type OR NEW.amount_ars IS DISTINCT FROM OLD.amount_ars
    OR NEW.check_number IS DISTINCT FROM OLD.check_number OR NEW.bank_name IS DISTINCT FROM OLD.bank_name
    OR NEW.org_id IS DISTINCT FROM OLD.org_id) THEN
    RAISE EXCEPTION 'Un cheque ya depositado, acreditado, rebotado, cancelado o entregado no se puede editar' USING ERRCODE = '55000';
  END IF;
  IF NEW.customer_id IS DISTINCT FROM OLD.customer_id AND NEW.customer_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.customers WHERE id = NEW.customer_id AND org_id = NEW.org_id) THEN
    RAISE EXCEPTION 'El cliente no es de este negocio' USING ERRCODE = '22023';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    v_ok := CASE
      -- Un cheque de terceros se entrega a un proveedor sólo con una orden de pago.
      WHEN OLD.type = 'received' AND OLD.status = 'pending'   THEN NEW.status IN ('deposited', 'bounced', 'cancelled')
                                                                   OR (NEW.status = 'endorsed' AND NEW.orden_de_pago_id IS NOT NULL)
      WHEN OLD.type = 'received' AND OLD.status = 'deposited' THEN NEW.status IN ('cleared', 'bounced')
      WHEN OLD.type = 'issued'   AND OLD.status = 'pending'   THEN NEW.status IN ('cleared', 'bounced', 'cancelled')
      ELSE false END;
    IF NOT v_ok THEN
      RAISE EXCEPTION 'Un cheque % no puede pasar de «%» a «%»',
        CASE OLD.type WHEN 'received' THEN 'recibido' ELSE 'emitido' END, OLD.status, NEW.status
        USING ERRCODE = '55000';
    END IF;
    NEW.estado_cambiado_at := now();
    IF NEW.status IN ('deposited', 'cleared') AND NEW.deposited_at IS NULL THEN
      NEW.deposited_at := current_date;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_cheque_estado() FROM PUBLIC, anon, authenticated;

-- 1 ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ordenes_de_pago (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  numero bigint NOT NULL CHECK (numero > 0),
  fecha date NOT NULL DEFAULT current_date,
  supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  proveedor_nombre text NOT NULL CHECK (length(btrim(proveedor_nombre)) BETWEEN 1 AND 200),
  proveedor_cuit text,
  total numeric(15,2) NOT NULL CHECK (total > 0),
  notas text CHECK (notas IS NULL OR length(notas) <= 1000),
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 128),
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ordenes_de_pago_numero_unico UNIQUE (org_id, numero),
  CONSTRAINT ordenes_de_pago_idempotencia UNIQUE (org_id, idempotency_key)
);
CREATE TABLE IF NOT EXISTS public.orden_de_pago_medios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  orden_id uuid NOT NULL REFERENCES public.ordenes_de_pago(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  medio text NOT NULL CHECK (medio IN ('efectivo', 'transferencia', 'cheque_propio', 'cheque_tercero', 'retencion', 'otro')),
  importe numeric(15,2) NOT NULL CHECK (importe > 0),
  referencia text CHECK (referencia IS NULL OR length(referencia) <= 200),
  cheque_id uuid REFERENCES public.cheques(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS public.orden_de_pago_imputaciones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  orden_id uuid NOT NULL REFERENCES public.ordenes_de_pago(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  supplier_debt_id uuid REFERENCES public.supplier_debts(id) ON DELETE SET NULL,
  descripcion text NOT NULL,
  importe numeric(15,2) NOT NULL CHECK (importe > 0)
);
CREATE INDEX IF NOT EXISTS ordenes_de_pago_org_fecha_idx ON public.ordenes_de_pago (org_id, fecha DESC);
CREATE INDEX IF NOT EXISTS orden_de_pago_medios_orden_idx ON public.orden_de_pago_medios (orden_id);
CREATE INDEX IF NOT EXISTS orden_de_pago_imputaciones_orden_idx ON public.orden_de_pago_imputaciones (orden_id);
ALTER TABLE public.supplier_payments ADD COLUMN IF NOT EXISTS orden_de_pago_id uuid REFERENCES public.ordenes_de_pago(id) ON DELETE SET NULL;
ALTER TABLE public.cheques DROP CONSTRAINT IF EXISTS cheques_orden_de_pago_fk;
ALTER TABLE public.cheques ADD CONSTRAINT cheques_orden_de_pago_fk FOREIGN KEY (orden_de_pago_id) REFERENCES public.ordenes_de_pago(id) ON DELETE SET NULL;

ALTER TABLE public.ordenes_de_pago ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orden_de_pago_medios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orden_de_pago_imputaciones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ordenes_de_pago_leer ON public.ordenes_de_pago;
CREATE POLICY ordenes_de_pago_leer ON public.ordenes_de_pago FOR SELECT TO authenticated USING (public.has_permission(org_id, 'purchases', 'view'));
DROP POLICY IF EXISTS orden_de_pago_medios_leer ON public.orden_de_pago_medios;
CREATE POLICY orden_de_pago_medios_leer ON public.orden_de_pago_medios FOR SELECT TO authenticated USING (public.has_permission(org_id, 'purchases', 'view'));
DROP POLICY IF EXISTS orden_de_pago_imputaciones_leer ON public.orden_de_pago_imputaciones;
CREATE POLICY orden_de_pago_imputaciones_leer ON public.orden_de_pago_imputaciones FOR SELECT TO authenticated USING (public.has_permission(org_id, 'purchases', 'view'));
REVOKE ALL ON public.ordenes_de_pago, public.orden_de_pago_medios, public.orden_de_pago_imputaciones FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.ordenes_de_pago, public.orden_de_pago_medios, public.orden_de_pago_imputaciones FROM authenticated;
GRANT SELECT ON public.ordenes_de_pago, public.orden_de_pago_medios, public.orden_de_pago_imputaciones TO authenticated;
GRANT ALL ON public.ordenes_de_pago, public.orden_de_pago_medios, public.orden_de_pago_imputaciones TO service_role;

-- 2 y 3 ───────────────────────────────────────────────────────────────────────
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
    IF v_medio = 'retencion' AND btrim(COALESCE(v_med->>'referencia', '')) = '' THEN
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
    IF v_medio = 'cheque_tercero' THEN
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
    VALUES (v_orden, p_org, v_medio, v_importe,
            NULLIF(btrim(COALESCE(v_med->>'referencia', v_med->>'numero', '')), ''), v_cheque_id);
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

  RETURN jsonb_build_object('ok', true, 'orden_id', v_orden, 'numero', v_numero, 'total', round(v_imputado, 2));
END;
$op$;

REVOKE ALL ON FUNCTION public.emitir_orden_de_pago(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.emitir_orden_de_pago(uuid, jsonb) TO authenticated, service_role;

INSERT INTO public.security_function_contracts(function_name, identity_arguments, audience, rationale, definition_hash, reviewed_on)
SELECT p.proname, pg_get_function_identity_arguments(p.oid), 'authenticated_delegate',
       'Exige permiso de editar compras; paga sólo deudas del proveedor elegido en su negocio, con cheques de su propia cartera.',
       md5(pg_get_functiondef(p.oid)), DATE '2026-10-22'
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'emitir_orden_de_pago'
ON CONFLICT (function_name, identity_arguments) DO UPDATE
  SET definition_hash = EXCLUDED.definition_hash, reviewed_on = EXCLUDED.reviewed_on, rationale = EXCLUDED.rationale;

COMMIT;
