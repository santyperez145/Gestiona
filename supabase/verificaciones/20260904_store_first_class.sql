-- Verificación reversible de dos vitrinas sobre el mismo Business Core.
-- No toca productos, stock, clientes ni órdenes reales.

BEGIN;

DO $verify$
DECLARE
  v_org uuid := gen_random_uuid();
  v_first uuid := gen_random_uuid();
  v_second uuid := gen_random_uuid();
  v_owner uuid;
  v_slug text := 'zz-store-first-class-' || substr(v_org::text, 1, 8);
  v_result jsonb;
  v_count integer;
  v_direct_update_denied boolean := false;
BEGIN
  SELECT user_id INTO v_owner
  FROM public.memberships
  WHERE role = 'owner'
  ORDER BY joined_at
  LIMIT 1;
  ASSERT v_owner IS NOT NULL, 'la verificación necesita un owner existente';

  INSERT INTO public.organizations (id, name, slug, owner_user_id)
  VALUES (v_org, 'ZZ Store first class', v_slug, v_owner);
  INSERT INTO public.memberships (org_id, user_id, role)
  VALUES (v_org, v_owner, 'owner');

  INSERT INTO public.ecommerce_stores (id, org_id, name, slug, is_active)
  VALUES
    (v_first, v_org, 'ZZ Principal', v_slug || '-one', true),
    (v_second, v_org, 'ZZ Secundaria', v_slug || '-two', true);

  SELECT count(*) INTO v_count
  FROM public.ecommerce_stores
  WHERE org_id = v_org
    AND is_primary;
  ASSERT v_count = 1, 'crear dos tiendas no conservó una única principal';
  ASSERT (
    SELECT is_primary FROM public.ecommerce_stores WHERE id = v_first
  ), 'la primera tienda no quedó principal';
  ASSERT NOT (
    SELECT is_primary FROM public.ecommerce_stores WHERE id = v_second
  ), 'la segunda tienda se apropió de la principal';
  ASSERT public.get_published_store_slug(v_org) = v_slug || '-one',
    'el link heredado no resolvió la principal';

  SET LOCAL ROLE authenticated;
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', v_owner, 'role', 'authenticated')::text,
    true
  );

  v_result := public.set_primary_ecommerce_store(v_second);
  ASSERT (v_result ->> 'changed')::boolean,
    'cambiar la principal no informó el cambio';
  ASSERT (
    SELECT is_primary FROM public.ecommerce_stores WHERE id = v_second
  ), 'el RPC no cambió la tienda principal';

  BEGIN
    UPDATE public.ecommerce_stores
    SET is_primary = false
    WHERE id = v_second;
  EXCEPTION WHEN check_violation THEN
    v_direct_update_denied := true;
  END;
  ASSERT v_direct_update_denied,
    'una escritura directa pudo dejar la organización sin principal';

  v_result := public.get_store_performance_snapshot(
    v_org,
    v_second,
    current_date,
    current_date
  );
  ASSERT v_result ->> 'store_id' = v_second::text,
    'el snapshot no quedó identificado por tienda';
  ASSERT (v_result ->> 'orders_total')::integer = 0,
    'la tienda ZZ heredó órdenes de otra organización';

  v_result := public.set_store_first_party_analytics(
    v_org,
    v_second,
    false,
    false
  );
  ASSERT v_result ->> 'store_id' = v_second::text,
    'analítica no operó sobre la tienda elegida';

  RESET ROLE;
  SET LOCAL ROLE anon;
  SELECT count(*) INTO v_count
  FROM public.get_store_catalog_products(v_slug || '-two');
  ASSERT v_count = 0, 'la tienda ZZ recibió productos de otro tenant';
  RESET ROLE;

  DELETE FROM public.ecommerce_stores WHERE id = v_second;
  ASSERT (
    SELECT is_primary FROM public.ecommerce_stores WHERE id = v_first
  ), 'borrar la principal no reasignó la tienda restante';

  DELETE FROM public.audit_logs WHERE org_id = v_org;
  DELETE FROM public.organizations WHERE id = v_org;
  SELECT count(*) INTO v_count
  FROM public.ecommerce_stores
  WHERE org_id = v_org;
  ASSERT v_count = 0, 'quedaron tiendas ZZ luego del cleanup';

  RAISE NOTICE 'OK: dos tiendas, principal atómica, aislamiento, permisos y 0 restos';
END
$verify$;

ROLLBACK;
