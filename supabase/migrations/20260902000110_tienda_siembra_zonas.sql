-- Al nacer la tienda, nacen las 6 zonas de Argentina.
--
-- Medido 2026-09-02: pruebas Workspace 0 tiendas / 0 zonas; Exentry 1 / 6 / 1
-- tarifa. Completar tarifario y el Foco de «zonas sin tarifa» no existen
-- sin zonas: el segundo comercio crea la vitrina y el checkout sólo ofrece
-- retiro. El botón de Envíos era un clic extra que Tiendanube/Shopify no piden
-- — siembran regiones al crear la tienda.
--
-- El seed sigue siendo idempotente por (org_id, name). La RPC del panel ahora
-- exige membresía: SECURITY DEFINER sin filtro sembraba zonas en cualquier org.

CREATE OR REPLACE FUNCTION public.seed_default_shipping_zones(p_org_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_org_id IS NULL THEN
    RAISE EXCEPTION 'Organización requerida';
  END IF;

  -- Panel: hay sesión. Trigger al INSERT de la tienda: también.
  -- Superusuario / verificación sin JWT: auth.uid() es NULL y no se bloquea
  -- el alta — el INSERT de la tienda ya pasó RLS o corre como dueño de la base.
  IF auth.uid() IS NOT NULL
     AND NOT public.is_org_member(p_org_id, auth.uid())
     AND NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Sin permiso sobre esa organización' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.shipping_zones (org_id, name, provinces, sort_order) VALUES
    (p_org_id, 'CABA',      ARRAY['AR-C'], 1),
    (p_org_id, 'GBA / Buenos Aires', ARRAY['AR-B'], 2),
    (p_org_id, 'Centro',    ARRAY['AR-S','AR-X','AR-E','AR-P'], 3),
    (p_org_id, 'Cuyo',      ARRAY['AR-M','AR-J','AR-D','AR-L'], 4),
    (p_org_id, 'NOA / NEA', ARRAY['AR-A','AR-T','AR-K','AR-G','AR-Y','AR-W','AR-N','AR-H'], 5),
    (p_org_id, 'Patagonia', ARRAY['AR-Q','AR-R','AR-U','AR-Z','AR-V'], 6)
  ON CONFLICT (org_id, name) DO NOTHING;
END;
$$;

COMMENT ON FUNCTION public.seed_default_shipping_zones(uuid) IS
  'Crea las 6 zonas estándar de Argentina. Sin tarifas: las carga el comercio. Exige membresía si hay sesión.';

CREATE OR REPLACE FUNCTION public.trg_ecommerce_store_seed_zones()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.seed_default_shipping_zones(NEW.org_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ecommerce_store_seed_zones ON public.ecommerce_stores;
CREATE TRIGGER trg_ecommerce_store_seed_zones
  AFTER INSERT ON public.ecommerce_stores
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_ecommerce_store_seed_zones();

REVOKE ALL ON FUNCTION public.trg_ecommerce_store_seed_zones() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seed_default_shipping_zones(uuid) TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname = 'ecommerce_stores'
       AND t.tgname = 'trg_ecommerce_store_seed_zones'
       AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION 'falta el trigger que siembra zonas al crear la tienda';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = 'seed_default_shipping_zones'
       AND pg_get_functiondef(p.oid) ILIKE '%is_org_member%'
  ) THEN
    RAISE EXCEPTION 'seed_default_shipping_zones no chequea membresía';
  END IF;
END $$;

-- Camino real: INSERT de tienda → 6 zonas. Limpieza a 0 restos.
DO $$
DECLARE
  v_org uuid := gen_random_uuid();
  v_usr uuid;
  v_n   int;
BEGIN
  SELECT user_id INTO v_usr FROM public.memberships LIMIT 1;
  IF v_usr IS NULL THEN
    RAISE EXCEPTION 'no hay un usuario de membresía para verificar el seed';
  END IF;

  INSERT INTO public.organizations (id, name, slug, owner_user_id)
  VALUES (
    v_org,
    'ZZ siembra zonas',
    'zz-siembra-zonas-' || substr(v_org::text, 1, 8),
    v_usr
  );

  INSERT INTO public.ecommerce_stores (org_id, name, slug)
  VALUES (
    v_org,
    'ZZ tienda zonas',
    'zz-siembra-tienda-' || substr(v_org::text, 1, 8)
  );

  SELECT count(*) INTO v_n FROM public.shipping_zones WHERE org_id = v_org;
  IF v_n <> 6 THEN
    RAISE EXCEPTION 'al crear la tienda se esperaban 6 zonas, hay %', v_n;
  END IF;

  PERFORM public.seed_default_shipping_zones(v_org);
  SELECT count(*) INTO v_n FROM public.shipping_zones WHERE org_id = v_org;
  IF v_n <> 6 THEN
    RAISE EXCEPTION 'el seed no es idempotente: hay % zonas', v_n;
  END IF;

  DELETE FROM public.ecommerce_stores WHERE org_id = v_org;
  DELETE FROM public.shipping_zones WHERE org_id = v_org;
  DELETE FROM public.automation_flows WHERE org_id = v_org;
  DELETE FROM public.organization_capabilities WHERE org_id = v_org;
  DELETE FROM public.organization_product_access WHERE org_id = v_org;
  DELETE FROM public.settings WHERE org_id = v_org;
  DELETE FROM public.memberships WHERE org_id = v_org;
  DELETE FROM public.role_permissions WHERE org_id = v_org;
  DELETE FROM public.subscriptions WHERE org_id = v_org;
  DELETE FROM public.organizations WHERE id = v_org;

  IF EXISTS (SELECT 1 FROM public.shipping_zones WHERE org_id = v_org)
     OR EXISTS (SELECT 1 FROM public.ecommerce_stores WHERE org_id = v_org)
     OR EXISTS (SELECT 1 FROM public.organizations WHERE id = v_org) THEN
    RAISE EXCEPTION 'quedaron restos ZZ de siembra de zonas';
  END IF;
EXCEPTION WHEN OTHERS THEN
  DELETE FROM public.ecommerce_stores WHERE org_id = v_org;
  DELETE FROM public.shipping_zones WHERE org_id = v_org;
  DELETE FROM public.automation_flows WHERE org_id = v_org;
  DELETE FROM public.organization_capabilities WHERE org_id = v_org;
  DELETE FROM public.organization_product_access WHERE org_id = v_org;
  DELETE FROM public.settings WHERE org_id = v_org;
  DELETE FROM public.memberships WHERE org_id = v_org;
  DELETE FROM public.role_permissions WHERE org_id = v_org;
  DELETE FROM public.subscriptions WHERE org_id = v_org;
  DELETE FROM public.organizations WHERE id = v_org;
  RAISE;
END $$;
