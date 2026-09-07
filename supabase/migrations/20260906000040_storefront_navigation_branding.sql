-- Identidad de documento por tienda: favicon independiente, Apple icon y
-- color del navegador. Forma parte de la versión del tema, no de Core.

ALTER TABLE public.ecommerce_stores
  ADD COLUMN IF NOT EXISTS favicon_url text;

COMMENT ON COLUMN public.ecommerce_stores.favicon_url IS
  'Icono cuadrado publicado de la tienda. Se versiona con el tema y nunca reemplaza el logo del encabezado.';

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

  RETURN jsonb_build_object(
    'theme', v_theme,
    'primary_color', v_color,
    'font', v_font,
    'logo_url', v_logo,
    'favicon_url', v_favicon,
    'banner_url', v_banner,
    'storefront_layout', COALESCE(v_layout, 'null'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.normalize_store_theme_config(jsonb)
  FROM PUBLIC, anon, authenticated;

-- Las versiones anteriores reciben el valor actualmente publicado. Así una
-- restauración histórica no hereda por accidente un favicon más nuevo.
UPDATE public.store_theme_versions v
   SET config = jsonb_set(
     v.config,
     '{favicon_url}',
     COALESCE(to_jsonb(s.favicon_url), 'null'::jsonb),
     true
   )
  FROM public.ecommerce_stores s
 WHERE s.id = v.store_id
   AND NOT (v.config ? 'favicon_url');

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
      'storefront_layout', NEW.storefront_layout
    )),
    COALESCE(NEW.published_at, NEW.created_at)
  ) ON CONFLICT (store_id, version) DO NOTHING;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.seed_store_theme_version()
  FROM PUBLIC, anon, authenticated;

-- Publicar/restaurar ya cambia el estado de store_theme_versions de forma
-- atómica. Este trigger extiende ese contrato sin duplicar ambos motores.
CREATE OR REPLACE FUNCTION public.sync_store_favicon_from_published_theme()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_config jsonb;
BEGIN
  IF NEW.status <> 'published' THEN RETURN NEW; END IF;
  v_config := public.normalize_store_theme_config(NEW.config);
  UPDATE public.ecommerce_stores
     SET favicon_url = NULLIF(v_config ->> 'favicon_url', '')
   WHERE id = NEW.store_id AND org_id = NEW.org_id;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_store_favicon_from_published_theme()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_sync_store_favicon_from_published_theme
  ON public.store_theme_versions;
CREATE TRIGGER trg_sync_store_favicon_from_published_theme
  AFTER INSERT OR UPDATE OF status, config ON public.store_theme_versions
  FOR EACH ROW
  WHEN (NEW.status = 'published')
  EXECUTE FUNCTION public.sync_store_favicon_from_published_theme();

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
  storefront_layout jsonb, shipping_provinces text[], pickup_instructions text,
  favicon_url text
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
  'Vidriera pública. favicon_url se expone al final como identidad visual, sin configuración privada.';

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
  storefront_layout jsonb, shipping_provinces text[], pickup_instructions text,
  favicon_url text
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
  'Preview autenticada de una versión visual, incluido su favicon, sin duplicar el storefront.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'ecommerce_stores'
       AND column_name = 'favicon_url'
  ) THEN
    RAISE EXCEPTION 'Falta ecommerce_stores.favicon_url';
  END IF;
  IF NOT pg_get_function_result('public.get_store_by_slug(text)'::regprocedure)
      ILIKE '%favicon_url text%' THEN
    RAISE EXCEPTION 'get_store_by_slug no expone favicon_url';
  END IF;
  IF has_function_privilege('anon', 'public.get_store_theme_preview(text,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'La preview del tema no puede ser anónima';
  END IF;
END;
$$;
