-- Categorías propias de cada tienda.
--
-- Hasta acá el nombre de una categoría salía de un `Record` hardcodeado en
-- `supabaseStore.ts` con cuatro entradas: perfume_arabe, perfume_diseñador,
-- vaper, electronico. En una plataforma multi-tenant eso significa que **el
-- que venda ropa recibe "Perfume Árabe"** o, en el mejor caso, el slug crudo,
-- y que nadie puede renombrar, ordenar, esconder ni ponerle una foto a una
-- categoría sin tocar el código.
--
-- La tabla `ecommerce_categories` ya existía con la forma correcta —org_id,
-- store_id, name, slug, parent_id, image_url, description, sort_order,
-- is_active— y estaba **vacía y sin usar por ningún código**. Es el mismo caso
-- que el stock por sucursal en la sesión 92: la estructura estaba, faltaba
-- conectarla.
--
-- ── Qué NO cambia ────────────────────────────────────────────────────────
--
-- `products.category` sigue guardando el slug y sigue siendo la columna que
-- usan el POS, los precios por categoría y las ofertas masivas. Esta migración
-- no la toca: agrega la tabla que le da **nombre, orden y presentación** a ese
-- slug. Cambiar la columna habría obligado a migrar seis pantallas a la vez y a
-- reescribir `category_pricing`, que se indexa por slug.
--
-- Por eso el seed toma los slugs que la organización ya tiene en sus productos
-- en vez de inventar un árbol: lo que se ve en la tienda no cambia el día que
-- se aplica, y a partir de ahí el comercio puede editarlo.
--
-- Idempotente.

ALTER TABLE public.ecommerce_categories ENABLE ROW LEVEL SECURITY;

-- Los miembros ven las suyas; escriben los que pueden tocar el catálogo.
DROP POLICY IF EXISTS "ecommerce_categories_org_select" ON public.ecommerce_categories;
CREATE POLICY "ecommerce_categories_org_select" ON public.ecommerce_categories
  FOR SELECT USING (public.is_org_member(org_id, auth.uid()));

DROP POLICY IF EXISTS "ecommerce_categories_org_write" ON public.ecommerce_categories;
CREATE POLICY "ecommerce_categories_org_write" ON public.ecommerce_categories
  FOR ALL USING (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin','manager']))
  WITH CHECK (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin','manager']));

-- Un slug no se puede repetir dentro de la misma organización: es la clave con
-- la que `products.category` apunta acá.
CREATE UNIQUE INDEX IF NOT EXISTS ecommerce_categories_org_slug_idx
  ON public.ecommerce_categories(org_id, slug);

CREATE INDEX IF NOT EXISTS ecommerce_categories_orden_idx
  ON public.ecommerce_categories(org_id, sort_order, name);

-- ── Lectura pública ───────────────────────────────────────────────────────
-- Devuelve además cuántos productos publicados tiene cada una: una categoría
-- vacía en el menú es un callejón sin salida, y la tienda decide no mostrarla.
--
-- El `DROP` es necesario porque cambia el tipo de retorno, y es seguro: la
-- versión anterior venía del andamiaje inicial de los RPC públicos, **no la
-- llamaba ningún código** (verificado con grep sobre src, api y las edge
-- functions) y la tabla estaba vacía. Sin ese chequeo previo, dropear un RPC
-- público sería exactamente el tipo de cambio que rompe la tienda en silencio.
--
-- El otro cambio es el JOIN: antes ataba la categoría a `store_id` y ahora a
-- `org_id`. Es el grano correcto, porque `products` tiene `org_id` y no
-- `store_id`: con el JOIN viejo, una categoría cuyo `store_id` no coincidiera
-- —o quedara en NULL— desaparecía del menú aunque tuviera productos.
DROP FUNCTION IF EXISTS public.get_store_categories(text);

CREATE OR REPLACE FUNCTION public.get_store_categories(p_slug text)
RETURNS TABLE (
  id          uuid,
  name        text,
  slug        text,
  parent_id   uuid,
  image_url   text,
  description text,
  sort_order  int,
  productos   bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT c.id, c.name, c.slug, c.parent_id, c.image_url, c.description,
         COALESCE(c.sort_order, 0),
         (SELECT count(*) FROM public.products p
           WHERE p.org_id = c.org_id AND p.category = c.slug AND p.is_active)
  FROM public.ecommerce_categories c
  JOIN public.ecommerce_stores s ON s.org_id = c.org_id
  WHERE lower(s.slug) = lower(p_slug)
    AND s.is_active
    AND c.is_active
  ORDER BY COALESCE(c.sort_order, 0), c.name;
$$;

REVOKE ALL ON FUNCTION public.get_store_categories(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_store_categories(text) TO anon, authenticated;

-- ── Crear las categorías a partir de los productos ────────────────────────
-- Sin esto, estrenar la pantalla arranca con una lista vacía mientras la
-- tienda ya tiene productos categorizados, y hay que tipear lo que la base ya
-- sabe. Nunca pisa una categoría existente.
CREATE OR REPLACE FUNCTION public.seed_store_categories(p_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_store uuid;
  v_creadas int := 0;
  v_r record;
  v_nombre text;
  -- Los cuatro nombres que hasta ahora vivían en `getCategoryLabel`. Se
  -- guardan como dato una sola vez, al sembrar; de ahí en más los edita el
  -- comercio y el código no vuelve a opinar.
  v_conocidos jsonb := jsonb_build_object(
    'perfume_arabe',      'Perfume Árabe',
    'perfume_diseñador',  'Perfume Diseñador',
    'vaper',              'Vaper',
    'electronico',        'Electrónico'
  );
BEGIN
  IF NOT public.has_org_role(p_org_id, auth.uid(), ARRAY['owner','admin','manager']) THEN
    RAISE EXCEPTION 'No tenés permiso para editar el catálogo';
  END IF;

  SELECT id INTO v_store FROM public.ecommerce_stores
   WHERE org_id = p_org_id ORDER BY created_at LIMIT 1;

  FOR v_r IN
    SELECT p.category AS slug, count(*) AS n
    FROM public.products p
    WHERE p.org_id = p_org_id
      AND p.category IS NOT NULL AND btrim(p.category) <> ''
    GROUP BY p.category
    ORDER BY count(*) DESC
  LOOP
    -- Un slug desconocido se muestra legible en vez de crudo: guiones bajos a
    -- espacios y la primera en mayúscula. Es un punto de partida editable, no
    -- una traducción.
    v_nombre := COALESCE(
      v_conocidos->>v_r.slug,
      initcap(replace(v_r.slug, '_', ' '))
    );

    INSERT INTO public.ecommerce_categories (
      org_id, store_id, name, slug, sort_order, is_active
    ) VALUES (
      p_org_id, v_store, v_nombre, v_r.slug, v_creadas, true
    )
    ON CONFLICT (org_id, slug) DO NOTHING;

    IF FOUND THEN v_creadas := v_creadas + 1; END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'creadas', v_creadas);
END;
$$;

REVOKE ALL ON FUNCTION public.seed_store_categories(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.seed_store_categories(uuid) TO authenticated;

COMMENT ON TABLE public.ecommerce_categories IS
  'Categorías de la tienda, propias de cada organización. `slug` es lo que '
  'guarda products.category. Antes los nombres estaban hardcodeados en '
  'getCategoryLabel y sólo servían para perfumería.';
