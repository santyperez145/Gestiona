-- La tienda online muestra también lo agotado.
--
-- `catalog_products` filtra `stock > 0`. Para el catálogo por WhatsApp está
-- bien: es una lista que se manda para comprar ahora. Para la tienda online no:
-- la ficha del agotado tiene su URL indexada, junta demanda y ofrece el aviso
-- de reposición. Escondiéndola se pierden la visita, el lugar en Google y la
-- señal de qué reponer.
--
-- Se crea una vista hermana en vez de tocar `catalog_products`: esa vista la
-- leen el catálogo por WhatsApp y la página pública, y cambiarle el filtro por
-- abajo es exactamente el incidente que ya pasó una vez.
--
-- Mismas columnas y mismos cálculos de decant que `catalog_products`; lo único
-- que cambia es que no exige stock. Si se toca una, hay que tocar la otra.
--
-- Idempotente.

DROP VIEW IF EXISTS public.store_catalog_products;

CREATE VIEW public.store_catalog_products AS
SELECT
  p.id, p.org_id, p.user_id, p.name, p.brand, p.category, p.gender,
  p.description, p.image_url, p.image_urls,
  p.sale_price_ars, p.discount_price_ars, p.price_2x_ars,
  p.stock, p.content_ml, p.total_sold, p.featured, p.offer_expires_at,
  p.created_at,
  CASE WHEN COALESCE(p.content_ml, 0) > 0
    THEN round(COALESCE(p.total_cost_usd, p.cost_usd, 0::numeric) / p.content_ml::numeric * 10::numeric
               * COALESCE(s.exchange_rate, 0::numeric)
               * (1::numeric + COALESCE(s.decant_margin_10ml, 250::numeric) / 100.0))
    ELSE NULL::numeric END AS decant_price_10ml,
  CASE WHEN COALESCE(p.content_ml, 0) > 0
    THEN round(COALESCE(p.total_cost_usd, p.cost_usd, 0::numeric) / p.content_ml::numeric * 5::numeric
               * COALESCE(s.exchange_rate, 0::numeric)
               * (1::numeric + COALESCE(s.decant_margin_5ml, 350::numeric) / 100.0))
    ELSE NULL::numeric END AS decant_price_5ml,
  CASE WHEN COALESCE(p.content_ml, 0) > 0
    THEN round(COALESCE(p.total_cost_usd, p.cost_usd, 0::numeric) / p.content_ml::numeric * 2.5
               * COALESCE(s.exchange_rate, 0::numeric)
               * (1::numeric + COALESCE(s.decant_margin_2_5ml, 500::numeric) / 100.0))
    ELSE NULL::numeric END AS decant_price_2_5ml
FROM public.products p
LEFT JOIN public.settings s ON s.org_id = p.org_id
WHERE COALESCE(p.sale_price_ars, 0::numeric) > 0::numeric
  AND COALESCE(p.is_active, true) = true;

-- `security_invoker` NO: los datos ya vienen saneados (sin costos ni márgenes)
-- y quien lee es el comprador anónimo, que no tiene fila en ninguna política.
-- Con invoker la vista devolvería siempre vacío — ya pasó con las de estado de
-- conexión.
ALTER VIEW public.store_catalog_products SET (security_invoker = false);

REVOKE ALL   ON public.store_catalog_products FROM PUBLIC;
GRANT SELECT ON public.store_catalog_products TO anon, authenticated;
