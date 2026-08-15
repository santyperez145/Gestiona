-- C11 / auditoría de inventario, paso 1: el historial tiene que ser evidencia,
-- no una tabla que cualquier miembro pueda completar o modificar desde el
-- navegador. Precio se escribe exclusivamente desde su trigger; el nuevo RPC
-- de Kardex conoce el usuario autenticado.

-- `price_history_org_access` y `org_members_manage_stock_movements` eran FOR
-- ALL. Aunque la pantalla no lo hiciera, un cliente podía inventar o alterar
-- una entrada de auditoría. Conservamos sólo la lectura por organización.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT polname, polrelid::regclass AS table_name
    FROM pg_policy
    WHERE polrelid IN ('public.price_history'::regclass, 'public.stock_movements'::regclass)
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %s', r.polname, r.table_name);
  END LOOP;
END
$$;

CREATE POLICY price_history_org_read ON public.price_history
  FOR SELECT TO authenticated
  USING (public.is_org_member(org_id, auth.uid()));

CREATE POLICY stock_movements_org_read ON public.stock_movements
  FOR SELECT TO authenticated
  USING (public.is_org_member(org_id, auth.uid()));

-- El ajuste absoluto admite al navegador autenticado o a una Edge Function con
-- service_role. En el primer caso el actor tiene que ser el JWT, para que un
-- empleado no pueda atribuir un ajuste a otro miembro.
CREATE OR REPLACE FUNCTION public.adjust_stock(
  p_org_id uuid,
  p_product_id uuid,
  p_variant_id uuid,
  p_new_stock integer,
  p_notes text,
  p_created_by uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_stock integer;
  v_delta integer;
  v_product_name text;
  v_variant_name text;
  v_movement_type text;
BEGIN
  IF p_new_stock < 0 THEN
    RAISE EXCEPTION 'El stock objetivo no puede ser negativo';
  END IF;

  IF auth.uid() IS NULL THEN
    IF auth.role() IS DISTINCT FROM 'service_role' THEN
      RAISE EXCEPTION 'Unauthorized';
    END IF;
  ELSIF auth.uid() IS DISTINCT FROM p_created_by THEN
    RAISE EXCEPTION 'Unauthorized: el actor no coincide con la sesión';
  END IF;

  IF NOT public.is_org_member(p_org_id, p_created_by) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT name INTO v_product_name
  FROM public.products
  WHERE id = p_product_id AND org_id = p_org_id;
  IF v_product_name IS NULL THEN
    RAISE EXCEPTION 'Producto no encontrado en la organización';
  END IF;

  IF p_variant_id IS NOT NULL THEN
    SELECT variant_name, stock INTO v_variant_name, v_current_stock
    FROM public.product_variants
    WHERE id = p_variant_id AND product_id = p_product_id;
    IF v_variant_name IS NULL THEN
      RAISE EXCEPTION 'Variante no encontrada para el producto';
    END IF;
  ELSE
    SELECT stock INTO v_current_stock
    FROM public.products
    WHERE id = p_product_id AND org_id = p_org_id;
  END IF;

  v_current_stock := COALESCE(v_current_stock, 0);
  v_delta := p_new_stock - v_current_stock;
  IF v_delta = 0 THEN
    RETURN NULL;
  END IF;

  v_movement_type := CASE WHEN v_delta > 0 THEN 'adjustment_in' ELSE 'adjustment_out' END;
  RETURN public.record_stock_movement(
    p_org_id => p_org_id,
    p_product_id => p_product_id,
    p_variant_id => p_variant_id,
    p_product_name => v_product_name,
    p_variant_name => v_variant_name,
    p_movement_type => v_movement_type,
    p_quantity => v_delta,
    p_reference_type => 'manual',
    p_notes => p_notes,
    p_created_by => p_created_by
  );
END;
$$;

-- Retornos, notas de crédito y canjes necesitan un delta asociado a un
-- documento. El cliente sólo aporta ids, cantidad y nota; el actor y los
-- nombres vienen de la sesión y de las tablas de la organización.
CREATE OR REPLACE FUNCTION public.record_member_stock_movement(
  p_org_id uuid,
  p_product_id uuid,
  p_variant_id uuid,
  p_movement_type text,
  p_quantity integer,
  p_reference_type text DEFAULT NULL,
  p_reference_id uuid DEFAULT NULL,
  p_unit_cost_usd numeric DEFAULT NULL,
  p_unit_price_ars numeric DEFAULT NULL,
  p_notes text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product_name text;
  v_variant_name text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_org_member(p_org_id, auth.uid()) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF p_quantity = 0 THEN
    RAISE EXCEPTION 'La cantidad del movimiento no puede ser cero';
  END IF;

  IF p_movement_type NOT IN ('return', 'return_in', 'invoice_credit_note', 'influencer_exchange') THEN
    RAISE EXCEPTION 'Tipo de movimiento no permitido: %', p_movement_type;
  END IF;

  SELECT name INTO v_product_name
  FROM public.products
  WHERE id = p_product_id AND org_id = p_org_id;
  IF v_product_name IS NULL THEN
    RAISE EXCEPTION 'Producto no encontrado en la organización';
  END IF;

  IF p_variant_id IS NOT NULL THEN
    SELECT variant_name INTO v_variant_name
    FROM public.product_variants
    WHERE id = p_variant_id AND product_id = p_product_id;
    IF v_variant_name IS NULL THEN
      RAISE EXCEPTION 'Variante no encontrada para el producto';
    END IF;
  END IF;

  RETURN public.record_stock_movement(
    p_org_id => p_org_id,
    p_product_id => p_product_id,
    p_variant_id => p_variant_id,
    p_product_name => v_product_name,
    p_variant_name => v_variant_name,
    p_movement_type => p_movement_type,
    p_quantity => p_quantity,
    p_reference_type => p_reference_type,
    p_reference_id => p_reference_id,
    p_unit_cost_usd => p_unit_cost_usd,
    p_unit_price_ars => p_unit_price_ars,
    p_notes => p_notes,
    p_created_by => auth.uid()
  );
END;
$$;

-- El RPC manual también debe fijar el actor al JWT. Antes sólo comprobaba que
-- el UUID recibido fuera owner/admin, por lo que un miembro podía falsificarlo.
CREATE OR REPLACE FUNCTION public.record_manual_stock_movement(
  p_org_id uuid,
  p_product_id uuid,
  p_variant_id uuid,
  p_movement_type text,
  p_quantity integer,
  p_notes text,
  p_created_by uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product_name text;
  v_variant_name text;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_created_by THEN
    RAISE EXCEPTION 'Unauthorized: el actor no coincide con la sesión';
  END IF;

  IF NOT public.has_org_role(p_org_id, auth.uid(), ARRAY['owner','admin']) THEN
    RAISE EXCEPTION 'Unauthorized: requires owner/admin role';
  END IF;

  IF p_quantity = 0 THEN
    RAISE EXCEPTION 'La cantidad del movimiento no puede ser cero';
  END IF;

  IF p_movement_type NOT IN ('breakage','gift','reservation','adjustment_in','adjustment_out') THEN
    RAISE EXCEPTION 'Invalid movement_type: %', p_movement_type;
  END IF;

  SELECT name INTO v_product_name
  FROM public.products
  WHERE id = p_product_id AND org_id = p_org_id;
  IF v_product_name IS NULL THEN
    RAISE EXCEPTION 'Product not found: %', p_product_id;
  END IF;

  IF p_variant_id IS NOT NULL THEN
    SELECT variant_name INTO v_variant_name
    FROM public.product_variants
    WHERE id = p_variant_id AND product_id = p_product_id;
    IF v_variant_name IS NULL THEN
      RAISE EXCEPTION 'Variant not found for product: %', p_variant_id;
    END IF;
  END IF;

  RETURN public.record_stock_movement(
    p_org_id => p_org_id,
    p_product_id => p_product_id,
    p_variant_id => p_variant_id,
    p_product_name => v_product_name,
    p_variant_name => v_variant_name,
    p_movement_type => p_movement_type,
    p_quantity => p_quantity,
    p_reference_type => 'manual',
    p_reference_id => NULL,
    p_notes => p_notes,
    p_created_by => auth.uid()
  );
END;
$$;

-- El cierre de `record_stock_movement` va en el paso 2, después de que el
-- frontend publicado cambie al RPC anterior. Mantenerla unos minutos evita
-- romper una pestaña con JavaScript viejo durante el despliegue.
REVOKE ALL ON FUNCTION public.adjust_stock(uuid, uuid, uuid, integer, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.adjust_stock(uuid, uuid, uuid, integer, text, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.record_member_stock_movement(uuid, uuid, uuid, text, integer, text, uuid, numeric, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_member_stock_movement(uuid, uuid, uuid, text, integer, text, uuid, numeric, numeric, text) TO authenticated;
REVOKE ALL ON FUNCTION public.record_manual_stock_movement(uuid, uuid, uuid, text, integer, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_manual_stock_movement(uuid, uuid, uuid, text, integer, text, uuid) TO authenticated;

-- Verificación real, como el rol de un miembro. No toca negocio: crea una
-- organización ZZ, confirma que el DML directo falla y que trigger + RPCs
-- dejan actor correcto. La última fila exige cero restos.
DO $verificar$
DECLARE
  v_user_id uuid;
  v_org_id uuid;
  v_product_id uuid;
  v_suffix text := substr(gen_random_uuid()::text, 1, 8);
  v_price_rows integer;
  v_stock_rows integer;
  v_stock integer;
  v_write_policies integer;
BEGIN
  SELECT id INTO v_user_id FROM auth.users ORDER BY created_at LIMIT 1;
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'C11 necesita un usuario existente para verificar la auditoría';
  END IF;

  INSERT INTO public.organizations (name, slug, owner_user_id)
  VALUES ('ZZ auditoría inventario', 'zz-audit-inventory-' || v_suffix, v_user_id)
  RETURNING id INTO v_org_id;

  INSERT INTO public.memberships (org_id, user_id, role)
  VALUES (v_org_id, v_user_id, 'owner');

  INSERT INTO public.products (org_id, user_id, name, sale_price_ars)
  VALUES (v_org_id, v_user_id, 'ZZ auditoría producto', 100)
  RETURNING id INTO v_product_id;

  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', v_user_id::text, 'role', 'authenticated')::text,
    true
  );
  EXECUTE 'SET LOCAL ROLE authenticated';

  BEGIN
    INSERT INTO public.price_history (org_id, product_id, new_price_ars)
    VALUES (v_org_id, v_product_id, 999);
    RAISE EXCEPTION 'price_history admitió una inserción directa';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    INSERT INTO public.stock_movements (
      org_id, product_id, product_name, movement_type, quantity, stock_before, stock_after
    ) VALUES (v_org_id, v_product_id, 'ZZ no debe entrar', 'adjustment_in', 1, 0, 1);
    RAISE EXCEPTION 'stock_movements admitió una inserción directa';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  PERFORM public.adjust_stock(v_org_id, v_product_id, NULL, 3, 'ZZ ajuste C11', v_user_id);
  PERFORM public.record_member_stock_movement(
    v_org_id, v_product_id, NULL, 'influencer_exchange', -1,
    'influencer_exchange', NULL, NULL, NULL, 'ZZ canje C11'
  );
  UPDATE public.products SET sale_price_ars = 120 WHERE id = v_product_id;

  EXECUTE 'RESET ROLE';

  SELECT count(*) INTO v_price_rows
  FROM public.price_history
  WHERE product_id = v_product_id AND changed_by = v_user_id
    AND old_price_ars = 100 AND new_price_ars = 120;
  SELECT count(*), max(stock_after) FILTER (WHERE quantity = 3) INTO v_stock_rows, v_stock
  FROM public.stock_movements
  WHERE product_id = v_product_id AND created_by = v_user_id;

  SELECT count(*) INTO v_write_policies
  FROM pg_policy
  WHERE polrelid IN ('public.price_history'::regclass, 'public.stock_movements'::regclass)
    AND polcmd <> 'r';

  IF v_price_rows <> 1 OR v_stock_rows <> 2 OR v_stock <> 3 OR v_write_policies <> 0 THEN
    RAISE EXCEPTION 'C11 falló: precio %, movimientos %, stock %, policies de escritura %',
      v_price_rows, v_stock_rows, v_stock, v_write_policies;
  END IF;

  DELETE FROM public.organizations WHERE id = v_org_id;

  IF EXISTS (SELECT 1 FROM public.organizations WHERE id = v_org_id)
     OR EXISTS (SELECT 1 FROM public.products WHERE id = v_product_id)
     OR EXISTS (SELECT 1 FROM public.stock_movements WHERE product_id = v_product_id)
     OR EXISTS (SELECT 1 FROM public.price_history WHERE product_id = v_product_id) THEN
    RAISE EXCEPTION 'C11 dejó filas ZZ';
  END IF;

  RAISE NOTICE 'C11 paso 1 verificado: DML directo bloqueado, actor real en precio/Kardex y restos ZZ 0';
END
$verificar$;
