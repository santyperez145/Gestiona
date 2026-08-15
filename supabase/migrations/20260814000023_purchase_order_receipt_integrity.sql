-- C8 / Una recepción deja evidencia: una vez que una OC recibió mercadería,
-- sus renglones y su estado no pueden editarse desde PostgREST. De otro modo
-- un admin podía borrar el receipt auditado sin revertir la purchase que ya
-- movió stock, o marcar received sin que entrara una sola unidad.

CREATE OR REPLACE FUNCTION public.guard_purchase_order_status_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  -- Una orden cancelada o recibida es terminal. Una parcial puede cancelarse
  -- por el saldo que el proveedor no entregará, pero no volver a confirmed.
  IF OLD.status = 'cancelled' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'Una orden cancelada no se puede reabrir'
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.status = 'received' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'Una orden recibida no se puede cambiar de estado'
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.status = 'partially_received'
     AND NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status <> 'cancelled'
     AND COALESCE(current_setting('gestiona.po_receipt_authority', true), '') <> 'on' THEN
    RAISE EXCEPTION 'Una recepción parcial sólo puede completarse desde la recepción de mercadería'
      USING ERRCODE = 'check_violation';
  END IF;

  -- El único camino hacia partially_received/received es el RPC. No basta con
  -- poner una etiqueta: el RPC también crea purchases y el kardex.
  IF NEW.status IN ('partially_received', 'received')
     AND NEW.status IS DISTINCT FROM OLD.status
     AND COALESCE(current_setting('gestiona.po_receipt_authority', true), '') <> 'on' THEN
    RAISE EXCEPTION 'El estado de recepción sólo se actualiza al registrar mercadería'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_guard_purchase_order_status_integrity ON public.purchase_orders;
CREATE TRIGGER trg_guard_purchase_order_status_integrity
BEFORE UPDATE OF status ON public.purchase_orders
FOR EACH ROW EXECUTE FUNCTION public.guard_purchase_order_status_integrity();

-- Al eliminar una organización, sus órdenes, recibos y renglones desaparecen
-- por FK CASCADE. Marcamos sólo esa transacción para que el guard de abajo no
-- convierta la portabilidad/borrado de un tenant en una operación imposible.
CREATE OR REPLACE FUNCTION public.mark_organization_deleting()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  PERFORM set_config('gestiona.organization_deleting', 'on', true);
  RETURN OLD;
END;
$function$;

DROP TRIGGER IF EXISTS trg_mark_organization_deleting ON public.organizations;
CREATE TRIGGER trg_mark_organization_deleting
BEFORE DELETE ON public.organizations
FOR EACH ROW EXECUTE FUNCTION public.mark_organization_deleting();

CREATE OR REPLACE FUNCTION public.guard_purchase_order_item_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_order_id uuid;
  v_status text;
  v_has_receipts boolean;
  v_receiving boolean := COALESCE(
    current_setting('gestiona.po_receipt_authority', true), ''
  ) = 'on';
  v_organization_deleting boolean := COALESCE(
    current_setting('gestiona.organization_deleting', true), ''
  ) = 'on';
BEGIN
  v_order_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.order_id ELSE NEW.order_id END;
  SELECT status INTO v_status FROM public.purchase_orders WHERE id = v_order_id;

  IF TG_OP = 'INSERT' THEN
    IF COALESCE(NEW.quantity_received, 0) <> 0 THEN
      RAISE EXCEPTION 'Un renglón nuevo de OC no puede traer mercadería recibida'
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_status NOT IN ('draft', 'sent', 'confirmed') THEN
      RAISE EXCEPTION 'No se pueden agregar renglones a una orden parcialmente recibida, recibida o cancelada'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.order_id IS DISTINCT FROM OLD.order_id THEN
    RAISE EXCEPTION 'Un renglón no se puede mover entre órdenes de compra'
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.org_id IS DISTINCT FROM OLD.org_id THEN
    RAISE EXCEPTION 'Un renglón no se puede mover entre organizaciones'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.purchase_order_receipts r
     WHERE r.order_item_id = OLD.id
  ) INTO v_has_receipts;

  IF TG_OP = 'DELETE' THEN
    IF (v_has_receipts OR v_status IN ('partially_received', 'received'))
       AND NOT v_organization_deleting THEN
      RAISE EXCEPTION 'No se puede borrar un renglón de una orden con recepción registrada'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF NEW.quantity_received IS DISTINCT FROM OLD.quantity_received THEN
    IF NOT v_receiving THEN
      RAISE EXCEPTION 'quantity_received sólo cambia al registrar mercadería'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.quantity_received < OLD.quantity_received
       OR NEW.quantity_received > NEW.quantity_ordered THEN
      RAISE EXCEPTION 'La cantidad recibida debe crecer sin superar lo pedido'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF v_has_receipts OR v_status IN ('partially_received', 'received') THEN
    RAISE EXCEPTION 'No se puede editar un renglón de una orden con recepción registrada'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_guard_purchase_order_item_integrity ON public.purchase_order_items;
CREATE TRIGGER trg_guard_purchase_order_item_integrity
BEFORE INSERT OR UPDATE OR DELETE ON public.purchase_order_items
FOR EACH ROW EXECUTE FUNCTION public.guard_purchase_order_item_integrity();

REVOKE ALL ON FUNCTION public.guard_purchase_order_status_integrity()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_purchase_order_item_integrity()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_organization_deleting()
  FROM PUBLIC, anon, authenticated;

-- La función de recepción es la única que habilita los dos triggers durante
-- su propia transacción. La marca local no llega al navegador ni sobrevive al
-- commit; sólo evita que el guard confunda al RPC legítimo con PostgREST.
CREATE OR REPLACE FUNCTION public.receive_purchase_order(
  p_order_id    uuid,
  p_items       jsonb,
  p_notes       text DEFAULT NULL,
  p_location_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_org         uuid;
  v_user        uuid := auth.uid();
  v_currency    text;
  v_supplier    text;
  v_supplier_id uuid;
  v_status      text;
  v_rate        numeric;
  v_item        jsonb;
  v_it          record;
  v_qty         numeric;
  v_pendiente   numeric;
  v_cost_usd    numeric;
  v_purchase    uuid;
  v_recibidos   int := 0;
  v_estado      text;
BEGIN
  SELECT po.org_id, po.currency, po.supplier_name, po.supplier_id, po.status
    INTO v_org, v_currency, v_supplier, v_supplier_id, v_status
    FROM public.purchase_orders po
   WHERE po.id = p_order_id
   FOR UPDATE;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'La orden de compra no existe' USING ERRCODE = 'no_data_found';
  END IF;
  IF NOT public.has_org_role(v_org, v_user, ARRAY['owner', 'admin']) THEN
    RAISE EXCEPTION 'No tenés permiso para recibir mercadería de esta orden'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_status NOT IN ('confirmed', 'partially_received') THEN
    RAISE EXCEPTION 'La orden debe estar confirmada para recibir mercadería'
      USING ERRCODE = 'check_violation';
  END IF;
  IF p_location_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.locations l
     WHERE l.id = p_location_id AND l.org_id = v_org
  ) THEN
    RAISE EXCEPTION 'La sucursal no pertenece a esta organización'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'No se indicó qué recibir' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  PERFORM set_config('gestiona.po_receipt_authority', 'on', true);
  SELECT NULLIF(s.exchange_rate, 0) INTO v_rate
    FROM public.settings s WHERE s.org_id = v_org LIMIT 1;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty := (v_item->>'quantity')::numeric;
    IF v_qty IS NULL OR v_qty <= 0 THEN CONTINUE; END IF;

    SELECT i.* INTO v_it
      FROM public.purchase_order_items i
     WHERE i.id = (v_item->>'item_id')::uuid
       AND i.order_id = p_order_id
     FOR UPDATE;
    IF v_it.id IS NULL THEN
      RAISE EXCEPTION 'El renglón % no pertenece a esta orden', v_item->>'item_id'
        USING ERRCODE = 'invalid_parameter_value';
    END IF;

    v_pendiente := v_it.quantity_ordered - COALESCE(v_it.quantity_received, 0);
    IF v_qty > v_pendiente THEN
      RAISE EXCEPTION 'De "%" faltan % unidades y se quieren recibir %',
        v_it.product_name, v_pendiente, v_qty USING ERRCODE = 'invalid_parameter_value';
    END IF;

    v_cost_usd := CASE
      WHEN upper(COALESCE(v_currency, 'USD')) = 'ARS' AND v_rate IS NOT NULL
        THEN v_it.unit_cost / v_rate
      ELSE v_it.unit_cost
    END;

    INSERT INTO public.purchases (
      org_id, user_id, product_id, product_name, quantity,
      unit_cost_usd, customs_fee, total_usd, exchange_rate, total_ars,
      date, supplier, supplier_id, location_id
    ) VALUES (
      v_org, v_user, v_it.product_id, v_it.product_name, v_qty::int,
      v_cost_usd, 0, v_cost_usd * v_qty, COALESCE(v_rate, 0),
      CASE WHEN v_rate IS NULL THEN 0 ELSE v_cost_usd * v_qty * v_rate END,
      now(), v_supplier, v_supplier_id, p_location_id
    ) RETURNING id INTO v_purchase;

    INSERT INTO public.purchase_order_receipts (
      org_id, order_id, order_item_id, purchase_id, quantity, received_by, notes
    ) VALUES (v_org, p_order_id, v_it.id, v_purchase, v_qty, v_user, p_notes);

    UPDATE public.purchase_order_items
       SET quantity_received = COALESCE(quantity_received, 0) + v_qty
     WHERE id = v_it.id;
    v_recibidos := v_recibidos + 1;
  END LOOP;

  IF v_recibidos = 0 THEN
    RAISE EXCEPTION 'No se recibió ningún renglón' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT CASE
           WHEN bool_and(COALESCE(quantity_received, 0) >= quantity_ordered) THEN 'received'
           ELSE 'partially_received'
         END
    INTO v_estado
    FROM public.purchase_order_items
   WHERE order_id = p_order_id;

  UPDATE public.purchase_orders
     SET status = v_estado,
         received_date = CASE WHEN v_estado = 'received' THEN current_date ELSE received_date END,
         updated_at = now()
   WHERE id = p_order_id;

  PERFORM set_config('gestiona.po_receipt_authority', 'off', true);
  RETURN jsonb_build_object(
    'status', v_estado,
    'renglones_recibidos', v_recibidos,
    'pendientes', (
      SELECT COALESCE(sum(quantity_ordered - COALESCE(quantity_received, 0)), 0)
        FROM public.purchase_order_items WHERE order_id = p_order_id
    )
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.receive_purchase_order(uuid, jsonb, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.receive_purchase_order(uuid, jsonb, text, uuid)
  TO authenticated;

DO $verify$
DECLARE
  v_owner_id uuid;
  v_org_id uuid;
  v_product_id uuid;
  v_order_id uuid;
  v_item_id uuid;
  v_stock numeric;
  v_status text;
  v_direct_qty_blocked boolean := false;
  v_direct_status_blocked boolean := false;
  v_delete_blocked boolean := false;
BEGIN
  SELECT id INTO v_owner_id FROM auth.users ORDER BY created_at LIMIT 1;
  IF v_owner_id IS NULL THEN
    RAISE NOTICE 'Purchase order integrity verification omitted: no auth user exists';
    RETURN;
  END IF;

  INSERT INTO public.organizations (name, slug, owner_user_id)
  VALUES ('ZZ integridad recepción OC', 'zz-po-integrity-' || substr(gen_random_uuid()::text, 1, 8), v_owner_id)
  RETURNING id INTO v_org_id;
  INSERT INTO public.memberships (org_id, user_id, role)
  VALUES (v_org_id, v_owner_id, 'owner');
  INSERT INTO public.products (org_id, user_id, name, sale_price_ars, total_cost_usd, stock)
  VALUES (v_org_id, v_owner_id, 'ZZ producto integridad OC', 100, 5, 0)
  RETURNING id INTO v_product_id;
  INSERT INTO public.purchase_orders (org_id, order_number, supplier_name, status, currency, total_amount)
  VALUES (v_org_id, 'ZZ-PO-I-' || substr(gen_random_uuid()::text, 1, 8), 'ZZ proveedor', 'confirmed', 'USD', 50)
  RETURNING id INTO v_order_id;
  INSERT INTO public.purchase_order_items (
    org_id, order_id, product_id, product_name, quantity_ordered, quantity_received, unit_cost, total_cost
  ) VALUES (v_org_id, v_order_id, v_product_id, 'ZZ producto integridad OC', 5, 0, 10, 50)
  RETURNING id INTO v_item_id;

  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_owner_id::text, 'role', 'authenticated'
  )::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM public.receive_purchase_order(
    v_order_id, jsonb_build_array(jsonb_build_object('item_id', v_item_id, 'quantity', 2))
  );
  EXECUTE 'RESET ROLE';

  BEGIN
    UPDATE public.purchase_order_items SET quantity_received = 5 WHERE id = v_item_id;
  EXCEPTION WHEN check_violation THEN
    v_direct_qty_blocked := true;
  END;
  BEGIN
    UPDATE public.purchase_orders SET status = 'received' WHERE id = v_order_id;
  EXCEPTION WHEN check_violation THEN
    v_direct_status_blocked := true;
  END;
  BEGIN
    DELETE FROM public.purchase_order_items WHERE id = v_item_id;
  EXCEPTION WHEN check_violation THEN
    v_delete_blocked := true;
  END;
  IF NOT (v_direct_qty_blocked AND v_direct_status_blocked AND v_delete_blocked) THEN
    RAISE EXCEPTION 'La recepción parcial se pudo alterar fuera del RPC: cantidad %, estado %, borrar %',
      v_direct_qty_blocked, v_direct_status_blocked, v_delete_blocked;
  END IF;

  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_owner_id::text, 'role', 'authenticated'
  )::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM public.receive_purchase_order(
    v_order_id, jsonb_build_array(jsonb_build_object('item_id', v_item_id, 'quantity', 3))
  );
  EXECUTE 'RESET ROLE';

  SELECT stock INTO v_stock FROM public.products WHERE id = v_product_id;
  SELECT status INTO v_status FROM public.purchase_orders WHERE id = v_order_id;
  IF v_stock <> 5 OR v_status <> 'received' THEN
    RAISE EXCEPTION 'El RPC legítimo no pudo completar la recepción: stock %, estado %', v_stock, v_status;
  END IF;

  DELETE FROM public.purchases WHERE org_id = v_org_id;
  DELETE FROM public.organizations WHERE id = v_org_id;
  IF EXISTS (SELECT 1 FROM public.organizations WHERE id = v_org_id)
     OR EXISTS (SELECT 1 FROM public.purchase_order_receipts WHERE org_id = v_org_id)
     OR EXISTS (SELECT 1 FROM public.purchases WHERE org_id = v_org_id)
     OR EXISTS (SELECT 1 FROM public.stock_movements WHERE org_id = v_org_id) THEN
    RAISE EXCEPTION 'Purchase order integrity dejó filas ZZ';
  END IF;
END
$verify$;
