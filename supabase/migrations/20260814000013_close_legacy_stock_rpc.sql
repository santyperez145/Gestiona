-- C11 / auditoría de inventario, paso 2: el frontend ya publicado usa
-- record_member_stock_movement (el bundle fue comprobado antes de aplicar).
-- `record_stock_movement` queda sólo para triggers y RPCs SECURITY DEFINER.

REVOKE ALL ON FUNCTION public.record_stock_movement(uuid, uuid, uuid, text, text, text, integer, text, uuid, numeric, numeric, text, uuid, uuid)
  FROM PUBLIC, anon, authenticated;

-- Verificación con el rol real. La llamada directa a la primitiva debe fallar;
-- la vía miembro debe seguir creando un asiento con su actor. Todo vive en una
-- organización ZZ que se borra antes de terminar.
DO $verificar$
DECLARE
  v_user_id uuid;
  v_org_id uuid;
  v_product_id uuid;
  v_suffix text := substr(gen_random_uuid()::text, 1, 8);
  v_movements integer;
  v_can_execute boolean;
BEGIN
  SELECT id INTO v_user_id FROM auth.users ORDER BY created_at LIMIT 1;
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'C11 necesita un usuario existente para cerrar el RPC legacy';
  END IF;

  INSERT INTO public.organizations (name, slug, owner_user_id)
  VALUES ('ZZ cierre RPC Kardex', 'zz-close-kardex-' || v_suffix, v_user_id)
  RETURNING id INTO v_org_id;

  INSERT INTO public.memberships (org_id, user_id, role)
  VALUES (v_org_id, v_user_id, 'owner');

  INSERT INTO public.products (org_id, user_id, name)
  VALUES (v_org_id, v_user_id, 'ZZ cierre Kardex producto')
  RETURNING id INTO v_product_id;

  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', v_user_id::text, 'role', 'authenticated')::text,
    true
  );
  EXECUTE 'SET LOCAL ROLE authenticated';

  BEGIN
    PERFORM public.record_stock_movement(
      v_org_id, v_product_id, NULL, 'ZZ directo bloqueado', NULL,
      'adjustment_in', 1, 'manual', NULL, NULL, NULL, NULL, v_user_id, NULL
    );
    RAISE EXCEPTION 'record_stock_movement todavía se puede invocar como authenticated';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  PERFORM public.record_member_stock_movement(
    v_org_id, v_product_id, NULL, 'return_in', 1,
    'return', NULL, NULL, NULL, 'ZZ wrapper permitido'
  );

  EXECUTE 'RESET ROLE';

  SELECT count(*) INTO v_movements
  FROM public.stock_movements
  WHERE product_id = v_product_id AND created_by = v_user_id AND quantity = 1;
  SELECT has_function_privilege(
    'authenticated',
    'public.record_stock_movement(uuid,uuid,uuid,text,text,text,integer,text,uuid,numeric,numeric,text,uuid,uuid)',
    'EXECUTE'
  ) INTO v_can_execute;

  IF v_movements <> 1 OR v_can_execute THEN
    RAISE EXCEPTION 'C11 no cerró el RPC legacy: movimientos %, execute %', v_movements, v_can_execute;
  END IF;

  DELETE FROM public.organizations WHERE id = v_org_id;

  IF EXISTS (SELECT 1 FROM public.organizations WHERE id = v_org_id)
     OR EXISTS (SELECT 1 FROM public.products WHERE id = v_product_id)
     OR EXISTS (SELECT 1 FROM public.stock_movements WHERE product_id = v_product_id) THEN
    RAISE EXCEPTION 'C11 dejó filas ZZ al cerrar el RPC legacy';
  END IF;

  RAISE NOTICE 'C11 paso 2 verificado: RPC legacy bloqueado y wrapper auditado, restos ZZ 0';
END
$verificar$;
