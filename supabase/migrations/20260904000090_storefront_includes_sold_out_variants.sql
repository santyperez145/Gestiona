-- D5.28 — La ficha pública necesita conocer las variantes activas agotadas.
--
-- `get_store_variants` filtraba `v.stock > 0`. Eso impedía mostrar la
-- combinación como agotada y, sobre todo, asociar el aviso de reposición al
-- `variant_id` exacto. Exponerla no habilita su compra: `resolve_store_line`
-- vuelve a validar el saldo bajo lock en el camino canónico de la orden.
--
-- La superficie sigue saneada: sólo identidad comercial, precio público,
-- imagen, SKU y stock. No expone costo, margen, proveedor ni organización.

CREATE OR REPLACE FUNCTION public.get_store_variants(p_slug text)
RETURNS TABLE (
  id             uuid,
  product_id     uuid,
  variant_name   text,
  variant_type   text,
  stock          int,
  price_override numeric,
  image_url      text,
  sku            text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT v.id, v.product_id, v.variant_name, v.variant_type,
         v.stock, v.price_override, v.image_url, v.sku
  FROM public.product_variants v
  JOIN public.ecommerce_stores s ON s.org_id = v.org_id
  WHERE lower(s.slug) = lower(p_slug)
    AND s.is_active
    AND v.active
  ORDER BY v.product_id, (v.stock > 0) DESC, v.variant_name;
$$;

REVOKE ALL ON FUNCTION public.get_store_variants(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_store_variants(text) TO anon, authenticated;

COMMENT ON FUNCTION public.get_store_variants(text) IS
  'Catálogo público saneado de variantes activas, incluidas las agotadas para selección y alerta exacta. Comprar siempre revalida stock en servidor.';
