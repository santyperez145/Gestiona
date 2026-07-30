-- Banners de la home de la tienda.
--
-- Hasta ahora había un solo `ecommerce_stores.banner_url`: una imagen de fondo
-- al 25% de opacidad, sin enlace y sin fecha. Con eso no se puede anunciar una
-- promo, ni llevar a una categoría, ni programar el banner del Hot Sale para
-- que se apague solo.
--
-- Idempotente.

CREATE TABLE IF NOT EXISTS public.store_banners (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.organizations(id)    ON DELETE CASCADE,
  store_id    uuid NOT NULL REFERENCES public.ecommerce_stores(id) ON DELETE CASCADE,
  image_url   text NOT NULL,
  -- Imagen alternativa para celular: un banner apaisado recortado a 375px
  -- deja el texto afuera. Si falta, se usa la de escritorio.
  image_url_mobile text,
  title       text,
  subtitle    text,
  -- Adónde lleva. Relativo a la tienda (`/productos?cat=perfume_arabe`) o
  -- absoluto. Sin link el banner es sólo decoración.
  link_url    text,
  cta_label   text,
  -- Obligatorio para accesibilidad y para que Google entienda la imagen.
  alt_text    text,
  sort_order  int  NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,
  -- Vigencia opcional: el banner del Hot Sale se apaga solo.
  starts_at   timestamptz,
  ends_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS store_banners_store_idx
  ON public.store_banners(store_id, is_active, sort_order);

ALTER TABLE public.store_banners ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "store_banners_org_select" ON public.store_banners;
CREATE POLICY "store_banners_org_select" ON public.store_banners
  FOR SELECT USING (public.is_org_member(org_id, auth.uid()));

DROP POLICY IF EXISTS "store_banners_org_write" ON public.store_banners;
CREATE POLICY "store_banners_org_write" ON public.store_banners
  FOR ALL USING (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin']))
  WITH CHECK (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin']));

-- ── Lectura pública ───────────────────────────────────────────────────────
-- La vigencia se resuelve en el servidor: si la decidiera el cliente, un reloj
-- adelantado mostraría la promo antes de tiempo.
CREATE OR REPLACE FUNCTION public.get_store_banners(p_slug text)
RETURNS TABLE (
  id               uuid,
  image_url        text,
  image_url_mobile text,
  title            text,
  subtitle         text,
  link_url         text,
  cta_label        text,
  alt_text         text,
  sort_order       int
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT b.id, b.image_url, b.image_url_mobile, b.title, b.subtitle,
         b.link_url, b.cta_label, b.alt_text, b.sort_order
  FROM public.store_banners b
  JOIN public.ecommerce_stores s ON s.id = b.store_id
  WHERE lower(s.slug) = lower(p_slug)
    AND s.is_active
    AND b.is_active
    AND (b.starts_at IS NULL OR b.starts_at <= now())
    AND (b.ends_at   IS NULL OR b.ends_at   >  now())
  ORDER BY b.sort_order, b.created_at;
$$;

REVOKE ALL  ON FUNCTION public.get_store_banners(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_store_banners(text) TO anon, authenticated;
