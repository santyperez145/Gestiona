-- Ajustes finos del tema de la vitrina (Shopify/Tiendanube theme settings).
--
-- El diseño de la tienda ya se versiona en store_theme_versions.config con
-- borrador → publicar → restaurar y audit log. Este slice agrega el bloque
-- `theme_settings` a ese snapshot: estilo del header, radios, ancho de página,
-- proporción de las fotos de producto y altura del header. Cada ajuste cae a
-- su default si falta o es basura: una tienda vieja se ve exactamente igual.

-- ── Columna en la tienda publicada ─────────────────────────────────────────

ALTER TABLE public.ecommerce_stores
  ADD COLUMN IF NOT EXISTS theme_settings jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Backfill honesto: lo publicado manda, igual que hace el favicon al publicar.
UPDATE public.ecommerce_stores s
   SET theme_settings = COALESCE(v.config -> 'theme_settings', '{}'::jsonb)
  FROM public.store_theme_versions v
 WHERE v.store_id = s.id
   AND v.status = 'published'
   AND v.config ? 'theme_settings'
   AND s.theme_settings = '{}'::jsonb;

-- ── Normalizador de config: whitelist + defaults ───────────────────────────

-- ── Normalizador de config: whitelist + defaults ───────────────────────────

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
  v_favicon text;
  v_banner text;
  v_layout jsonb;
  v_settings jsonb;
  v_header_style text;
  v_radius text;
  v_page_width text;
  v_card_ratio text;
  v_header_height text;
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
  v_favicon := NULLIF(btrim(COALESCE(p_config ->> 'favicon_url', '')), '');
  v_banner := NULLIF(btrim(COALESCE(p_config ->> 'banner_url', '')), '');
  IF char_length(COALESCE(v_logo, '')) > 2048
     OR char_length(COALESCE(v_favicon, '')) > 2048
     OR char_length(COALESCE(v_banner, '')) > 2048 THEN
    RAISE EXCEPTION 'La URL de una imagen es demasiado larga';
  END IF;
  IF v_logo IS NOT NULL AND v_logo !~* '^(https://|/)' THEN
    RAISE EXCEPTION 'La URL del logo no es válida';
  END IF;
  IF v_favicon IS NOT NULL AND v_favicon !~* '^(https://|/)' THEN
    RAISE EXCEPTION 'La URL del ícono de pestaña no es válida';
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

  -- Ajustes finos: cada opción cae a default si falta o no está en la lista.
  -- Un objeto basura no rompe la tienda: se guardan los defaults.
  v_settings := p_config -> 'theme_settings';
  IF v_settings IS NULL OR v_settings = 'null'::jsonb
     OR jsonb_typeof(v_settings) <> 'object' THEN
    v_settings := '{}'::jsonb;
  END IF;

  v_header_style := lower(btrim(COALESCE(v_settings ->> 'header_style', '')));
  IF v_header_style NOT IN ('solido', 'transparente', 'borde_inferior') THEN
    v_header_style := 'solido';
  END IF;

  v_radius := lower(btrim(COALESCE(v_settings ->> 'radius', '')));
  IF v_radius NOT IN ('cuadrado', 'suave', 'redondo') THEN
    v_radius := 'suave';
  END IF;

  v_page_width := lower(btrim(COALESCE(v_settings ->> 'page_width', '')));
  IF v_page_width NOT IN ('6xl', '7xl', 'full') THEN
    v_page_width := '6xl';
  END IF;

  v_card_ratio := btrim(COALESCE(v_settings ->> 'card_ratio', ''));
  IF v_card_ratio NOT IN ('1:1', '4:5', '3:2') THEN
    v_card_ratio := '1:1';
  END IF;

  v_header_height := lower(btrim(COALESCE(v_settings ->> 'header_height', '')));
  IF v_header_height NOT IN ('compacto', 'normal', 'alto') THEN
    v_header_height := 'normal';
  END IF;

  RETURN jsonb_build_object(
    'theme', v_theme,
    'primary_color', v_color,
    'font', v_font,
    'logo_url', v_logo,
    'favicon_url', v_favicon,
    'banner_url', v_banner,
    'storefront_layout', COALESCE(v_layout, 'null'::jsonb),
    'theme_settings', jsonb_build_object(
      'header_style', v_header_style,
      'radius', v_radius,
      'page_width', v_page_width,
      'card_ratio', v_card_ratio,
      'header_height', v_header_height
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.normalize_store_theme_config(jsonb)
  FROM PUBLIC, anon, authenticated;

-- ── Seed de tiendas futuras: incluir theme_settings ────────────────────────

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
      'favicon_url', NEW.favicon_url,
      'banner_url', NEW.banner_url,
      'storefront_layout', NEW.storefront_layout,
      'theme_settings', NEW.theme_settings
    )),
    COALESCE(NEW.published_at, NEW.created_at)
  ) ON CONFLICT (store_id, version) DO NOTHING;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.seed_store_theme_version()
  FROM PUBLIC, anon, authenticated;

-- ── Lecturas de la vitrina: exponer theme_settings ─────────────────────────

DROP FUNCTION IF EXISTS public.get_store_by_slug(text);
CREATE FUNCTION public.get_store_by_slug(p_slug text)
RETURNS TABLE(
  org_id uuid, owner_user_id uuid, name text, description text, slug text,
  theme text, font text, primary_color text, logo_url text, banner_url text,
  currency text, payment_methods text[], payment_discounts jsonb,
  shipping_cost numeric, free_shipping_above numeric, shipping_mode text,
  pickup_enabled boolean, pickup_address text, meta_title text,
  meta_description text, social_links jsonb, meta_pixel_id text,
  ga_measurement_id text, tiktok_pixel_id text, nav_links jsonb,
  storefront_layout jsonb, theme_settings jsonb, shipping_provinces text[],
  pickup_instructions text, favicon_url text
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    s.org_id,
    (SELECT m.user_id FROM public.memberships m
      WHERE m.org_id = s.org_id AND m.role = 'owner'
      ORDER BY m.joined_at LIMIT 1),
    s.name, s.description, s.slug, s.theme, s.font, s.primary_color,
    s.logo_url, s.banner_url, s.currency,
    public.medios_de_pago_vivos(s.org_id, s.payment_methods),
    COALESCE(s.payment_discounts, '{}'::jsonb),
    s.shipping_cost, s.free_shipping_above,
    COALESCE(s.shipping_mode, 'flat'), COALESCE(s.pickup_enabled, false), s.pickup_address,
    s.meta_title, s.meta_description, s.social_links,
    s.meta_pixel_id, s.ga_measurement_id, s.tiktok_pixel_id,
    COALESCE(s.nav_links, '[]'::jsonb),
    s.storefront_layout,
    COALESCE(s.theme_settings, '{}'::jsonb),
    COALESCE((
      SELECT array_agg(DISTINCT province ORDER BY province)
        FROM public.shipping_zones z
        JOIN public.shipping_rates r ON r.zone_id = z.id AND r.is_active
        CROSS JOIN LATERAL unnest(z.provinces) AS province
       WHERE z.org_id = s.org_id AND z.is_active
    ), ARRAY[]::text[]),
    NULLIF(btrim(COALESCE(s.pickup_instructions, '')), ''),
    s.favicon_url
  FROM public.ecommerce_stores s
  WHERE lower(s.slug) = lower(p_slug) AND s.is_active
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_store_by_slug(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_store_by_slug(text) TO anon, authenticated;

COMMENT ON FUNCTION public.get_store_by_slug(text) IS
  'Vidriera pública. favicon_url y theme_settings son presentación, sin datos privados.';

DROP FUNCTION IF EXISTS public.get_store_theme_preview(text, uuid);
CREATE FUNCTION public.get_store_theme_preview(p_slug text, p_version_id uuid)
RETURNS TABLE(
  org_id uuid, owner_user_id uuid, name text, description text, slug text,
  theme text, font text, primary_color text, logo_url text, banner_url text,
  currency text, payment_methods text[], payment_discounts jsonb,
  shipping_cost numeric, free_shipping_above numeric, shipping_mode text,
  pickup_enabled boolean, pickup_address text, meta_title text,
  meta_description text, social_links jsonb, meta_pixel_id text,
  ga_measurement_id text, tiktok_pixel_id text, nav_links jsonb,
  storefront_layout jsonb, theme_settings jsonb, shipping_provinces text[],
  pickup_instructions text, favicon_url text
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
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
    v.config ->> 'theme', NULLIF(v.config ->> 'font', ''),
    v.config ->> 'primary_color', NULLIF(v.config ->> 'logo_url', ''),
    NULLIF(v.config ->> 'banner_url', ''), s.currency,
    public.medios_de_pago_vivos(s.org_id, s.payment_methods),
    COALESCE(s.payment_discounts, '{}'::jsonb),
    s.shipping_cost, s.free_shipping_above,
    COALESCE(s.shipping_mode, 'flat'), COALESCE(s.pickup_enabled, false), s.pickup_address,
    s.meta_title, s.meta_description, s.social_links,
    s.meta_pixel_id, s.ga_measurement_id, s.tiktok_pixel_id,
    COALESCE(s.nav_links, '[]'::jsonb), v.config -> 'storefront_layout',
    COALESCE(v.config -> 'theme_settings', '{}'::jsonb),
    COALESCE((
      SELECT array_agg(DISTINCT province ORDER BY province)
        FROM public.shipping_zones z
        JOIN public.shipping_rates r ON r.zone_id = z.id AND r.is_active
        CROSS JOIN LATERAL unnest(z.provinces) AS province
       WHERE z.org_id = s.org_id AND z.is_active
    ), ARRAY[]::text[]),
    NULLIF(btrim(COALESCE(s.pickup_instructions, '')), ''),
    NULLIF(v.config ->> 'favicon_url', '')
  FROM public.ecommerce_stores s
  JOIN public.store_theme_versions v ON v.store_id = s.id
  WHERE lower(s.slug) = lower(p_slug) AND v.id = p_version_id
  LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.get_store_theme_preview(text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_store_theme_preview(text, uuid)
  TO authenticated;

COMMENT ON FUNCTION public.get_store_theme_preview(text, uuid) IS
  'Preview autenticada de una versión visual, incluidos favicon y ajustes de tema.';

-- ── Publicar y restaurar escriben theme_settings ────────────────────────────

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
    'favicon_url', v_store.favicon_url,
    'banner_url', v_store.banner_url,
    'storefront_layout', v_store.storefront_layout,
    'theme_settings', v_store.theme_settings
  ));

  UPDATE public.store_theme_versions
     SET status = 'archived', updated_at = clock_timestamp()
   WHERE store_id = p_store_id AND status = 'published';

  UPDATE public.ecommerce_stores
     SET theme = v_draft.config ->> 'theme',
         primary_color = v_draft.config ->> 'primary_color',
         font = NULLIF(v_draft.config ->> 'font', ''),
         logo_url = NULLIF(v_draft.config ->> 'logo_url', ''),
         favicon_url = NULLIF(v_draft.config ->> 'favicon_url', ''),
         banner_url = NULLIF(v_draft.config ->> 'banner_url', ''),
         storefront_layout = v_draft.config -> 'storefront_layout',
         theme_settings = COALESCE(v_draft.config -> 'theme_settings', '{}'::jsonb)
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

REVOKE ALL ON FUNCTION public.publish_store_theme_draft(uuid, uuid, timestamptz)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.publish_store_theme_draft(uuid, uuid, timestamptz)
  TO authenticated;

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
    'favicon_url', v_store.favicon_url,
    'banner_url', v_store.banner_url,
    'storefront_layout', v_store.storefront_layout,
    'theme_settings', v_store.theme_settings
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
         favicon_url = NULLIF(v_source.config ->> 'favicon_url', ''),
         banner_url = NULLIF(v_source.config ->> 'banner_url', ''),
         storefront_layout = v_source.config -> 'storefront_layout',
         theme_settings = COALESCE(v_source.config -> 'theme_settings', '{}'::jsonb)
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

REVOKE ALL ON FUNCTION public.restore_store_theme_version(uuid, uuid)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.restore_store_theme_version(uuid, uuid)
  TO authenticated;

-- ── Verificación ────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT pg_get_function_result('public.get_store_by_slug(text)'::regprocedure)
       LIKE '%theme_settings%' THEN
    RAISE EXCEPTION 'get_store_by_slug no expone theme_settings';
  END IF;
  IF has_function_privilege('anon', 'public.get_store_by_slug(text)', 'EXECUTE') IS NOT TRUE THEN
    RAISE EXCEPTION 'get_store_by_slug perdió el execute público';
  END IF;
  IF NOT pg_get_function_result('public.get_store_theme_preview(text,uuid)'::regprocedure)
       LIKE '%theme_settings%' THEN
    RAISE EXCEPTION 'get_store_theme_preview no expone theme_settings';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'ecommerce_stores'
       AND column_name = 'theme_settings'
  ) THEN
    RAISE EXCEPTION 'ecommerce_stores.theme_settings no existe';
  END IF;
END $$;