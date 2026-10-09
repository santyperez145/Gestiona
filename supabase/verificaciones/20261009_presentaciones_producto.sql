-- Presentaciones de producto. Datos ZZ; ROLLBACK.
BEGIN;
CREATE TEMP TABLE zz_pres_ctx(org_id uuid, other_org uuid, owner_id uuid, product_id uuid, kilo_id uuid);
DO $$
DECLARE v_org uuid := gen_random_uuid(); v_other uuid := gen_random_uuid(); v_owner uuid; v_product uuid := gen_random_uuid(); v_kilo uuid := gen_random_uuid();
BEGIN
  SELECT user_id INTO v_owner FROM public.memberships WHERE role = 'owner' ORDER BY joined_at LIMIT 1;
  INSERT INTO public.organizations(id, name, slug, owner_user_id) VALUES
    (v_org, 'ZZ Presentaciones', 'zz-pres-' || v_org, v_owner), (v_other, 'ZZ Otra', 'zz-otra-' || v_other, v_owner);
  INSERT INTO public.memberships(org_id, user_id, role) VALUES (v_org, v_owner, 'owner');
  INSERT INTO public.products(id, org_id, user_id, name, sale_price_ars, maneja_stock) VALUES (v_product, v_org, v_owner, 'ZZ Gaseosa', 1000, false);
  INSERT INTO public.products(id, org_id, user_id, name, sale_price_ars, maneja_stock, unidad_medida) VALUES (v_kilo, v_org, v_owner, 'ZZ Queso', 9000, false, 'kg');
  INSERT INTO zz_pres_ctx VALUES (v_org, v_other, v_owner, v_product, v_kilo);
END;
$$;
GRANT SELECT ON zz_pres_ctx TO authenticated;
SET LOCAL ROLE authenticated;
DO $$
DECLARE c record; v_denied boolean;
BEGIN
  SELECT * INTO c FROM zz_pres_ctx;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', c.owner_id, 'role', 'authenticated')::text, true);

  INSERT INTO public.product_presentations(org_id, product_id, name, factor, barcode) VALUES (c.org_id, c.product_id, '  Pack x6 ', 6, ' 7790001 ');
  ASSERT (SELECT name = 'Pack x6' AND barcode = '7790001' FROM public.product_presentations WHERE product_id = c.product_id), 'No normalizó nombre y código';

  -- Media unidad no existe para un producto por unidad; sí para uno por kilo.
  v_denied := false;
  BEGIN INSERT INTO public.product_presentations(org_id, product_id, name, factor) VALUES (c.org_id, c.product_id, 'Medio', 0.5);
  EXCEPTION WHEN check_violation THEN v_denied := true; END;
  ASSERT v_denied, 'Aceptó una presentación fraccionada de un producto por unidad';
  INSERT INTO public.product_presentations(org_id, product_id, name, factor) VALUES (c.org_id, c.kilo_id, 'Horma 4,5 kg', 4.5);

  -- El código de bulto es único en la organización.
  v_denied := false;
  BEGIN INSERT INTO public.product_presentations(org_id, product_id, name, factor, barcode) VALUES (c.org_id, c.product_id, 'Caja', 12, '7790001');
  EXCEPTION WHEN unique_violation THEN v_denied := true; END;
  ASSERT v_denied, 'Repitió el código de bulto';

  -- Otra organización: RLS lo impide.
  v_denied := false;
  BEGIN INSERT INTO public.product_presentations(org_id, product_id, name, factor) VALUES (c.other_org, c.product_id, 'Caja', 12);
  EXCEPTION WHEN insufficient_privilege OR foreign_key_violation THEN v_denied := true; END;
  ASSERT v_denied, 'Cargó una presentación en una organización ajena';
END;
$$;
RESET ROLE;
SELECT 'presentaciones_producto OK' AS resultado;
ROLLBACK;
