-- Verificación productiva de P1-01. Todo ocurre dentro de una transacción que
-- se revierte: no toca datos reales y la última fila debe devolver restos = 0.

BEGIN;

CREATE TEMP TABLE zz_capability_context (
  org_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  product_id uuid NOT NULL
) ON COMMIT DROP;

DO $verify$
DECLARE
  v_owner uuid;
  v_org uuid;
  v_product uuid;
  v_outsider uuid := gen_random_uuid();
  v_result record;
  v_cycle_blocked boolean := false;
  v_suffix text := substr(gen_random_uuid()::text, 1, 8);
BEGIN
  SELECT id INTO v_owner FROM auth.users ORDER BY created_at LIMIT 1;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'La verificación necesita un usuario existente, sin modificarlo';
  END IF;

  INSERT INTO public.organizations(name, slug, owner_user_id)
  VALUES ('ZZ Capability Catalog', 'zz-capability-' || v_suffix, v_owner)
  RETURNING id INTO v_org;
  INSERT INTO public.memberships(org_id, user_id, role)
  VALUES (v_org, v_owner, 'owner')
  ON CONFLICT DO NOTHING;

  INSERT INTO public.products(org_id, user_id, name)
  VALUES (v_org, v_owner, 'ZZ Producto que debe sobrevivir')
  RETURNING id INTO v_product;
  INSERT INTO zz_capability_context VALUES (v_org, v_owner, v_product);

  IF (
    SELECT count(*) FROM public.organization_capabilities capability
    WHERE capability.org_id = v_org
  ) <> 4 THEN
    RAISE EXCEPTION 'La organización nueva no recibió las cuatro capabilities piloto';
  END IF;

  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_owner::text, 'role', 'authenticated')::text,
    true
  );

  SELECT * INTO v_result
  FROM public.organization_capability_access(v_org, 'catalog.products', 'view');
  IF NOT COALESCE(v_result.allowed, false) OR v_result.capability_version <> '1.0.0' THEN
    RAISE EXCEPTION 'catalog.products no resolvió para el owner';
  END IF;

  SELECT * INTO v_result
  FROM public.organization_capability_access(v_org, 'finance.documents', 'view');
  IF COALESCE(v_result.allowed, false) OR v_result.blocker <> 'product_not_enabled' THEN
    RAISE EXCEPTION 'Finance ignoró el entitlement comercial';
  END IF;

  UPDATE public.organization_product_access
  SET status = 'enabled'
  WHERE org_id = v_org AND product_key = 'finance';
  SELECT * INTO v_result
  FROM public.organization_capability_access(v_org, 'finance.documents', 'view');
  IF NOT COALESCE(v_result.allowed, false) THEN
    RAISE EXCEPTION 'Finance habilitado no pasó por el evaluador: %', v_result.blocker;
  END IF;

  UPDATE public.organization_capabilities
  SET status = 'disabled', disabled_at = now(), reason = 'ZZ prueba de preservación'
  WHERE org_id = v_org AND capability_key = 'catalog.products';
  SELECT * INTO v_result
  FROM public.organization_capability_access(v_org, 'inventory.core', 'view');
  IF COALESCE(v_result.allowed, false)
     OR v_result.blocker <> 'dependency_not_ready:catalog.products' THEN
    RAISE EXCEPTION 'inventory.core ignoró su dependencia deshabilitada';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.products product WHERE product.id = v_product
  ) THEN
    RAISE EXCEPTION 'Desactivar la capability borró datos del catálogo';
  END IF;

  UPDATE public.organization_capabilities
  SET status = 'enabled', enabled_at = now(), disabled_at = NULL
  WHERE org_id = v_org AND capability_key = 'catalog.products';
  IF NOT public.organization_capability_enabled(v_org, 'inventory.core') THEN
    RAISE EXCEPTION 'El wrapper de workers no comparte la resolución de dependencias';
  END IF;

  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_outsider::text, 'role', 'authenticated')::text,
    true
  );
  SELECT * INTO v_result
  FROM public.organization_capability_access(v_org, 'catalog.products', 'view');
  IF COALESCE(v_result.allowed, false) OR v_result.blocker <> 'membership_required' THEN
    RAISE EXCEPTION 'Un outsider pudo resolver una capability de otra organización';
  END IF;

  BEGIN
    INSERT INTO public.capability_dependencies(
      capability_key, required_capability_key, dependency_type
    ) VALUES ('catalog.products', 'inventory.core', 'required');
  EXCEPTION WHEN SQLSTATE '23514' THEN
    v_cycle_blocked := true;
  END;
  IF NOT v_cycle_blocked THEN
    RAISE EXCEPTION 'El catálogo aceptó una dependencia cíclica';
  END IF;

  IF has_table_privilege('authenticated', 'public.organization_capabilities', 'SELECT')
     OR has_function_privilege(
       'authenticated',
       'public.organization_capability_enabled(uuid,text)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'El navegador puede leer decisiones crudas o usar el wrapper de workers';
  END IF;
END;
$verify$;

SELECT
  (SELECT count(*) FROM public.capability_catalog
    WHERE capability_key IN ('catalog.products','inventory.core','commerce.store','finance.documents')) AS catalogadas,
  (SELECT count(*) FROM public.capability_dependencies WHERE dependency_type = 'required') AS dependencias,
  (SELECT count(*) FROM public.organization_capabilities capability
    JOIN zz_capability_context context ON context.org_id = capability.org_id) AS activaciones_fixture,
  (SELECT count(*) FROM public.products product
    JOIN zz_capability_context context ON context.product_id = product.id) AS datos_preservados;

ROLLBACK;

SELECT count(*) AS restos
FROM public.organizations
WHERE slug LIKE 'zz-capability-%';
