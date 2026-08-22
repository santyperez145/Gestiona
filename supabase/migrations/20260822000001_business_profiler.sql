-- Business Profiler mínimo: el rubro configura tipos y atributos sobre el
-- mismo catálogo. No crea tablas, stock, precios ni módulos por vertical.

ALTER TABLE public.industry_presets
  ADD COLUMN IF NOT EXISTS profile_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS product_type_templates jsonb NOT NULL DEFAULT '[]'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.industry_presets'::regclass
      AND conname = 'industry_presets_profile_version_check'
  ) THEN
    ALTER TABLE public.industry_presets
      ADD CONSTRAINT industry_presets_profile_version_check CHECK (profile_version >= 1);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.industry_presets'::regclass
      AND conname = 'industry_presets_templates_array_check'
  ) THEN
    ALTER TABLE public.industry_presets
      ADD CONSTRAINT industry_presets_templates_array_check
      CHECK (jsonb_typeof(product_type_templates) = 'array');
  END IF;
END;
$$;

-- Los presets son datos declarativos y versionados. Talles/colores siguen en
-- variants; lotes/vencimientos siguen en el módulo de lotes. Los atributos de
-- perfil describen y filtran el producto, no duplican esas autoridades.
UPDATE public.industry_presets
SET profile_version = 1,
    product_type_templates = $json$[
      {"name":"Perfume","slug":"perfume","description":"Fragancias, perfumes y body splashes.","attributes":[
        {"name":"Marca","slug":"marca","data_type":"text","filterable":true},
        {"name":"Contenido","slug":"contenido-ml","data_type":"number","unit":"ml","filterable":true},
        {"name":"Concentración","slug":"concentracion","data_type":"select","options":["EDT","EDP","Parfum","Extrait","Body splash"],"filterable":true},
        {"name":"Familia olfativa","slug":"familia-olfativa","data_type":"multiselect","options":["Amaderada","Ámbar","Aromática","Cítrica","Floral","Fougère","Gourmand","Oriental"],"filterable":true}
      ]}
    ]$json$::jsonb
WHERE code = 'perfumes';

UPDATE public.industry_presets
SET profile_version = 1,
    product_type_templates = $json$[
      {"name":"Dispositivo","slug":"dispositivo-vape","description":"Dispositivos, pods y accesorios.","attributes":[
        {"name":"Marca","slug":"marca","data_type":"text","filterable":true},
        {"name":"Modelo","slug":"modelo","data_type":"text","filterable":true},
        {"name":"Color","slug":"color","data_type":"text","filterable":true}
      ]},
      {"name":"E-liquid","slug":"e-liquid","description":"Líquidos y sales para vapeo.","attributes":[
        {"name":"Sabor","slug":"sabor","data_type":"text","filterable":true},
        {"name":"Nicotina","slug":"nicotina-mg","data_type":"number","unit":"mg","filterable":true},
        {"name":"Contenido","slug":"contenido-ml","data_type":"number","unit":"ml","filterable":true}
      ]}
    ]$json$::jsonb
WHERE code = 'vapers';

UPDATE public.industry_presets
SET profile_version = 1,
    product_type_templates = $json$[
      {"name":"Prenda","slug":"prenda","description":"Indumentaria; talle y color se administran como variantes con stock propio.","attributes":[
        {"name":"Marca","slug":"marca","data_type":"text","filterable":true},
        {"name":"Material","slug":"material","data_type":"text","filterable":true},
        {"name":"Temporada","slug":"temporada","data_type":"select","options":["Todo el año","Primavera/Verano","Otoño/Invierno"],"filterable":true},
        {"name":"Género","slug":"genero","data_type":"select","options":["Unisex","Mujer","Hombre","Niños"],"filterable":true}
      ]}
    ]$json$::jsonb
WHERE code = 'indumentaria';

UPDATE public.industry_presets
SET profile_version = 1,
    product_type_templates = $json$[
      {"name":"Tecnología","slug":"tecnologia","description":"Equipos, periféricos y accesorios tecnológicos.","attributes":[
        {"name":"Marca","slug":"marca","data_type":"text","filterable":true},
        {"name":"Modelo","slug":"modelo","data_type":"text","filterable":true},
        {"name":"Garantía","slug":"garantia-meses","data_type":"number","unit":"meses","filterable":false},
        {"name":"Conectividad","slug":"conectividad","data_type":"multiselect","options":["Bluetooth","Ethernet","NFC","USB","Wi-Fi"],"filterable":true}
      ]}
    ]$json$::jsonb
WHERE code = 'tecnologia';

UPDATE public.industry_presets
SET profile_version = 1,
    product_type_templates = $json$[
      {"name":"Cosmético","slug":"cosmetico","description":"Cuidado personal, maquillaje y dermocosmética.","attributes":[
        {"name":"Marca","slug":"marca","data_type":"text","filterable":true},
        {"name":"Contenido","slug":"contenido-ml","data_type":"number","unit":"ml","filterable":true},
        {"name":"Tipo de piel","slug":"tipo-de-piel","data_type":"multiselect","options":["Mixta","Normal","Grasa","Seca","Sensible"],"filterable":true},
        {"name":"Cruelty free","slug":"cruelty-free","data_type":"boolean","filterable":true}
      ]}
    ]$json$::jsonb
WHERE code = 'cosmetica';

UPDATE public.industry_presets
SET profile_version = 1,
    product_type_templates = $json$[
      {"name":"Alimento","slug":"alimento","description":"Alimentos y bebidas; lote y vencimiento se administran con trazabilidad de inventario.","attributes":[
        {"name":"Marca","slug":"marca","data_type":"text","filterable":true},
        {"name":"Peso neto","slug":"peso-neto-g","data_type":"number","unit":"g","filterable":true},
        {"name":"Conservación","slug":"conservacion","data_type":"select","options":["Ambiente","Refrigerado","Congelado"],"filterable":true},
        {"name":"Apto para","slug":"apto-para","data_type":"multiselect","options":["Celíacos","Kosher","Sin azúcar","Veganos","Vegetarianos"],"filterable":true}
      ]}
    ]$json$::jsonb
WHERE code = 'alimentos';

UPDATE public.industry_presets
SET profile_version = 1,
    product_type_templates = $json$[
      {"name":"Producto","slug":"producto-general","description":"Tipo inicial editable para un catálogo general.","attributes":[
        {"name":"Marca","slug":"marca","data_type":"text","filterable":true},
        {"name":"Modelo o línea","slug":"modelo-o-linea","data_type":"text","filterable":true}
      ]}
    ]$json$::jsonb
WHERE code = 'otro';

ALTER TABLE public.product_types
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'custom',
  ADD COLUMN IF NOT EXISTS template_code text,
  ADD COLUMN IF NOT EXISTS template_version integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.product_types'::regclass
      AND conname = 'product_types_source_check'
  ) THEN
    ALTER TABLE public.product_types
      ADD CONSTRAINT product_types_source_check
      CHECK (source IN ('custom', 'business_profile'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.product_types'::regclass
      AND conname = 'product_types_profile_origin_check'
  ) THEN
    ALTER TABLE public.product_types
      ADD CONSTRAINT product_types_profile_origin_check
      CHECK (
        (source = 'custom' AND template_code IS NULL AND template_version IS NULL)
        OR (source = 'business_profile' AND template_code IS NOT NULL AND template_version IS NOT NULL)
      );
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.organization_business_profiles (
  org_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  industry_code text NOT NULL REFERENCES public.industry_presets(code) ON UPDATE CASCADE,
  profile_version integer NOT NULL CHECK (profile_version >= 1),
  applied_templates jsonb NOT NULL DEFAULT '[]'::jsonb,
  configured_by uuid NOT NULL,
  configured_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organization_business_profiles_templates_array_check
    CHECK (jsonb_typeof(applied_templates) = 'array')
);

ALTER TABLE public.organization_business_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_business_profiles_member_read
  ON public.organization_business_profiles;
CREATE POLICY organization_business_profiles_member_read
  ON public.organization_business_profiles
  FOR SELECT TO authenticated
  USING (public.is_org_member(org_id, auth.uid()));

REVOKE ALL ON public.organization_business_profiles FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE ON public.organization_business_profiles FROM authenticated;
GRANT SELECT ON public.organization_business_profiles TO authenticated;

CREATE OR REPLACE FUNCTION public.configure_business_profile(
  p_org_id uuid,
  p_industry_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
      source, template_code, template_version
    ) VALUES (
      p_org_id, v_type_name, v_type_slug, NULLIF(btrim(v_template->>'description'), ''), true,
      'business_profile', v_preset.code || ':' || v_type_slug, v_preset.profile_version
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
$$;

CREATE OR REPLACE FUNCTION public.complete_business_onboarding(
  p_org_id uuid,
  p_business_name text,
  p_primary_color text,
  p_industry_code text,
  p_onboarding_goal text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_name text := NULLIF(btrim(p_business_name), '');
  v_profile jsonb;
BEGIN
  IF v_actor IS NULL OR NOT public.has_org_role(p_org_id, v_actor, ARRAY['owner','admin']) THEN
    RAISE EXCEPTION 'Unauthorized: requires organization owner or admin';
  END IF;
  IF v_name IS NULL OR length(v_name) > 120 THEN
    RAISE EXCEPTION 'Business name must contain between 1 and 120 characters';
  END IF;
  IF p_primary_color IS NULL OR p_primary_color !~ '^#[0-9A-Fa-f]{6}$' THEN
    RAISE EXCEPTION 'Primary color must be a six-digit hex color';
  END IF;
  IF p_onboarding_goal IS NULL OR p_onboarding_goal NOT IN ('pos','online','explore') THEN
    RAISE EXCEPTION 'Invalid onboarding goal';
  END IF;

  v_profile := public.configure_business_profile(p_org_id, p_industry_code);

  UPDATE public.organizations
  SET name = v_name,
      primary_color = upper(p_primary_color),
      onboarding_completed = true,
      onboarding_goal = p_onboarding_goal,
      updated_at = now()
  WHERE id = p_org_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Organization not found';
  END IF;

  UPDATE public.settings
  SET business_name = v_name,
      primary_color = upper(p_primary_color),
      updated_at = now()
  WHERE org_id = p_org_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Organization settings not found';
  END IF;

  RETURN jsonb_build_object(
    'org_id', p_org_id,
    'business_name', v_name,
    'onboarding_goal', p_onboarding_goal,
    'profile', v_profile
  );
END;
$$;

REVOKE ALL ON FUNCTION public.configure_business_profile(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_business_onboarding(uuid, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.configure_business_profile(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_business_onboarding(uuid, text, text, text, text) TO authenticated;

DO $$
DECLARE
  v_invalid_presets integer;
BEGIN
  SELECT count(*) INTO v_invalid_presets
  FROM public.industry_presets
  WHERE active AND (
    jsonb_typeof(product_type_templates) <> 'array'
    OR jsonb_array_length(product_type_templates) = 0
  );
  IF v_invalid_presets <> 0 THEN
    RAISE EXCEPTION '% active business profiles have no valid product type templates', v_invalid_presets;
  END IF;
  IF has_table_privilege('anon', 'public.organization_business_profiles', 'SELECT') THEN
    RAISE EXCEPTION 'Business profiles are visible to anon';
  END IF;
  IF has_table_privilege('authenticated', 'public.organization_business_profiles', 'INSERT')
     OR has_table_privilege('authenticated', 'public.organization_business_profiles', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.organization_business_profiles', 'DELETE') THEN
    RAISE EXCEPTION 'Authenticated can mutate business profiles without RPC';
  END IF;
END;
$$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260822000001', 'business_profiler') ON CONFLICT DO NOTHING;
