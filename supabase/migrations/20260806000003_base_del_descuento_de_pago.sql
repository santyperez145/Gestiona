-- La base del descuento por medio de pago, resuelta en la vista.
--
-- La tienda necesita saber sobre qué precio se aplica el descuento del medio de
-- pago, y esa decisión cruza products.offer_stacks_payment con
-- ecommerce_stores.payment_discount_stacks.
--
-- Se resuelve acá y no en el cliente: así el storefront muestra un precio sin
-- conocer la política ni cruzar dos tablas, y la regla queda en un solo lugar
-- junto a la que usa create_store_order al cobrar. Si divergieran, el comprador
-- ve un precio y se le cobra otro, que es el peor de los bugs de esta pantalla.
--
-- La columna va **al final**: CREATE OR REPLACE VIEW no deja insertarla en el
-- medio (42P16, renombraría las que siguen), y además agregar al final no toca
-- a nadie que lea por nombre de campo.
--
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
      WHEN COALESCE(p.offer_stacks_payment, es.payment_discount_stacks, false)
        THEN COALESCE(NULLIF(p.discount_price_ars, 0), p.sale_price_ars)
      ELSE p.sale_price_ars
    END AS payment_base_price
   FROM products p
     LEFT JOIN settings s ON s.org_id = p.org_id
     LEFT JOIN ecommerce_stores es ON es.org_id = p.org_id
  WHERE COALESCE(p.sale_price_ars, 0::numeric) > 0::numeric AND COALESCE(p.is_active, true) = true;
