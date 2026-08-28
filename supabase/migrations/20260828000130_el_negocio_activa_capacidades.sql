-- P1-01 — Capability Catalog: una sola decisión para UI, comandos y workers.
--
-- Producto contratado, permiso de la persona y rollout técnico siguen siendo
-- controles separados. Una capability los compone, suma dependencias y deja
-- una activación versionada por organización. Desactivarla cambia una fila de
-- control; los datos del dominio no se borran ni se reescriben.

CREATE TABLE IF NOT EXISTS public.capability_catalog (
  capability_key       text PRIMARY KEY
    CHECK (capability_key ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  version              text NOT NULL CHECK (version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
  display_name         text NOT NULL CHECK (char_length(btrim(display_name)) BETWEEN 2 AND 120),
  problem_solved       text NOT NULL CHECK (char_length(btrim(problem_solved)) BETWEEN 10 AND 500),
  required_product_key text CHECK (required_product_key IN ('business', 'finance')),
  permission_module    text,
  rollout_flag_key     text CHECK (
    rollout_flag_key IS NULL OR rollout_flag_key ~ '^[a-z][a-z0-9_]{2,63}$'
  ),
  supported_archetypes text[] NOT NULL DEFAULT '{}'::text[],
  supported_countries  text[] NOT NULL DEFAULT ARRAY['AR']::text[],
  emits_events         text[] NOT NULL DEFAULT '{}'::text[],
  consumes_events      text[] NOT NULL DEFAULT '{}'::text[],
  default_workflows    text[] NOT NULL DEFAULT '{}'::text[],
  kpis                  text[] NOT NULL DEFAULT '{}'::text[],
  activation_milestone text,
  deactivation_policy  text NOT NULL
    CHECK (deactivation_policy IN ('read_only', 'safe_disable', 'requires_cleanup')),
  default_enabled      boolean NOT NULL DEFAULT false,
  active               boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.capability_dependencies (
  capability_key          text NOT NULL
    REFERENCES public.capability_catalog(capability_key) ON DELETE RESTRICT,
  required_capability_key text NOT NULL
    REFERENCES public.capability_catalog(capability_key) ON DELETE RESTRICT,
  dependency_type         text NOT NULL DEFAULT 'required'
    CHECK (dependency_type IN ('required', 'recommended')),
  created_at              timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (capability_key, required_capability_key),
  CHECK (capability_key <> required_capability_key)
);

CREATE TABLE IF NOT EXISTS public.capability_conflicts (
  capability_key             text NOT NULL
    REFERENCES public.capability_catalog(capability_key) ON DELETE RESTRICT,
  conflicting_capability_key text NOT NULL
    REFERENCES public.capability_catalog(capability_key) ON DELETE RESTRICT,
  reason                     text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 10 AND 500),
  created_at                 timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (capability_key, conflicting_capability_key),
  CHECK (capability_key < conflicting_capability_key)
);

CREATE TABLE IF NOT EXISTS public.organization_capabilities (
  org_id          uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  capability_key  text NOT NULL
    REFERENCES public.capability_catalog(capability_key) ON DELETE RESTRICT,
  status          text NOT NULL CHECK (status IN ('enabled', 'disabled')),
  source          text NOT NULL
    CHECK (source IN ('system', 'profiler', 'blueprint', 'provisioning', 'platform')),
  reason          text CHECK (reason IS NULL OR char_length(reason) <= 500),
  enabled_at      timestamptz,
  disabled_at     timestamptz,
  updated_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, capability_key),
  CHECK (
    (status = 'enabled' AND enabled_at IS NOT NULL AND disabled_at IS NULL)
    OR (status = 'disabled' AND disabled_at IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS public.capability_settings (
  org_id          uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  capability_key  text NOT NULL
    REFERENCES public.capability_catalog(capability_key) ON DELETE RESTRICT,
  schema_version  integer NOT NULL DEFAULT 1 CHECK (schema_version > 0),
  settings        jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(settings) = 'object'),
  updated_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, capability_key)
);

CREATE INDEX IF NOT EXISTS organization_capabilities_key_status_idx
  ON public.organization_capabilities(capability_key, status, org_id);

ALTER TABLE public.capability_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.capability_dependencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.capability_conflicts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_capabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.capability_settings ENABLE ROW LEVEL SECURITY;

-- El manifest y sus decisiones no viajan como tablas al navegador. La UI
-- recibe sólo el resultado mínimo del evaluador; los workers usan el wrapper
-- service_role. Esto evita que una pantalla reconstruya la regla por su cuenta.
REVOKE ALL ON public.capability_catalog FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.capability_dependencies FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.capability_conflicts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.organization_capabilities FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.capability_settings FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.capability_catalog TO service_role;
GRANT SELECT ON public.capability_dependencies TO service_role;
GRANT SELECT ON public.capability_conflicts TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.organization_capabilities TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.capability_settings TO service_role;

DROP TRIGGER IF EXISTS trg_capability_catalog_updated_at ON public.capability_catalog;
CREATE TRIGGER trg_capability_catalog_updated_at
BEFORE UPDATE ON public.capability_catalog
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_organization_capabilities_updated_at ON public.organization_capabilities;
CREATE TRIGGER trg_organization_capabilities_updated_at
BEFORE UPDATE ON public.organization_capabilities
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_capability_settings_updated_at ON public.capability_settings;
CREATE TRIGGER trg_capability_settings_updated_at
BEFORE UPDATE ON public.capability_settings
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Un catálogo cíclico no puede resolverse de forma determinista. La guarda se
-- ejecuta al escribir el grafo, no cuando una organización intenta trabajar.
CREATE OR REPLACE FUNCTION public.capability_dependency_prevent_cycle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_old_capability text;
  v_old_required text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_old_capability := OLD.capability_key;
    v_old_required := OLD.required_capability_key;
  END IF;

  IF NEW.capability_key = NEW.required_capability_key THEN
    RAISE EXCEPTION 'Una capability no puede depender de sí misma'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    WITH RECURSIVE descendants(capability_key) AS (
      SELECT dependency.required_capability_key
      FROM public.capability_dependencies dependency
      WHERE dependency.capability_key = NEW.required_capability_key
        AND dependency.dependency_type = 'required'
        AND (
          v_old_capability IS NULL
          OR (dependency.capability_key, dependency.required_capability_key)
            IS DISTINCT FROM (v_old_capability, v_old_required)
        )
      UNION
      SELECT dependency.required_capability_key
      FROM public.capability_dependencies dependency
      JOIN descendants current_node
        ON dependency.capability_key = current_node.capability_key
      WHERE dependency.dependency_type = 'required'
        AND (
          v_old_capability IS NULL
          OR (dependency.capability_key, dependency.required_capability_key)
            IS DISTINCT FROM (v_old_capability, v_old_required)
        )
    )
    SELECT 1 FROM descendants WHERE capability_key = NEW.capability_key
  ) THEN
    RAISE EXCEPTION 'La dependencia crea un ciclo de capabilities'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_capability_dependency_prevent_cycle ON public.capability_dependencies;
CREATE TRIGGER trg_capability_dependency_prevent_cycle
BEFORE INSERT OR UPDATE ON public.capability_dependencies
FOR EACH ROW EXECUTE FUNCTION public.capability_dependency_prevent_cycle();

INSERT INTO public.capability_catalog (
  capability_key, version, display_name, problem_solved,
  required_product_key, permission_module, supported_archetypes,
  emits_events, consumes_events, default_workflows, kpis,
  activation_milestone, deactivation_policy, default_enabled
) VALUES
  (
    'catalog.products', '1.0.0', 'Catálogo de productos y servicios',
    'Mantiene una identidad única de lo que el comercio ofrece en todos sus canales.',
    'business', 'products',
    ARRAY['retail','wholesale','ecommerce','services','appointments','projects','manufacturing','rentals','subscriptions','gastronomy','hybrid'],
    ARRAY['catalog.product.created','catalog.product.updated'], '{}'::text[],
    ARRAY['catalog.first_product'], ARRAY['catalog_active_products'],
    'Primer producto o servicio publicable', 'read_only', true
  ),
  (
    'inventory.core', '1.0.0', 'Inventario unificado',
    'Conserva una sola verdad de stock y movimientos entre sucursales y canales.',
    'business', 'inventory',
    ARRAY['retail','wholesale','ecommerce','manufacturing','rentals','gastronomy','hybrid'],
    ARRAY['inventory.movement.recorded'], ARRAY['catalog.product.created'],
    ARRAY['inventory.opening_balance'], ARRAY['inventory_negative_stock','inventory_accuracy'],
    'Primer saldo inicial o conteo confirmado', 'read_only', true
  ),
  (
    'commerce.store', '1.0.0', 'Tienda online',
    'Publica el catálogo del Business Core y convierte pedidos sin crear un stock paralelo.',
    'business', 'ecommerce',
    ARRAY['retail','wholesale','ecommerce','services','subscriptions','gastronomy','hybrid'],
    ARRAY['commerce.order.placed'], ARRAY['catalog.product.updated','inventory.movement.recorded'],
    ARRAY['commerce.store.publish'], ARRAY['commerce_conversion_rate','commerce_margin_by_channel'],
    'Primera tienda publicada', 'safe_disable', false
  ),
  (
    'finance.documents', '1.0.0', 'Documentos de Finance',
    'Custodia y convierte comprobantes de proveedor en borradores revisables del mismo Core.',
    'finance', 'finance',
    ARRAY['retail','wholesale','ecommerce','services','appointments','projects','manufacturing','rentals','subscriptions','gastronomy','hybrid'],
    ARRAY['finance.document.reviewed'], ARRAY['finance.document.uploaded'],
    ARRAY['finance.document.review'], ARRAY['finance_documents_processed','finance_review_accuracy'],
    'Primer documento revisado', 'read_only', true
  )
ON CONFLICT (capability_key) DO UPDATE SET
  version = EXCLUDED.version,
  display_name = EXCLUDED.display_name,
  problem_solved = EXCLUDED.problem_solved,
  required_product_key = EXCLUDED.required_product_key,
  permission_module = EXCLUDED.permission_module,
  supported_archetypes = EXCLUDED.supported_archetypes,
  emits_events = EXCLUDED.emits_events,
  consumes_events = EXCLUDED.consumes_events,
  default_workflows = EXCLUDED.default_workflows,
  kpis = EXCLUDED.kpis,
  activation_milestone = EXCLUDED.activation_milestone,
  deactivation_policy = EXCLUDED.deactivation_policy,
  default_enabled = EXCLUDED.default_enabled,
  active = true,
  updated_at = now();

INSERT INTO public.capability_dependencies (
  capability_key, required_capability_key, dependency_type
) VALUES
  ('inventory.core', 'catalog.products', 'required'),
  ('commerce.store', 'catalog.products', 'required')
ON CONFLICT (capability_key, required_capability_key) DO UPDATE
SET dependency_type = EXCLUDED.dependency_type;

-- El evaluator es la única función que compone activación, producto, rollout,
-- dependencias, conflictos, membresía y permiso. Está revocada: la UI y los
-- workers llegan por wrappers que fijan si corresponde validar una persona.
CREATE OR REPLACE FUNCTION public.capability_evaluate(
  p_org_id uuid,
  p_capability_key text,
  p_action text,
  p_enforce_user boolean
)
RETURNS TABLE (
  resolved_key text,
  resolved_version text,
  allowed boolean,
  activation_status text,
  product_enabled boolean,
  dependencies_ready boolean,
  rollout_enabled boolean,
  permission_granted boolean,
  blocker text,
  deactivation_policy text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_catalog public.capability_catalog%ROWTYPE;
  v_org_status text;
  v_product_enabled boolean := true;
  v_dependencies_ready boolean := true;
  v_rollout_enabled boolean := true;
  v_permission_granted boolean := true;
  v_dependency_key text;
  v_conflicting_key text;
  v_blocker text;
BEGIN
  IF p_action NOT IN ('view', 'create', 'edit', 'delete', 'export') THEN
    RAISE EXCEPTION 'Acción de capability no reconocida'
      USING ERRCODE = '22023';
  END IF;

  SELECT catalog.* INTO v_catalog
  FROM public.capability_catalog catalog
  WHERE catalog.capability_key = p_capability_key;

  IF NOT FOUND OR NOT COALESCE(v_catalog.active, false) THEN
    RETURN QUERY SELECT
      p_capability_key, NULL::text, false, 'unknown', false, false, false, false,
      'capability_unknown'::text, NULL::text;
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.organizations organization WHERE organization.id = p_org_id) THEN
    RETURN QUERY SELECT
      p_capability_key, v_catalog.version, false, 'missing_org', false, false, false, false,
      'organization_not_found'::text, v_catalog.deactivation_policy;
    RETURN;
  END IF;

  SELECT organization_capability.status INTO v_org_status
  FROM public.organization_capabilities organization_capability
  WHERE organization_capability.org_id = p_org_id
    AND organization_capability.capability_key = p_capability_key;

  IF v_catalog.required_product_key IS NOT NULL THEN
    SELECT COALESCE(product_access.status = 'enabled', false)
      INTO v_product_enabled
    FROM public.organization_product_access product_access
    WHERE product_access.org_id = p_org_id
      AND product_access.product_key = v_catalog.required_product_key;
    v_product_enabled := COALESCE(v_product_enabled, false);
  END IF;

  IF v_catalog.rollout_flag_key IS NOT NULL THEN
    v_rollout_enabled := public.feature_flag_habilitada(
      v_catalog.rollout_flag_key,
      p_org_id,
      false
    );
  END IF;

  WITH RECURSIVE dependency_tree(dependency_key, path, cycle) AS (
    SELECT
      dependency.required_capability_key,
      ARRAY[p_capability_key, dependency.required_capability_key]::text[],
      false
    FROM public.capability_dependencies dependency
    WHERE dependency.capability_key = p_capability_key
      AND dependency.dependency_type = 'required'
    UNION ALL
    SELECT
      dependency.required_capability_key,
      current_node.path || dependency.required_capability_key,
      dependency.required_capability_key = ANY(current_node.path)
    FROM dependency_tree current_node
    JOIN public.capability_dependencies dependency
      ON dependency.capability_key = current_node.dependency_key
    WHERE dependency.dependency_type = 'required'
      AND NOT current_node.cycle
  )
  SELECT dependency_node.dependency_key INTO v_dependency_key
  FROM dependency_tree dependency_node
  LEFT JOIN public.capability_catalog dependency_catalog
    ON dependency_catalog.capability_key = dependency_node.dependency_key
  LEFT JOIN public.organization_capabilities organization_dependency
    ON organization_dependency.org_id = p_org_id
   AND organization_dependency.capability_key = dependency_node.dependency_key
  LEFT JOIN public.organization_product_access dependency_product
    ON dependency_product.org_id = p_org_id
   AND dependency_product.product_key = dependency_catalog.required_product_key
  WHERE dependency_node.cycle
     OR dependency_catalog.capability_key IS NULL
     OR NOT dependency_catalog.active
     OR COALESCE(organization_dependency.status, 'missing') <> 'enabled'
     OR (
       dependency_catalog.required_product_key IS NOT NULL
       AND COALESCE(dependency_product.status, 'available') <> 'enabled'
     )
     OR (
       dependency_catalog.rollout_flag_key IS NOT NULL
       AND NOT public.feature_flag_habilitada(
         dependency_catalog.rollout_flag_key,
         p_org_id,
         false
       )
     )
  ORDER BY dependency_node.dependency_key
  LIMIT 1;
  v_dependencies_ready := v_dependency_key IS NULL;

  SELECT
    CASE
      WHEN conflict.capability_key = p_capability_key
        THEN conflict.conflicting_capability_key
      ELSE conflict.capability_key
    END
    INTO v_conflicting_key
  FROM public.capability_conflicts conflict
  JOIN public.organization_capabilities organization_conflict
    ON organization_conflict.org_id = p_org_id
   AND organization_conflict.capability_key = CASE
     WHEN conflict.capability_key = p_capability_key
       THEN conflict.conflicting_capability_key
     ELSE conflict.capability_key
   END
  JOIN public.capability_catalog conflict_catalog
    ON conflict_catalog.capability_key = organization_conflict.capability_key
  LEFT JOIN public.organization_product_access conflict_product
    ON conflict_product.org_id = p_org_id
   AND conflict_product.product_key = conflict_catalog.required_product_key
  WHERE p_capability_key IN (conflict.capability_key, conflict.conflicting_capability_key)
    AND organization_conflict.status = 'enabled'
    AND conflict_catalog.active
    AND (
      conflict_catalog.required_product_key IS NULL
      OR conflict_product.status = 'enabled'
    )
  LIMIT 1;

  IF p_enforce_user THEN
    v_permission_granted := auth.uid() IS NOT NULL
      AND public.is_org_member(p_org_id, auth.uid());
    IF v_permission_granted AND v_catalog.permission_module IS NOT NULL THEN
      v_permission_granted := public.has_permission(
        p_org_id,
        v_catalog.permission_module,
        p_action
      );
    END IF;
  END IF;

  v_blocker := CASE
    WHEN v_org_status IS NULL THEN 'capability_not_provisioned'
    WHEN v_org_status <> 'enabled' THEN 'capability_disabled'
    WHEN NOT v_product_enabled THEN 'product_not_enabled'
    WHEN NOT v_dependencies_ready THEN 'dependency_not_ready:' || v_dependency_key
    WHEN NOT v_rollout_enabled THEN 'rollout_disabled'
    WHEN v_conflicting_key IS NOT NULL THEN 'capability_conflict:' || v_conflicting_key
    WHEN p_enforce_user AND auth.uid() IS NULL THEN 'authentication_required'
    WHEN p_enforce_user
      AND NOT public.is_org_member(p_org_id, auth.uid()) THEN 'membership_required'
    WHEN NOT v_permission_granted THEN 'module_permission_denied'
    ELSE NULL
  END;

  RETURN QUERY SELECT
    p_capability_key,
    v_catalog.version,
    v_blocker IS NULL,
    COALESCE(v_org_status, 'not_provisioned'),
    v_product_enabled,
    v_dependencies_ready,
    v_rollout_enabled,
    v_permission_granted,
    v_blocker,
    v_catalog.deactivation_policy;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.organization_capability_access(
  p_org_id uuid,
  p_capability_key text,
  p_action text DEFAULT 'view'
)
RETURNS TABLE (
  capability_key text,
  capability_version text,
  allowed boolean,
  activation_status text,
  product_enabled boolean,
  dependencies_ready boolean,
  rollout_enabled boolean,
  permission_granted boolean,
  blocker text,
  deactivation_policy text
)
LANGUAGE sql
STABLE
SECURITY DEFINER SET search_path = public
AS $fn$
  SELECT *
  FROM public.capability_evaluate(
    p_org_id,
    p_capability_key,
    p_action,
    true
  );
$fn$;

CREATE OR REPLACE FUNCTION public.organization_capability_enabled(
  p_org_id uuid,
  p_capability_key text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER SET search_path = public
AS $fn$
  SELECT COALESCE(result.allowed, false)
  FROM public.capability_evaluate(
    p_org_id,
    p_capability_key,
    'view',
    false
  ) result;
$fn$;

-- Es la futura puerta de Blueprint/Provisioning y, por ahora, una mutación de
-- Control Plane deliberadamente mínima. Sólo cambia control; nunca toca tablas
-- del dominio que la capability gobierna.
CREATE OR REPLACE FUNCTION public.platform_organization_capability_set(
  p_org_id uuid,
  p_capability_key text,
  p_enabled boolean,
  p_actor uuid,
  p_reason text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_status text := CASE WHEN p_enabled THEN 'enabled' ELSE 'disabled' END;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.platform_admins administrator
    WHERE administrator.user_id = p_actor AND administrator.role = 'superadmin'
  ) THEN
    RAISE EXCEPTION 'Sólo superadmin puede cambiar capabilities'
      USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.organizations organization WHERE organization.id = p_org_id
  ) OR NOT EXISTS (
    SELECT 1 FROM public.capability_catalog catalog
    WHERE catalog.capability_key = p_capability_key AND catalog.active
  ) THEN
    RAISE EXCEPTION 'La organización o capability no existen'
      USING ERRCODE = '22023';
  END IF;
  IF v_reason IS NULL OR char_length(v_reason) < 10 OR char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'La decisión requiere un motivo de 10 a 500 caracteres'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.organization_capabilities (
    org_id, capability_key, status, source, reason,
    enabled_at, disabled_at, updated_by
  ) VALUES (
    p_org_id, p_capability_key, v_status, 'platform', v_reason,
    CASE WHEN p_enabled THEN now() ELSE NULL END,
    CASE WHEN p_enabled THEN NULL ELSE now() END,
    p_actor
  )
  ON CONFLICT (org_id, capability_key) DO UPDATE SET
    status = EXCLUDED.status,
    source = EXCLUDED.source,
    reason = EXCLUDED.reason,
    enabled_at = CASE
      WHEN p_enabled THEN COALESCE(public.organization_capabilities.enabled_at, now())
      ELSE public.organization_capabilities.enabled_at
    END,
    disabled_at = CASE WHEN p_enabled THEN NULL ELSE now() END,
    updated_by = p_actor,
    updated_at = now();

  INSERT INTO public.admin_audit_logs (
    admin_user_id, action, target_org_id, details
  ) VALUES (
    p_actor,
    CASE WHEN p_enabled THEN 'capabilityEnabled' ELSE 'capabilityDisabled' END,
    p_org_id,
    jsonb_build_object(
      'capability_key', p_capability_key,
      'status', v_status,
      'reason', v_reason,
      'data_policy', 'preserve'
    )
  );

  RETURN v_status;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.seed_organization_capabilities()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
  INSERT INTO public.organization_capabilities (
    org_id, capability_key, status, source, enabled_at, disabled_at, reason
  )
  SELECT
    NEW.id,
    catalog.capability_key,
    CASE WHEN catalog.default_enabled THEN 'enabled' ELSE 'disabled' END,
    'system',
    CASE WHEN catalog.default_enabled THEN now() ELSE NULL END,
    CASE WHEN catalog.default_enabled THEN NULL ELSE now() END,
    'Estado inicial del catálogo ' || catalog.version
  FROM public.capability_catalog catalog
  WHERE catalog.active
  ON CONFLICT (org_id, capability_key) DO NOTHING;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_seed_organization_capabilities ON public.organizations;
CREATE TRIGGER trg_seed_organization_capabilities
AFTER INSERT ON public.organizations
FOR EACH ROW EXECUTE FUNCTION public.seed_organization_capabilities();

INSERT INTO public.organization_capabilities (
  org_id, capability_key, status, source, enabled_at, disabled_at, reason
)
SELECT
  organization.id,
  catalog.capability_key,
  CASE
    WHEN catalog.capability_key = 'commerce.store'
      AND EXISTS (
        SELECT 1 FROM public.ecommerce_stores store
        WHERE store.org_id = organization.id
      ) THEN 'enabled'
    WHEN catalog.default_enabled THEN 'enabled'
    ELSE 'disabled'
  END,
  'system',
  CASE
    WHEN catalog.capability_key = 'commerce.store'
      AND EXISTS (
        SELECT 1 FROM public.ecommerce_stores store
        WHERE store.org_id = organization.id
      ) THEN now()
    WHEN catalog.default_enabled THEN now()
    ELSE NULL
  END,
  CASE
    WHEN catalog.capability_key = 'commerce.store'
      AND EXISTS (
        SELECT 1 FROM public.ecommerce_stores store
        WHERE store.org_id = organization.id
      ) THEN NULL
    WHEN catalog.default_enabled THEN NULL
    ELSE now()
  END,
  'Backfill inicial del Capability Catalog'
FROM public.organizations organization
CROSS JOIN public.capability_catalog catalog
WHERE catalog.active
ON CONFLICT (org_id, capability_key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.enable_store_capability_on_create()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
  INSERT INTO public.organization_capabilities (
    org_id, capability_key, status, source, reason, enabled_at, disabled_at
  ) VALUES (
    NEW.org_id, 'commerce.store', 'enabled', 'provisioning',
    'La organización creó su tienda', now(), NULL
  )
  ON CONFLICT (org_id, capability_key) DO UPDATE SET
    status = 'enabled',
    source = 'provisioning',
    reason = 'La organización creó su tienda',
    enabled_at = COALESCE(public.organization_capabilities.enabled_at, now()),
    disabled_at = NULL,
    updated_at = now();
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_enable_store_capability_on_create ON public.ecommerce_stores;
CREATE TRIGGER trg_enable_store_capability_on_create
AFTER INSERT ON public.ecommerce_stores
FOR EACH ROW EXECUTE FUNCTION public.enable_store_capability_on_create();

-- Compatibilidad: las pantallas actuales de Finance conservan el mismo RPC y
-- contrato, pero la decisión interna sale del Capability Catalog.
CREATE OR REPLACE FUNCTION public.product_surface_access(
  p_org_id uuid,
  p_product_key text
)
RETURNS TABLE (
  product_key text,
  status text,
  allowed boolean,
  can_request boolean,
  blocker text,
  requested_at timestamptz,
  decided_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_status text;
  v_requested_at timestamptz;
  v_decided_at timestamptz;
  v_role text;
  v_capability_key text;
  v_resolution record;
BEGIN
  IF p_product_key NOT IN ('business', 'finance') THEN
    RAISE EXCEPTION 'Producto no reconocido' USING ERRCODE = '22023';
  END IF;

  SELECT membership.role::text INTO v_role
  FROM public.memberships membership
  WHERE membership.org_id = p_org_id AND membership.user_id = auth.uid();
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'No sos miembro de esta organización' USING ERRCODE = '42501';
  END IF;

  SELECT product_access.status, product_access.requested_at, product_access.decided_at
    INTO v_status, v_requested_at, v_decided_at
  FROM public.organization_product_access product_access
  WHERE product_access.org_id = p_org_id
    AND product_access.product_key = p_product_key;

  v_capability_key := CASE
    WHEN p_product_key = 'finance' THEN 'finance.documents'
    ELSE 'catalog.products'
  END;
  SELECT * INTO v_resolution
  FROM public.organization_capability_access(p_org_id, v_capability_key, 'view');

  RETURN QUERY SELECT
    p_product_key,
    COALESCE(v_status, 'available'),
    COALESCE(v_resolution.allowed, false),
    COALESCE(
      p_product_key = 'finance'
      AND v_status = 'available'
      AND v_role IN ('owner', 'admin'),
      false
    ),
    CASE
      WHEN v_resolution.blocker = 'module_permission_denied'
        THEN 'module_permission_denied'
      WHEN NOT COALESCE(v_resolution.allowed, false)
        THEN 'product_not_enabled'
      ELSE NULL
    END,
    v_requested_at,
    v_decided_at;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.finance_document_can(
  p_org_id uuid,
  p_action text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER SET search_path = public
AS $fn$
  SELECT COALESCE(result.allowed, false)
  FROM public.organization_capability_access(
    p_org_id,
    'finance.documents',
    p_action
  ) result;
$fn$;

REVOKE ALL ON FUNCTION public.capability_dependency_prevent_cycle() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.capability_evaluate(uuid, text, text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.organization_capability_access(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.organization_capability_enabled(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.platform_organization_capability_set(uuid, text, boolean, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.seed_organization_capabilities() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enable_store_capability_on_create() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.organization_capability_access(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.organization_capability_enabled(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.platform_organization_capability_set(uuid, text, boolean, uuid, text) TO service_role;

COMMENT ON TABLE public.capability_catalog IS
  'Manifest versionado de capacidades. Producto, permiso y rollout siguen siendo controles separados.';
COMMENT ON TABLE public.organization_capabilities IS
  'Activación por organización. Desactivar preserva los datos del dominio.';
COMMENT ON FUNCTION public.capability_evaluate(uuid, text, text, boolean) IS
  'Único evaluador de capability compartido por UI, comandos y workers.';

DO $guard$
BEGIN
  IF has_table_privilege('authenticated', 'public.capability_catalog', 'SELECT')
     OR has_table_privilege('authenticated', 'public.organization_capabilities', 'SELECT')
     OR has_table_privilege('authenticated', 'public.capability_settings', 'UPDATE') THEN
    RAISE EXCEPTION 'El kernel de capabilities quedó expuesto como tablas al navegador';
  END IF;
  IF has_function_privilege('authenticated', 'public.capability_evaluate(uuid,text,text,boolean)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.organization_capability_enabled(uuid,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.platform_organization_capability_set(uuid,text,boolean,uuid,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.organization_capability_access(uuid,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Un wrapper de capabilities quedó con privilegios incorrectos';
  END IF;
  IF (SELECT count(*) FROM public.capability_catalog WHERE capability_key IN (
    'catalog.products', 'inventory.core', 'commerce.store', 'finance.documents'
  )) <> 4 THEN
    RAISE EXCEPTION 'No quedaron las cuatro capabilities piloto';
  END IF;
END;
$guard$;

INSERT INTO supabase_migrations.schema_migrations(version, name)
VALUES ('20260828000130', 'el_negocio_activa_capacidades')
ON CONFLICT DO NOTHING;
