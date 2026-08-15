-- C9a — Transferencias de variantes entre depósitos
--
-- C9 incorporó el saldo por variante y permite a la tienda despachar desde un
-- depósito real. Faltaba el camino operativo para mover una variante entre
-- dos depósitos. Transferir el producto agregado no sirve cuando tiene talles,
-- sabores o mililitrajes: mover "10 unidades" sin decir cuáles inventa una
-- distribución que después el checkout no puede respaldar.
--
-- La regla es deliberadamente estricta: un producto que tiene variantes sólo
-- se mueve indicando `p_variant_id`. El producto sin variantes conserva el
-- flujo anterior. Ambos caminos hacen las dos puntas mediante
-- `record_stock_movement`, que es la autoridad única de stock y Kardex.

ALTER TABLE public.stock_transfers
  ADD COLUMN IF NOT EXISTS variant_id uuid
  REFERENCES public.product_variants(id) ON DELETE RESTRICT;

ALTER TABLE public.stock_transfers
  ADD COLUMN IF NOT EXISTS variant_name text;

CREATE INDEX IF NOT EXISTS stock_transfers_variant_created_idx
  ON public.stock_transfers(variant_id, created_at DESC)
  WHERE variant_id IS NOT NULL;

COMMENT ON COLUMN public.stock_transfers.variant_id IS
  'Variante física transferida. Null sólo para productos sin variantes; no se usa el agregado de un producto con variantes porque perdería qué stock viajó.';

DROP FUNCTION IF EXISTS public.transfer_stock_between_locations(uuid, uuid, uuid, integer, text);

CREATE OR REPLACE FUNCTION public.transfer_stock_between_locations(
  p_from_location_id uuid,
  p_to_location_id   uuid,
  p_product_id       uuid,
  p_quantity         integer,
  p_notes            text DEFAULT NULL,
  p_variant_id       uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org          uuid;
  v_user         uuid := auth.uid();
  v_product_name text;
  v_variant_name text;
  v_disp         integer;
  v_origen       integer;
  v_destino      integer;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'La cantidad a transferir tiene que ser mayor que cero'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_from_location_id = p_to_location_id THEN
    RAISE EXCEPTION 'El origen y el destino son la misma sucursal'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT p.org_id, p.name INTO v_org, v_product_name
  FROM public.products p
  WHERE p.id = p_product_id;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'El producto no existe' USING ERRCODE = 'no_data_found';
  END IF;
  IF NOT public.is_org_member(v_org, v_user) THEN
    RAISE EXCEPTION 'Sin permiso sobre este producto' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (
    SELECT count(*) FROM public.locations l
    WHERE l.id IN (p_from_location_id, p_to_location_id)
      AND l.org_id = v_org
      AND l.active
  ) <> 2 THEN
    RAISE EXCEPTION 'Origen y destino tienen que ser sucursales activas de esta organización'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_variant_id IS NULL AND EXISTS (
    SELECT 1 FROM public.product_variants v WHERE v.product_id = p_product_id
  ) THEN
    RAISE EXCEPTION 'Este producto tiene variantes: elegí el talle, sabor o presentación que vas a transferir'
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_variant_id IS NOT NULL THEN
    SELECT v.variant_name INTO v_variant_name
    FROM public.product_variants v
    WHERE v.id = p_variant_id
      AND v.product_id = p_product_id
      AND v.org_id = v_org;
    IF v_variant_name IS NULL THEN
      RAISE EXCEPTION 'La variante no pertenece al producto de esta organización'
        USING ERRCODE = 'invalid_parameter_value';
    END IF;

    -- La fila exacta de la variante es la cerradura. Dos transferencias de la
    -- misma presentación no leen el mismo saldo y no pueden gastar dos veces.
    SELECT lvs.stock INTO v_disp
    FROM public.location_variant_stock lvs
    WHERE lvs.location_id = p_from_location_id
      AND lvs.product_id = p_product_id
      AND lvs.variant_id = p_variant_id
    FOR UPDATE;
  ELSE
    SELECT ls.stock INTO v_disp
    FROM public.location_stock ls
    WHERE ls.location_id = p_from_location_id
      AND ls.product_id = p_product_id
    FOR UPDATE;
  END IF;

  IF COALESCE(v_disp, 0) < p_quantity THEN
    RAISE EXCEPTION 'En la sucursal de origen hay % unidades de "%" y se quieren mover %',
      COALESCE(v_disp, 0),
      CASE WHEN v_variant_name IS NULL THEN v_product_name
           ELSE v_product_name || ' (' || v_variant_name || ')' END,
      p_quantity
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  PERFORM public.record_stock_movement(
    p_org_id=>v_org, p_product_id=>p_product_id, p_variant_id=>p_variant_id,
    p_product_name=>v_product_name, p_variant_name=>v_variant_name,
    p_movement_type=>'transfer_out', p_quantity=>-p_quantity,
    p_reference_type=>'location_transfer', p_reference_id=>NULL,
    p_notes=>p_notes, p_created_by=>v_user,
    p_location_id=>p_from_location_id
  );
  PERFORM public.record_stock_movement(
    p_org_id=>v_org, p_product_id=>p_product_id, p_variant_id=>p_variant_id,
    p_product_name=>v_product_name, p_variant_name=>v_variant_name,
    p_movement_type=>'transfer_in', p_quantity=>p_quantity,
    p_reference_type=>'location_transfer', p_reference_id=>NULL,
    p_notes=>p_notes, p_created_by=>v_user,
    p_location_id=>p_to_location_id
  );

  INSERT INTO public.stock_transfers (
    org_id, from_location_id, to_location_id, product_id, variant_id,
    product_name, variant_name, quantity, notes, transferred_by
  ) VALUES (
    v_org, p_from_location_id, p_to_location_id, p_product_id, p_variant_id,
    v_product_name, v_variant_name, p_quantity, p_notes, v_user
  );

  IF p_variant_id IS NOT NULL THEN
    SELECT stock INTO v_origen FROM public.location_variant_stock
    WHERE location_id = p_from_location_id AND variant_id = p_variant_id;
    SELECT stock INTO v_destino FROM public.location_variant_stock
    WHERE location_id = p_to_location_id AND variant_id = p_variant_id;
  ELSE
    SELECT stock INTO v_origen FROM public.location_stock
    WHERE location_id = p_from_location_id AND product_id = p_product_id;
    SELECT stock INTO v_destino FROM public.location_stock
    WHERE location_id = p_to_location_id AND product_id = p_product_id;
  END IF;

  RETURN jsonb_build_object(
    'producto', CASE WHEN v_variant_name IS NULL THEN v_product_name
                     ELSE v_product_name || ' — ' || v_variant_name END,
    'variant_id', p_variant_id,
    'origen', COALESCE(v_origen, 0),
    'destino', COALESCE(v_destino, 0)
  );
END;
$$;

COMMENT ON FUNCTION public.transfer_stock_between_locations(uuid, uuid, uuid, integer, text, uuid) IS
  'Mueve un producto simple o una variante exacta entre dos sucursales activas. Un producto con variantes exige p_variant_id; valida y bloquea el saldo del origen, registra las dos puntas por record_stock_movement y conserva el Kardex.';

REVOKE ALL ON FUNCTION public.transfer_stock_between_locations(uuid, uuid, uuid, integer, text, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transfer_stock_between_locations(uuid, uuid, uuid, integer, text, uuid)
  TO authenticated;

-- ── Verificación real con datos ZZ y rol de miembro ───────────────────────
CREATE TEMP TABLE IF NOT EXISTS zz_variant_transfer_verification (
  check_name text PRIMARY KEY,
  passed boolean NOT NULL,
  detail text NOT NULL
);
TRUNCATE zz_variant_transfer_verification;

DO $verify$
DECLARE
  v_suffix text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
  v_user uuid;
  v_org uuid;
  v_from uuid;
  v_to uuid;
  v_product uuid;
  v_variant uuid;
  v_result jsonb;
  v_from_variant int;
  v_to_variant int;
  v_from_product int;
  v_to_product int;
  v_global int;
  v_variant_transfers int;
  v_aggregate_blocked boolean := false;
  v_anon_can_transfer boolean;
BEGIN
  SELECT id INTO v_user FROM auth.users ORDER BY created_at LIMIT 1;
  IF v_user IS NULL THEN
    RAISE NOTICE 'Variant transfer verification omitted: no auth user exists';
    RETURN;
  END IF;

  INSERT INTO public.organizations (name, slug, owner_user_id)
  VALUES ('ZZ transferencia variante ' || v_suffix, 'zz-variant-transfer-' || v_suffix, v_user)
  RETURNING id INTO v_org;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_user, 'owner');
  INSERT INTO public.locations (org_id, name, is_main) VALUES (v_org, 'ZZ origen', true) RETURNING id INTO v_from;
  INSERT INTO public.locations (org_id, name) VALUES (v_org, 'ZZ destino') RETURNING id INTO v_to;
  INSERT INTO public.products (org_id, user_id, name, sale_price_ars, stock)
  VALUES (v_org, v_user, 'ZZ perfume variante', 500, 0)
  RETURNING id INTO v_product;
  INSERT INTO public.product_variants (org_id, user_id, product_id, variant_name, stock, active)
  VALUES (v_org, v_user, v_product, 'ZZ 100ml', 0, true)
  RETURNING id INTO v_variant;
  PERFORM public.record_stock_movement(
    v_org, v_product, v_variant, 'ZZ perfume variante', 'ZZ 100ml',
    'adjustment_in', 5, 'manual', NULL, NULL, 500, 'stock ZZ origen', v_user, v_from
  );

  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_user::text, 'role', 'authenticated'
  )::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT public.transfer_stock_between_locations(
    v_from, v_to, v_product, 3, 'ZZ mover variante', v_variant
  ) INTO v_result;
  BEGIN
    PERFORM public.transfer_stock_between_locations(
      v_from, v_to, v_product, 1, 'ZZ agregado prohibido', NULL
    );
  EXCEPTION WHEN check_violation THEN
    v_aggregate_blocked := true;
  END;
  EXECUTE 'RESET ROLE';

  SELECT stock INTO v_from_variant FROM public.location_variant_stock
  WHERE location_id = v_from AND variant_id = v_variant;
  SELECT stock INTO v_to_variant FROM public.location_variant_stock
  WHERE location_id = v_to AND variant_id = v_variant;
  SELECT stock INTO v_from_product FROM public.location_stock
  WHERE location_id = v_from AND product_id = v_product;
  SELECT stock INTO v_to_product FROM public.location_stock
  WHERE location_id = v_to AND product_id = v_product;
  SELECT stock INTO v_global FROM public.product_variants WHERE id = v_variant;
  SELECT count(*) INTO v_variant_transfers FROM public.stock_transfers
  WHERE org_id = v_org AND variant_id = v_variant;

  IF v_from_variant <> 2 OR v_to_variant <> 3
     OR v_from_product <> 2 OR v_to_product <> 3
     OR v_global <> 5 OR v_variant_transfers <> 1
     OR NOT v_aggregate_blocked
     OR (v_result->>'origen')::int <> 2
     OR (v_result->>'destino')::int <> 3 THEN
    RAISE EXCEPTION 'La transferencia de variante no cerró: variante %/%, producto %/%, total %, registros %, agregado bloqueado %',
      v_from_variant, v_to_variant, v_from_product, v_to_product,
      v_global, v_variant_transfers, v_aggregate_blocked;
  END IF;
  IF EXISTS (SELECT 1 FROM public.stock_sucursal_descuadrado WHERE org_id = v_org) THEN
    RAISE EXCEPTION 'La transferencia de variante descuadró el total por sucursal';
  END IF;
  SELECT has_function_privilege(
    'anon', 'public.transfer_stock_between_locations(uuid,uuid,uuid,integer,text,uuid)', 'EXECUTE'
  ) INTO v_anon_can_transfer;
  IF v_anon_can_transfer THEN
    RAISE EXCEPTION 'La transferencia de variante quedó disponible para anon';
  END IF;

  DELETE FROM public.organizations WHERE id = v_org;
  IF EXISTS (SELECT 1 FROM public.organizations WHERE id = v_org)
     OR EXISTS (SELECT 1 FROM public.location_variant_stock WHERE org_id = v_org)
     OR EXISTS (SELECT 1 FROM public.stock_transfers WHERE org_id = v_org) THEN
    RAISE EXCEPTION 'C9a dejó restos ZZ';
  END IF;

  INSERT INTO zz_variant_transfer_verification VALUES
    ('transferencia', true, 'variante, dos depósitos, Kardex, total y bloqueo agregado verificados'),
    ('autoridad', true, 'miembro autenticado y anon cerrado verificados'),
    ('zz_restos', true, 'sin restos de verificación');
END
$verify$;

SELECT check_name, passed, detail
FROM zz_variant_transfer_verification
ORDER BY check_name;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260815000006', 'variant_location_transfers') ON CONFLICT DO NOTHING;
