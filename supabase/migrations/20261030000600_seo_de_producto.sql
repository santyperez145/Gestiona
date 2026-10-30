-- Título y descripción para buscadores de cada producto (2026-10-30).
--
-- Al migrar desde Tiendanube o Shopify, el comercio trae títulos y
-- descripciones SEO trabajados durante años ("Título para SEO", "Descripción
-- para SEO"). Hasta hoy se perdían: Google veía "Nombre — Marca | Tienda" y
-- la posición se resentía justo cuando el comercio más la necesita. También
-- faltaba poder editarlos a mano, cosa que Tiendanube sí permite.
--
-- Tabla aparte (no columnas en products) para no tocar el catálogo público que
-- usan la tienda, el sitemap y el feed:
--   · `guardar_seo_producto`: el comercio edita (permiso de editar productos).
--   · `registrar_seo_importado`: al terminar una importación, el panel manda
--     el SEO del archivo; se ubica cada producto por su identidad de origen
--     y nunca pisa lo que el comercio cargó a mano.
--   · `get_store_product_seo`: lo lee el HTML para buscadores, sólo para
--     productos publicados en esa tienda.
--   · Deshacer la importación borra el SEO que trajo.

BEGIN;

CREATE TABLE IF NOT EXISTS public.product_seo (
  product_id uuid PRIMARY KEY REFERENCES public.products(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  titulo text CHECK (titulo IS NULL OR char_length(titulo) BETWEEN 1 AND 120),
  descripcion text CHECK (descripcion IS NULL OR char_length(descripcion) BETWEEN 1 AND 400),
  origen text NOT NULL DEFAULT 'manual' CHECK (origen IN ('manual', 'importado')),
  import_session_id uuid REFERENCES public.catalog_import_sessions(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (titulo IS NOT NULL OR descripcion IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS product_seo_org_idx ON public.product_seo(org_id);
CREATE INDEX IF NOT EXISTS product_seo_sesion_idx ON public.product_seo(import_session_id) WHERE import_session_id IS NOT NULL;

ALTER TABLE public.product_seo ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "miembros leen el seo de sus productos" ON public.product_seo;
CREATE POLICY "miembros leen el seo de sus productos" ON public.product_seo
  FOR SELECT TO authenticated USING (public.is_org_member(org_id, auth.uid()));
REVOKE ALL ON public.product_seo FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.product_seo TO authenticated;

-- Texto limpio: sin espacios de más ni saltos; vacío = sin dato.
CREATE OR REPLACE FUNCTION public.texto_seo(p_texto text, p_max integer)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $fn$
  SELECT NULLIF(left(btrim(regexp_replace(COALESCE(p_texto, ''), '\s+', ' ', 'g')), p_max), '');
$fn$;
REVOKE ALL ON FUNCTION public.texto_seo(text, integer) FROM PUBLIC, anon, authenticated;

-- ── El comercio lo edita ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.guardar_seo_producto(p_product_id uuid, p_titulo text, p_descripcion text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_org uuid;
  v_titulo text := public.texto_seo(p_titulo, 120);
  v_descripcion text := public.texto_seo(p_descripcion, 400);
BEGIN
  SELECT p.org_id INTO v_org FROM public.products p WHERE p.id = p_product_id;
  IF v_org IS NULL OR auth.uid() IS NULL OR NOT public.is_org_member(v_org, auth.uid()) THEN
    RAISE EXCEPTION 'Producto inexistente' USING ERRCODE = '42501';
  END IF;
  PERFORM public.exigir_permiso(v_org, 'products', 'edit', 'editar el SEO de un producto');

  IF v_titulo IS NULL AND v_descripcion IS NULL THEN
    DELETE FROM public.product_seo WHERE product_id = p_product_id;
    RETURN jsonb_build_object('ok', true, 'titulo', NULL, 'descripcion', NULL);
  END IF;
  INSERT INTO public.product_seo (product_id, org_id, titulo, descripcion, origen, import_session_id, updated_by, updated_at)
  VALUES (p_product_id, v_org, v_titulo, v_descripcion, 'manual', NULL, auth.uid(), now())
  ON CONFLICT (product_id) DO UPDATE SET
    titulo = EXCLUDED.titulo, descripcion = EXCLUDED.descripcion, origen = 'manual',
    import_session_id = NULL, updated_by = EXCLUDED.updated_by, updated_at = now();
  RETURN jsonb_build_object('ok', true, 'titulo', v_titulo, 'descripcion', v_descripcion);
END;
$fn$;
REVOKE ALL ON FUNCTION public.guardar_seo_producto(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guardar_seo_producto(uuid, text, text) TO authenticated;

-- ── Lo trae la importación ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.registrar_seo_importado(p_session_id uuid, p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_sesion public.catalog_import_sessions%ROWTYPE;
  v_item jsonb;
  v_producto uuid;
  v_titulo text;
  v_descripcion text;
  v_guardados integer := 0;
  v_omitidos integer := 0;
BEGIN
  SELECT * INTO v_sesion FROM public.catalog_import_sessions WHERE id = p_session_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Importación inexistente' USING ERRCODE = '22023'; END IF;
  IF auth.uid() IS NULL OR NOT public.has_org_role(v_sesion.org_id, auth.uid(), ARRAY['owner', 'admin']) THEN
    RAISE EXCEPTION 'Sólo owner o admin puede registrar el SEO de una importación' USING ERRCODE = '42501';
  END IF;
  IF v_sesion.status <> 'completed' OR v_sesion.deshecha_at IS NOT NULL THEN
    RAISE EXCEPTION 'El SEO se registra al terminar la importación' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) > 1000 THEN
    RAISE EXCEPTION 'Hasta 1000 productos por vez' USING ERRCODE = '22023';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_titulo := public.texto_seo(v_item->>'titulo', 120);
    v_descripcion := public.texto_seo(v_item->>'descripcion', 400);
    v_producto := NULL;
    SELECT i.product_id INTO v_producto FROM public.catalog_import_identities i
     WHERE i.org_id = v_sesion.org_id AND i.source_system = v_sesion.source_system
       AND i.entity_type = 'product' AND i.external_key = left(btrim(COALESCE(v_item->>'external_key', '')), 500);
    IF v_producto IS NULL OR (v_titulo IS NULL AND v_descripcion IS NULL) THEN
      v_omitidos := v_omitidos + 1;
      CONTINUE;
    END IF;
    INSERT INTO public.product_seo (product_id, org_id, titulo, descripcion, origen, import_session_id, updated_by, updated_at)
    VALUES (v_producto, v_sesion.org_id, v_titulo, v_descripcion, 'importado', p_session_id, auth.uid(), now())
    ON CONFLICT (product_id) DO UPDATE SET
      titulo = EXCLUDED.titulo, descripcion = EXCLUDED.descripcion,
      import_session_id = EXCLUDED.import_session_id, updated_by = EXCLUDED.updated_by, updated_at = now()
    -- Lo que el comercio cargó a mano manda.
    WHERE public.product_seo.origen = 'importado';
    IF FOUND THEN v_guardados := v_guardados + 1; ELSE v_omitidos := v_omitidos + 1; END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'guardados', v_guardados, 'omitidos', v_omitidos);
END;
$fn$;
REVOKE ALL ON FUNCTION public.registrar_seo_importado(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_seo_importado(uuid, jsonb) TO authenticated;

-- Deshacer la importación (20261030000300) también se lleva su SEO.
CREATE OR REPLACE FUNCTION public.trg_sesion_deshecha_borra_seo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF NEW.deshecha_at IS NOT NULL AND OLD.deshecha_at IS NULL THEN
    DELETE FROM public.product_seo WHERE import_session_id = NEW.id AND origen = 'importado';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.trg_sesion_deshecha_borra_seo() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_sesion_deshecha_borra_seo ON public.catalog_import_sessions;
CREATE TRIGGER trg_sesion_deshecha_borra_seo
  AFTER UPDATE OF deshecha_at ON public.catalog_import_sessions
  FOR EACH ROW EXECUTE FUNCTION public.trg_sesion_deshecha_borra_seo();

-- ── Lo lee el HTML para buscadores ──────────────────────────────────────
-- Misma regla de visibilidad que el catálogo público (get_store_catalog_products).
CREATE OR REPLACE FUNCTION public.get_store_product_seo(p_slug text, p_product_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT jsonb_build_object('titulo', seo.titulo, 'descripcion', seo.descripcion)
    FROM public.ecommerce_stores store
    JOIN public.products product ON product.org_id = store.org_id AND product.id = p_product_id
    JOIN public.product_seo seo ON seo.product_id = product.id
    LEFT JOIN public.store_product_publications publication
      ON publication.store_id = store.id AND publication.product_id = product.id
   WHERE lower(store.slug) = lower(btrim(p_slug))
     AND store.is_active
     AND COALESCE(product.is_active, true)
     AND COALESCE(publication.visibility, 'published') = 'published'
   LIMIT 1;
$fn$;
REVOKE ALL ON FUNCTION public.get_store_product_seo(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_store_product_seo(text, uuid) TO anon, authenticated;

WITH c(function_name, audience, rationale) AS (VALUES
  ('guardar_seo_producto', 'authenticated_delegate', 'El comercio edita título y descripción para buscadores de un producto; permiso de editar productos.'),
  ('registrar_seo_importado', 'authenticated_delegate', 'Owner/admin registra el SEO de su importación terminada; ubica por identidad de origen y no pisa lo manual.'),
  ('trg_sesion_deshecha_borra_seo', 'security_helper', 'Trigger: al deshacer una importación borra el SEO que trajo.'),
  ('get_store_product_seo', 'public_storefront', 'Devuelve título y descripción SEO de un producto publicado en una tienda activa; lo mismo que ya ve un buscador.')
)
INSERT INTO public.security_function_contracts(function_name, identity_arguments, audience, rationale, definition_hash, reviewed_on)
SELECT p.proname, pg_get_function_identity_arguments(p.oid), c.audience, c.rationale, md5(pg_get_functiondef(p.oid)), DATE '2026-10-30'
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN c ON c.function_name = p.proname
 WHERE n.nspname = 'public'
ON CONFLICT (function_name, identity_arguments) DO UPDATE
  SET audience = EXCLUDED.audience, rationale = EXCLUDED.rationale,
      definition_hash = EXCLUDED.definition_hash, reviewed_on = EXCLUDED.reviewed_on;

COMMIT;
