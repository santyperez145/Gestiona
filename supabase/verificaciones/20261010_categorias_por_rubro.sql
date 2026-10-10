-- Categorías por rubro. Datos ZZ; ROLLBACK.
BEGIN;
CREATE TEMP TABLE zz_cat_ctx(org_id uuid, owner_id uuid, keep_id uuid);
DO $$
DECLARE v_org uuid := gen_random_uuid(); v_owner uuid; v_keep uuid := gen_random_uuid();
BEGIN
  SELECT user_id INTO v_owner FROM public.memberships WHERE role = 'owner' ORDER BY joined_at LIMIT 1;
  INSERT INTO public.organizations(id, name, slug, owner_user_id) VALUES (v_org, 'ZZ Ferreteria', 'zz-ferre-' || v_org, v_owner);
  INSERT INTO public.memberships(org_id, user_id, role) VALUES (v_org, v_owner, 'owner');
  INSERT INTO public.settings(org_id, user_id, industry_code) VALUES (v_org, v_owner, 'ferreteria')
    ON CONFLICT (org_id) DO UPDATE SET industry_code = 'ferreteria';
  -- Alta: entra categorizado y la categoría existe en la tienda.
  INSERT INTO public.products(org_id, user_id, name, sale_price_ars, maneja_stock, category) VALUES
    (v_org, v_owner, 'ZZ BULON CABEZA REDONDA 3/8 x 10', 10, false, 'otro'),
    (v_org, v_owner, 'ZZ AEROSOL KUWAIT ESM. SINT. VERDE', 10, false, NULL),
    (v_org, v_owner, 'ZZ TALADRO PERCUTOR 13MM', 10, false, 'Herramientaselectricas'),
    (v_org, v_owner, 'ZZ COSA SIN REGLA', 10, false, 'otro');
  INSERT INTO public.products(id, org_id, user_id, name, sale_price_ars, maneja_stock, category) VALUES
    (v_keep, v_org, v_owner, 'ZZ TALADRO EN OFERTA', 10, false, 'Ofertas de la semana');
  INSERT INTO zz_cat_ctx VALUES (v_org, v_owner, v_keep);
  ASSERT (SELECT count(*) FROM public.products WHERE org_id = v_org AND category = 'buloneria-y-fijaciones') = 1, 'bulón';
  ASSERT (SELECT count(*) FROM public.products WHERE org_id = v_org AND category = 'pintureria') = 1, 'aerosol';
  ASSERT (SELECT count(*) FROM public.products WHERE org_id = v_org AND category = 'herramientas-electricas') = 1, 'categoría importada unificada';
  ASSERT (SELECT count(*) FROM public.products WHERE org_id = v_org AND category = 'varios') = 1, 'sin regla → Varios';
  ASSERT (SELECT category = 'Ofertas de la semana' FROM public.products WHERE id = v_keep), 'pisó una categoría propia';
  ASSERT (SELECT count(*) FROM public.ecommerce_categories WHERE org_id = v_org) = 4, 'no creó las categorías de la tienda';
  -- Desordeno uno para probar la herramienta.
  UPDATE public.products SET category = 'otro' WHERE org_id = v_org AND name LIKE 'ZZ BULON%';
END;
$$;
GRANT SELECT ON zz_cat_ctx TO authenticated;
SET LOCAL ROLE authenticated;
DO $$
DECLARE c record; r jsonb; n int;
BEGIN
  SELECT * INTO c FROM zz_cat_ctx;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', c.owner_id, 'role', 'authenticated')::text, true);
  r := public.categorizar_productos(c.org_id, false);
  ASSERT (r->>'cambios')::int = 1, 'vista previa: ' || r;
  ASSERT (SELECT category FROM public.products WHERE org_id = c.org_id AND name LIKE 'ZZ BULON%') = 'otro', 'la vista previa cambió datos';
  r := public.categorizar_productos(c.org_id, true);
  ASSERT (SELECT category FROM public.products WHERE org_id = c.org_id AND name LIKE 'ZZ BULON%') = 'buloneria-y-fijaciones', 'no aplicó';
  n := public.deshacer_categorizacion(c.org_id, (r->>'lote_id')::uuid);
  ASSERT n = 1 AND (SELECT category FROM public.products WHERE org_id = c.org_id AND name LIKE 'ZZ BULON%') = 'otro', 'no deshizo';
END;
$$;
RESET ROLE;
SELECT 'categorias_por_rubro OK' AS resultado;
ROLLBACK;
