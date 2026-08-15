-- C9b — Alta y ajuste de variantes por depósito
--
-- Una vez que una organización trabaja con dos sucursales, fijar el stock
-- global de una variante no informa dónde quedó esa mercadería. La tienda no
-- puede vender con precisión contra una distribución que no existe. Este RPC
-- conserva `adjust_stock` como puerta de Kardex, pero su valor objetivo pasa a
-- ser el saldo de una ubicación cuando se informa `p_location_id`.
--
-- Para variantes, más de una sucursal activa exige ubicación en la base. No
-- depende de que la pantalla esconda un input: un cliente modificado tampoco
-- puede volver a crear stock global ambiguo. Con ninguna o una sucursal se
-- conserva el camino existente; la única sucursal se usa automáticamente.

DROP FUNCTION IF EXISTS public.adjust_stock(uuid, uuid, uuid, integer, text, uuid);

CREATE OR REPLACE FUNCTION public.adjust_stock(
  p_org_id uuid,
  p_product_id uuid,
  p_variant_id uuid,
  p_new_stock integer,
  p_notes text,
  p_created_by uuid,
  p_location_id uuid DEFAULT NULL
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
  v_location_id uuid := p_location_id;
  v_active_locations integer;
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
    SELECT variant_name INTO v_variant_name
    FROM public.product_variants
    WHERE id = p_variant_id AND product_id = p_product_id AND org_id = p_org_id;
    IF v_variant_name IS NULL THEN
      RAISE EXCEPTION 'Variante no encontrada para el producto';
    END IF;
  END IF;

  SELECT count(*) INTO v_active_locations
  FROM public.locations
  WHERE org_id = p_org_id AND active;

  IF v_location_id IS NULL AND v_active_locations = 1 THEN
    SELECT min(id::text)::uuid INTO v_location_id
    FROM public.locations
    WHERE org_id = p_org_id AND active;
  END IF;
  IF v_location_id IS NULL AND p_variant_id IS NOT NULL AND v_active_locations > 1 THEN
    RAISE EXCEPTION 'Elegí el depósito para ajustar esta variante: hay % sucursales activas', v_active_locations
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_location_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.locations l
    WHERE l.id = v_location_id AND l.org_id = p_org_id AND l.active
  ) THEN
    RAISE EXCEPTION 'El depósito tiene que estar activo y pertenecer a la organización'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF v_location_id IS NOT NULL AND p_variant_id IS NOT NULL THEN
    SELECT stock INTO v_current_stock
    FROM public.location_variant_stock
    WHERE location_id = v_location_id AND product_id = p_product_id AND variant_id = p_variant_id
    FOR UPDATE;
  ELSIF v_location_id IS NOT NULL THEN
    SELECT stock INTO v_current_stock
    FROM public.location_stock
    WHERE location_id = v_location_id AND product_id = p_product_id
    FOR UPDATE;
  ELSIF p_variant_id IS NOT NULL THEN
    SELECT stock INTO v_current_stock
    FROM public.product_variants
    WHERE id = p_variant_id AND product_id = p_product_id;
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
    p_created_by => p_created_by,
    p_location_id => v_location_id
  );
END;
$$;

COMMENT ON FUNCTION public.adjust_stock(uuid, uuid, uuid, integer, text, uuid, uuid) IS
  'Fija stock global o por depósito mediante Kardex. Para una variante con más de una sucursal activa, p_location_id es obligatorio: el sistema no inventa dónde quedó el ajuste.';

REVOKE ALL ON FUNCTION public.adjust_stock(uuid, uuid, uuid, integer, text, uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.adjust_stock(uuid, uuid, uuid, integer, text, uuid, uuid)
  TO authenticated, service_role;

CREATE TEMP TABLE IF NOT EXISTS zz_variant_stock_location_adjustment_verification (
  check_name text PRIMARY KEY,
  passed boolean NOT NULL,
  detail text NOT NULL
);
TRUNCATE zz_variant_stock_location_adjustment_verification;

DO $verify$
DECLARE
  v_suffix text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
  v_user uuid;
  v_org uuid;
  v_location_a uuid;
  v_location_b uuid;
  v_product uuid;
  v_variant uuid;
  v_a int;
  v_b int;
  v_global int;
  v_missing_location_blocked boolean := false;
  v_anon_can_adjust boolean;
BEGIN
  SELECT id INTO v_user FROM auth.users ORDER BY created_at LIMIT 1;
  IF v_user IS NULL THEN
    RAISE NOTICE 'Variant stock location adjustment verification omitted: no auth user exists';
    RETURN;
  END IF;
  INSERT INTO public.organizations (name, slug, owner_user_id)
  VALUES ('ZZ ajuste variante depósito ' || v_suffix, 'zz-variant-adjust-' || v_suffix, v_user)
  RETURNING id INTO v_org;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_user, 'owner');
  INSERT INTO public.locations (org_id, name, is_main) VALUES (v_org, 'ZZ ajuste A', true) RETURNING id INTO v_location_a;
  INSERT INTO public.locations (org_id, name) VALUES (v_org, 'ZZ ajuste B') RETURNING id INTO v_location_b;
  INSERT INTO public.products (org_id, user_id, name, sale_price_ars, stock)
  VALUES (v_org, v_user, 'ZZ ajuste variante', 500, 0)
  RETURNING id INTO v_product;
  INSERT INTO public.product_variants (org_id, user_id, product_id, variant_name, stock, active)
  VALUES (v_org, v_user, v_product, 'ZZ azul', 0, true)
  RETURNING id INTO v_variant;
  PERFORM public.record_stock_movement(
    v_org, v_product, v_variant, 'ZZ ajuste variante', 'ZZ azul',
    'adjustment_in', 2, 'manual', NULL, NULL, 500, 'stock ZZ A', v_user, v_location_a
  );

  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_user::text, 'role', 'authenticated'
  )::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM public.adjust_stock(v_org, v_product, v_variant, 4, 'ZZ ajustar B', v_user, v_location_b);
  BEGIN
    PERFORM public.adjust_stock(v_org, v_product, v_variant, 7, 'ZZ global prohibido', v_user, NULL);
  EXCEPTION WHEN check_violation THEN
    v_missing_location_blocked := true;
  END;
  EXECUTE 'RESET ROLE';

  SELECT stock INTO v_a FROM public.location_variant_stock
  WHERE location_id = v_location_a AND variant_id = v_variant;
  SELECT stock INTO v_b FROM public.location_variant_stock
  WHERE location_id = v_location_b AND variant_id = v_variant;
  SELECT stock INTO v_global FROM public.product_variants WHERE id = v_variant;
  SELECT has_function_privilege(
    'anon', 'public.adjust_stock(uuid,uuid,uuid,integer,text,uuid,uuid)', 'EXECUTE'
  ) INTO v_anon_can_adjust;

  IF v_a <> 2 OR v_b <> 4 OR v_global <> 6 OR NOT v_missing_location_blocked OR v_anon_can_adjust THEN
    RAISE EXCEPTION 'El ajuste localizado no cerró: A %, B %, global %, bloqueo %, anon %',
      v_a, v_b, v_global, v_missing_location_blocked, v_anon_can_adjust;
  END IF;
  IF EXISTS (SELECT 1 FROM public.stock_sucursal_descuadrado WHERE org_id = v_org) THEN
    RAISE EXCEPTION 'El ajuste localizado descuadró stock por sucursal';
  END IF;

  DELETE FROM public.organizations WHERE id = v_org;
  IF EXISTS (SELECT 1 FROM public.organizations WHERE id = v_org)
     OR EXISTS (SELECT 1 FROM public.location_variant_stock WHERE org_id = v_org) THEN
    RAISE EXCEPTION 'C9b dejó restos ZZ';
  END IF;
  INSERT INTO zz_variant_stock_location_adjustment_verification VALUES
    ('ajuste', true, 'variante ajustada en depósito, bloqueo global y total verificados'),
    ('autoridad', true, 'actor autenticado y anon cerrado verificados'),
    ('zz_restos', true, 'sin restos de verificación');
END
$verify$;

SELECT check_name, passed, detail
FROM zz_variant_stock_location_adjustment_verification
ORDER BY check_name;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260815000007', 'variant_stock_location_adjustment') ON CONFLICT DO NOTHING;
