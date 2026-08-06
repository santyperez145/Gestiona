-- El precio de promocion, visible para la tienda.
--
-- Sin esta columna el storefront mostraria el precio de oferta mientras el
-- checkout cobra el de promocion: el comprador ve un numero y paga otro, que es
-- el peor bug de esta pantalla.
--
-- Va al final: CREATE OR REPLACE VIEW no deja insertar en el medio (42P16).
-- Idempotente.

CREATE OR REPLACE VIEW public.store_catalog_products AS
 SELECT p.id,
    p.org_id,
    p.user_id,
    p.name,
    p.brand,
    p.category,
    p.gender,
    p.description,
    p.image_url,
    p.image_urls,
    p.sale_price_ars,
    p.discount_price_ars,
    p.price_2x_ars,
    p.stock,
    p.content_ml,
    p.total_sold,
    p.featured,
    p.offer_expires_at,
    p.created_at,
        CASE
            WHEN COALESCE(p.content_ml, 0) > 0 THEN round(COALESCE(p.total_cost_usd, p.cost_usd, 0::numeric) / p.content_ml::numeric * 10::numeric * COALESCE(s.exchange_rate, 0::numeric) * (1::numeric + COALESCE(s.decant_margin_10ml, 250::numeric) / 100.0))
            ELSE NULL::numeric
        END AS decant_price_10ml,
        CASE
            WHEN COALESCE(p.content_ml, 0) > 0 THEN round(COALESCE(p.total_cost_usd, p.cost_usd, 0::numeric) / p.content_ml::numeric * 5::numeric * COALESCE(s.exchange_rate, 0::numeric) * (1::numeric + COALESCE(s.decant_margin_5ml, 350::numeric) / 100.0))
            ELSE NULL::numeric
        END AS decant_price_5ml,
        CASE
            WHEN COALESCE(p.content_ml, 0) > 0 THEN round(COALESCE(p.total_cost_usd, p.cost_usd, 0::numeric) / p.content_ml::numeric * 2.5 * COALESCE(s.exchange_rate, 0::numeric) * (1::numeric + COALESCE(s.decant_margin_2_5ml, 500::numeric) / 100.0))
            ELSE NULL::numeric
        END AS decant_price_2_5ml,
        CASE
            WHEN COALESCE(p.offer_stacks_payment, es.payment_discount_stacks, false) THEN COALESCE(NULLIF(p.discount_price_ars, 0::numeric), p.sale_price_ars)
            ELSE p.sale_price_ars
        END AS payment_base_price,
    -- Mejor precio de promocion auto-aplicable, o NULL si ninguna aplica.
    -- Se resuelve aca para que la tienda muestre el mismo precio que cobra
    -- create_store_order, sin tener que leer promotions ni repetir las reglas.
    public.store_promo_price(p.org_id, p.id, p.category, p.sale_price_ars) AS promo_price
   FROM products p
     LEFT JOIN settings s ON s.org_id = p.org_id
     LEFT JOIN ecommerce_stores es ON es.org_id = p.org_id
  WHERE COALESCE(p.sale_price_ars, 0::numeric) > 0::numeric AND COALESCE(p.is_active, true) = true;
