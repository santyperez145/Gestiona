-- La factura del proveedor, enlazada con su compra y con su deuda.
--
-- Hasta acá el comprobante de compra vivía sólo en el Libro IVA y la deuda del
-- proveedor se cargaba aparte, a mano: dos veces lo mismo, y nada garantizaba
-- que la cuenta corriente coincidiera con las facturas.
--
--   1. `suppliers.cuit`: el proveedor se reconoce por su CUIT.
--   2. `pasar_comprobante_a_cuenta_corriente(comprobante, vencimiento, orden)`:
--      · una factura o nota de débito genera su deuda (una sola vez) y queda
--        enlazada a ella y, si se indica, a la orden de compra;
--      · una nota de crédito se aplica a las deudas abiertas del proveedor, de
--        la más vieja a la más nueva, y lo que sobra queda como saldo a favor
--        informado;
--      · si el proveedor no existe, se lo da de alta con su CUIT y razón social.
--   3. La deuda y los pagos apuntan al comprobante: la cuenta corriente es la
--      suma de sus facturas menos sus pagos, sin cargar nada dos veces.
-- Reversible: DROP FUNCTION; DROP de las columnas nuevas.
BEGIN;

ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS cuit text;
ALTER TABLE public.suppliers DROP CONSTRAINT IF EXISTS suppliers_cuit_check;
ALTER TABLE public.suppliers ADD CONSTRAINT suppliers_cuit_check CHECK (cuit IS NULL OR cuit ~ '^[0-9]{11}$');
CREATE UNIQUE INDEX IF NOT EXISTS suppliers_org_cuit_idx ON public.suppliers (org_id, cuit) WHERE cuit IS NOT NULL;

ALTER TABLE public.comprobantes_de_compra
  ADD COLUMN IF NOT EXISTS supplier_debt_id uuid REFERENCES public.supplier_debts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS purchase_order_id uuid REFERENCES public.purchase_orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS vencimiento date,
  ADD COLUMN IF NOT EXISTS aplicado_at timestamptz,
  ADD COLUMN IF NOT EXISTS saldo_a_favor numeric(15,2) NOT NULL DEFAULT 0 CHECK (saldo_a_favor >= 0);

ALTER TABLE public.supplier_debts ADD COLUMN IF NOT EXISTS comprobante_de_compra_id uuid REFERENCES public.comprobantes_de_compra(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS supplier_debts_comprobante_idx ON public.supplier_debts (comprobante_de_compra_id) WHERE comprobante_de_compra_id IS NOT NULL;
ALTER TABLE public.supplier_payments ADD COLUMN IF NOT EXISTS comprobante_de_compra_id uuid REFERENCES public.comprobantes_de_compra(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.pasar_comprobante_a_cuenta_corriente(
  p_comprobante uuid, p_vencimiento date DEFAULT NULL, p_orden_de_compra uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $pc$
DECLARE
  c public.comprobantes_de_compra%ROWTYPE;
  v_supplier uuid;
  v_nombre text;
  v_desc text;
  v_debt public.supplier_debts%ROWTYPE;
  v_resto numeric;
  v_aplicar numeric;
  v_aplicado numeric := 0;
  v_id uuid;
  v_nc boolean;
BEGIN
  SELECT * INTO c FROM public.comprobantes_de_compra WHERE id = p_comprobante FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Comprobante no encontrado' USING ERRCODE = 'P0002'; END IF;
  IF auth.uid() IS NULL OR NOT public.is_org_member(c.org_id, auth.uid())
     OR NOT public.has_permission(c.org_id, 'purchases', 'edit') THEN
    RAISE EXCEPTION 'No tenes permiso para registrar deudas con proveedores' USING ERRCODE = '42501';
  END IF;
  v_nc := c.tipo_comprobante IN (3, 8, 13, 53, 110, 112, 113, 114, 203, 208, 213);

  -- Una sola vez por comprobante.
  IF c.supplier_debt_id IS NOT NULL OR c.aplicado_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'idempotente', true, 'supplier_debt_id', c.supplier_debt_id, 'saldo_a_favor', c.saldo_a_favor);
  END IF;

  -- El proveedor: el del comprobante, el del mismo CUIT o uno nuevo.
  v_supplier := c.supplier_id;
  IF v_supplier IS NULL THEN
    SELECT id INTO v_supplier FROM public.suppliers WHERE org_id = c.org_id AND cuit = c.cuit_emisor;
  END IF;
  IF v_supplier IS NULL THEN
    INSERT INTO public.suppliers (org_id, name, cuit) VALUES (c.org_id, c.razon_social_emisor, c.cuit_emisor)
    ON CONFLICT (org_id, cuit) WHERE cuit IS NOT NULL DO UPDATE SET cuit = EXCLUDED.cuit
    RETURNING id INTO v_supplier;
  END IF;
  SELECT name INTO v_nombre FROM public.suppliers WHERE id = v_supplier;
  UPDATE public.suppliers SET cuit = c.cuit_emisor WHERE id = v_supplier AND cuit IS NULL
    AND NOT EXISTS (SELECT 1 FROM public.suppliers o WHERE o.org_id = c.org_id AND o.cuit = c.cuit_emisor);

  IF p_orden_de_compra IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.purchase_orders o WHERE o.id = p_orden_de_compra AND o.org_id = c.org_id
      AND (o.supplier_id IS NULL OR o.supplier_id = v_supplier) AND o.status <> 'cancelled') THEN
    RAISE EXCEPTION 'La orden de compra no es de este proveedor' USING ERRCODE = '22023';
  END IF;

  v_desc := CASE WHEN v_nc THEN 'Nota de credito ' ELSE 'Comprobante ' END || c.tipo_comprobante || ' '
    || lpad(c.punto_venta::text, 5, '0') || '-' || lpad(c.numero::text, 8, '0');

  IF v_nc THEN
    -- La nota de crédito cancela deuda abierta, de la más vieja a la más nueva.
    v_resto := c.total;
    FOR v_debt IN SELECT * FROM public.supplier_debts
       WHERE org_id = c.org_id AND supplier_id = v_supplier AND status <> 'paid' AND remaining_ars > 0
       ORDER BY due_date NULLS LAST, created_at, id FOR UPDATE
    LOOP
      EXIT WHEN v_resto <= 0;
      v_aplicar := least(v_resto, v_debt.remaining_ars);
      INSERT INTO public.supplier_payments (org_id, supplier_debt_id, amount_ars, method, note, comprobante_de_compra_id)
      VALUES (c.org_id, v_debt.id, v_aplicar, 'nota_credito', v_desc, c.id);
      UPDATE public.supplier_debts SET paid_ars = round(paid_ars + v_aplicar, 2),
             status = CASE WHEN round(paid_ars + v_aplicar, 2) >= amount_ars THEN 'paid' ELSE 'partial' END, updated_at = now()
       WHERE id = v_debt.id;
      v_resto := round(v_resto - v_aplicar, 2);
      v_aplicado := round(v_aplicado + v_aplicar, 2);
    END LOOP;
    UPDATE public.comprobantes_de_compra SET supplier_id = v_supplier, aplicado_at = now(), saldo_a_favor = greatest(v_resto, 0),
           purchase_order_id = COALESCE(p_orden_de_compra, purchase_order_id), updated_at = now()
     WHERE id = c.id;
    RETURN jsonb_build_object('ok', true, 'nota_de_credito', true, 'aplicado', v_aplicado, 'saldo_a_favor', greatest(v_resto, 0), 'supplier_id', v_supplier);
  END IF;

  INSERT INTO public.supplier_debts (org_id, supplier_id, supplier_name, description, amount_ars, due_date, comprobante_de_compra_id)
  VALUES (c.org_id, v_supplier, COALESCE(v_nombre, c.razon_social_emisor), v_desc, c.total,
          COALESCE(p_vencimiento, c.vencimiento, c.fecha + 30), c.id)
  RETURNING id INTO v_id;
  UPDATE public.comprobantes_de_compra SET supplier_id = v_supplier, supplier_debt_id = v_id,
         vencimiento = COALESCE(p_vencimiento, c.vencimiento, c.fecha + 30),
         purchase_order_id = COALESCE(p_orden_de_compra, purchase_order_id), updated_at = now()
   WHERE id = c.id;
  RETURN jsonb_build_object('ok', true, 'supplier_debt_id', v_id, 'supplier_id', v_supplier, 'importe', c.total);
END;
$pc$;

-- Un comprobante que ya está en la cuenta corriente no se borra: quedaría una
-- deuda (o un pago) sin su factura.
CREATE OR REPLACE FUNCTION public.trg_comprobante_en_cuenta_corriente()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $cc$
BEGIN
  IF OLD.supplier_debt_id IS NOT NULL OR OLD.aplicado_at IS NOT NULL THEN
    RAISE EXCEPTION 'Este comprobante ya esta en la cuenta corriente del proveedor: no se puede borrar' USING ERRCODE = '22023';
  END IF;
  RETURN OLD;
END;
$cc$;
DROP TRIGGER IF EXISTS trg_comprobante_en_cuenta_corriente ON public.comprobantes_de_compra;
CREATE TRIGGER trg_comprobante_en_cuenta_corriente BEFORE DELETE ON public.comprobantes_de_compra
  FOR EACH ROW EXECUTE FUNCTION public.trg_comprobante_en_cuenta_corriente();

REVOKE ALL ON FUNCTION public.pasar_comprobante_a_cuenta_corriente(uuid, date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pasar_comprobante_a_cuenta_corriente(uuid, date, uuid) TO authenticated, service_role;

INSERT INTO public.security_function_contracts(function_name, identity_arguments, audience, rationale, definition_hash, reviewed_on)
SELECT p.proname, pg_get_function_identity_arguments(p.oid), 'authenticated_delegate',
       'Exige permiso de editar compras en el negocio del comprobante; crea su deuda o aplica la nota de crédito sólo a deudas de ese proveedor.',
       md5(pg_get_functiondef(p.oid)), DATE '2026-10-22'
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'pasar_comprobante_a_cuenta_corriente'
ON CONFLICT (function_name, identity_arguments) DO UPDATE
  SET definition_hash = EXCLUDED.definition_hash, reviewed_on = EXCLUDED.reviewed_on, rationale = EXCLUDED.rationale;

COMMIT;
