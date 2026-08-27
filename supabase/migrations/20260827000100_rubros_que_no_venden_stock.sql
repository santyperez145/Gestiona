-- Rubros que no venden productos con stock — P1-02
--
-- ── El eslabón que faltaba ────────────────────────────────────────────────
--
-- `20260827000090` dejó que un PRODUCTO pueda no llevar stock. Pero el
-- comercio tenía que marcarlo uno por uno: una peluquería con veinte
-- prestaciones las carga y las marca veinte veces, y la primera que se le pasa
-- vuelve a bajar a −1 con cada venta.
--
-- Lo que sabe si algo se descuenta no es el producto: es **el tipo**. Un
-- «Servicio» nunca se stockea; un «Insumo» sí. Así que la declaración sube al
-- tipo de producto, y el rubro la trae puesta desde el preset.
--
-- ── Por qué dos rubros y no once ──────────────────────────────────────────
--
-- La auditoría enumera once arquetipos (retail, wholesale, ecommerce,
-- services, appointments, projects, manufacturing, rentals, subscriptions,
-- gastronomy, hybrid). Se agregan **dos**: los que hoy no se pueden operar de
-- ninguna forma porque el Core descontaba stock de algo que no lo tiene.
--
-- 📌 Los otros —mayorista, ecommerce, retail— ya funcionan con los rubros de
-- catálogo que existen: no son un rubro distinto, son la misma mercadería
-- vendida por otro canal. Y turnos, proyectos, alquileres y suscripciones
-- necesitan entidades que hoy no existen (una agenda, un contrato, un plazo),
-- así que un preset suyo sería una promesa vacía.
--
-- CLAUDE.md: el modo de falla de este proyecto no es quedarse corto, es
-- agregar. Un rubro que no se puede operar es peor que no tenerlo.

ALTER TABLE public.product_types
  ADD COLUMN IF NOT EXISTS maneja_stock boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.product_types.maneja_stock IS
  'false = los productos de este tipo no se descuentan al venderse. La ficha '
  'lo usa como valor inicial; la autoridad sigue siendo products.maneja_stock, '
  'porque un producto puntual puede diferir de su tipo.';

-- ═══════════════════════════════════════════════════════════════════════════
-- El preset lo trae puesto
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.configure_business_profile(p_org_id uuid, p_industry_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_preset public.industry_presets;
  v_template jsonb;
  v_attribute jsonb;
  v_attributes jsonb;
  v_type_id uuid;
  v_type_source text;
  v_type_name text;
  v_type_slug text;
  v_attribute_name text;
  v_attribute_slug text;
  v_attribute_type text;
  v_options jsonb;
  v_rows integer;
  v_types_created integer := 0;
  v_attributes_created integer := 0;
  v_custom_conflicts integer := 0;
  v_applied jsonb := '[]'::jsonb;
BEGIN
  IF v_actor IS NULL OR NOT public.has_org_role(p_org_id, v_actor, ARRAY['owner','admin']) THEN
    RAISE EXCEPTION 'Unauthorized: requires organization owner or admin';
  END IF;

  SELECT * INTO v_preset
  FROM public.industry_presets
  WHERE code = p_industry_code AND active;
  IF v_preset.id IS NULL THEN
    RAISE EXCEPTION 'Business profile not found or inactive';
  END IF;
  IF jsonb_typeof(v_preset.product_type_templates) <> 'array' THEN
    RAISE EXCEPTION 'Business profile templates must be an array';
  END IF;

  UPDATE public.settings
  SET industry_code = v_preset.code,
      ai_tone = COALESCE(v_preset.ai_tone, ai_tone),
      low_stock_threshold = CASE
        WHEN (v_preset.default_settings->>'low_stock_threshold') ~ '^[0-9]+$'
          THEN (v_preset.default_settings->>'low_stock_threshold')::integer
        ELSE low_stock_threshold
      END,
      updated_at = now()
  WHERE org_id = p_org_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Organization settings not found';
  END IF;

  FOR v_template IN SELECT value FROM jsonb_array_elements(v_preset.product_type_templates)
  LOOP
    v_type_name := NULLIF(btrim(v_template->>'name'), '');
    v_type_slug := NULLIF(btrim(v_template->>'slug'), '');
    v_attributes := COALESCE(v_template->'attributes', '[]'::jsonb);
    IF v_type_name IS NULL OR v_type_slug IS NULL
       OR v_type_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
       OR jsonb_typeof(v_attributes) <> 'array' THEN
      RAISE EXCEPTION 'Invalid product type template in profile %', v_preset.code;
    END IF;

    INSERT INTO public.product_types (
      org_id, name, slug, description, active,
      source, template_code, template_version, maneja_stock
    ) VALUES (
      p_org_id, v_type_name, v_type_slug, NULLIF(btrim(v_template->>'description'), ''), true,
      'business_profile', v_preset.code || ':' || v_type_slug, v_preset.profile_version,
      -- El rubro decide si lo que vende se descuenta. Ausente = sí, que es lo
      -- que hacen los seis rubros de catálogo que ya existen.
      COALESCE((v_template->>'maneja_stock')::boolean, true)
    )
    ON CONFLICT (org_id, slug) DO NOTHING;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_types_created := v_types_created + v_rows;

    SELECT id, source INTO v_type_id, v_type_source
    FROM public.product_types
    WHERE org_id = p_org_id AND slug = v_type_slug;

    IF v_type_source = 'custom' THEN
      v_custom_conflicts := v_custom_conflicts + 1;
      v_applied := v_applied || jsonb_build_array(jsonb_build_object(
        'slug', v_type_slug, 'name', v_type_name, 'status', 'skipped_custom'
      ));
      CONTINUE;
    END IF;

    FOR v_attribute IN SELECT value FROM jsonb_array_elements(v_attributes)
    LOOP
      v_attribute_name := NULLIF(btrim(v_attribute->>'name'), '');
      v_attribute_slug := NULLIF(btrim(v_attribute->>'slug'), '');
      v_attribute_type := COALESCE(NULLIF(btrim(v_attribute->>'data_type'), ''), 'text');
      v_options := COALESCE(v_attribute->'options', '[]'::jsonb);
      IF v_attribute_name IS NULL OR v_attribute_slug IS NULL
         OR v_attribute_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
         OR v_attribute_type NOT IN ('text','number','boolean','date','select','multiselect')
         OR jsonb_typeof(v_options) <> 'array' THEN
        RAISE EXCEPTION 'Invalid attribute template % in profile %', v_attribute_slug, v_preset.code;
      END IF;

      INSERT INTO public.attribute_definitions (
        org_id, product_type_id, name, slug, data_type, unit,
        options, required, filterable, sort_order
      ) VALUES (
        p_org_id, v_type_id, v_attribute_name, v_attribute_slug, v_attribute_type,
        NULLIF(btrim(v_attribute->>'unit'), ''), v_options,
        COALESCE((v_attribute->>'required')::boolean, false),
        COALESCE((v_attribute->>'filterable')::boolean, true),
        COALESCE((v_attribute->>'sort_order')::integer, 0)
      )
      ON CONFLICT (product_type_id, slug) DO NOTHING;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      v_attributes_created := v_attributes_created + v_rows;
    END LOOP;

    v_applied := v_applied || jsonb_build_array(jsonb_build_object(
      'id', v_type_id, 'slug', v_type_slug, 'name', v_type_name, 'status', 'available'
    ));
  END LOOP;

  INSERT INTO public.organization_business_profiles (
    org_id, industry_code, profile_version, applied_templates,
    configured_by, configured_at, updated_at
  ) VALUES (
    p_org_id, v_preset.code, v_preset.profile_version, v_applied,
    v_actor, now(), now()
  )
  ON CONFLICT (org_id) DO UPDATE
  SET industry_code = EXCLUDED.industry_code,
      profile_version = EXCLUDED.profile_version,
      applied_templates = EXCLUDED.applied_templates,
      configured_by = EXCLUDED.configured_by,
      updated_at = now();

  RETURN jsonb_build_object(
    'org_id', p_org_id,
    'industry_code', v_preset.code,
    'profile_version', v_preset.profile_version,
    'types_created', v_types_created,
    'attributes_created', v_attributes_created,
    'custom_conflicts', v_custom_conflicts,
    'applied_templates', v_applied
  );
END;
$function$
;

-- ═══════════════════════════════════════════════════════════════════════════
-- Los dos rubros
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO public.industry_presets
  (code, name, default_color, default_secondary_color, ai_tone, active, sort_order,
   profile_version, default_settings, product_type_templates)
VALUES
  ('servicios', 'Servicios', '252 83% 62%', '174 62% 47%',
   'cercano y profesional', true, 7, 1,
   '{}'::jsonb,
   '[{
      "name": "Servicio",
      "slug": "servicio",
      "description": "Se vende por tiempo o por trabajo hecho. No se descuenta stock.",
      "maneja_stock": false,
      "attributes": [
        {"name": "Duración (minutos)", "slug": "duracion-minutos", "data_type": "number", "unit": "min", "filterable": true},
        {"name": "Modalidad", "slug": "modalidad", "data_type": "select",
         "options": ["Presencial", "A domicilio", "Remoto"], "filterable": true},
        {"name": "A cargo de", "slug": "a-cargo-de", "data_type": "text", "filterable": true}
      ]
    }]'::jsonb),

  ('gastronomia', 'Gastronomía', '16 84% 55%', '43 96% 56%',
   'cálido y directo', true, 8, 1,
   '{}'::jsonb,
   -- ⚠️ Dos tipos a propósito, y ahí está el punto: un restaurante NO es un
   -- negocio sin stock. El plato no se descuenta —se prepara— pero la harina,
   -- la bebida y el descartable sí. Un rubro que marcara todo como «sin stock»
   -- le rompería el inventario al día siguiente.
   '[{
      "name": "Plato",
      "slug": "plato",
      "description": "Lo que sale de la cocina. No se descuenta: se prepara.",
      "maneja_stock": false,
      "attributes": [
        {"name": "Sección de la carta", "slug": "seccion-carta", "data_type": "select",
         "options": ["Entrada", "Principal", "Postre", "Bebida", "Guarnición"], "filterable": true},
        {"name": "Apto para", "slug": "apto-para", "data_type": "multiselect",
         "options": ["Vegetariano", "Vegano", "Sin TACC", "Sin lactosa"], "filterable": true},
        {"name": "Porciones", "slug": "porciones", "data_type": "number", "filterable": false}
      ]
    },
    {
      "name": "Insumo",
      "slug": "insumo",
      "description": "Lo que se compra y se consume: mercadería, bebida, descartables.",
      "maneja_stock": true,
      "attributes": [
        {"name": "Unidad de compra", "slug": "unidad-compra", "data_type": "select",
         "options": ["Kilo", "Litro", "Unidad", "Caja", "Bulto"], "filterable": true},
        {"name": "Conservación", "slug": "conservacion", "data_type": "select",
         "options": ["Ambiente", "Refrigerado", "Congelado"], "filterable": true}
      ]
    }]'::jsonb)
ON CONFLICT (code) DO UPDATE
  SET name = EXCLUDED.name,
      product_type_templates = EXCLUDED.product_type_templates,
      active = EXCLUDED.active,
      sort_order = EXCLUDED.sort_order;

-- ═══════════════════════════════════════════════════════════════════════════
-- Verificación — en los dos sentidos
-- ═══════════════════════════════════════════════════════════════════════════

DO $verif$
DECLARE
  v_org    uuid := gen_random_uuid();
  v_user   uuid;
  v_serv   boolean;
  v_insumo boolean;
  v_perf   boolean;
  v_restos int;
BEGIN
  SELECT user_id INTO v_user FROM public.memberships LIMIT 1;
  INSERT INTO public.organizations (id, name, slug, owner_user_id)
  VALUES (v_org, 'ZZ verificacion rubros',
          'zz-rubros-' || substr(v_org::text, 1, 8), v_user);
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_user, 'owner');

  -- `configure_business_profile` exige owner o admin, y lo resuelve con
  -- `auth.uid()`. En un bloque DO eso es NULL, así que se declara el claim del
  -- usuario real — que ES owner de la org ZZ recién creada. No se cambia de
  -- rol: la función es SECURITY DEFINER y sólo necesita saber quién llama.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'authenticated')::text, true);

  -- ── a. Gastronomía trae el plato SIN stock y el insumo CON ──────────────
  PERFORM public.configure_business_profile(v_org, 'gastronomia');

  SELECT maneja_stock INTO v_serv   FROM public.product_types WHERE org_id = v_org AND slug = 'plato';
  SELECT maneja_stock INTO v_insumo FROM public.product_types WHERE org_id = v_org AND slug = 'insumo';

  ASSERT v_serv IS FALSE, 'el plato quedó marcado como que lleva stock';
  ASSERT v_insumo IS TRUE,
    'el insumo quedó SIN stock: un restaurante sí stockea la mercadería, y '
    'marcarlo mal le rompe el inventario al día siguiente';

  -- ── b. ⚠️ Y un rubro de catálogo sigue llevando stock ───────────────────
  -- Sin esta mitad, un default invertido pasaría el punto (a) igual y habría
  -- dejado a los seis rubros existentes sin descontar nada.
  PERFORM public.configure_business_profile(v_org, 'perfumes');
  SELECT maneja_stock INTO v_perf FROM public.product_types WHERE org_id = v_org AND slug = 'perfume';
  ASSERT v_perf IS TRUE, 'un perfume quedó marcado como que NO lleva stock';

  -- ── c. Sin restos ───────────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', NULL, true);
  DELETE FROM public.organizations WHERE id = v_org;
  SELECT count(*) INTO v_restos FROM public.product_types WHERE org_id = v_org;
  ASSERT v_restos = 0, 'quedaron ' || v_restos || ' tipos ZZ';

  RAISE NOTICE 'OK: plato sin stock, insumo con stock, perfume con stock, sin restos';
END $verif$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260827000100', 'rubros_que_no_venden_stock')
ON CONFLICT DO NOTHING;
