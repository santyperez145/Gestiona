-- Theme releases: editar sin tocar la tienda publicada.
--
-- Shopify y Tiendanube separan el tema vivo de sus borradores, permiten
-- previsualizar antes de publicar y conservan la versión anterior. Nerqia
-- mantiene la misma frontera sin crear otro Storefront: ecommerce_stores
-- sigue siendo la autoridad pública y esta tabla sólo versiona presentación.

CREATE TABLE IF NOT EXISTS public.store_theme_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES public.ecommerce_stores(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 80),
  status text NOT NULL CHECK (status IN ('draft', 'published', 'archived')),
  config jsonb NOT NULL CHECK (jsonb_typeof(config) = 'object'),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  published_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  UNIQUE (store_id, version)
);

-- La UI y el renderer comparten siete presets. La constraint heredada de la
-- primera versión conocía cinco y podía rechazar Noche/Pastel al publicar.
ALTER TABLE public.ecommerce_stores
  DROP CONSTRAINT IF EXISTS ecommerce_stores_theme_check;
ALTER TABLE public.ecommerce_stores
  ADD CONSTRAINT ecommerce_stores_theme_check
  CHECK (theme IN ('minimal', 'bold', 'luxury', 'sport', 'natural', 'noche', 'pastel'));

CREATE UNIQUE INDEX IF NOT EXISTS store_theme_versions_one_draft
  ON public.store_theme_versions(store_id) WHERE status = 'draft';
CREATE UNIQUE INDEX IF NOT EXISTS store_theme_versions_one_published
  ON public.store_theme_versions(store_id) WHERE status = 'published';
CREATE INDEX IF NOT EXISTS store_theme_versions_history
  ON public.store_theme_versions(store_id, version DESC);

ALTER TABLE public.store_theme_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "store theme versions are readable by permitted members"
  ON public.store_theme_versions;
CREATE POLICY "store theme versions are readable by permitted members"
  ON public.store_theme_versions FOR SELECT TO authenticated
  USING (public.has_permission(org_id, 'ecommerce', 'view'));

REVOKE INSERT, UPDATE, DELETE ON public.store_theme_versions
  FROM anon, authenticated;
GRANT SELECT ON public.store_theme_versions TO authenticated;

CREATE OR REPLACE FUNCTION public.normalize_store_theme_config(p_config jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_theme text;
  v_color text;
  v_font text;
  v_logo text;
  v_banner text;
  v_layout jsonb;
BEGIN
  IF p_config IS NULL OR jsonb_typeof(p_config) <> 'object' THEN
    RAISE EXCEPTION 'El diseño no tiene un formato válido';
  END IF;

  v_theme := lower(btrim(COALESCE(p_config ->> 'theme', '')));
  IF v_theme NOT IN ('minimal', 'bold', 'luxury', 'sport', 'natural', 'noche', 'pastel') THEN
    RAISE EXCEPTION 'El tema elegido no existe';
  END IF;

  v_color := upper(btrim(COALESCE(p_config ->> 'primary_color', '')));
  IF v_color !~ '^#[0-9A-F]{6}$' THEN
    RAISE EXCEPTION 'El color principal debe tener formato hexadecimal';
  END IF;

  v_font := NULLIF(lower(btrim(COALESCE(p_config ->> 'font', ''))), '');
  IF v_font IS NOT NULL AND v_font NOT IN ('sistema', 'inter', 'poppins', 'space', 'playfair', 'lora') THEN
    RAISE EXCEPTION 'La tipografía elegida no existe';
  END IF;

  v_logo := NULLIF(btrim(COALESCE(p_config ->> 'logo_url', '')), '');
  v_banner := NULLIF(btrim(COALESCE(p_config ->> 'banner_url', '')), '');
  IF char_length(COALESCE(v_logo, '')) > 2048 OR char_length(COALESCE(v_banner, '')) > 2048 THEN
    RAISE EXCEPTION 'La URL de una imagen es demasiado larga';
  END IF;
  IF v_logo IS NOT NULL AND v_logo !~* '^(https://|/)' THEN
    RAISE EXCEPTION 'La URL del logo no es válida';
  END IF;
  IF v_banner IS NOT NULL AND v_banner !~* '^(https://|/)' THEN
    RAISE EXCEPTION 'La URL de la portada no es válida';
  END IF;

  v_layout := p_config -> 'storefront_layout';
  IF v_layout IS NOT NULL AND v_layout <> 'null'::jsonb
     AND jsonb_typeof(v_layout) <> 'object' THEN
    RAISE EXCEPTION 'La composición de portada no es válida';
  END IF;
  IF octet_length(COALESCE(v_layout, 'null'::jsonb)::text) > 32768 THEN
    RAISE EXCEPTION 'La composición de portada supera el límite permitido';
  END IF;

  RETURN jsonb_build_object(
    'theme', v_theme,
    'primary_color', v_color,
    'font', v_font,
    'logo_url', v_logo,
    'banner_url', v_banner,
    'storefront_layout', COALESCE(v_layout, 'null'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.normalize_store_theme_config(jsonb)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.seed_store_theme_version()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.store_theme_versions (
    org_id, store_id, version, label, status, config, published_at
  ) VALUES (
    NEW.org_id,
    NEW.id,
    1,
    'Diseño inicial',
    'published',
    public.normalize_store_theme_config(jsonb_build_object(
      'theme', NEW.theme,
      'primary_color', NEW.primary_color,
      'font', NEW.font,
      'logo_url', NEW.logo_url,
      'banner_url', NEW.banner_url,
      'storefront_layout', NEW.storefront_layout
    )),
    COALESCE(NEW.published_at, NEW.created_at)
  ) ON CONFLICT (store_id, version) DO NOTHING;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.seed_store_theme_version()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_seed_store_theme_version ON public.ecommerce_stores;
CREATE TRIGGER trg_seed_store_theme_version
  AFTER INSERT ON public.ecommerce_stores
  FOR EACH ROW EXECUTE FUNCTION public.seed_store_theme_version();

INSERT INTO public.store_theme_versions (
  org_id, store_id, version, label, status, config, published_at
)
SELECT
  s.org_id,
  s.id,
  1,
  'Diseño publicado',
  'published',
  public.normalize_store_theme_config(jsonb_build_object(
    'theme', s.theme,
    'primary_color', s.primary_color,
    'font', s.font,
    'logo_url', s.logo_url,
    'banner_url', s.banner_url,
    'storefront_layout', s.storefront_layout
  )),
  COALESCE(s.published_at, s.created_at)
FROM public.ecommerce_stores s
WHERE NOT EXISTS (
  SELECT 1 FROM public.store_theme_versions v WHERE v.store_id = s.id
);

CREATE OR REPLACE FUNCTION public.save_store_theme_draft(
  p_store_id uuid,
  p_config jsonb,
  p_label text DEFAULT NULL,
  p_expected_updated_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_store public.ecommerce_stores%ROWTYPE;
  v_draft public.store_theme_versions%ROWTYPE;
  v_config jsonb;
  v_label text := NULLIF(btrim(COALESCE(p_label, '')), '');
  v_version integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Necesitás iniciar sesión para guardar un borrador';
  END IF;

  SELECT * INTO v_store FROM public.ecommerce_stores
   WHERE id = p_store_id FOR UPDATE;
  IF v_store.id IS NULL THEN
    RAISE EXCEPTION 'La tienda no existe';
  END IF;
  PERFORM public.exigir_permiso(v_store.org_id, 'ecommerce', 'edit', 'editar el diseño de la tienda');
  v_config := public.normalize_store_theme_config(p_config);

  SELECT * INTO v_draft FROM public.store_theme_versions
   WHERE store_id = p_store_id AND status = 'draft' FOR UPDATE;

  IF v_draft.id IS NOT NULL THEN
    IF p_expected_updated_at IS NOT NULL
       AND v_draft.updated_at IS DISTINCT FROM p_expected_updated_at THEN
      RAISE EXCEPTION 'El borrador cambió en otra sesión. Recargá antes de sobrescribirlo'
        USING ERRCODE = '40001';
    END IF;
    UPDATE public.store_theme_versions
       SET config = v_config,
           label = COALESCE(v_label, label),
           updated_at = clock_timestamp()
     WHERE id = v_draft.id
     RETURNING * INTO v_draft;
  ELSE
    SELECT COALESCE(max(version), 0) + 1 INTO v_version
      FROM public.store_theme_versions WHERE store_id = p_store_id;
    INSERT INTO public.store_theme_versions (
      org_id, store_id, version, label, status, config, created_by
    ) VALUES (
      v_store.org_id, p_store_id, v_version,
      COALESCE(v_label, 'Borrador de diseño'), 'draft', v_config, auth.uid()
    ) RETURNING * INTO v_draft;
  END IF;

  INSERT INTO public.audit_logs (
    user_id, org_id, action, entity_type, entity_id, details, severity, tags
  ) VALUES (
    auth.uid(), v_store.org_id, 'store_theme.draft_saved', 'store_theme_version',
    v_draft.id, jsonb_build_object('store_id', p_store_id, 'version', v_draft.version),
    'info', ARRAY['ecommerce', 'theme']::text[]
  );

  RETURN to_jsonb(v_draft);
END;
$$;

CREATE OR REPLACE FUNCTION public.publish_store_theme_draft(
  p_store_id uuid,
  p_draft_id uuid,
  p_expected_updated_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_store public.ecommerce_stores%ROWTYPE;
  v_draft public.store_theme_versions%ROWTYPE;
  v_old_config jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Necesitás iniciar sesión para publicar un diseño';
  END IF;

  SELECT * INTO v_store FROM public.ecommerce_stores
   WHERE id = p_store_id FOR UPDATE;
  IF v_store.id IS NULL THEN
    RAISE EXCEPTION 'La tienda no existe';
  END IF;
  PERFORM public.exigir_permiso(v_store.org_id, 'ecommerce', 'edit', 'publicar el diseño de la tienda');

  SELECT * INTO v_draft FROM public.store_theme_versions
   WHERE id = p_draft_id AND store_id = p_store_id AND status = 'draft'
   FOR UPDATE;
  IF v_draft.id IS NULL THEN
    RAISE EXCEPTION 'El borrador ya no está disponible';
  END IF;
  IF p_expected_updated_at IS NOT NULL
     AND v_draft.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'El borrador cambió en otra sesión. Recargá antes de publicarlo'
      USING ERRCODE = '40001';
  END IF;

  v_old_config := public.normalize_store_theme_config(jsonb_build_object(
    'theme', v_store.theme,
    'primary_color', v_store.primary_color,
    'font', v_store.font,
    'logo_url', v_store.logo_url,
    'banner_url', v_store.banner_url,
    'storefront_layout', v_store.storefront_layout
  ));

  UPDATE public.store_theme_versions
     SET status = 'archived', updated_at = clock_timestamp()
   WHERE store_id = p_store_id AND status = 'published';

  UPDATE public.ecommerce_stores
     SET theme = v_draft.config ->> 'theme',
         primary_color = v_draft.config ->> 'primary_color',
         font = NULLIF(v_draft.config ->> 'font', ''),
         logo_url = NULLIF(v_draft.config ->> 'logo_url', ''),
         banner_url = NULLIF(v_draft.config ->> 'banner_url', ''),
         storefront_layout = v_draft.config -> 'storefront_layout'
   WHERE id = p_store_id;

  UPDATE public.store_theme_versions
     SET status = 'published',
         published_by = auth.uid(),
         published_at = clock_timestamp(),
         updated_at = clock_timestamp()
   WHERE id = v_draft.id
   RETURNING * INTO v_draft;

  INSERT INTO public.audit_logs (
    user_id, org_id, action, entity_type, entity_id, old_values, new_values,
    details, severity, tags
  ) VALUES (
    auth.uid(), v_store.org_id, 'store_theme.published', 'store_theme_version',
    v_draft.id, v_old_config, v_draft.config,
    jsonb_build_object('store_id', p_store_id, 'version', v_draft.version),
    'info', ARRAY['ecommerce', 'theme', 'publish']::text[]
  );

  RETURN jsonb_build_object('version', to_jsonb(v_draft), 'config', v_draft.config);
END;
$$;

CREATE OR REPLACE FUNCTION public.restore_store_theme_version(
  p_store_id uuid,
  p_version_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_store public.ecommerce_stores%ROWTYPE;
  v_source public.store_theme_versions%ROWTYPE;
  v_restored public.store_theme_versions%ROWTYPE;
  v_old_config jsonb;
  v_next integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Necesitás iniciar sesión para restaurar un diseño';
  END IF;

  SELECT * INTO v_store FROM public.ecommerce_stores
   WHERE id = p_store_id FOR UPDATE;
  IF v_store.id IS NULL THEN
    RAISE EXCEPTION 'La tienda no existe';
  END IF;
  PERFORM public.exigir_permiso(v_store.org_id, 'ecommerce', 'edit', 'restaurar el diseño de la tienda');

  SELECT * INTO v_source FROM public.store_theme_versions
   WHERE id = p_version_id AND store_id = p_store_id
     AND status IN ('published', 'archived');
  IF v_source.id IS NULL THEN
    RAISE EXCEPTION 'La versión elegida no está disponible';
  END IF;

  v_old_config := public.normalize_store_theme_config(jsonb_build_object(
    'theme', v_store.theme,
    'primary_color', v_store.primary_color,
    'font', v_store.font,
    'logo_url', v_store.logo_url,
    'banner_url', v_store.banner_url,
    'storefront_layout', v_store.storefront_layout
  ));
  SELECT COALESCE(max(version), 0) + 1 INTO v_next
    FROM public.store_theme_versions WHERE store_id = p_store_id;

  UPDATE public.store_theme_versions
     SET status = 'archived', updated_at = clock_timestamp()
   WHERE store_id = p_store_id AND status = 'published';

  INSERT INTO public.store_theme_versions (
    org_id, store_id, version, label, status, config, created_by,
    published_by, published_at
  ) VALUES (
    v_store.org_id, p_store_id, v_next,
    'Restaurada desde v' || v_source.version, 'published', v_source.config,
    auth.uid(), auth.uid(), clock_timestamp()
  ) RETURNING * INTO v_restored;

  UPDATE public.ecommerce_stores
     SET theme = v_source.config ->> 'theme',
         primary_color = v_source.config ->> 'primary_color',
         font = NULLIF(v_source.config ->> 'font', ''),
         logo_url = NULLIF(v_source.config ->> 'logo_url', ''),
         banner_url = NULLIF(v_source.config ->> 'banner_url', ''),
         storefront_layout = v_source.config -> 'storefront_layout'
   WHERE id = p_store_id;

  INSERT INTO public.audit_logs (
    user_id, org_id, action, entity_type, entity_id, old_values, new_values,
    details, severity, tags
  ) VALUES (
    auth.uid(), v_store.org_id, 'store_theme.restored', 'store_theme_version',
    v_restored.id, v_old_config, v_source.config,
    jsonb_build_object(
      'store_id', p_store_id,
      'source_version', v_source.version,
      'new_version', v_restored.version
    ),
    'warning', ARRAY['ecommerce', 'theme', 'restore']::text[]
  );

  RETURN jsonb_build_object('version', to_jsonb(v_restored), 'config', v_restored.config);
END;
$$;

DROP FUNCTION IF EXISTS public.get_store_theme_preview(text, uuid);
CREATE FUNCTION public.get_store_theme_preview(p_slug text, p_version_id uuid)
RETURNS TABLE(
  org_id uuid,
  owner_user_id uuid,
  name text,
  description text,
  slug text,
  theme text,
  font text,
  primary_color text,
  logo_url text,
  banner_url text,
  currency text,
  payment_methods text[],
  payment_discounts jsonb,
  shipping_cost numeric,
  free_shipping_above numeric,
  shipping_mode text,
  pickup_enabled boolean,
  pickup_address text,
  meta_title text,
  meta_description text,
  social_links jsonb,
  meta_pixel_id text,
  ga_measurement_id text,
  tiktok_pixel_id text,
  nav_links jsonb,
  storefront_layout jsonb,
  shipping_provinces text[],
  pickup_instructions text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Necesitás iniciar sesión para ver este borrador';
  END IF;

  SELECT s.org_id INTO v_org_id
    FROM public.ecommerce_stores s
    JOIN public.store_theme_versions v ON v.store_id = s.id
   WHERE lower(s.slug) = lower(p_slug) AND v.id = p_version_id;
  IF v_org_id IS NULL OR NOT public.has_permission(v_org_id, 'ecommerce', 'view') THEN
    RAISE EXCEPTION 'No tenés permiso para ver este borrador';
  END IF;

  RETURN QUERY
  SELECT
    s.org_id,
    (SELECT m.user_id FROM public.memberships m
      WHERE m.org_id = s.org_id AND m.role = 'owner'
      ORDER BY m.joined_at LIMIT 1),
    s.name, s.description, s.slug,
    v.config ->> 'theme',
    NULLIF(v.config ->> 'font', ''),
    v.config ->> 'primary_color',
    NULLIF(v.config ->> 'logo_url', ''),
    NULLIF(v.config ->> 'banner_url', ''),
    s.currency,
    public.medios_de_pago_vivos(s.org_id, s.payment_methods),
    COALESCE(s.payment_discounts, '{}'::jsonb),
    s.shipping_cost, s.free_shipping_above,
    COALESCE(s.shipping_mode, 'flat'), COALESCE(s.pickup_enabled, false), s.pickup_address,
    s.meta_title, s.meta_description, s.social_links,
    s.meta_pixel_id, s.ga_measurement_id, s.tiktok_pixel_id,
    COALESCE(s.nav_links, '[]'::jsonb),
    v.config -> 'storefront_layout',
    COALESCE((
      SELECT array_agg(DISTINCT province ORDER BY province)
        FROM public.shipping_zones z
        JOIN public.shipping_rates r ON r.zone_id = z.id AND r.is_active
        CROSS JOIN LATERAL unnest(z.provinces) AS province
       WHERE z.org_id = s.org_id AND z.is_active
    ), ARRAY[]::text[]),
    NULLIF(btrim(COALESCE(s.pickup_instructions, '')), '')
  FROM public.ecommerce_stores s
  JOIN public.store_theme_versions v ON v.store_id = s.id
  WHERE lower(s.slug) = lower(p_slug) AND v.id = p_version_id
  LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.save_store_theme_draft(uuid, jsonb, text, timestamptz)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.publish_store_theme_draft(uuid, uuid, timestamptz)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.restore_store_theme_version(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_store_theme_preview(text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_store_theme_draft(uuid, jsonb, text, timestamptz)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.publish_store_theme_draft(uuid, uuid, timestamptz)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.restore_store_theme_version(uuid, uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_store_theme_preview(text, uuid)
  TO authenticated;

COMMENT ON TABLE public.store_theme_versions IS
  'Historial de presentación de una tienda. ecommerce_stores conserva la versión pública vigente.';
COMMENT ON FUNCTION public.publish_store_theme_draft(uuid, uuid, timestamptz) IS
  'Publica un borrador visual de forma atómica y conserva la versión anterior para rollback.';
COMMENT ON FUNCTION public.get_store_theme_preview(text, uuid) IS
  'Vista previa autenticada de una versión visual; no requiere que la tienda esté activa.';

DO $$
DECLARE
  v_def text;
BEGIN
  v_def := pg_get_functiondef(
    'public.publish_store_theme_draft(uuid,uuid,timestamp with time zone)'::regprocedure
  );
  IF v_def NOT LIKE '%FOR UPDATE%' OR v_def NOT LIKE '%status = ''archived''%' THEN
    RAISE EXCEPTION 'publicar tema perdió lock o historial';
  END IF;
  IF has_function_privilege('anon', 'public.save_store_theme_draft(uuid,jsonb,text,timestamp with time zone)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.publish_store_theme_draft(uuid,uuid,timestamp with time zone)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.restore_store_theme_version(uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.get_store_theme_preview(text,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon no debe editar ni previsualizar versiones privadas';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.ecommerce_stores'::regclass
       AND tgname = 'trg_seed_store_theme_version'
       AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'las tiendas nuevas no inicializan su historial visual';
  END IF;
END $$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260904000100', 'store_theme_versions')
ON CONFLICT DO NOTHING;
