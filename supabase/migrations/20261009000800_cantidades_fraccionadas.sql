-- Cantidades fraccionadas: vender por kilo, metro, litro o m².
--
-- Una ferretería vende cable por metro y clavos por kilo; el stock era entero
-- en todo el libro. Cada producto declara `unidad_medida` ('unidad' por
-- defecto). Las cantidades de stock/Kardex/ventas/compras/devoluciones/
-- reservas/transferencias pasan a numeric(14,3) y `record_stock_movement`
-- —la autoridad del stock— sólo acepta fracciones para productos con medida:
-- un producto por unidad conserva exactamente la semántica entera anterior.
--
-- Generada desde el estado vivo el 2026-10-09: las vistas dependientes,
-- triggers y funciones se recrean con su definición, opciones, comentarios y
-- permisos exactos (revocando los permisos por defecto de Supabase).
-- Tienda online y API pública siguen operando en unidades enteras.

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS unidad_medida text NOT NULL DEFAULT 'unidad';
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_unidad_medida_valida;
ALTER TABLE public.products ADD CONSTRAINT products_unidad_medida_valida
  CHECK (unidad_medida IN ('unidad', 'kg', 'metro', 'litro', 'm2'));

-- Objetos que dependen de las columnas: se guardan y se recrean idénticos.
DROP FUNCTION public.get_store_catalog_products(text);
DROP TRIGGER trg_notify_low_stock ON public.products;
DROP TRIGGER trg_sale_stock_movement ON public.sales;
DROP VIEW public.sale_margin_operations;
DROP VIEW public._sale_margin_operations_effective;
DROP VIEW public.organization_margin_coverage;
DROP VIEW public.sale_margin_dimensions;
DROP VIEW public._sale_margin_operations_source;
DROP VIEW public.platform_org_margin_coverage;
DROP VIEW public.sale_margin_facts;
DROP VIEW public._sale_margin_facts_effective;
DROP VIEW public.platform_activation_cohorts;
DROP VIEW public._sale_margin_facts_source;
DROP VIEW public.catalog_product_variants;
DROP VIEW public.platform_activation_cohort_members;
DROP VIEW public.products_public;
DROP VIEW public.traza_de_pago;
DROP VIEW public.catalog_products;
DROP VIEW public.inventory_capital_items;
DROP VIEW public.kardex_contra_stock;
DROP VIEW public.kardex_summary;
DROP VIEW public.organization_activation_readiness;
DROP VIEW public.payment_operation_trace;
DROP VIEW public.platform_org_stock_accuracy;
DROP VIEW public.product_availability;
DROP VIEW public.sale_items;
DROP VIEW public.sales_return_operations;
DROP VIEW public.stock_a_reponer;
DROP VIEW public.stock_comprometido;
DROP VIEW public.stock_inmovilizado;
DROP VIEW public.stock_negativo;
DROP VIEW public.stock_sin_ubicar;
DROP VIEW public.stock_sucursal_descuadrado;
DROP VIEW public.store_catalog_products;
DROP VIEW public.store_order_margin_facts;
DROP VIEW public.ubicaciones_descuadradas;

ALTER TABLE public.products ALTER COLUMN stock TYPE numeric(14,3) USING stock::numeric(14,3);
ALTER TABLE public.product_variants ALTER COLUMN stock TYPE numeric(14,3) USING stock::numeric(14,3);
ALTER TABLE public.location_stock ALTER COLUMN stock TYPE numeric(14,3) USING stock::numeric(14,3);
ALTER TABLE public.location_variant_stock ALTER COLUMN stock TYPE numeric(14,3) USING stock::numeric(14,3);
ALTER TABLE public.stock_movements ALTER COLUMN quantity TYPE numeric(14,3) USING quantity::numeric(14,3);
ALTER TABLE public.stock_movements ALTER COLUMN stock_before TYPE numeric(14,3) USING stock_before::numeric(14,3);
ALTER TABLE public.stock_movements ALTER COLUMN stock_after TYPE numeric(14,3) USING stock_after::numeric(14,3);
ALTER TABLE public.stock_movements ALTER COLUMN previous_stock TYPE numeric(14,3) USING previous_stock::numeric(14,3);
ALTER TABLE public.stock_movements ALTER COLUMN new_stock TYPE numeric(14,3) USING new_stock::numeric(14,3);
ALTER TABLE public.stock_history ALTER COLUMN new_stock TYPE numeric(14,3) USING new_stock::numeric(14,3);
ALTER TABLE public.sales ALTER COLUMN quantity TYPE numeric(14,3) USING quantity::numeric(14,3);
ALTER TABLE public.sales ALTER COLUMN returned_quantity TYPE numeric(14,3) USING returned_quantity::numeric(14,3);
ALTER TABLE public.returns ALTER COLUMN quantity TYPE numeric(14,3) USING quantity::numeric(14,3);
ALTER TABLE public.purchases ALTER COLUMN quantity TYPE numeric(14,3) USING quantity::numeric(14,3);
ALTER TABLE public.stock_reservations ALTER COLUMN quantity TYPE numeric(14,3) USING quantity::numeric(14,3);
ALTER TABLE public.stock_transfers ALTER COLUMN quantity TYPE numeric(14,3) USING quantity::numeric(14,3);
ALTER TABLE public.inventory_transfer_items ALTER COLUMN quantity_sent TYPE numeric(14,3) USING quantity_sent::numeric(14,3);
ALTER TABLE public.inventory_transfer_items ALTER COLUMN quantity_received TYPE numeric(14,3) USING quantity_received::numeric(14,3);
ALTER TABLE public.product_import_rows ALTER COLUMN stock_before TYPE numeric(14,3) USING stock_before::numeric(14,3);
ALTER TABLE public.product_import_rows ALTER COLUMN stock_after TYPE numeric(14,3) USING stock_after::numeric(14,3);

CREATE VIEW public.catalog_products AS
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
        END AS decant_price_2_5ml
   FROM products p
     LEFT JOIN settings s ON s.org_id = p.org_id
  WHERE p.stock > 0 AND COALESCE(p.sale_price_ars, 0::numeric) > 0::numeric AND COALESCE(p.is_active, true) = true;
REVOKE ALL ON public.catalog_products FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.catalog_products TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.catalog_products TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.catalog_products TO service_role;
COMMENT ON VIEW public.catalog_products IS 'Catálogo público. NUNCA agregar columnas de costo (cost_usd, total_cost_usd, customs_fee, profit_per_unit_*): los decants ya vienen calculados justamente para no tener que exponerlas.';

CREATE VIEW public.inventory_capital_items WITH (security_barrier=true) AS
 WITH items AS MATERIALIZED (
         SELECT p.org_id,
            p.id AS product_id,
            NULL::uuid AS variant_id,
            p.name AS product_name,
            NULL::text AS variant_name,
            p.sku,
            p.stock,
            false AS variant_gap
           FROM products p
          WHERE COALESCE(p.maneja_stock, true) AND is_org_member(p.org_id, auth.uid()) AND has_permission(p.org_id, 'inventory'::text, 'view'::text) AND has_permission(p.org_id, 'analytics'::text, 'view'::text) AND NOT (EXISTS ( SELECT 1
                   FROM product_variants v_1
                  WHERE v_1.product_id = p.id AND v_1.org_id = p.org_id))
        UNION ALL
         SELECT p.org_id,
            p.id,
            v_1.id,
            p.name,
            v_1.variant_name,
            v_1.sku,
            v_1.stock,
            p.stock IS DISTINCT FROM (( SELECT sum(v2.stock) AS sum
                   FROM product_variants v2
                  WHERE v2.product_id = p.id AND v2.org_id = p.org_id)) OR (EXISTS ( SELECT 1
                   FROM stock_movements m
                  WHERE m.org_id = p.org_id AND m.product_id = p.id AND m.variant_id IS NULL AND m.quantity <> 0))
           FROM products p
             JOIN product_variants v_1 ON v_1.product_id = p.id AND v_1.org_id = p.org_id
          WHERE COALESCE(p.maneja_stock, true) AND is_org_member(p.org_id, auth.uid()) AND has_permission(p.org_id, 'inventory'::text, 'view'::text) AND has_permission(p.org_id, 'analytics'::text, 'view'::text)
        ), raw AS MATERIALIZED (
         SELECT m.id,
            m.org_id,
            m.product_id,
            m.variant_id,
            m.product_name,
            m.variant_name,
            m.movement_type,
            m.quantity,
            m.stock_before,
            m.stock_after,
            m.reference_type,
            m.reference_id,
            m.unit_cost_usd,
            m.unit_price_ars,
            m.notes,
            m.created_by,
            m.created_at,
            m.source_type,
            m.source_id,
            m.previous_stock,
            m.new_stock,
            m.note,
            m.location_id,
            m.unit_cost_ars
           FROM stock_movements m
             JOIN items i ON i.org_id = m.org_id AND i.product_id = m.product_id AND NOT i.variant_id IS DISTINCT FROM m.variant_id
        ), transfers AS (
         SELECT raw.org_id,
            raw.product_id,
            raw.variant_id,
            raw.created_at,
            sum(raw.quantity) <> 0 OR count(*) FILTER (WHERE raw.movement_type = 'transfer_in'::text) <> count(*) FILTER (WHERE raw.movement_type = 'transfer_out'::text) AS invalid
           FROM raw
          WHERE raw.movement_type = ANY (ARRAY['transfer_in'::text, 'transfer_out'::text])
          GROUP BY raw.org_id, raw.product_id, raw.variant_id, raw.created_at
        ), ordered AS MATERIALIZED (
         SELECT m.id,
            m.org_id,
            m.product_id,
            m.variant_id,
            m.product_name,
            m.variant_name,
            m.movement_type,
            m.quantity,
            m.stock_before,
            m.stock_after,
            m.reference_type,
            m.reference_id,
            m.unit_cost_usd,
            m.unit_price_ars,
            m.notes,
            m.created_by,
            m.created_at,
            m.source_type,
            m.source_id,
            m.previous_stock,
            m.new_stock,
            m.note,
            m.location_id,
            m.unit_cost_ars,
            row_number() OVER w AS "position",
            first_value(m.stock_before) OVER w AS opening,
            lag(m.stock_after) OVER w AS prior_after,
            count(*) OVER (PARTITION BY m.org_id, m.product_id, m.variant_id, m.created_at) AS simultaneous,
            sum(m.quantity) FILTER (WHERE m.quantity > 0) OVER w AS cumulative_in
           FROM raw m
          WHERE m.movement_type <> ALL (ARRAY['transfer_in'::text, 'transfer_out'::text])
          WINDOW w AS (PARTITION BY m.org_id, m.product_id, m.variant_id ORDER BY m.created_at, m.id ROWS UNBOUNDED PRECEDING)
        ), checks AS MATERIALIZED (
         SELECT i.org_id,
            i.product_id,
            i.variant_id,
            i.product_name,
            i.variant_name,
            i.sku,
            i.stock,
            i.variant_gap,
            COALESCE(max(m.opening), i.stock) AS opening,
            COALESCE(sum(m.quantity), 0::bigint) AS delta,
            COALESCE(- sum(m.quantity) FILTER (WHERE m.quantity < 0), 0::bigint) AS consumed,
            COALESCE(bool_or(m.simultaneous > 1), false) AS ambiguous,
            COALESCE(bool_or(m.stock_before < 0 OR m.stock_after < 0), false) AS negative_history,
            COALESCE(bool_or(m.stock_before IS NULL OR m.stock_after IS NULL OR m.stock_after <> (m.stock_before + m.quantity) OR m."position" > 1 AND m.stock_before IS DISTINCT FROM m.prior_after), false) AS broken_chain,
            (EXISTS ( SELECT 1
                   FROM transfers t
                  WHERE t.org_id = i.org_id AND t.product_id = i.product_id AND NOT t.variant_id IS DISTINCT FROM i.variant_id AND t.invalid)) AS broken_transfer
           FROM items i
             LEFT JOIN ordered m ON m.org_id = i.org_id AND m.product_id = i.product_id AND NOT m.variant_id IS DISTINCT FROM i.variant_id
          GROUP BY i.org_id, i.product_id, i.variant_id, i.product_name, i.variant_name, i.sku, i.stock, i.variant_gap
        ), classified AS MATERIALIZED (
         SELECT c.org_id,
            c.product_id,
            c.variant_id,
            c.product_name,
            c.variant_name,
            c.sku,
            c.stock,
            c.variant_gap,
            c.opening,
            c.delta,
            c.consumed,
            c.ambiguous,
            c.negative_history,
            c.broken_chain,
            c.broken_transfer,
            array_remove(ARRAY[
                CASE
                    WHEN c.stock IS NULL OR c.stock < 0 THEN 'negative_stock'::text
                    ELSE NULL::text
                END,
                CASE
                    WHEN c.variant_gap THEN 'variant_reconciliation'::text
                    ELSE NULL::text
                END,
                CASE
                    WHEN c.opening < 0 OR c.negative_history THEN 'negative_history'::text
                    ELSE NULL::text
                END,
                CASE
                    WHEN (c.opening + c.delta) IS DISTINCT FROM c.stock OR c.broken_chain THEN 'movement_reconciliation'::text
                    ELSE NULL::text
                END,
                CASE
                    WHEN c.ambiguous THEN 'movement_order'::text
                    ELSE NULL::text
                END,
                CASE
                    WHEN c.broken_transfer THEN 'transfer_reconciliation'::text
                    ELSE NULL::text
                END], NULL::text) AS blockers
           FROM checks c
        ), incoming AS (
         SELECT c.org_id,
            c.product_id,
            c.variant_id,
            NULL::uuid AS movement_id,
            NULL::timestamp with time zone AS received_at,
            'opening'::text AS source,
            c.opening AS units,
            NULL::numeric AS unit_cost_ars,
            c.opening::numeric AS cumulative_in
           FROM classified c
          WHERE c.opening > 0
        UNION ALL
         SELECT m.org_id,
            m.product_id,
            m.variant_id,
            m.id,
            m.created_at,
                CASE
                    WHEN (m.movement_type = ANY (ARRAY['purchase'::text, 'purchase_edited'::text, 'initial'::text, 'initial_stock'::text, 'manual_in'::text, 'adjustment_in'::text, 'import'::text])) AND m.unit_cost_ars > 0::numeric THEN 'movement_snapshot'::text
                    ELSE 'unverified_entry'::text
                END AS "case",
            m.quantity,
                CASE
                    WHEN (m.movement_type = ANY (ARRAY['purchase'::text, 'purchase_edited'::text, 'initial'::text, 'initial_stock'::text, 'manual_in'::text, 'adjustment_in'::text, 'import'::text])) AND m.unit_cost_ars > 0::numeric THEN m.unit_cost_ars
                    ELSE NULL::numeric
                END AS "case",
            m.opening + COALESCE(m.cumulative_in, 0::bigint)
           FROM ordered m
          WHERE m.quantity > 0
        ), remaining AS MATERIALIZED (
         SELECT incoming.org_id,
            incoming.product_id,
            incoming.variant_id,
            incoming.movement_id,
            incoming.received_at,
            incoming.source,
            incoming.units,
            incoming.unit_cost_ars,
            incoming.cumulative_in,
            LEAST(incoming.units::numeric, GREATEST(0::numeric, incoming.cumulative_in - c.consumed::numeric))::integer AS remaining_units
           FROM incoming
             JOIN classified c USING (org_id, product_id)
          WHERE NOT c.variant_id IS DISTINCT FROM incoming.variant_id AND cardinality(c.blockers) = 0
        ), valuation AS MATERIALIZED (
         SELECT c.org_id,
            c.product_id,
            c.variant_id,
            c.product_name,
            c.variant_name,
            c.sku,
            c.stock,
            c.variant_gap,
            c.opening,
            c.delta,
            c.consumed,
            c.ambiguous,
            c.negative_history,
            c.broken_chain,
            c.broken_transfer,
            c.blockers,
            COALESCE(sum(r.remaining_units) FILTER (WHERE r.unit_cost_ars IS NOT NULL), 0::bigint)::integer AS known_units,
            round(sum(r.remaining_units::numeric * r.unit_cost_ars) FILTER (WHERE r.unit_cost_ars IS NOT NULL), 2) AS measured_value_ars,
            COALESCE(jsonb_agg(jsonb_build_object('movementId', r.movement_id, 'receivedAt', r.received_at, 'source', r.source, 'remainingUnits', r.remaining_units, 'unitCostARS', r.unit_cost_ars, 'valueARS', round(r.remaining_units::numeric * r.unit_cost_ars, 2)) ORDER BY r.received_at NULLS FIRST, r.movement_id) FILTER (WHERE r.remaining_units > 0), '[]'::jsonb) AS layers
           FROM classified c
             LEFT JOIN remaining r ON r.org_id = c.org_id AND r.product_id = c.product_id AND NOT r.variant_id IS DISTINCT FROM c.variant_id AND r.remaining_units > 0
          GROUP BY c.org_id, c.product_id, c.variant_id, c.product_name, c.variant_name, c.sku, c.stock, c.variant_gap, c.opening, c.delta, c.consumed, c.ambiguous, c.negative_history, c.broken_chain, c.broken_transfer, c.blockers
        ), sales AS (
         SELECT s_1.org_id,
            s_1.product_id,
            s_1.variant_id,
            max(s_1.date) FILTER (WHERE s_1.quantity > s_1.returned_quantity AND s_1.date <= now()) AS last_sold_at,
            COALESCE(sum(s_1.quantity - s_1.returned_quantity) FILTER (WHERE s_1.date > (now() - '90 days'::interval) AND s_1.date <= now()), 0::bigint) AS sold_units_90
           FROM public.sales s_1
             JOIN items i ON i.org_id = s_1.org_id AND i.product_id = s_1.product_id AND NOT i.variant_id IS DISTINCT FROM s_1.variant_id
          GROUP BY s_1.org_id, s_1.product_id, s_1.variant_id
        )
 SELECT v.org_id,
    v.product_id,
    v.variant_id,
    v.product_name,
    v.variant_name,
    NULLIF(v.sku, ''::text) AS sku,
    v.stock AS stock_units,
    v.known_units,
        CASE
            WHEN v.stock > 0 THEN v.stock - v.known_units
            ELSE 0
        END AS unvalued_units,
        CASE
            WHEN v.stock = 0 AND cardinality(v.blockers) = 0 THEN 0::numeric
            ELSE v.measured_value_ars
        END AS measured_value_ars,
        CASE
            WHEN cardinality(v.blockers) = 0 AND v.stock = v.known_units THEN COALESCE(v.measured_value_ars, 0::numeric)
            ELSE NULL::numeric
        END AS value_ars,
        CASE
            WHEN v.stock > 0 THEN round(100.0 * v.known_units::numeric / v.stock::numeric, 1)
            ELSE NULL::numeric
        END AS coverage_pct,
    v.blockers ||
        CASE
            WHEN v.stock > v.known_units AND cardinality(v.blockers) = 0 THEN ARRAY['missing_cost'::text]
            ELSE ARRAY[]::text[]
        END AS reasons,
    v.layers,
    s.last_sold_at,
    COALESCE(s.sold_units_90, 0::bigint) AS sold_units_90,
        CASE
            WHEN s.last_sold_at IS NOT NULL THEN (now() AT TIME ZONE 'America/Argentina/Buenos_Aires'::text)::date - (s.last_sold_at AT TIME ZONE 'America/Argentina/Buenos_Aires'::text)::date
            ELSE NULL::integer
        END AS days_without_sale,
        CASE
            WHEN v.stock >= 0 AND s.sold_units_90 > 0 THEN round(v.stock::numeric * 90.0 / s.sold_units_90::numeric, 1)
            ELSE NULL::numeric
        END AS days_of_stock
   FROM valuation v
     LEFT JOIN sales s ON s.org_id = v.org_id AND s.product_id = v.product_id AND NOT s.variant_id IS DISTINCT FROM v.variant_id;
REVOKE ALL ON public.inventory_capital_items FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.inventory_capital_items TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.inventory_capital_items TO service_role;

CREATE VIEW public.kardex_contra_stock AS
 WITH ultimo AS (
         SELECT DISTINCT ON (m.product_id) m.product_id,
            m.stock_after,
            m.created_at
           FROM stock_movements m
          WHERE m.product_id IS NOT NULL
          ORDER BY m.product_id, m.created_at DESC, m.id DESC
        )
 SELECT p.org_id,
    p.id AS product_id,
    p.name AS producto,
    p.sku,
    u.stock_after AS kardex,
    p.stock AS stock_actual,
    p.stock - u.stock_after AS diferencia,
    round(abs(p.stock - u.stock_after)::numeric * COALESCE(p.sale_price_ars, 0::numeric), 2) AS impacto_ars,
    u.created_at AS ultimo_movimiento,
    u.stock_after < 0 AND p.stock >= 0 AS kardex_negativo
   FROM ultimo u
     JOIN products p ON p.id = u.product_id
  WHERE p.stock <> u.stock_after AND is_org_member(p.org_id, auth.uid());
REVOKE ALL ON public.kardex_contra_stock FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.kardex_contra_stock TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.kardex_contra_stock TO service_role;
COMMENT ON VIEW public.kardex_contra_stock IS 'Productos donde el Kardex y el stock actual no coinciden, ordenables por impacto en pesos. NO corrige: dice que contar primero. El ajuste sale de cerrar_conteo, que deja asiento.';

CREATE VIEW public.kardex_summary AS
 SELECT sm.org_id,
    sm.product_id,
    sm.product_name,
    p.stock AS current_stock,
    count(*) AS total_movements,
    sum(
        CASE
            WHEN sm.quantity > 0 THEN sm.quantity
            ELSE 0
        END) AS total_in,
    sum(
        CASE
            WHEN sm.quantity < 0 THEN abs(sm.quantity)
            ELSE 0
        END) AS total_out,
    max(sm.created_at) AS last_movement_at
   FROM stock_movements sm
     LEFT JOIN products p ON p.id = sm.product_id
  GROUP BY sm.org_id, sm.product_id, sm.product_name, p.stock;
REVOKE ALL ON public.kardex_summary FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.kardex_summary TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.kardex_summary TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.kardex_summary TO service_role;

CREATE VIEW public.organization_activation_readiness WITH (security_invoker=false) AS
 WITH product_signals AS (
         SELECT product.org_id,
            count(*) FILTER (WHERE product.is_active IS DISTINCT FROM false AND COALESCE(product.sale_price_ars, 0::numeric) > 0::numeric) AS catalog_products_count,
            count(*) FILTER (WHERE product.is_active IS DISTINCT FROM false AND COALESCE(product.sale_price_ars, 0::numeric) > 0::numeric AND COALESCE(product.stock, 0) > 0) AS sellable_stock_products_count
           FROM products product
          GROUP BY product.org_id
        ), chosen_store AS (
         SELECT DISTINCT ON (store_1.org_id) store_1.org_id,
            store_1.id AS store_id,
            store_1.slug,
            store_1.is_active,
            store_1.published_at,
            store_1.payment_methods,
            store_1.shipping_mode,
            store_1.pickup_enabled,
            store_1.pickup_address
           FROM ecommerce_stores store_1
          ORDER BY store_1.org_id, store_1.is_active DESC, store_1.is_primary DESC, store_1.created_at, store_1.id
        ), legal_signals AS (
         SELECT page.store_id,
            count(DISTINCT page.slug) FILTER (WHERE (page.slug = ANY (ARRAY['politica-de-privacidad'::text, 'terminos-y-condiciones'::text])) AND page.status = 'published'::text AND btrim(COALESCE(page.content, ''::text)) <> ''::text AND lower(page.content) !~~ '%completá acá%'::text AND lower(page.content) !~~ '%completa aca%'::text AND lower(page.content) !~~ '%mi tienda online%'::text AND lower(page.content) !~~ '%[completar]%'::text AND lower(page.content) !~~ '%lorem ipsum%'::text) = 2 AS legal_ready
           FROM store_pages page
          GROUP BY page.store_id
        ), payment_signals AS (
         SELECT connection.org_id,
            bool_or(connection.provider = 'mercadopago'::text AND connection.access_token IS NOT NULL AND (connection.expires_at IS NULL OR connection.expires_at > now())) AS mercadopago_ready
           FROM payment_connections connection
          GROUP BY connection.org_id
        ), bank_signals AS (
         SELECT settings.org_id,
            NULLIF(btrim(COALESCE(settings.bank_cbu, ''::text)), ''::text) IS NOT NULL OR NULLIF(btrim(COALESCE(settings.bank_alias, ''::text)), ''::text) IS NOT NULL AS bank_transfer_ready
           FROM settings settings
        ), shipping_signals AS (
         SELECT zone.org_id,
            bool_or(zone.is_active AND rate.id IS NOT NULL) AS has_active_rate
           FROM shipping_zones zone
             LEFT JOIN shipping_rates rate ON rate.zone_id = zone.id AND rate.org_id = zone.org_id AND rate.is_active
          GROUP BY zone.org_id
        ), fiscal_signals AS (
         SELECT credentials.org_id,
                CASE
                    WHEN credentials.cuit IS NULL OR btrim(credentials.cuit) = ''::text OR COALESCE(credentials.punto_venta, 0) <= 0 THEN 'falta_datos_fiscales'::text
                    WHEN credentials.modo = 'propio'::text AND (credentials.certificate IS NULL OR credentials.private_key IS NULL) THEN 'falta_certificado_propio'::text
                    WHEN credentials.modo <> 'propio'::text AND NOT (EXISTS ( SELECT 1
                       FROM afip_platform_credentials platform
                      WHERE platform.certificate IS NOT NULL AND platform.private_key IS NOT NULL)) THEN 'falta_plataforma'::text
                    WHEN credentials.modo <> 'propio'::text AND NOT COALESCE(credentials.delegacion_verificada, false) THEN 'falta_delegar'::text
                    WHEN credentials.modo = 'propio'::text AND NOT (EXISTS ( SELECT 1
                       FROM invoices invoice
                      WHERE invoice.org_id = credentials.org_id AND NULLIF(btrim(COALESCE(invoice.cae, ''::text)), ''::text) IS NOT NULL)) THEN 'falta_verificar_ciclo'::text
                    ELSE 'listo'::text
                END AS fiscal_status
           FROM afip_credentials credentials
        ), pos_sales AS (
         SELECT sale.org_id,
            count(*) AS pos_sales_total,
            min(sale.date) AS first_pos_sale_at
           FROM sales sale
          WHERE sale.source = 'pos'::text
          GROUP BY sale.org_id
        ), online_sales AS (
         SELECT orders.org_id,
            count(*) FILTER (WHERE orders.payment_status = ANY (ARRAY['paid'::text, 'partial'::text, 'refunded'::text])) AS online_orders_total,
            min(orders.created_at) FILTER (WHERE orders.payment_status = ANY (ARRAY['paid'::text, 'partial'::text, 'refunded'::text])) AS first_online_sale_at
           FROM ecommerce_orders orders
          GROUP BY orders.org_id
        )
 SELECT organization.id AS org_id,
    organization.onboarding_goal,
    btrim(COALESCE(organization.name, ''::text)) <> ''::text AND (lower(btrim(organization.name)) <> ALL (ARRAY['mi negocio'::text, 'mi negocio workspace'::text])) AS identity_ready,
    COALESCE(products.catalog_products_count, 0::bigint) AS catalog_products_count,
    COALESCE(products.sellable_stock_products_count, 0::bigint) AS sellable_stock_products_count,
    COALESCE(products.catalog_products_count, 0::bigint) > 0 AS catalog_ready,
    COALESCE(products.sellable_stock_products_count, 0::bigint) > 0 AS stock_ready,
    store.store_id IS NOT NULL AS store_exists,
    COALESCE(store.is_active, false) AND NULLIF(btrim(COALESCE(store.slug, ''::text)), ''::text) IS NOT NULL AS online_channel_ready,
    COALESCE(legal.legal_ready, false) AS legal_ready,
    COALESCE(payment.mercadopago_ready, false) AS mercadopago_ready,
    ('efectivo'::text = ANY (COALESCE(store.payment_methods, ARRAY[]::text[]))) OR ('transferencia'::text = ANY (COALESCE(store.payment_methods, ARRAY[]::text[]))) AND COALESCE(bank.bank_transfer_ready, false) OR ('mercadopago'::text = ANY (COALESCE(store.payment_methods, ARRAY[]::text[]))) AND COALESCE(payment.mercadopago_ready, false) AS online_payment_ready,
    COALESCE(store.pickup_enabled, false) AND NULLIF(btrim(COALESCE(store.pickup_address, ''::text)), ''::text) IS NOT NULL OR COALESCE(store.shipping_mode, 'flat'::text) <> 'zones'::text OR COALESCE(shipping.has_active_rate, false) AS online_shipping_ready,
    COALESCE(fiscal.fiscal_status, 'falta_datos_fiscales'::text) AS fiscal_status,
    COALESCE(fiscal.fiscal_status, 'falta_datos_fiscales'::text) = 'listo'::text AS fiscal_ready,
    COALESCE(pos.pos_sales_total, 0::bigint) AS pos_sales_total,
    pos.first_pos_sale_at,
    COALESCE(online.online_orders_total, 0::bigint) AS online_orders_total,
    online.first_online_sale_at,
    store.published_at AS store_published_at
   FROM organizations organization
     LEFT JOIN product_signals products ON products.org_id = organization.id
     LEFT JOIN chosen_store store ON store.org_id = organization.id
     LEFT JOIN legal_signals legal ON legal.store_id = store.store_id
     LEFT JOIN payment_signals payment ON payment.org_id = organization.id
     LEFT JOIN bank_signals bank ON bank.org_id = organization.id
     LEFT JOIN shipping_signals shipping ON shipping.org_id = organization.id
     LEFT JOIN fiscal_signals fiscal ON fiscal.org_id = organization.id
     LEFT JOIN pos_sales pos ON pos.org_id = organization.id
     LEFT JOIN online_sales online ON online.org_id = organization.id
  WHERE is_org_member(organization.id, auth.uid()) OR is_platform_admin(auth.uid());
REVOKE ALL ON public.organization_activation_readiness FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.organization_activation_readiness TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.organization_activation_readiness TO service_role;
COMMENT ON VIEW public.organization_activation_readiness IS 'Hitos hacia la primera venta sobre una vitrina activa determinística; legales evaluados en esa misma tienda.';

CREATE VIEW public.payment_operation_trace AS
 SELECT i.org_id,
    i.correlation_id,
    i.order_id,
    'intent'::text AS stage,
    10 AS stage_order,
    i.id AS record_id,
    i.estado AS status,
    NULL::text AS provider,
    NULL::text AS provider_reference,
    i.created_at AS occurred_at
   FROM payment_intents i
UNION ALL
 SELECT i.org_id,
    i.correlation_id,
    i.order_id,
    'attempt'::text AS stage,
    20 AS stage_order,
    a.id AS record_id,
    a.estado AS status,
    a.provider,
    a.external_id AS provider_reference,
    a.created_at AS occurred_at
   FROM payment_attempts a
     JOIN payment_intents i ON i.id = a.intent_id
UNION ALL
 SELECT t.org_id,
    t.correlation_id,
        CASE
            WHEN t.source = 'ecommerce'::text THEN t.source_id
            ELSE NULL::uuid
        END AS order_id,
    'settlement'::text AS stage,
    40 AS stage_order,
    t.id AS record_id,
    t.status,
    t.provider,
    t.external_id AS provider_reference,
    t.created_at AS occurred_at
   FROM payment_transactions t
UNION ALL
 SELECT e.org_id,
    i.correlation_id,
    i.order_id,
    'event'::text AS stage,
        CASE
            WHEN e.event_type = 'orden.pagada'::text THEN 35
            ELSE 30
        END AS stage_order,
    e.id AS record_id,
    e.event_type AS status,
    NULL::text AS provider,
    NULL::text AS provider_reference,
    e.occurred_at
   FROM domain_events e
     JOIN payment_intents i ON i.org_id = e.org_id AND (e.metadata ->> 'correlation_id'::text) = i.correlation_id::text
UNION ALL
 SELECT le.org_id,
    i.correlation_id,
    i.order_id,
    'ledger'::text AS stage,
    50 AS stage_order,
    le.id AS record_id,
    'asentado'::text AS status,
    NULL::text AS provider,
    NULL::text AS provider_reference,
    le.created_at AS occurred_at
   FROM ledger_entries le
     JOIN payment_intents i ON i.org_id = le.org_id AND i.order_id = le.referencia_id
  WHERE le.referencia_tipo = 'orden'::text AND le.anulado_por IS NULL AND le.anula_a IS NULL
UNION ALL
 SELECT o.org_id,
    i.correlation_id,
    o.id AS order_id,
    'order'::text AS stage,
    25 AS stage_order,
    o.id AS record_id,
    o.payment_status AS status,
    o.payment_method AS provider,
    o.order_number AS provider_reference,
    o.created_at AS occurred_at
   FROM ecommerce_orders o
     JOIN LATERAL ( SELECT pi.correlation_id
           FROM payment_intents pi
          WHERE pi.order_id = o.id AND pi.correlation_id IS NOT NULL
          ORDER BY pi.created_at DESC
         LIMIT 1) i ON true
UNION ALL
 SELECT m.org_id,
    i.correlation_id,
    o.ord AS order_id,
    'inventory'::text AS stage,
    45 AS stage_order,
    m.id AS record_id,
    m.movement_type AS status,
    NULL::text AS provider,
    m.quantity::text AS provider_reference,
    m.created_at AS occurred_at
   FROM stock_movements m
     JOIN LATERAL ( SELECT COALESCE(s.ecommerce_order_id, m.reference_id) AS ord
           FROM sales s
          WHERE s.id = m.reference_id
        UNION ALL
         SELECT m.reference_id
 LIMIT 1) o ON true
     JOIN LATERAL ( SELECT pi.correlation_id
           FROM payment_intents pi
          WHERE pi.order_id = o.ord AND pi.correlation_id IS NOT NULL
          ORDER BY pi.created_at DESC
         LIMIT 1) i ON true
UNION ALL
 SELECT f.org_id,
    i.correlation_id,
    f.ecommerce_order_id AS order_id,
    'invoice'::text AS stage,
    55 AS stage_order,
    f.id AS record_id,
    f.afip_status AS status,
    NULL::text AS provider,
    f.number AS provider_reference,
    f.created_at AS occurred_at
   FROM invoices f
     JOIN LATERAL ( SELECT pi.correlation_id
           FROM payment_intents pi
          WHERE pi.order_id = f.ecommerce_order_id AND pi.correlation_id IS NOT NULL
          ORDER BY pi.created_at DESC
         LIMIT 1) i ON true
UNION ALL
 SELECT t.org_id,
    t.correlation_id,
    NULL::uuid AS order_id,
    'sale'::text AS stage,
    15 AS stage_order,
    t.id AS record_id,
    t.source AS status,
    NULL::text AS provider,
    NULL::text AS provider_reference,
    t.occurred_at
   FROM sale_transactions t
  WHERE t.correlation_id IS NOT NULL
UNION ALL
 SELECT m.org_id,
    t.correlation_id,
    NULL::uuid AS order_id,
    'inventory'::text AS stage,
    45 AS stage_order,
    m.id AS record_id,
    m.movement_type AS status,
    NULL::text AS provider,
    m.quantity::text AS provider_reference,
    m.created_at AS occurred_at
   FROM stock_movements m
     JOIN sales s ON s.id = m.reference_id
     JOIN sale_transactions t ON t.id = s.sale_transaction_id
  WHERE t.correlation_id IS NOT NULL
UNION ALL
 SELECT f.org_id,
    t.correlation_id,
    NULL::uuid AS order_id,
    'invoice'::text AS stage,
    55 AS stage_order,
    f.id AS record_id,
    f.afip_status AS status,
    NULL::text AS provider,
    f.number AS provider_reference,
    f.created_at AS occurred_at
   FROM invoices f
     JOIN sales s ON s.id = f.sale_id
     JOIN sale_transactions t ON t.id = s.sale_transaction_id
  WHERE t.correlation_id IS NOT NULL
UNION ALL
 SELECT e.org_id,
    t.correlation_id,
    NULL::uuid AS order_id,
    'ledger'::text AS stage,
    60 AS stage_order,
    e.id AS record_id,
        CASE
            WHEN e.anulado_por IS NOT NULL THEN 'anulado'::text
            ELSE 'asentado'::text
        END AS status,
    NULL::text AS provider,
    e.descripcion AS provider_reference,
    e.created_at AS occurred_at
   FROM ledger_entries e
     JOIN sale_transactions t ON t.id = e.referencia_id
  WHERE e.referencia_tipo = 'venta_pos'::text AND t.correlation_id IS NOT NULL;
REVOKE ALL ON public.payment_operation_trace FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.payment_operation_trace TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.payment_operation_trace TO service_role;
COMMENT ON VIEW public.payment_operation_trace IS 'Traza de una operacion por correlation_id. Online: intent, attempt, order, settlement, inventory, invoice, event, ledger. Mostrador: sale, inventory, invoice, ledger. Ordenar por stage_order.';

CREATE VIEW public.platform_org_stock_accuracy AS
 WITH latest_product_ledger AS (
         SELECT DISTINCT ON (sm.org_id, sm.product_id) sm.org_id,
            sm.product_id,
            sm.stock_after,
            sm.created_at
           FROM stock_movements sm
          WHERE sm.product_id IS NOT NULL AND sm.variant_id IS NULL
          ORDER BY sm.org_id, sm.product_id, sm.created_at DESC, sm.id DESC
        ), latest_variant_ledger AS (
         SELECT DISTINCT ON (sm.org_id, sm.variant_id) sm.org_id,
            sm.variant_id,
            sm.stock_after,
            sm.created_at
           FROM stock_movements sm
          WHERE sm.variant_id IS NOT NULL
          ORDER BY sm.org_id, sm.variant_id, sm.created_at DESC, sm.id DESC
        ), variant_state AS (
         SELECT p.org_id,
            p.id AS product_id,
            count(pv.id)::integer AS variant_count,
            count(lv.variant_id)::integer AS variant_ledger_count,
            COALESCE(sum(pv.stock), 0::bigint)::numeric AS variant_stock,
            COALESCE(bool_and(lv.variant_id IS NOT NULL AND pv.stock = lv.stock_after), true) AS variants_match,
            count(*) FILTER (WHERE pv.stock < 0)::integer AS negative_variants,
            max(lv.created_at) AS last_variant_ledger_at
           FROM products p
             LEFT JOIN product_variants pv ON pv.product_id = p.id
             LEFT JOIN latest_variant_ledger lv ON lv.variant_id = pv.id
          GROUP BY p.org_id, p.id
        ), product_state AS (
         SELECT p.org_id,
            p.id,
            p.stock,
            p.stock < 0 OR COALESCE(vs.negative_variants, 0) > 0 AS has_negative_stock,
                CASE
                    WHEN COALESCE(vs.variant_count, 0) > 0 THEN COALESCE(vs.variant_ledger_count, 0) = vs.variant_count
                    ELSE lp.product_id IS NOT NULL
                END AS has_ledger,
                CASE
                    WHEN COALESCE(vs.variant_count, 0) > 0 THEN COALESCE(vs.variant_ledger_count, 0) = vs.variant_count AND vs.variants_match AND p.stock::numeric = vs.variant_stock
                    ELSE lp.product_id IS NOT NULL AND p.stock = lp.stock_after
                END AS ledger_matches,
            GREATEST(lp.created_at, vs.last_variant_ledger_at) AS last_ledger_at
           FROM products p
             LEFT JOIN latest_product_ledger lp ON lp.product_id = p.id
             LEFT JOIN variant_state vs ON vs.product_id = p.id
        ), count_state AS (
         SELECT stock_counts.org_id,
            count(*) FILTER (WHERE stock_counts.status = 'cerrado'::text)::integer AS closed_counts,
            max(stock_counts.closed_at) FILTER (WHERE stock_counts.status = 'cerrado'::text) AS last_count_at
           FROM stock_counts
          GROUP BY stock_counts.org_id
        )
 SELECT o.id AS org_id,
    o.name AS org_name,
    o.slug,
    count(ps.id)::integer AS productos_total,
    count(ps.id) FILTER (WHERE ps.has_ledger)::integer AS productos_medidos,
    count(ps.id) FILTER (WHERE ps.has_ledger AND ps.ledger_matches)::integer AS productos_coinciden,
    count(ps.id) FILTER (WHERE ps.has_ledger AND NOT ps.ledger_matches)::integer AS productos_descuadrados,
    count(ps.id) FILTER (WHERE NOT ps.has_ledger)::integer AS productos_sin_kardex,
    count(ps.id) FILTER (WHERE ps.has_negative_stock)::integer AS productos_stock_negativo,
        CASE
            WHEN count(ps.id) FILTER (WHERE ps.has_ledger) > 0 THEN round(count(ps.id) FILTER (WHERE ps.has_ledger AND ps.ledger_matches)::numeric / count(ps.id) FILTER (WHERE ps.has_ledger)::numeric * 100::numeric, 1)
            ELSE NULL::numeric
        END AS precision_pct,
    max(ps.last_ledger_at) AS ultimo_movimiento_at,
    COALESCE(cs.closed_counts, 0) AS conteos_cerrados,
    cs.last_count_at AS ultimo_conteo_at
   FROM organizations o
     LEFT JOIN product_state ps ON ps.org_id = o.id
     LEFT JOIN count_state cs ON cs.org_id = o.id
  WHERE is_platform_admin(auth.uid())
  GROUP BY o.id, o.name, o.slug, cs.closed_counts, cs.last_count_at;
REVOKE ALL ON public.platform_org_stock_accuracy FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.platform_org_stock_accuracy TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.platform_org_stock_accuracy TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.platform_org_stock_accuracy TO service_role;
COMMENT ON VIEW public.platform_org_stock_accuracy IS 'Precision de inventario para plataforma. Compara el ultimo asiento del Kardex con el stock actual; productos sin asiento no entran como coincidencias. Los productos con variantes se validan contra cada variante y su total padre.';

CREATE VIEW public.product_availability WITH (security_invoker=true) AS
 SELECT p.id AS product_id,
    p.org_id,
    p.name AS product_name,
    p.stock AS stock_total,
    COALESCE(r.reserved, 0::bigint)::integer AS reserved,
    (p.stock - COALESCE(r.reserved, 0::bigint))::integer AS available
   FROM products p
     LEFT JOIN ( SELECT stock_reservations.product_id,
            sum(stock_reservations.quantity) AS reserved
           FROM stock_reservations
          WHERE stock_reservations.status = 'active'::text
          GROUP BY stock_reservations.product_id) r ON r.product_id = p.id;
REVOKE ALL ON public.product_availability FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.product_availability TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.product_availability TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.product_availability TO service_role;

CREATE VIEW public.sale_items WITH (security_invoker=true) AS
 SELECT id,
    id AS sale_id,
    org_id,
    product_id,
    product_name,
    quantity,
    unit_price_ars AS unit_price,
    total_ars AS total_price,
    date,
    created_at
   FROM sales s;
REVOKE ALL ON public.sale_items FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.sale_items TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.sale_items TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.sale_items TO service_role;

CREATE VIEW public.sales_return_operations WITH (security_invoker=true) AS
 SELECT operation.id,
    operation.org_id,
    operation.sale_transaction_id,
    operation.legacy_sale_id,
    operation.status,
    operation.reason,
    operation.notes,
    operation.restock,
    operation.refund_amount,
    operation.currency,
    operation.cash_session_id,
    operation.credit_note_required,
    operation.created_by,
    operation.created_at,
    operation.completed_at,
    COALESCE(lines.line_count, 0) AS line_count,
    COALESCE(lines.units, 0) AS units,
    COALESCE(lines.product_names, ''::text) AS product_names,
    COALESCE(refunds.completed_amount, 0::numeric) AS completed_amount,
    COALESCE(refunds.pending_amount, 0::numeric) AS pending_amount,
    COALESCE(refunds.payment_summary, ''::text) AS payment_summary
   FROM sales_return_transactions operation
     LEFT JOIN LATERAL ( SELECT count(*)::integer AS line_count,
            COALESCE(sum(line.quantity), 0::bigint)::integer AS units,
            string_agg(line.product_name, ', '::text ORDER BY line.created_at, line.id) AS product_names
           FROM returns line
          WHERE line.return_transaction_id = operation.id) lines ON true
     LEFT JOIN LATERAL ( SELECT round(COALESCE(sum(refund.amount) FILTER (WHERE refund.status = 'completed'::text), 0::numeric), 2) AS completed_amount,
            round(COALESCE(sum(refund.amount) FILTER (WHERE refund.status = 'pending_external'::text), 0::numeric), 2) AS pending_amount,
            string_agg((refund.sale_method || ': '::text) || refund.status, ', '::text ORDER BY refund.created_at, refund.id) AS payment_summary
           FROM sales_return_refunds refund
          WHERE refund.return_transaction_id = operation.id) refunds ON true;
REVOKE ALL ON public.sales_return_operations FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.sales_return_operations TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.sales_return_operations TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.sales_return_operations TO service_role;

CREATE VIEW public.stock_a_reponer AS
 SELECT a.org_id,
    a.product_id,
    p.name AS producto,
    p.stock,
    a.days_on_hand AS cobertura_dias,
    a.abc_class,
    a.xyz_class,
    a.velocity,
    a.stockout_risk,
    a.reorder_point,
    a.safety_stock,
    a.eoq,
    a.total_units AS vendidas_en_el_periodo,
        CASE
            WHEN a.reorder_point IS NOT NULL AND p.stock < a.reorder_point THEN a.reorder_point - p.stock + COALESCE(a.eoq, 0)
            ELSE NULL::integer
        END AS sugerencia_compra
   FROM inventory_abc a
     JOIN products p ON p.id = a.product_id
  WHERE a.analysis_date = (( SELECT max(a2.analysis_date) AS max
           FROM inventory_abc a2
          WHERE a2.org_id = a.org_id)) AND (a.stockout_risk = ANY (ARRAY['quebrado'::text, 'critico'::text, 'atencion'::text])) AND p.maneja_stock;
REVOKE ALL ON public.stock_a_reponer FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.stock_a_reponer TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.stock_a_reponer TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.stock_a_reponer TO service_role;
COMMENT ON VIEW public.stock_a_reponer IS 'Productos que hay que reponer. Excluye los que no llevan stock: un servicio se vende, así que el análisis ABC lo marcaba «quebrado» y pedía comprar unidades de algo que no se compra.';

CREATE VIEW public.stock_comprometido WITH (security_invoker=true) AS
 SELECT r.org_id,
    r.product_id,
    p.name AS producto,
    p.stock AS stock_total,
    sum(r.quantity) AS reservado,
    p.stock - sum(r.quantity) AS disponible,
    min(r.expires_at) AS primera_vence,
    count(*) FILTER (WHERE r.order_id IS NOT NULL) AS de_ordenes,
    count(*) FILTER (WHERE r.order_id IS NULL) AS manuales
   FROM stock_reservations r
     JOIN products p ON p.id = r.product_id
  WHERE r.status = 'active'::text AND (r.expires_at IS NULL OR r.expires_at > now())
  GROUP BY r.org_id, r.product_id, p.name, p.stock;
REVOKE ALL ON public.stock_comprometido FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.stock_comprometido TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.stock_comprometido TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.stock_comprometido TO service_role;
COMMENT ON VIEW public.stock_comprometido IS 'Mercadería apartada y todavía vigente. `disponible` es lo que se le puede vender a alguien más; si sale negativo hay reservas por encima del stock y algo se sobrevendió.';

CREATE VIEW public.stock_inmovilizado WITH (security_invoker=true) AS
 SELECT a.org_id,
    a.product_id,
    p.name AS producto,
    p.stock,
    a.days_on_hand AS cobertura_dias,
    a.velocity,
    a.abc_class,
    p.stock::numeric * COALESCE(p.total_cost_usd, 0::numeric) AS capital_inmovilizado_usd,
    a.total_units AS vendidas_en_el_periodo
   FROM inventory_abc a
     JOIN products p ON p.id = a.product_id
  WHERE a.analysis_date = (( SELECT max(a2.analysis_date) AS max
           FROM inventory_abc a2
          WHERE a2.org_id = a.org_id)) AND (a.velocity = ANY (ARRAY['lento'::text, 'muerto'::text])) AND p.stock > 0;
REVOKE ALL ON public.stock_inmovilizado FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.stock_inmovilizado TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.stock_inmovilizado TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.stock_inmovilizado TO service_role;
COMMENT ON VIEW public.stock_inmovilizado IS 'Mercadería que no rota: más de 90 días de cobertura y stock encima. Es la contracara de stock_a_reponer — plata quieta en el estante.';

CREATE VIEW public.stock_negativo WITH (security_invoker=true) AS
 SELECT org_id,
    id AS product_id,
    name,
    stock
   FROM products p
  WHERE stock < 0;
REVOKE ALL ON public.stock_negativo FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.stock_negativo TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.stock_negativo TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.stock_negativo TO service_role;
COMMENT ON VIEW public.stock_negativo IS 'Productos con stock negativo. Tiene que estar vacía: una fila es un movimiento de más o una venta sin respaldo.';

CREATE VIEW public.stock_sin_ubicar WITH (security_invoker=true) AS
 SELECT ls.location_id,
    l.name AS sucursal,
    ls.product_id,
    p.name AS producto,
    ls.stock AS en_sucursal,
    COALESCE(( SELECT sum(bs.quantity) AS sum
           FROM bin_stock bs
             JOIN warehouse_bins b ON b.id = bs.bin_id
          WHERE b.location_id = ls.location_id AND bs.product_id = ls.product_id), 0::numeric) AS ubicado,
    ls.stock::numeric - COALESCE(( SELECT sum(bs.quantity) AS sum
           FROM bin_stock bs
             JOIN warehouse_bins b ON b.id = bs.bin_id
          WHERE b.location_id = ls.location_id AND bs.product_id = ls.product_id), 0::numeric) AS sin_ubicar
   FROM location_stock ls
     JOIN locations l ON l.id = ls.location_id
     JOIN products p ON p.id = ls.product_id
  WHERE ls.stock::numeric > COALESCE(( SELECT sum(bs.quantity) AS sum
           FROM bin_stock bs
             JOIN warehouse_bins b ON b.id = bs.bin_id
          WHERE b.location_id = ls.location_id AND bs.product_id = ls.product_id), 0::numeric);
REVOKE ALL ON public.stock_sin_ubicar FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.stock_sin_ubicar TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.stock_sin_ubicar TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.stock_sin_ubicar TO service_role;
COMMENT ON VIEW public.stock_sin_ubicar IS 'Mercadería que está en la sucursal pero todavía no se guardó en ninguna posición. No es un error: es la lista de lo que falta ubicar.';

CREATE VIEW public.stock_sucursal_descuadrado WITH (security_invoker=true) AS
 SELECT p.org_id,
    p.id AS product_id,
    p.name,
    p.stock AS total_organizacion,
    COALESCE(sum(ls.stock), 0::bigint) AS suma_sucursales,
    p.stock - COALESCE(sum(ls.stock), 0::bigint) AS diferencia
   FROM products p
     LEFT JOIN location_stock ls ON ls.product_id = p.id
  WHERE (EXISTS ( SELECT 1
           FROM locations l
          WHERE l.org_id = p.org_id AND l.active))
  GROUP BY p.org_id, p.id, p.name, p.stock
 HAVING p.stock <> COALESCE(sum(ls.stock), 0::bigint);
REVOKE ALL ON public.stock_sucursal_descuadrado FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.stock_sucursal_descuadrado TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.stock_sucursal_descuadrado TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.stock_sucursal_descuadrado TO service_role;
COMMENT ON VIEW public.stock_sucursal_descuadrado IS 'Productos donde el total de la organización no coincide con la suma por sucursal. Tiene que estar vacía; una fila acá es mercadería que el sistema no sabe dónde está.';

CREATE VIEW public.store_catalog_products WITH (security_invoker=false) AS
 SELECT product.id,
    product.org_id,
    product.user_id,
    product.name,
    product.brand,
    COALESCE(publication.category_slug, product.category) AS category,
    product.gender,
    product.description,
    product.image_url,
    product.image_urls,
        CASE
            WHEN publication.price_ars IS NOT NULL THEN COALESCE(publication.compare_at_price_ars, publication.price_ars)
            ELSE product.sale_price_ars
        END AS sale_price_ars,
        CASE
            WHEN publication.price_ars IS NOT NULL AND publication.compare_at_price_ars > publication.price_ars THEN publication.price_ars
            WHEN publication.price_ars IS NULL THEN product.discount_price_ars
            ELSE NULL::numeric
        END AS discount_price_ars,
    product.price_2x_ars,
    product.stock,
    product.content_ml,
    product.total_sold,
    COALESCE(publication.featured, product.featured, false) AS featured,
    product.offer_expires_at,
    product.created_at,
        CASE
            WHEN COALESCE(product.content_ml, 0) > 0 THEN round(COALESCE(product.total_cost_usd, product.cost_usd, 0::numeric) / product.content_ml::numeric * 10::numeric * COALESCE(settings.exchange_rate, 0::numeric) * (1::numeric + COALESCE(settings.decant_margin_10ml, 250::numeric) / 100.0))
            ELSE NULL::numeric
        END AS decant_price_10ml,
        CASE
            WHEN COALESCE(product.content_ml, 0) > 0 THEN round(COALESCE(product.total_cost_usd, product.cost_usd, 0::numeric) / product.content_ml::numeric * 5::numeric * COALESCE(settings.exchange_rate, 0::numeric) * (1::numeric + COALESCE(settings.decant_margin_5ml, 350::numeric) / 100.0))
            ELSE NULL::numeric
        END AS decant_price_5ml,
        CASE
            WHEN COALESCE(product.content_ml, 0) > 0 THEN round(COALESCE(product.total_cost_usd, product.cost_usd, 0::numeric) / product.content_ml::numeric * 2.5 * COALESCE(settings.exchange_rate, 0::numeric) * (1::numeric + COALESCE(settings.decant_margin_2_5ml, 500::numeric) / 100.0))
            ELSE NULL::numeric
        END AS decant_price_2_5ml,
        CASE
            WHEN COALESCE(product.offer_stacks_payment, store.payment_discount_stacks, false) THEN COALESCE(
            CASE
                WHEN publication.price_ars IS NOT NULL THEN publication.price_ars
                ELSE NULL::numeric
            END, NULLIF(product.discount_price_ars, 0::numeric), product.sale_price_ars)
            ELSE
            CASE
                WHEN publication.price_ars IS NOT NULL THEN COALESCE(publication.compare_at_price_ars, publication.price_ars)
                ELSE product.sale_price_ars
            END
        END AS payment_base_price,
    store_promo_price(product.org_id, product.id, COALESCE(publication.category_slug, product.category),
        CASE
            WHEN publication.price_ars IS NOT NULL THEN COALESCE(publication.compare_at_price_ars, publication.price_ars)
            ELSE product.sale_price_ars
        END, NULL::numeric) AS promo_price
   FROM products product
     JOIN LATERAL ( SELECT candidate.id,
            candidate.org_id,
            candidate.name,
            candidate.slug,
            candidate.domain,
            candidate.custom_domain,
            candidate.theme,
            candidate.primary_color,
            candidate.logo_url,
            candidate.banner_url,
            candidate.description,
            candidate.currency,
            candidate.tax_included,
            candidate.free_shipping_above,
            candidate.shipping_cost,
            candidate.is_active,
            candidate.meta_title,
            candidate.meta_description,
            candidate.social_links,
            candidate.payment_methods,
            candidate.created_at,
            candidate.notification_email,
            candidate.shipping_mode,
            candidate.pickup_enabled,
            candidate.pickup_address,
            candidate.pickup_instructions,
            candidate.default_item_weight_kg,
            candidate.meta_pixel_id,
            candidate.ga_measurement_id,
            candidate.google_ads_id,
            candidate.tiktok_pixel_id,
            candidate.payment_discounts,
            candidate.font,
            candidate.nav_links,
            candidate.payment_discount_stacks,
            candidate.published_at,
            candidate.fulfillment_location_id,
            candidate.storefront_layout,
            candidate.custom_domain_status,
            candidate.custom_domain_verification,
            candidate.custom_domain_claimed_at,
            candidate.custom_domain_checked_at,
            candidate.custom_domain_verified_at,
            candidate.custom_domain_error_code,
            candidate.first_party_analytics_enabled,
            candidate.analytics_disclosure_accepted_at,
            candidate.analytics_disclosure_accepted_by,
            candidate.is_primary
           FROM ecommerce_stores candidate
          WHERE candidate.org_id = product.org_id AND candidate.is_active
          ORDER BY candidate.is_primary DESC, candidate.created_at, candidate.id
         LIMIT 1) store ON true
     LEFT JOIN store_product_publications publication ON publication.store_id = store.id AND publication.product_id = product.id
     LEFT JOIN settings settings ON settings.org_id = product.org_id
  WHERE COALESCE(product.is_active, true) AND COALESCE(publication.visibility, 'published'::text) = 'published'::text AND
        CASE
            WHEN publication.price_ars IS NOT NULL THEN publication.price_ars
            ELSE COALESCE(NULLIF(product.discount_price_ars, 0::numeric), product.sale_price_ars)
        END > 0::numeric;
REVOKE ALL ON public.store_catalog_products FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.store_catalog_products TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.store_catalog_products TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.store_catalog_products TO service_role;
COMMENT ON VIEW public.store_catalog_products IS 'Compatibilidad pública por organización: una fila por producto y configuración de la vitrina activa/principal.';

CREATE VIEW public.store_order_margin_facts WITH (security_invoker=true) AS
 WITH settlements AS (
         SELECT pt.org_id,
            pt.source_id AS ecommerce_order_id,
            round(sum(pt.provider_fee + pt.provider_fee_iva + pt.platform_fee), 2) AS payment_fee_total_ars
           FROM payment_transactions pt
          WHERE pt.source = 'ecommerce'::text AND pt.status = 'approved'::text AND pt.source_id IS NOT NULL
          GROUP BY pt.org_id, pt.source_id
        ), lines AS (
         SELECT s.id AS sale_id,
            s.org_id,
            s.ecommerce_order_id,
            s.product_id,
            s.product_name,
            s.quantity,
            s.date AS sold_at,
            s.total_ars AS product_revenue_ars,
            s.cost_of_goods_ars,
            o.order_number,
            o.shipping_cost AS shipping_charged_order_ars,
            o.tax_amount AS tax_order_ars,
            st.payment_fee_total_ars,
            sum(s.total_ars) OVER (PARTITION BY s.ecommerce_order_id) AS products_total_ars,
            row_number() OVER (PARTITION BY s.ecommerce_order_id ORDER BY s.id) AS allocation_position,
            count(*) OVER (PARTITION BY s.ecommerce_order_id) AS allocation_count
           FROM sales s
             JOIN ecommerce_orders o ON o.id = s.ecommerce_order_id AND o.org_id = s.org_id
             LEFT JOIN settlements st ON st.org_id = s.org_id AND st.ecommerce_order_id = s.ecommerce_order_id
          WHERE s.source = 'tienda_online'::text AND s.ecommerce_order_id IS NOT NULL
        ), provisional AS (
         SELECT lines.sale_id,
            lines.org_id,
            lines.ecommerce_order_id,
            lines.product_id,
            lines.product_name,
            lines.quantity,
            lines.sold_at,
            lines.product_revenue_ars,
            lines.cost_of_goods_ars,
            lines.order_number,
            lines.shipping_charged_order_ars,
            lines.tax_order_ars,
            lines.payment_fee_total_ars,
            lines.products_total_ars,
            lines.allocation_position,
            lines.allocation_count,
                CASE
                    WHEN lines.payment_fee_total_ars IS NOT NULL AND lines.products_total_ars > 0::numeric THEN round(lines.payment_fee_total_ars * lines.product_revenue_ars / lines.products_total_ars, 2)
                    ELSE NULL::numeric
                END AS payment_fee_preliminary_ars,
                CASE
                    WHEN lines.products_total_ars > 0::numeric THEN round(lines.shipping_charged_order_ars * lines.product_revenue_ars / lines.products_total_ars, 2)
                    ELSE NULL::numeric
                END AS shipping_charged_preliminary_ars,
                CASE
                    WHEN lines.products_total_ars > 0::numeric THEN round(lines.tax_order_ars * lines.product_revenue_ars / lines.products_total_ars, 2)
                    ELSE NULL::numeric
                END AS tax_preliminary_ars
           FROM lines
        ), allocated AS (
         SELECT provisional.sale_id,
            provisional.org_id,
            provisional.ecommerce_order_id,
            provisional.product_id,
            provisional.product_name,
            provisional.quantity,
            provisional.sold_at,
            provisional.product_revenue_ars,
            provisional.cost_of_goods_ars,
            provisional.order_number,
            provisional.shipping_charged_order_ars,
            provisional.tax_order_ars,
            provisional.payment_fee_total_ars,
            provisional.products_total_ars,
            provisional.allocation_position,
            provisional.allocation_count,
            provisional.payment_fee_preliminary_ars,
            provisional.shipping_charged_preliminary_ars,
            provisional.tax_preliminary_ars,
                CASE
                    WHEN provisional.payment_fee_total_ars IS NULL OR provisional.products_total_ars <= 0::numeric THEN NULL::numeric
                    WHEN provisional.allocation_position = provisional.allocation_count THEN round(provisional.payment_fee_total_ars - COALESCE(sum(provisional.payment_fee_preliminary_ars) OVER (PARTITION BY provisional.ecommerce_order_id ORDER BY provisional.sale_id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0::numeric), 2)
                    ELSE provisional.payment_fee_preliminary_ars
                END AS payment_fee_ars,
                CASE
                    WHEN provisional.products_total_ars <= 0::numeric THEN NULL::numeric
                    WHEN provisional.allocation_position = provisional.allocation_count THEN round(provisional.shipping_charged_order_ars - COALESCE(sum(provisional.shipping_charged_preliminary_ars) OVER (PARTITION BY provisional.ecommerce_order_id ORDER BY provisional.sale_id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0::numeric), 2)
                    ELSE provisional.shipping_charged_preliminary_ars
                END AS shipping_charged_ars,
                CASE
                    WHEN provisional.products_total_ars <= 0::numeric THEN NULL::numeric
                    WHEN provisional.allocation_position = provisional.allocation_count THEN round(provisional.tax_order_ars - COALESCE(sum(provisional.tax_preliminary_ars) OVER (PARTITION BY provisional.ecommerce_order_id ORDER BY provisional.sale_id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0::numeric), 2)
                    ELSE provisional.tax_preliminary_ars
                END AS tax_ars
           FROM provisional
        )
 SELECT sale_id,
    org_id,
    ecommerce_order_id,
    product_id,
    product_name,
    quantity,
    sold_at,
    order_number,
    product_revenue_ars,
    cost_of_goods_ars,
    payment_fee_ars,
    shipping_charged_ars,
    tax_ars,
    NULL::numeric AS carrier_shipping_cost_ars,
    round(product_revenue_ars - cost_of_goods_ars, 2) AS gross_margin_ars,
        CASE
            WHEN payment_fee_ars IS NOT NULL THEN round(product_revenue_ars - cost_of_goods_ars - payment_fee_ars, 2)
            ELSE NULL::numeric
        END AS margin_after_payment_ars,
    payment_fee_ars IS NOT NULL AS payment_fee_recorded,
    false AS carrier_shipping_cost_recorded
   FROM allocated;
REVOKE ALL ON public.store_order_margin_facts FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.store_order_margin_facts TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.store_order_margin_facts TO service_role;
COMMENT ON VIEW public.store_order_margin_facts IS 'Hechos por línea de venta de tienda: costo de mercadería, comisión de pago, IVA y envío cobrado al comprador. El costo real del correo se mantiene NULL hasta que se registre desde una etiqueta/contrato.';

CREATE VIEW public.ubicaciones_descuadradas WITH (security_invoker=true) AS
 SELECT b.location_id,
    l.name AS sucursal,
    bs.product_id,
    p.name AS producto,
    sum(bs.quantity) AS ubicado,
    COALESCE(max(ls.stock), 0) AS en_sucursal,
    sum(bs.quantity) - COALESCE(max(ls.stock), 0)::numeric AS de_mas
   FROM bin_stock bs
     JOIN warehouse_bins b ON b.id = bs.bin_id
     JOIN locations l ON l.id = b.location_id
     JOIN products p ON p.id = bs.product_id
     LEFT JOIN location_stock ls ON ls.location_id = b.location_id AND ls.product_id = bs.product_id
  GROUP BY b.location_id, l.name, bs.product_id, p.name
 HAVING sum(bs.quantity) > COALESCE(max(ls.stock), 0)::numeric;
REVOKE ALL ON public.ubicaciones_descuadradas FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.ubicaciones_descuadradas TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.ubicaciones_descuadradas TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.ubicaciones_descuadradas TO service_role;
COMMENT ON VIEW public.ubicaciones_descuadradas IS 'Productos con más unidades ubicadas que existentes en la sucursal. Tiene que estar vacía: una fila es mercadería que el sistema cree tener en una estantería y no tiene.';

CREATE VIEW public._sale_margin_facts_source WITH (security_barrier=true) AS
 WITH ledger_components AS (
         SELECT entry.org_id,
            entry.referencia_tipo,
            entry.referencia_id,
            round(sum(line.debe - line.haber) FILTER (WHERE account.codigo = '5.1.01'::text), 2) AS cogs_total_ars,
            round(COALESCE(sum(line.haber - line.debe) FILTER (WHERE account.codigo = '2.1.02'::text), 0::numeric), 2) AS tax_total_ars
           FROM ledger_entries entry
             JOIN ledger_lines line ON line.entry_id = entry.id
             JOIN ledger_accounts account ON account.id = line.account_id
          WHERE entry.anulado_por IS NULL AND entry.anula_a IS NULL AND entry.referencia_id IS NOT NULL AND (entry.referencia_tipo = ANY (ARRAY['venta_pos'::text, 'orden'::text]))
          GROUP BY entry.id, entry.org_id, entry.referencia_tipo, entry.referencia_id
        ), payment_components AS (
         SELECT transaction.org_id,
            transaction.source_id,
            round(sum(transaction.provider_fee + transaction.provider_fee_iva + transaction.platform_fee), 2) AS payment_fee_total_ars
           FROM payment_transactions transaction
          WHERE transaction.source = 'pos'::text AND transaction.status = 'approved'::text AND transaction.source_id IS NOT NULL
          GROUP BY transaction.org_id, transaction.source_id
        ), base AS (
         SELECT sale.id AS sale_id,
            sale.org_id,
            sale.product_id,
            sale.product_name,
            sale.quantity,
            sale.date AS sold_at,
            sale.source AS recorded_source,
                CASE sale.source
                    WHEN 'pos'::text THEN 'pos'::text
                    WHEN 'tienda_online'::text THEN 'tienda_online'::text
                    WHEN 'mercadolibre'::text THEN 'mercadolibre'::text
                    WHEN 'manual'::text THEN 'sin_atribuir'::text
                    ELSE COALESCE(NULLIF(sale.source, ''::text), 'sin_atribuir'::text)
                END AS channel,
                CASE
                    WHEN sale.source = 'tienda_online'::text AND sale.ecommerce_order_id IS NOT NULL THEN 'orden_tienda'::text
                    WHEN sale.source = 'mercadolibre'::text AND meli.meli_order_id IS NOT NULL THEN 'orden_mercadolibre'::text
                    WHEN sale.sale_transaction_id IS NOT NULL THEN 'venta'::text
                    ELSE 'linea_historica'::text
                END AS operation_type,
            COALESCE(
                CASE
                    WHEN sale.source = 'tienda_online'::text THEN sale.ecommerce_order_id
                    ELSE NULL::uuid
                END,
                CASE
                    WHEN sale.source = 'mercadolibre'::text THEN meli.meli_order_id
                    ELSE NULL::uuid
                END, sale.sale_transaction_id, sale.id) AS operation_id,
            concat(sale.org_id::text, ':',
                CASE
                    WHEN sale.source = 'tienda_online'::text AND sale.ecommerce_order_id IS NOT NULL THEN 'store'::text
                    WHEN sale.source = 'mercadolibre'::text AND meli.meli_order_id IS NOT NULL THEN 'meli'::text
                    WHEN sale.sale_transaction_id IS NOT NULL THEN 'sale'::text
                    ELSE 'legacy'::text
                END, ':', COALESCE(
                CASE
                    WHEN sale.source = 'tienda_online'::text THEN sale.ecommerce_order_id::text
                    ELSE NULL::text
                END,
                CASE
                    WHEN sale.source = 'mercadolibre'::text THEN meli.meli_order_id::text
                    ELSE NULL::text
                END, sale.sale_transaction_id::text, sale.id::text)) AS operation_key,
            round(COALESCE(sale.total_ars, 0::numeric), 2) AS revenue_ars,
                CASE
                    WHEN COALESCE(sale.cost_of_goods_ars, 0::numeric) > 0::numeric THEN round(sale.cost_of_goods_ars, 2)
                    ELSE NULL::numeric
                END AS sale_cogs_ars,
            store.payment_fee_ars AS store_payment_fee_ars,
            store.carrier_shipping_cost_ars AS store_shipping_cost_ars,
            store.tax_ars AS store_tax_ars,
            meli.sale_fee_ars AS meli_payment_fee_ars,
            meli.seller_shipping_cost_ars AS meli_shipping_cost_ars,
            line_payment.payment_fee_total_ars AS line_payment_fee_ars,
            transaction_payment.payment_fee_total_ars AS transaction_payment_fee_ars,
            COALESCE(pos_ledger.cogs_total_ars, store_ledger.cogs_total_ars) AS ledger_cogs_total_ars,
            COALESCE(pos_ledger.tax_total_ars, store_ledger.tax_total_ars) AS ledger_tax_total_ars,
            invoice.tax_amount AS invoice_tax_ars,
            sale.invoice_id,
            sale.ecommerce_order_id,
            sale.sale_transaction_id,
            meli.meli_order_id,
            COALESCE(sale.payment_method, ''::text) AS payment_method,
            sale.split_payments,
            COALESCE(sale.returned, false) AS returned,
            COALESCE(sale.returned_quantity, 0) AS returned_quantity
           FROM sales sale
             LEFT JOIN store_order_margin_facts store ON store.sale_id = sale.id
             LEFT JOIN meli_order_sale_lines meli ON meli.sale_id = sale.id
             LEFT JOIN payment_components line_payment ON line_payment.org_id = sale.org_id AND line_payment.source_id = sale.id
             LEFT JOIN payment_components transaction_payment ON transaction_payment.org_id = sale.org_id AND transaction_payment.source_id = sale.sale_transaction_id
             LEFT JOIN ledger_components pos_ledger ON pos_ledger.org_id = sale.org_id AND pos_ledger.referencia_tipo = 'venta_pos'::text AND pos_ledger.referencia_id = sale.sale_transaction_id
             LEFT JOIN ledger_components store_ledger ON store_ledger.org_id = sale.org_id AND store_ledger.referencia_tipo = 'orden'::text AND store_ledger.referencia_id = sale.ecommerce_order_id
             LEFT JOIN LATERAL ( SELECT candidate.tax_amount
                   FROM invoices candidate
                  WHERE candidate.org_id = sale.org_id AND (candidate.id = sale.invoice_id OR candidate.sale_id = sale.id)
                  ORDER BY (candidate.id = sale.invoice_id) DESC, candidate.created_at DESC
                 LIMIT 1) invoice ON true
        ), operation_totals AS (
         SELECT base.sale_id,
            base.org_id,
            base.product_id,
            base.product_name,
            base.quantity,
            base.sold_at,
            base.recorded_source,
            base.channel,
            base.operation_type,
            base.operation_id,
            base.operation_key,
            base.revenue_ars,
            base.sale_cogs_ars,
            base.store_payment_fee_ars,
            base.store_shipping_cost_ars,
            base.store_tax_ars,
            base.meli_payment_fee_ars,
            base.meli_shipping_cost_ars,
            base.line_payment_fee_ars,
            base.transaction_payment_fee_ars,
            base.ledger_cogs_total_ars,
            base.ledger_tax_total_ars,
            base.invoice_tax_ars,
            base.invoice_id,
            base.ecommerce_order_id,
            base.sale_transaction_id,
            base.meli_order_id,
            base.payment_method,
            base.split_payments,
            base.returned,
            base.returned_quantity,
            sum(base.revenue_ars) OVER operation_window AS operation_revenue_ars,
            sum(COALESCE(base.sale_cogs_ars, 0::numeric)) OVER operation_window AS operation_known_cogs_ars,
            sum(base.revenue_ars) FILTER (WHERE base.sale_cogs_ars IS NULL) OVER operation_window AS missing_cogs_revenue_ars,
            sum(
                CASE
                    WHEN base.sale_cogs_ars IS NULL THEN 1
                    ELSE 0
                END) OVER operation_ordered AS missing_cogs_position,
            count(*) FILTER (WHERE base.sale_cogs_ars IS NULL) OVER operation_window AS missing_cogs_count,
            row_number() OVER operation_ordered AS allocation_position,
            count(*) OVER operation_window AS allocation_count
           FROM base
          WINDOW operation_window AS (PARTITION BY base.org_id, base.operation_key), operation_ordered AS (PARTITION BY base.org_id, base.operation_key ORDER BY base.sale_id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
        ), provisional AS (
         SELECT operation_totals.sale_id,
            operation_totals.org_id,
            operation_totals.product_id,
            operation_totals.product_name,
            operation_totals.quantity,
            operation_totals.sold_at,
            operation_totals.recorded_source,
            operation_totals.channel,
            operation_totals.operation_type,
            operation_totals.operation_id,
            operation_totals.operation_key,
            operation_totals.revenue_ars,
            operation_totals.sale_cogs_ars,
            operation_totals.store_payment_fee_ars,
            operation_totals.store_shipping_cost_ars,
            operation_totals.store_tax_ars,
            operation_totals.meli_payment_fee_ars,
            operation_totals.meli_shipping_cost_ars,
            operation_totals.line_payment_fee_ars,
            operation_totals.transaction_payment_fee_ars,
            operation_totals.ledger_cogs_total_ars,
            operation_totals.ledger_tax_total_ars,
            operation_totals.invoice_tax_ars,
            operation_totals.invoice_id,
            operation_totals.ecommerce_order_id,
            operation_totals.sale_transaction_id,
            operation_totals.meli_order_id,
            operation_totals.payment_method,
            operation_totals.split_payments,
            operation_totals.returned,
            operation_totals.returned_quantity,
            operation_totals.operation_revenue_ars,
            operation_totals.operation_known_cogs_ars,
            operation_totals.missing_cogs_revenue_ars,
            operation_totals.missing_cogs_position,
            operation_totals.missing_cogs_count,
            operation_totals.allocation_position,
            operation_totals.allocation_count,
                CASE
                    WHEN operation_totals.transaction_payment_fee_ars IS NOT NULL AND operation_totals.operation_revenue_ars > 0::numeric THEN round(operation_totals.transaction_payment_fee_ars * operation_totals.revenue_ars / operation_totals.operation_revenue_ars, 2)
                    ELSE NULL::numeric
                END AS transaction_payment_preliminary_ars,
                CASE
                    WHEN operation_totals.ledger_tax_total_ars IS NOT NULL AND operation_totals.operation_revenue_ars > 0::numeric THEN round(operation_totals.ledger_tax_total_ars * operation_totals.revenue_ars / operation_totals.operation_revenue_ars, 2)
                    ELSE NULL::numeric
                END AS ledger_tax_preliminary_ars,
                CASE
                    WHEN operation_totals.sale_cogs_ars IS NULL AND operation_totals.ledger_cogs_total_ars > operation_totals.operation_known_cogs_ars AND operation_totals.missing_cogs_revenue_ars > 0::numeric THEN round((operation_totals.ledger_cogs_total_ars - operation_totals.operation_known_cogs_ars) * operation_totals.revenue_ars / operation_totals.missing_cogs_revenue_ars, 2)
                    ELSE NULL::numeric
                END AS ledger_cogs_preliminary_ars
           FROM operation_totals
        ), allocated AS (
         SELECT provisional.sale_id,
            provisional.org_id,
            provisional.product_id,
            provisional.product_name,
            provisional.quantity,
            provisional.sold_at,
            provisional.recorded_source,
            provisional.channel,
            provisional.operation_type,
            provisional.operation_id,
            provisional.operation_key,
            provisional.revenue_ars,
            provisional.sale_cogs_ars,
            provisional.store_payment_fee_ars,
            provisional.store_shipping_cost_ars,
            provisional.store_tax_ars,
            provisional.meli_payment_fee_ars,
            provisional.meli_shipping_cost_ars,
            provisional.line_payment_fee_ars,
            provisional.transaction_payment_fee_ars,
            provisional.ledger_cogs_total_ars,
            provisional.ledger_tax_total_ars,
            provisional.invoice_tax_ars,
            provisional.invoice_id,
            provisional.ecommerce_order_id,
            provisional.sale_transaction_id,
            provisional.meli_order_id,
            provisional.payment_method,
            provisional.split_payments,
            provisional.returned,
            provisional.returned_quantity,
            provisional.operation_revenue_ars,
            provisional.operation_known_cogs_ars,
            provisional.missing_cogs_revenue_ars,
            provisional.missing_cogs_position,
            provisional.missing_cogs_count,
            provisional.allocation_position,
            provisional.allocation_count,
            provisional.transaction_payment_preliminary_ars,
            provisional.ledger_tax_preliminary_ars,
            provisional.ledger_cogs_preliminary_ars,
                CASE
                    WHEN provisional.transaction_payment_fee_ars IS NULL OR provisional.operation_revenue_ars <= 0::numeric THEN NULL::numeric
                    WHEN provisional.allocation_position = provisional.allocation_count THEN round(provisional.transaction_payment_fee_ars - COALESCE(sum(provisional.transaction_payment_preliminary_ars) OVER (PARTITION BY provisional.org_id, provisional.operation_key ORDER BY provisional.sale_id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0::numeric), 2)
                    ELSE provisional.transaction_payment_preliminary_ars
                END AS transaction_payment_allocated_ars,
                CASE
                    WHEN provisional.ledger_tax_total_ars IS NULL OR provisional.operation_revenue_ars <= 0::numeric THEN NULL::numeric
                    WHEN provisional.allocation_position = provisional.allocation_count THEN round(provisional.ledger_tax_total_ars - COALESCE(sum(provisional.ledger_tax_preliminary_ars) OVER (PARTITION BY provisional.org_id, provisional.operation_key ORDER BY provisional.sale_id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0::numeric), 2)
                    ELSE provisional.ledger_tax_preliminary_ars
                END AS ledger_tax_allocated_ars,
                CASE
                    WHEN provisional.sale_cogs_ars IS NOT NULL THEN NULL::numeric
                    WHEN provisional.ledger_cogs_total_ars <= provisional.operation_known_cogs_ars OR provisional.missing_cogs_revenue_ars <= 0::numeric THEN NULL::numeric
                    WHEN provisional.missing_cogs_position = provisional.missing_cogs_count THEN round(provisional.ledger_cogs_total_ars - provisional.operation_known_cogs_ars - COALESCE(sum(provisional.ledger_cogs_preliminary_ars) FILTER (WHERE provisional.sale_cogs_ars IS NULL) OVER (PARTITION BY provisional.org_id, provisional.operation_key ORDER BY provisional.sale_id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0::numeric), 2)
                    ELSE provisional.ledger_cogs_preliminary_ars
                END AS ledger_cogs_allocated_ars
           FROM provisional
        ), resolved AS (
         SELECT allocated.sale_id,
            allocated.org_id,
            allocated.product_id,
            allocated.product_name,
            allocated.quantity,
            allocated.sold_at,
            allocated.recorded_source,
            allocated.channel,
            allocated.operation_type,
            allocated.operation_id,
            allocated.operation_key,
            allocated.revenue_ars,
            allocated.sale_cogs_ars,
            allocated.store_payment_fee_ars,
            allocated.store_shipping_cost_ars,
            allocated.store_tax_ars,
            allocated.meli_payment_fee_ars,
            allocated.meli_shipping_cost_ars,
            allocated.line_payment_fee_ars,
            allocated.transaction_payment_fee_ars,
            allocated.ledger_cogs_total_ars,
            allocated.ledger_tax_total_ars,
            allocated.invoice_tax_ars,
            allocated.invoice_id,
            allocated.ecommerce_order_id,
            allocated.sale_transaction_id,
            allocated.meli_order_id,
            allocated.payment_method,
            allocated.split_payments,
            allocated.returned,
            allocated.returned_quantity,
            allocated.operation_revenue_ars,
            allocated.operation_known_cogs_ars,
            allocated.missing_cogs_revenue_ars,
            allocated.missing_cogs_position,
            allocated.missing_cogs_count,
            allocated.allocation_position,
            allocated.allocation_count,
            allocated.transaction_payment_preliminary_ars,
            allocated.ledger_tax_preliminary_ars,
            allocated.ledger_cogs_preliminary_ars,
            allocated.transaction_payment_allocated_ars,
            allocated.ledger_tax_allocated_ars,
            allocated.ledger_cogs_allocated_ars,
            COALESCE(allocated.sale_cogs_ars, allocated.ledger_cogs_allocated_ars) AS cogs_ars,
                CASE
                    WHEN allocated.sale_cogs_ars IS NOT NULL THEN 'sale_snapshot'::text
                    WHEN allocated.ledger_cogs_allocated_ars IS NOT NULL THEN 'ledger_operation_allocation'::text
                    ELSE NULL::text
                END AS cogs_source,
                CASE
                    WHEN allocated.store_payment_fee_ars IS NOT NULL THEN allocated.store_payment_fee_ars
                    WHEN allocated.meli_payment_fee_ars IS NOT NULL THEN allocated.meli_payment_fee_ars
                    WHEN allocated.line_payment_fee_ars IS NOT NULL THEN allocated.line_payment_fee_ars
                    WHEN allocated.payment_method = 'efectivo'::text AND (allocated.split_payments IS NULL OR allocated.split_payments = '[]'::jsonb OR allocated.split_payments = '{}'::jsonb) THEN 0::numeric
                    ELSE allocated.transaction_payment_allocated_ars
                END AS payment_fee_ars,
                CASE
                    WHEN allocated.store_payment_fee_ars IS NOT NULL THEN 'store_settlement'::text
                    WHEN allocated.meli_payment_fee_ars IS NOT NULL THEN 'meli_settlement'::text
                    WHEN allocated.line_payment_fee_ars IS NOT NULL THEN 'payment_transaction_line'::text
                    WHEN allocated.payment_method = 'efectivo'::text AND (allocated.split_payments IS NULL OR allocated.split_payments = '[]'::jsonb OR allocated.split_payments = '{}'::jsonb) THEN 'cash_not_applicable'::text
                    WHEN allocated.transaction_payment_allocated_ars IS NOT NULL THEN 'payment_transaction_allocation'::text
                    ELSE NULL::text
                END AS payment_fee_source,
                CASE
                    WHEN allocated.store_shipping_cost_ars IS NOT NULL THEN allocated.store_shipping_cost_ars
                    WHEN allocated.meli_shipping_cost_ars IS NOT NULL THEN allocated.meli_shipping_cost_ars
                    WHEN allocated.recorded_source = 'pos'::text THEN 0::numeric
                    ELSE NULL::numeric
                END AS shipping_cost_ars,
                CASE
                    WHEN allocated.store_shipping_cost_ars IS NOT NULL THEN 'carrier_settlement'::text
                    WHEN allocated.meli_shipping_cost_ars IS NOT NULL THEN 'meli_settlement'::text
                    WHEN allocated.recorded_source = 'pos'::text THEN 'pos_not_applicable'::text
                    ELSE NULL::text
                END AS shipping_cost_source,
                CASE
                    WHEN allocated.store_tax_ars IS NOT NULL THEN allocated.store_tax_ars
                    WHEN allocated.invoice_tax_ars IS NOT NULL THEN round(allocated.invoice_tax_ars, 2)
                    ELSE allocated.ledger_tax_allocated_ars
                END AS tax_ars,
                CASE
                    WHEN allocated.store_tax_ars IS NOT NULL THEN 'store_order_snapshot'::text
                    WHEN allocated.invoice_tax_ars IS NOT NULL THEN 'invoice_snapshot'::text
                    WHEN allocated.ledger_tax_allocated_ars IS NOT NULL THEN 'ledger_operation_allocation'::text
                    ELSE NULL::text
                END AS tax_source
           FROM allocated
        ), classified AS (
         SELECT resolved.sale_id,
            resolved.org_id,
            resolved.product_id,
            resolved.product_name,
            resolved.quantity,
            resolved.sold_at,
            resolved.recorded_source,
            resolved.channel,
            resolved.operation_type,
            resolved.operation_id,
            resolved.operation_key,
            resolved.revenue_ars,
            resolved.sale_cogs_ars,
            resolved.store_payment_fee_ars,
            resolved.store_shipping_cost_ars,
            resolved.store_tax_ars,
            resolved.meli_payment_fee_ars,
            resolved.meli_shipping_cost_ars,
            resolved.line_payment_fee_ars,
            resolved.transaction_payment_fee_ars,
            resolved.ledger_cogs_total_ars,
            resolved.ledger_tax_total_ars,
            resolved.invoice_tax_ars,
            resolved.invoice_id,
            resolved.ecommerce_order_id,
            resolved.sale_transaction_id,
            resolved.meli_order_id,
            resolved.payment_method,
            resolved.split_payments,
            resolved.returned,
            resolved.returned_quantity,
            resolved.operation_revenue_ars,
            resolved.operation_known_cogs_ars,
            resolved.missing_cogs_revenue_ars,
            resolved.missing_cogs_position,
            resolved.missing_cogs_count,
            resolved.allocation_position,
            resolved.allocation_count,
            resolved.transaction_payment_preliminary_ars,
            resolved.ledger_tax_preliminary_ars,
            resolved.ledger_cogs_preliminary_ars,
            resolved.transaction_payment_allocated_ars,
            resolved.ledger_tax_allocated_ars,
            resolved.ledger_cogs_allocated_ars,
            resolved.cogs_ars,
            resolved.cogs_source,
            resolved.payment_fee_ars,
            resolved.payment_fee_source,
            resolved.shipping_cost_ars,
            resolved.shipping_cost_source,
            resolved.tax_ars,
            resolved.tax_source,
            (resolved.cogs_ars IS NOT NULL)::integer + (resolved.payment_fee_ars IS NOT NULL)::integer + (resolved.shipping_cost_ars IS NOT NULL)::integer + (resolved.tax_ars IS NOT NULL)::integer AS known_components,
            array_remove(ARRAY[
                CASE
                    WHEN resolved.cogs_ars IS NULL THEN 'costo_mercaderia'::text
                    ELSE NULL::text
                END,
                CASE
                    WHEN resolved.payment_fee_ars IS NULL THEN 'comision_cobro'::text
                    ELSE NULL::text
                END,
                CASE
                    WHEN resolved.shipping_cost_ars IS NULL THEN 'costo_envio_real'::text
                    ELSE NULL::text
                END,
                CASE
                    WHEN resolved.tax_ars IS NULL THEN 'iva'::text
                    ELSE NULL::text
                END], NULL::text) AS missing_components
           FROM resolved
        )
 SELECT sale_id,
    org_id,
    product_id,
    product_name,
    quantity,
    sold_at,
    recorded_source,
    channel,
    operation_type,
    operation_id,
    operation_key,
    revenue_ars,
    cogs_ars,
    cogs_source,
    payment_fee_ars,
    payment_fee_source,
    shipping_cost_ars,
    shipping_cost_source,
    tax_ars,
    tax_source,
        CASE
            WHEN cogs_ars IS NOT NULL THEN round(revenue_ars - cogs_ars, 2)
            ELSE NULL::numeric
        END AS gross_margin_ars,
        CASE
            WHEN known_components = 4 THEN round(revenue_ars - cogs_ars - payment_fee_ars - shipping_cost_ars - tax_ars, 2)
            ELSE NULL::numeric
        END AS contribution_margin_ars,
    known_components,
    known_components * 25 AS coverage_pct,
    missing_components,
    known_components = 4 AS is_explainable,
        CASE
            WHEN known_components = 4 THEN 'complete'::text
            WHEN known_components = 0 THEN 'unmeasured'::text
            ELSE 'partial'::text
        END AS quality_status,
    returned,
    returned_quantity
   FROM classified;
REVOKE ALL ON public._sale_margin_facts_source FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public._sale_margin_facts_source TO service_role;

CREATE VIEW public.catalog_product_variants AS
 SELECT v.id,
    v.product_id,
    v.variant_name,
    v.stock,
    v.image_url
   FROM product_variants v
     JOIN catalog_products p ON p.id = v.product_id
  WHERE COALESCE(v.active, true) = true;
REVOKE ALL ON public.catalog_product_variants FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.catalog_product_variants TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.catalog_product_variants TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.catalog_product_variants TO service_role;

CREATE VIEW public.platform_activation_cohort_members WITH (security_invoker=false) AS
 WITH readiness AS (
         SELECT o.id AS org_id,
            o.name AS org_name,
            o.slug,
            o.created_at AS org_created_at,
            date_trunc('month'::text, o.created_at)::date AS cohort_month,
            r.onboarding_goal,
            r.identity_ready,
            r.legal_ready,
            r.catalog_ready,
            r.stock_ready,
            r.online_channel_ready,
            r.online_payment_ready,
            r.online_shipping_ready,
            r.fiscal_ready,
            r.pos_sales_total,
            r.online_orders_total,
            r.first_pos_sale_at,
            r.first_online_sale_at,
                CASE
                    WHEN r.onboarding_goal = 'pos'::text THEN r.first_pos_sale_at
                    WHEN r.onboarding_goal = 'online'::text THEN r.first_online_sale_at
                    ELSE NULL::timestamp with time zone
                END AS first_target_sale_at
           FROM organizations o
             JOIN organization_activation_readiness r ON r.org_id = o.id
          WHERE is_platform_admin(auth.uid())
        ), scored AS (
         SELECT r.org_id,
            r.org_name,
            r.slug,
            r.org_created_at,
            r.cohort_month,
            r.onboarding_goal,
            r.identity_ready,
            r.legal_ready,
            r.catalog_ready,
            r.stock_ready,
            r.online_channel_ready,
            r.online_payment_ready,
            r.online_shipping_ready,
            r.fiscal_ready,
            r.pos_sales_total,
            r.online_orders_total,
            r.first_pos_sale_at,
            r.first_online_sale_at,
            r.first_target_sale_at,
                CASE
                    WHEN COALESCE(r.identity_ready, false) AND (r.onboarding_goal <> 'online'::text OR COALESCE(r.legal_ready, false)) THEN 1
                    ELSE 0
                END +
                CASE
                    WHEN COALESCE(r.catalog_ready, false) THEN 1
                    ELSE 0
                END +
                CASE
                    WHEN COALESCE(r.stock_ready, false) THEN 1
                    ELSE 0
                END +
                CASE
                    WHEN (r.onboarding_goal = ANY (ARRAY['pos'::text, 'online'::text])) AND (r.onboarding_goal <> 'online'::text OR COALESCE(r.online_channel_ready, false)) THEN 1
                    ELSE 0
                END +
                CASE
                    WHEN (r.onboarding_goal = ANY (ARRAY['pos'::text, 'online'::text])) AND (r.onboarding_goal <> 'online'::text OR COALESCE(r.online_payment_ready, false)) THEN 1
                    ELSE 0
                END +
                CASE
                    WHEN (r.onboarding_goal = ANY (ARRAY['pos'::text, 'online'::text])) AND (r.onboarding_goal <> 'online'::text OR COALESCE(r.online_shipping_ready, false)) THEN 1
                    ELSE 0
                END +
                CASE
                    WHEN COALESCE(r.fiscal_ready, false) THEN 1
                    ELSE 0
                END +
                CASE
                    WHEN r.onboarding_goal = 'pos'::text AND COALESCE(r.pos_sales_total, 0::bigint) > 0 THEN 1
                    WHEN r.onboarding_goal = 'online'::text AND COALESCE(r.online_orders_total, 0::bigint) > 0 THEN 1
                    ELSE 0
                END AS readiness_done_count
           FROM readiness r
        ), measurement AS (
         SELECT platform_metric_watermarks.reliable_from AS support_measurement_started_at
           FROM platform_metric_watermarks
          WHERE platform_metric_watermarks.metric_key = 'activation_support_cost'::text
        ), intervention_cost AS (
         SELECT s_1.org_id,
            count(i.id) FILTER (WHERE i.voided_at IS NULL AND (s_1.first_target_sale_at IS NULL OR i.occurred_at <= s_1.first_target_sale_at))::integer AS activation_intervention_count,
            COALESCE(sum(i.minutes_spent) FILTER (WHERE i.voided_at IS NULL AND (s_1.first_target_sale_at IS NULL OR i.occurred_at <= s_1.first_target_sale_at)), 0::bigint)::integer AS activation_intervention_minutes,
            min(i.occurred_at) FILTER (WHERE i.voided_at IS NULL) AS first_intervention_at,
            max(i.occurred_at) FILTER (WHERE i.voided_at IS NULL) AS last_intervention_at
           FROM scored s_1
             LEFT JOIN activation_interventions i ON i.org_id = s_1.org_id
          GROUP BY s_1.org_id
        )
 SELECT (s.org_id::text || ''::text)::uuid AS org_id,
    s.org_name,
    s.slug,
    s.org_created_at,
    s.cohort_month,
    s.onboarding_goal,
    s.readiness_done_count,
    8 AS readiness_total,
    s.first_target_sale_at,
    s.first_target_sale_at IS NOT NULL AS activated,
        CASE
            WHEN s.first_target_sale_at IS NULL THEN NULL::numeric
            ELSE round(GREATEST(0::numeric, EXTRACT(epoch FROM s.first_target_sale_at - s.org_created_at)) / 86400.0, 1)
        END AS days_to_first_sale,
    COALESCE(c.activation_intervention_count, 0) AS activation_intervention_count,
    COALESCE(c.activation_intervention_minutes, 0) AS activation_intervention_minutes,
    c.first_intervention_at,
    c.last_intervention_at,
    s.org_created_at >= measurement.support_measurement_started_at AND s.first_target_sale_at IS NOT NULL AND COALESCE(c.activation_intervention_count, 0) = 0 AS self_service_activated,
    s.org_created_at >= measurement.support_measurement_started_at AND s.first_target_sale_at IS NOT NULL AND COALESCE(c.activation_intervention_count, 0) > 0 AS supported_activated,
    measurement.support_measurement_started_at,
    s.org_created_at >= measurement.support_measurement_started_at AS support_measurement_eligible
   FROM scored s
     CROSS JOIN measurement
     LEFT JOIN intervention_cost c ON c.org_id = s.org_id;
REVOKE ALL ON public.platform_activation_cohort_members FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.platform_activation_cohort_members TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.platform_activation_cohort_members TO service_role;
COMMENT ON VIEW public.platform_activation_cohort_members IS 'Una fila por organización con primera venta del canal objetivo, hitos y costo de ayuda previo a activar.';

CREATE VIEW public.products_public AS
 SELECT id,
    user_id,
    org_id,
    name,
    brand,
    category,
    gender,
    description,
    image_url,
    sale_price_ars,
    discount_price_ars,
    stock
   FROM catalog_products;
REVOKE ALL ON public.products_public FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.products_public TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.products_public TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.products_public TO service_role;

CREATE VIEW public.traza_de_pago AS
 WITH pago AS (
         SELECT pt.correlation_id,
            pt.org_id,
            pt.id AS pago_id,
            pt.status AS pago_estado,
            pt.gross_amount AS monto,
            pt.external_id AS id_del_proveedor,
            pt.provider,
            pt.created_at,
                CASE
                    WHEN pt.source = 'ecommerce'::text THEN pt.source_id
                    ELSE NULL::uuid
                END AS orden_id
           FROM payment_transactions pt
          WHERE pt.correlation_id IS NOT NULL
        )
 SELECT p.correlation_id,
    p.org_id,
    p.created_at,
    p.provider,
    p.monto,
    p.pago_estado,
    p.id_del_proveedor,
    p.pago_id,
    o.id AS orden_id,
    o.payment_status AS orden_estado,
    s.id AS venta_id,
    ( SELECT count(*) AS count
           FROM ledger_entries le
          WHERE le.referencia_tipo = 'venta'::text AND le.referencia_id = s.id) AS asientos,
    ( SELECT count(*) AS count
           FROM payment_operation_trace t
          WHERE t.correlation_id = p.correlation_id) AS pasos_registrados,
        CASE
            WHEN o.id IS NULL THEN 'se cobró y no hay orden'::text
            WHEN s.id IS NULL THEN 'no se puede seguir: la venta no guarda el número de orden'::text
            WHEN NOT (EXISTS ( SELECT 1
               FROM ledger_entries le
              WHERE le.referencia_tipo = 'venta'::text AND le.referencia_id = s.id)) THEN 'hay venta y no llegó al libro'::text
            ELSE 'completo'::text
        END AS donde_se_corto
   FROM pago p
     LEFT JOIN ecommerce_orders o ON o.id = p.orden_id
     LEFT JOIN sales s ON s.ecommerce_order_id = o.id
  WHERE is_org_member(p.org_id, auth.uid()) OR is_platform_admin(auth.uid());
REVOKE ALL ON public.traza_de_pago FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.traza_de_pago TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.traza_de_pago TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.traza_de_pago TO service_role;
COMMENT ON VIEW public.traza_de_pago IS 'Un pago y sus eslabones: cobro, orden, venta, asientos y pasos. `donde_se_corto` distingue plata que no llegó de una operación que no se puede seguir. No guarda nada: recorre los enlaces que ya existen.';

CREATE VIEW public._sale_margin_facts_effective WITH (security_barrier=true) AS
 WITH unresolved_payment AS (
         SELECT payment.org_id,
            payment.source_id AS operation_id
           FROM payment_transactions payment
          WHERE payment.source = 'pos'::text AND payment.source_id IS NOT NULL
          GROUP BY payment.org_id, payment.source_id
         HAVING bool_or(payment.status <> 'approved'::text)
        ), effective AS (
         SELECT source.sale_id,
            source.org_id,
            source.product_id,
            source.product_name,
            source.quantity,
            source.sold_at,
            source.recorded_source,
            source.channel,
            source.operation_type,
            source.operation_id,
            source.operation_key,
            source.revenue_ars,
            source.cogs_ars,
            source.cogs_source,
            source.payment_fee_ars,
            source.payment_fee_source,
            source.shipping_cost_ars,
            source.shipping_cost_source,
            source.tax_ars,
            source.tax_source,
            source.gross_margin_ars,
            source.contribution_margin_ars,
            source.known_components,
            source.coverage_pct,
            source.missing_components,
            source.is_explainable,
            source.quality_status,
            source.returned,
            source.returned_quantity,
            unresolved.operation_id IS NOT NULL AS payment_pending,
            source.known_components -
                CASE
                    WHEN unresolved.operation_id IS NOT NULL AND source.payment_fee_ars IS NOT NULL THEN 1
                    ELSE 0
                END AS effective_known_components
           FROM _sale_margin_facts_source source
             LEFT JOIN unresolved_payment unresolved ON unresolved.org_id = source.org_id AND unresolved.operation_id = source.operation_id
        )
 SELECT sale_id,
    org_id,
    product_id,
    product_name,
    quantity,
    sold_at,
    recorded_source,
    channel,
    operation_type,
    operation_id,
    operation_key,
    revenue_ars,
    cogs_ars,
    cogs_source,
        CASE
            WHEN payment_pending THEN NULL::numeric
            ELSE payment_fee_ars
        END AS payment_fee_ars,
        CASE
            WHEN payment_pending THEN NULL::text
            ELSE payment_fee_source
        END AS payment_fee_source,
    shipping_cost_ars,
    shipping_cost_source,
    tax_ars,
    tax_source,
    gross_margin_ars,
        CASE
            WHEN returned OR returned_quantity > 0 OR payment_pending THEN NULL::numeric
            ELSE contribution_margin_ars
        END AS contribution_margin_ars,
    effective_known_components AS known_components,
    effective_known_components * 25 AS coverage_pct,
        CASE
            WHEN payment_pending AND NOT ('comision_cobro'::text = ANY (missing_components)) THEN array_append(missing_components, 'comision_cobro'::text)
            ELSE missing_components
        END AS missing_components,
    is_explainable AND NOT returned AND returned_quantity = 0 AND NOT payment_pending AS is_explainable,
        CASE
            WHEN returned OR returned_quantity > 0 THEN 'return_pending'::text
            WHEN payment_pending THEN 'settlement_pending'::text
            ELSE quality_status
        END AS quality_status,
    returned,
    returned_quantity,
    array_remove(ARRAY[
        CASE
            WHEN returned OR returned_quantity > 0 THEN 'devolucion_neta'::text
            ELSE NULL::text
        END,
        CASE
            WHEN payment_pending THEN 'liquidacion_cobro'::text
            ELSE NULL::text
        END], NULL::text) AS margin_blockers
   FROM effective;
REVOKE ALL ON public._sale_margin_facts_effective FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public._sale_margin_facts_effective TO service_role;

CREATE VIEW public.platform_activation_cohorts WITH (security_invoker=false) AS
 SELECT cohort_month,
    count(*)::integer AS organizations_total,
    count(*) FILTER (WHERE activated)::integer AS activated_total,
    count(*) FILTER (WHERE NOT activated)::integer AS pending_total,
    count(*) FILTER (WHERE self_service_activated)::integer AS self_service_activated_total,
    count(*) FILTER (WHERE supported_activated)::integer AS supported_activated_total,
    count(*) FILTER (WHERE org_created_at <= (now() - '7 days'::interval))::integer AS eligible_7d_total,
    count(*) FILTER (WHERE org_created_at <= (now() - '7 days'::interval) AND days_to_first_sale <= 7::numeric)::integer AS activated_7d_total,
    count(*) FILTER (WHERE org_created_at <= (now() - '14 days'::interval))::integer AS eligible_14d_total,
    count(*) FILTER (WHERE org_created_at <= (now() - '14 days'::interval) AND days_to_first_sale <= 14::numeric)::integer AS activated_14d_total,
    count(*) FILTER (WHERE org_created_at <= (now() - '30 days'::interval))::integer AS eligible_30d_total,
    count(*) FILTER (WHERE org_created_at <= (now() - '30 days'::interval) AND days_to_first_sale <= 30::numeric)::integer AS activated_30d_total,
    round(100.0 * count(*) FILTER (WHERE activated)::numeric / NULLIF(count(*), 0)::numeric, 1) AS activation_rate_pct,
    round(100.0 * count(*) FILTER (WHERE self_service_activated)::numeric / NULLIF(count(*) FILTER (WHERE activated AND support_measurement_eligible), 0)::numeric, 1) AS self_service_rate_pct,
    round(100.0 * count(*) FILTER (WHERE org_created_at <= (now() - '7 days'::interval) AND days_to_first_sale <= 7::numeric)::numeric / NULLIF(count(*) FILTER (WHERE org_created_at <= (now() - '7 days'::interval)), 0)::numeric, 1) AS activation_7d_rate_pct,
    round(100.0 * count(*) FILTER (WHERE org_created_at <= (now() - '14 days'::interval) AND days_to_first_sale <= 14::numeric)::numeric / NULLIF(count(*) FILTER (WHERE org_created_at <= (now() - '14 days'::interval)), 0)::numeric, 1) AS activation_14d_rate_pct,
    round(100.0 * count(*) FILTER (WHERE org_created_at <= (now() - '30 days'::interval) AND days_to_first_sale <= 30::numeric)::numeric / NULLIF(count(*) FILTER (WHERE org_created_at <= (now() - '30 days'::interval)), 0)::numeric, 1) AS activation_30d_rate_pct,
    COALESCE(sum(activation_intervention_count) FILTER (WHERE support_measurement_eligible), 0::bigint)::integer AS activation_interventions_total,
    COALESCE(sum(activation_intervention_minutes) FILTER (WHERE support_measurement_eligible), 0::bigint)::integer AS activation_intervention_minutes,
    round(COALESCE(sum(activation_intervention_minutes) FILTER (WHERE support_measurement_eligible), 0::bigint)::numeric / NULLIF(count(*) FILTER (WHERE support_measurement_eligible), 0)::numeric, 1) AS avg_support_minutes_per_org,
    round(percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (days_to_first_sale::double precision))::numeric, 1) AS median_days_to_first_sale,
    count(*) FILTER (WHERE support_measurement_eligible)::integer AS support_measurement_eligible_total
   FROM platform_activation_cohort_members m
  GROUP BY cohort_month
  ORDER BY cohort_month DESC;
REVOKE ALL ON public.platform_activation_cohorts FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.platform_activation_cohorts TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.platform_activation_cohorts TO service_role;
COMMENT ON VIEW public.platform_activation_cohorts IS 'Conversión mensual a primera venta del canal objetivo, tasas maduras y costo estructurado de acompañamiento.';

CREATE VIEW public._sale_margin_operations_source WITH (security_barrier=true) AS
 WITH line_context AS (
         SELECT fact.sale_id,
            fact.org_id,
            fact.product_id,
            fact.product_name,
            fact.quantity,
            fact.sold_at,
            fact.recorded_source,
            fact.channel,
            fact.operation_type,
            fact.operation_id,
            fact.operation_key,
            fact.revenue_ars,
            fact.cogs_ars,
            fact.cogs_source,
            fact.payment_fee_ars,
            fact.payment_fee_source,
            fact.shipping_cost_ars,
            fact.shipping_cost_source,
            fact.tax_ars,
            fact.tax_source,
            fact.gross_margin_ars,
            fact.contribution_margin_ars,
            fact.known_components,
            fact.coverage_pct,
            fact.missing_components,
            fact.is_explainable,
            fact.quality_status,
            fact.returned,
            fact.returned_quantity,
            fact.margin_blockers,
            sale.payment_method,
            sale.split_payments,
            round(COALESCE(sale.global_discount_ars, 0::numeric), 2) AS global_discount_ars,
            NULLIF(btrim(sale.coupon_code), ''::text) AS coupon_code,
            COALESCE(sale.discount_applied, false) AS price_discount_applied,
            COALESCE(store_order.order_number, meli_order.meli_order_id::text) AS external_reference
           FROM _sale_margin_facts_effective fact
             JOIN sales sale ON sale.id = fact.sale_id AND sale.org_id = fact.org_id
             LEFT JOIN ecommerce_orders store_order ON store_order.id = sale.ecommerce_order_id AND store_order.org_id = sale.org_id
             LEFT JOIN meli_order_sale_lines meli_line ON meli_line.sale_id = sale.id
             LEFT JOIN meli_orders meli_order ON meli_order.id = meli_line.meli_order_id AND meli_order.org_id = sale.org_id
        ), payment_legs AS (
         SELECT line.org_id,
            line.operation_key,
            COALESCE(NULLIF(btrim(leg.value ->> 'method'::text), ''::text), 'sin_informar'::text) AS payment_method,
                CASE
                    WHEN COALESCE(leg.value ->> 'amount'::text, ''::text) ~ '^-?[0-9]+([.][0-9]+)?$'::text THEN round((leg.value ->> 'amount'::text)::numeric, 2)
                    ELSE NULL::numeric
                END AS amount_ars
           FROM line_context line
             CROSS JOIN LATERAL jsonb_array_elements(
                CASE
                    WHEN jsonb_typeof(line.split_payments) = 'array'::text AND jsonb_array_length(line.split_payments) > 0 THEN line.split_payments
                    ELSE jsonb_build_array(jsonb_build_object('method', COALESCE(NULLIF(btrim(line.payment_method), ''::text), 'sin_informar'::text), 'amount', line.revenue_ars))
                END) leg(value)
        ), payment_method_totals AS (
         SELECT payment_legs.org_id,
            payment_legs.operation_key,
            payment_legs.payment_method,
            round(sum(payment_legs.amount_ars), 2) AS amount_ars
           FROM payment_legs
          GROUP BY payment_legs.org_id, payment_legs.operation_key, payment_legs.payment_method
        ), payment_mix AS (
         SELECT payment_method_totals.org_id,
            payment_method_totals.operation_key,
            array_agg(payment_method_totals.payment_method ORDER BY payment_method_totals.payment_method) AS payment_methods,
            jsonb_agg(jsonb_build_object('method', payment_method_totals.payment_method, 'amount_ars', payment_method_totals.amount_ars) ORDER BY payment_method_totals.payment_method) AS payment_mix,
            round(sum(payment_method_totals.amount_ars), 2) AS payment_mix_total_ars
           FROM payment_method_totals
          GROUP BY payment_method_totals.org_id, payment_method_totals.operation_key
        ), operation_rollup AS (
         SELECT line.org_id,
            line.operation_key,
            (array_agg(line.operation_id ORDER BY line.operation_id))[1] AS operation_id,
            max(line.operation_type) AS operation_type,
            max(line.channel) AS channel,
            max(line.recorded_source) AS recorded_source,
            COALESCE(max(line.external_reference), upper("left"(replace((array_agg(line.operation_id ORDER BY line.operation_id))[1]::text, '-'::text, ''::text), 8))) AS operation_reference,
            min(line.sold_at) AS sold_at,
            count(*) AS line_count,
            sum(line.quantity) AS units,
            round(sum(line.revenue_ars), 2) AS revenue_ars,
            bool_and(line.cogs_ars IS NOT NULL) AS cogs_complete,
            bool_and(line.payment_fee_ars IS NOT NULL) AS payment_fee_complete,
            bool_and(line.shipping_cost_ars IS NOT NULL) AS shipping_complete,
            bool_and(line.tax_ars IS NOT NULL) AS tax_complete,
            round(sum(line.cogs_ars), 2) AS cogs_sum_ars,
            round(sum(line.payment_fee_ars), 2) AS payment_fee_sum_ars,
            round(sum(line.shipping_cost_ars), 2) AS shipping_sum_ars,
            round(sum(line.tax_ars), 2) AS tax_sum_ars,
            COALESCE(array_agg(DISTINCT line.cogs_source ORDER BY line.cogs_source) FILTER (WHERE line.cogs_source IS NOT NULL), ARRAY[]::text[]) AS cogs_sources,
            COALESCE(array_agg(DISTINCT line.payment_fee_source ORDER BY line.payment_fee_source) FILTER (WHERE line.payment_fee_source IS NOT NULL), ARRAY[]::text[]) AS payment_fee_sources,
            COALESCE(array_agg(DISTINCT line.shipping_cost_source ORDER BY line.shipping_cost_source) FILTER (WHERE line.shipping_cost_source IS NOT NULL), ARRAY[]::text[]) AS shipping_sources,
            COALESCE(array_agg(DISTINCT line.tax_source ORDER BY line.tax_source) FILTER (WHERE line.tax_source IS NOT NULL), ARRAY[]::text[]) AS tax_sources,
            round(sum(line.global_discount_ars), 2) AS measured_discount_ars,
            COALESCE(array_agg(DISTINCT line.coupon_code ORDER BY line.coupon_code) FILTER (WHERE line.coupon_code IS NOT NULL), ARRAY[]::text[]) AS coupon_codes,
            count(*) FILTER (WHERE line.price_discount_applied) AS price_discount_lines,
            bool_or(line.global_discount_ars > 0::numeric OR line.coupon_code IS NOT NULL OR line.price_discount_applied) AS has_promotion,
            bool_or(line.coupon_code IS NOT NULL) AS has_coupon_without_amount,
            bool_or(line.price_discount_applied) AS has_price_discount_without_baseline,
            bool_or(cardinality(line.margin_blockers) > 0) AS has_margin_blocker,
            sum(line.returned_quantity) AS returned_units
           FROM line_context line
          GROUP BY line.org_id, line.operation_key
        ), classified AS (
         SELECT operation.org_id,
            operation.operation_key,
            operation.operation_id,
            operation.operation_type,
            operation.channel,
            operation.recorded_source,
            operation.operation_reference,
            operation.sold_at,
            operation.line_count,
            operation.units,
            operation.revenue_ars,
            operation.cogs_complete,
            operation.payment_fee_complete,
            operation.shipping_complete,
            operation.tax_complete,
            operation.cogs_sum_ars,
            operation.payment_fee_sum_ars,
            operation.shipping_sum_ars,
            operation.tax_sum_ars,
            operation.cogs_sources,
            operation.payment_fee_sources,
            operation.shipping_sources,
            operation.tax_sources,
            operation.measured_discount_ars,
            operation.coupon_codes,
            operation.price_discount_lines,
            operation.has_promotion,
            operation.has_coupon_without_amount,
            operation.has_price_discount_without_baseline,
            operation.has_margin_blocker,
            operation.returned_units,
            operation.cogs_complete::integer + operation.payment_fee_complete::integer + operation.shipping_complete::integer + operation.tax_complete::integer AS known_components,
            array_remove(ARRAY[
                CASE
                    WHEN NOT operation.cogs_complete THEN 'costo_mercaderia'::text
                    ELSE NULL::text
                END,
                CASE
                    WHEN NOT operation.payment_fee_complete THEN 'comision_cobro'::text
                    ELSE NULL::text
                END,
                CASE
                    WHEN NOT operation.shipping_complete THEN 'costo_envio_real'::text
                    ELSE NULL::text
                END,
                CASE
                    WHEN NOT operation.tax_complete THEN 'iva'::text
                    ELSE NULL::text
                END], NULL::text) AS missing_components,
            array_remove(ARRAY[
                CASE
                    WHEN operation.has_margin_blocker THEN 'devolucion_neta'::text
                    ELSE NULL::text
                END], NULL::text) AS margin_blockers,
            array_remove(ARRAY[
                CASE
                    WHEN operation.has_coupon_without_amount THEN 'importe_descuento_cupon'::text
                    ELSE NULL::text
                END,
                CASE
                    WHEN operation.has_price_discount_without_baseline THEN 'precio_referencia_historico'::text
                    ELSE NULL::text
                END], NULL::text) AS promotion_missing_evidence
           FROM operation_rollup operation
        )
 SELECT classified.org_id,
    classified.operation_key,
    classified.operation_id,
    classified.operation_type,
    classified.operation_reference,
    classified.channel,
    classified.recorded_source,
    classified.sold_at,
    classified.line_count,
    classified.units,
    classified.revenue_ars,
        CASE
            WHEN classified.cogs_complete THEN classified.cogs_sum_ars
            ELSE NULL::numeric
        END AS cogs_ars,
        CASE
            WHEN classified.payment_fee_complete THEN classified.payment_fee_sum_ars
            ELSE NULL::numeric
        END AS payment_fee_ars,
        CASE
            WHEN classified.shipping_complete THEN classified.shipping_sum_ars
            ELSE NULL::numeric
        END AS shipping_cost_ars,
        CASE
            WHEN classified.tax_complete THEN classified.tax_sum_ars
            ELSE NULL::numeric
        END AS tax_ars,
        CASE
            WHEN classified.known_components = 4 AND NOT classified.has_margin_blocker THEN round(classified.revenue_ars - classified.cogs_sum_ars - classified.payment_fee_sum_ars - classified.shipping_sum_ars - classified.tax_sum_ars, 2)
            ELSE NULL::numeric
        END AS contribution_margin_ars,
    classified.known_components,
    classified.known_components * 25 AS coverage_pct,
    classified.missing_components,
    classified.margin_blockers,
    classified.known_components = 4 AND NOT classified.has_margin_blocker AS is_explainable,
        CASE
            WHEN classified.has_margin_blocker THEN 'return_pending'::text
            WHEN classified.known_components = 4 THEN 'complete'::text
            WHEN classified.known_components = 0 THEN 'unmeasured'::text
            ELSE 'partial'::text
        END AS quality_status,
    classified.cogs_sources,
    classified.payment_fee_sources,
    classified.shipping_sources,
    classified.tax_sources,
    COALESCE(mix.payment_methods, ARRAY[]::text[]) AS payment_methods,
    COALESCE(mix.payment_mix, '[]'::jsonb) AS payment_mix,
    round(classified.revenue_ars - COALESCE(mix.payment_mix_total_ars, 0::numeric), 2) AS payment_mix_difference_ars,
    classified.has_promotion,
    classified.measured_discount_ars,
    classified.coupon_codes,
    classified.price_discount_lines,
    classified.promotion_missing_evidence,
        CASE
            WHEN NOT classified.has_promotion THEN 'not_applicable'::text
            WHEN cardinality(classified.promotion_missing_evidence) > 0 THEN 'partial'::text
            ELSE 'measured'::text
        END AS promotion_evidence_status,
    classified.returned_units
   FROM classified
     LEFT JOIN payment_mix mix ON mix.org_id = classified.org_id AND mix.operation_key = classified.operation_key;
REVOKE ALL ON public._sale_margin_operations_source FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public._sale_margin_operations_source TO service_role;

CREATE VIEW public.platform_org_margin_coverage WITH (security_barrier=true) AS
 SELECT organization.id AS org_id,
    count(facts.sale_id) AS sales_lines,
    count(DISTINCT facts.operation_key) AS operations,
    round(COALESCE(sum(facts.revenue_ars), 0::numeric), 2) AS revenue_ars,
    count(facts.sale_id) FILTER (WHERE facts.cogs_ars IS NOT NULL) AS cogs_known_lines,
    count(facts.sale_id) FILTER (WHERE facts.payment_fee_ars IS NOT NULL) AS payment_fee_known_lines,
    count(facts.sale_id) FILTER (WHERE facts.shipping_cost_ars IS NOT NULL) AS shipping_known_lines,
    count(facts.sale_id) FILTER (WHERE facts.tax_ars IS NOT NULL) AS tax_known_lines,
    count(facts.sale_id) FILTER (WHERE facts.is_explainable) AS explainable_lines,
    round(COALESCE(sum(facts.revenue_ars) FILTER (WHERE facts.is_explainable), 0::numeric), 2) AS explainable_revenue_ars,
        CASE
            WHEN COALESCE(sum(facts.revenue_ars), 0::numeric) > 0::numeric THEN round(100::numeric * COALESCE(sum(facts.revenue_ars) FILTER (WHERE facts.is_explainable), 0::numeric) / sum(facts.revenue_ars), 1)
            ELSE NULL::numeric
        END AS explainable_revenue_pct,
    round(avg(facts.coverage_pct), 1) AS average_coverage_pct,
    round(sum(facts.contribution_margin_ars) FILTER (WHERE facts.is_explainable), 2) AS measured_contribution_margin_ars
   FROM organizations organization
     LEFT JOIN _sale_margin_facts_effective facts ON facts.org_id = organization.id
  WHERE is_platform_admin(auth.uid())
  GROUP BY organization.id;
REVOKE ALL ON public.platform_org_margin_coverage FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.platform_org_margin_coverage TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.platform_org_margin_coverage TO service_role;
COMMENT ON VIEW public.platform_org_margin_coverage IS 'Cobertura agregada del margen canónico por organización para Control Plane; no expone detalle comercial ni PII.';

CREATE VIEW public.sale_margin_facts WITH (security_barrier=true) AS
 SELECT sale_id,
    org_id,
    product_id,
    product_name,
    quantity,
    sold_at,
    recorded_source,
    channel,
    operation_type,
    operation_id,
    operation_key,
    revenue_ars,
    cogs_ars,
    cogs_source,
    payment_fee_ars,
    payment_fee_source,
    shipping_cost_ars,
    shipping_cost_source,
    tax_ars,
    tax_source,
    gross_margin_ars,
    contribution_margin_ars,
    known_components,
    coverage_pct,
    missing_components,
    is_explainable,
    quality_status,
    returned,
    returned_quantity,
    margin_blockers
   FROM _sale_margin_facts_effective effective
  WHERE is_org_member(org_id, auth.uid()) AND has_permission(org_id, 'analytics'::text, 'view'::text);
REVOKE ALL ON public.sale_margin_facts FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.sale_margin_facts TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.sale_margin_facts TO service_role;
COMMENT ON VIEW public.sale_margin_facts IS 'Hechos canónicos por línea. Margen de contribución sólo cuando costo, comisión, envío real e IVA tienen evidencia persistida; null nunca significa cero.';

CREATE VIEW public._sale_margin_operations_effective WITH (security_barrier=true) AS
 WITH unresolved_payment AS (
         SELECT payment.org_id,
            payment.source_id AS operation_id
           FROM payment_transactions payment
          WHERE payment.source = 'pos'::text AND payment.source_id IS NOT NULL
          GROUP BY payment.org_id, payment.source_id
         HAVING bool_or(payment.status <> 'approved'::text)
        )
 SELECT operation.org_id,
    operation.operation_key,
    operation.operation_id,
    operation.operation_type,
    operation.operation_reference,
    operation.channel,
    operation.recorded_source,
    operation.sold_at,
    operation.line_count,
    operation.units,
    operation.revenue_ars,
    operation.cogs_ars,
    operation.payment_fee_ars,
    operation.shipping_cost_ars,
    operation.tax_ars,
    operation.contribution_margin_ars,
    operation.known_components,
    operation.coverage_pct,
    operation.missing_components,
    array_remove(ARRAY[
        CASE
            WHEN operation.returned_units > 0 THEN 'devolucion_neta'::text
            ELSE NULL::text
        END,
        CASE
            WHEN unresolved.operation_id IS NOT NULL THEN 'liquidacion_cobro'::text
            ELSE NULL::text
        END], NULL::text) AS margin_blockers,
    operation.is_explainable,
        CASE
            WHEN operation.returned_units > 0 THEN 'return_pending'::text
            WHEN unresolved.operation_id IS NOT NULL THEN 'settlement_pending'::text
            ELSE operation.quality_status
        END AS quality_status,
    operation.cogs_sources,
    operation.payment_fee_sources,
    operation.shipping_sources,
    operation.tax_sources,
    operation.payment_methods,
    operation.payment_mix,
    operation.payment_mix_difference_ars,
    operation.has_promotion,
    operation.measured_discount_ars,
    operation.coupon_codes,
    operation.price_discount_lines,
    operation.promotion_missing_evidence,
    operation.promotion_evidence_status,
    operation.returned_units
   FROM _sale_margin_operations_source operation
     LEFT JOIN unresolved_payment unresolved ON unresolved.org_id = operation.org_id AND unresolved.operation_id = operation.operation_id;
REVOKE ALL ON public._sale_margin_operations_effective FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public._sale_margin_operations_effective TO service_role;

CREATE VIEW public.organization_margin_coverage WITH (security_invoker=true) AS
 SELECT org_id,
    count(*) AS sales_lines,
    count(DISTINCT operation_key) AS operations,
    round(sum(revenue_ars), 2) AS revenue_ars,
    count(*) FILTER (WHERE cogs_ars IS NOT NULL) AS cogs_known_lines,
    count(*) FILTER (WHERE payment_fee_ars IS NOT NULL) AS payment_fee_known_lines,
    count(*) FILTER (WHERE shipping_cost_ars IS NOT NULL) AS shipping_known_lines,
    count(*) FILTER (WHERE tax_ars IS NOT NULL) AS tax_known_lines,
    count(*) FILTER (WHERE is_explainable) AS explainable_lines,
    round(COALESCE(sum(revenue_ars) FILTER (WHERE is_explainable), 0::numeric), 2) AS explainable_revenue_ars,
    round(100::numeric * COALESCE(sum(revenue_ars) FILTER (WHERE is_explainable), 0::numeric) / NULLIF(sum(revenue_ars), 0::numeric), 1) AS explainable_revenue_pct,
    round(avg(coverage_pct), 1) AS average_coverage_pct,
    round(sum(contribution_margin_ars) FILTER (WHERE is_explainable), 2) AS measured_contribution_margin_ars
   FROM sale_margin_facts facts
  GROUP BY org_id;
REVOKE ALL ON public.organization_margin_coverage FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.organization_margin_coverage TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.organization_margin_coverage TO service_role;

CREATE VIEW public.sale_margin_dimensions WITH (security_barrier=true) AS
 SELECT fact.sale_id,
    fact.org_id,
    fact.product_id,
    fact.product_name,
    fact.quantity,
    fact.sold_at,
    fact.recorded_source,
    fact.channel,
    fact.operation_type,
    fact.operation_id,
    fact.operation_key,
    fact.revenue_ars,
    fact.cogs_ars,
    fact.cogs_source,
    fact.payment_fee_ars,
    fact.payment_fee_source,
    fact.shipping_cost_ars,
    fact.shipping_cost_source,
    fact.tax_ars,
    fact.tax_source,
    fact.gross_margin_ars,
    fact.contribution_margin_ars,
    fact.known_components,
    fact.coverage_pct,
    fact.missing_components,
    fact.is_explainable,
    fact.quality_status,
    fact.returned,
    fact.returned_quantity,
    fact.margin_blockers,
    variant.id AS variant_id,
        CASE
            WHEN variant.id IS NOT NULL THEN NULLIF(variant.sku, ''::text)
            WHEN sale.variant_id IS NULL THEN NULLIF(product.sku, ''::text)
            ELSE NULL::text
        END AS sku,
    variant.variant_name,
        CASE
            WHEN variant.id IS NOT NULL OR sale.variant_id IS NULL AND product.id IS NOT NULL THEN 'current_catalog'::text
            ELSE 'unavailable'::text
        END AS sku_source,
    store.id AS store_id
   FROM sale_margin_facts fact
     JOIN sales sale ON sale.id = fact.sale_id AND sale.org_id = fact.org_id
     LEFT JOIN products product ON product.id = fact.product_id AND product.org_id = fact.org_id
     LEFT JOIN product_variants variant ON variant.id = sale.variant_id AND variant.product_id = fact.product_id AND variant.org_id = fact.org_id
     LEFT JOIN ecommerce_orders customer_order ON fact.channel = 'tienda_online'::text AND customer_order.id = sale.ecommerce_order_id AND customer_order.org_id = fact.org_id
     LEFT JOIN ecommerce_stores store ON store.id = customer_order.store_id AND store.org_id = fact.org_id
  WHERE is_org_member(fact.org_id, auth.uid()) AND has_permission(fact.org_id, 'analytics'::text, 'view'::text);
REVOKE ALL ON public.sale_margin_dimensions FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.sale_margin_dimensions TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.sale_margin_dimensions TO service_role;

CREATE VIEW public.sale_margin_operations WITH (security_barrier=true) AS
 SELECT org_id,
    operation_key,
    operation_id,
    operation_type,
    operation_reference,
    channel,
    recorded_source,
    sold_at,
    line_count,
    units,
    revenue_ars,
    cogs_ars,
    payment_fee_ars,
    shipping_cost_ars,
    tax_ars,
    contribution_margin_ars,
    known_components,
    coverage_pct,
    missing_components,
    margin_blockers,
    is_explainable,
    quality_status,
    cogs_sources,
    payment_fee_sources,
    shipping_sources,
    tax_sources,
    payment_methods,
    payment_mix,
    payment_mix_difference_ars,
    has_promotion,
    measured_discount_ars,
    coupon_codes,
    price_discount_lines,
    promotion_missing_evidence,
    promotion_evidence_status,
    returned_units
   FROM _sale_margin_operations_effective operation
  WHERE is_org_member(org_id, auth.uid()) AND has_permission(org_id, 'analytics'::text, 'view'::text);
REVOKE ALL ON public.sale_margin_operations FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.sale_margin_operations TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.sale_margin_operations TO service_role;
COMMENT ON VIEW public.sale_margin_operations IS 'Explicación canónica por ticket/orden: cuatro costos, fuentes, mix de cobro, evidencia promocional y blockers de devolución sin PII.';

CREATE OR REPLACE FUNCTION public.get_store_catalog_products(p_slug text)
 RETURNS SETOF store_catalog_products
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT
    product.id,
    product.org_id,
    product.user_id,
    product.name,
    product.brand,
    COALESCE(publication.category_slug, product.category),
    product.gender,
    product.description,
    product.image_url,
    product.image_urls,
    CASE
      WHEN publication.price_ars IS NOT NULL
        THEN COALESCE(publication.compare_at_price_ars, publication.price_ars)
      ELSE product.sale_price_ars
    END,
    CASE
      WHEN publication.price_ars IS NOT NULL
        AND publication.compare_at_price_ars > publication.price_ars
        THEN publication.price_ars
      WHEN publication.price_ars IS NULL THEN product.discount_price_ars
      ELSE NULL::numeric
    END,
    product.price_2x_ars,
    product.stock,
    product.content_ml,
    product.total_sold,
    COALESCE(publication.featured, product.featured, false),
    product.offer_expires_at,
    product.created_at,
    CASE WHEN COALESCE(product.content_ml, 0) > 0 THEN round(
      COALESCE(product.total_cost_usd, product.cost_usd, 0) / product.content_ml * 10
      * COALESCE(settings.exchange_rate, 0)
      * (1 + COALESCE(settings.decant_margin_10ml, 250) / 100.0)
    ) END,
    CASE WHEN COALESCE(product.content_ml, 0) > 0 THEN round(
      COALESCE(product.total_cost_usd, product.cost_usd, 0) / product.content_ml * 5
      * COALESCE(settings.exchange_rate, 0)
      * (1 + COALESCE(settings.decant_margin_5ml, 350) / 100.0)
    ) END,
    CASE WHEN COALESCE(product.content_ml, 0) > 0 THEN round(
      COALESCE(product.total_cost_usd, product.cost_usd, 0) / product.content_ml * 2.5
      * COALESCE(settings.exchange_rate, 0)
      * (1 + COALESCE(settings.decant_margin_2_5ml, 500) / 100.0)
    ) END,
    CASE
      WHEN COALESCE(product.offer_stacks_payment, store.payment_discount_stacks, false)
        THEN COALESCE(
          CASE WHEN publication.price_ars IS NOT NULL
            THEN publication.price_ars END,
          NULLIF(product.discount_price_ars, 0), product.sale_price_ars
        )
      ELSE CASE
        WHEN publication.price_ars IS NOT NULL
          THEN COALESCE(publication.compare_at_price_ars, publication.price_ars)
        ELSE product.sale_price_ars
      END
    END,
    public.store_promo_price(
      product.org_id,
      product.id,
      COALESCE(publication.category_slug, product.category),
      CASE
        WHEN publication.price_ars IS NOT NULL
          THEN COALESCE(publication.compare_at_price_ars, publication.price_ars)
        ELSE product.sale_price_ars
      END,
      NULL::numeric
    )
  FROM public.ecommerce_stores store
  JOIN public.products product ON product.org_id = store.org_id
  LEFT JOIN public.store_product_publications publication
    ON publication.store_id = store.id
   AND publication.product_id = product.id
  LEFT JOIN public.settings settings ON settings.org_id = product.org_id
  WHERE lower(store.slug) = lower(btrim(p_slug))
    AND store.is_active
    AND COALESCE(product.is_active, true)
    AND COALESCE(publication.visibility, 'published') = 'published'
    AND CASE
      WHEN publication.price_ars IS NOT NULL THEN publication.price_ars
      ELSE COALESCE(NULLIF(product.discount_price_ars, 0), product.sale_price_ars)
    END > 0
  ORDER BY
    COALESCE(publication.sort_order, 2147483647),
    COALESCE(publication.featured, product.featured, false) DESC,
    product.name ASC;
$function$;
REVOKE ALL ON FUNCTION public.get_store_catalog_products(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_store_catalog_products(text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_store_catalog_products(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_store_catalog_products(text) TO service_role;
COMMENT ON FUNCTION public.get_store_catalog_products(text) IS 'Catálogo público seguro resuelto por slug; comparte productos del Core y aplica configuración comercial de la vitrina.';

CREATE TRIGGER trg_notify_low_stock AFTER UPDATE OF stock ON public.products FOR EACH ROW EXECUTE FUNCTION notify_low_stock();
CREATE TRIGGER trg_sale_stock_movement AFTER INSERT OR DELETE OR UPDATE OF product_id, variant_id, quantity, location_id ON public.sales FOR EACH ROW EXECUTE FUNCTION trg_sale_stock_movement();

DROP FUNCTION public.record_stock_movement(uuid,uuid,uuid,text,text,text,integer,text,uuid,numeric,numeric,text,uuid,uuid);
CREATE OR REPLACE FUNCTION public.record_stock_movement(p_org_id uuid, p_product_id uuid, p_variant_id uuid, p_product_name text, p_variant_name text, p_movement_type text, p_quantity numeric, p_reference_type text DEFAULT NULL::text, p_reference_id uuid DEFAULT NULL::uuid, p_unit_cost_usd numeric DEFAULT NULL::numeric, p_unit_price_ars numeric DEFAULT NULL::numeric, p_notes text DEFAULT NULL::text, p_created_by uuid DEFAULT NULL::uuid, p_location_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_resuelto jsonb;
  v_costo_ars numeric;
  v_stock_before numeric;
  v_stock_after  numeric;
  v_mov_id       UUID;
  v_location_id  UUID := p_location_id;
BEGIN

  -- ── Una organización que ya no existe no recibe movimientos ───────────
  --
  -- Al borrar una organización, Postgres saca la fila de `organizations`
  -- ANTES de correr las cascadas. Cuando la cascada llega a `sales` dispara
  -- `trg_sale_stock_movement` en DELETE, que entra acá a devolver el stock —
  -- y el INSERT en `stock_movements` choca contra la FK del `org_id` que la
  -- misma sentencia acaba de borrar (23503). El orden entre cascadas no está
  -- garantizado: no se puede confiar en que el Kardex se limpie antes.
  --
  -- Devuelve NULL y no escribe: un movimiento de una organización borrada es
  -- una fila que nadie puede conciliar.
  IF NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = p_org_id) THEN
    RETURN NULL;
  END IF;


  -- ── Un producto puede no llevar stock ───────────────────────────────────
  --
  -- Un servicio —un corte de pelo, una hora de consultoría, un plato de un
  -- restaurante— se vende igual que un producto: tiene precio, va al POS, sale
  -- en la factura y suma al margen. Lo que no tiene es algo que descontar.
  --
  -- Sin esta guarda, cada venta lo empuja a −1, −2, −3, y `stock_negativo`
  -- —que según CLAUDE.md tiene que estar vacía— se llena de servicios. El
  -- panel diría «agotado» sobre algo que nunca se agota.
  --
  -- ⚠️ La decisión vive ACÁ y no en los triggers porque ésta es la única
  -- autoridad sobre el stock: cubre de una sola vez la venta, la compra, el
  -- ajuste manual, el cierre de conteo físico y la transferencia entre
  -- sucursales. Repartirla entre los triggers sería la misma decisión escrita
  -- en cinco lugares, que en este repo ya divergió dos veces.
  --
  -- Devuelve NULL —no hay movimiento— y no escribe en `stock_movements`: un
  -- Kardex de algo que no se stockea sería una fila que nadie puede conciliar.
  IF p_product_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.products p
     WHERE p.id = p_product_id AND p.maneja_stock IS FALSE
  ) THEN
    RETURN NULL;
  END IF;
  -- Cantidades fraccionadas sólo para productos que se venden por medida
  -- (kg, metro, litro, m2). Un producto por unidad conserva el stock entero.
  IF p_quantity IS NULL OR p_quantity <> round(p_quantity, 3) THEN
    RAISE EXCEPTION 'La cantidad admite hasta tres decimales';
  END IF;
  IF p_quantity <> trunc(p_quantity) AND p_product_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.products p WHERE p.id = p_product_id AND p.unidad_medida <> 'unidad'
  ) THEN
    RAISE EXCEPTION 'Este producto se vende por unidad: la cantidad debe ser entera';
  END IF;

  -- Con una sola sucursal activa, cualquier stock sin ubicación sólo puede
  -- estar ahí. Así una variante creada después de habilitar sucursales no
  -- queda global e invisible para la tienda. Con dos o más no se adivina.
  IF v_location_id IS NULL THEN
    SELECT min(l.id::text)::uuid INTO v_location_id
    FROM public.locations l
    WHERE l.org_id = p_org_id AND l.active
    HAVING count(*) = 1;
  END IF;

  IF v_location_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.locations l
    WHERE l.id = v_location_id AND l.org_id = p_org_id
  ) THEN
    RAISE EXCEPTION 'La sucursal del movimiento no pertenece a la organización'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF p_variant_id IS NOT NULL THEN
    SELECT stock INTO v_stock_before
    FROM public.product_variants
    WHERE id = p_variant_id AND product_id = p_product_id AND org_id = p_org_id;
  ELSE
    SELECT stock INTO v_stock_before
    FROM public.products
    WHERE id = p_product_id AND org_id = p_org_id;
  END IF;
  v_stock_before := COALESCE(v_stock_before, 0);
  v_stock_after  := v_stock_before + p_quantity;

  IF p_variant_id IS NOT NULL THEN
    UPDATE public.product_variants
       SET stock = v_stock_after
     WHERE id = p_variant_id AND product_id = p_product_id AND org_id = p_org_id;
    UPDATE public.products p
       SET stock = (
         SELECT COALESCE(SUM(pv.stock), 0)
         FROM public.product_variants pv
         WHERE pv.product_id = p.id
       )
     WHERE id = p_product_id AND org_id = p_org_id;
  ELSE
    UPDATE public.products
       SET stock = v_stock_after
     WHERE id = p_product_id AND org_id = p_org_id;
  END IF;

  IF v_location_id IS NOT NULL AND p_product_id IS NOT NULL THEN
    INSERT INTO public.location_stock (org_id, location_id, product_id, stock, updated_at)
    VALUES (p_org_id, v_location_id, p_product_id, p_quantity, now())
    ON CONFLICT (location_id, product_id) DO UPDATE
      SET stock = public.location_stock.stock + EXCLUDED.stock,
          updated_at = now();

    IF p_variant_id IS NOT NULL THEN
      INSERT INTO public.location_variant_stock (
        org_id, location_id, product_id, variant_id, stock, updated_at
      ) VALUES (
        p_org_id, v_location_id, p_product_id, p_variant_id, p_quantity, now()
      )
      ON CONFLICT (location_id, variant_id) DO UPDATE
        SET stock = public.location_variant_stock.stock + EXCLUDED.stock,
            updated_at = now(),
            product_id = EXCLUDED.product_id,
            org_id = EXCLUDED.org_id;
    END IF;
  END IF;

  -- ⚠️ El costo en pesos se CONGELA acá, en el momento del movimiento.
  --
  -- Antes sólo se guardaba `unit_cost_usd` y el ledger lo multiplicaba por la
  -- cotización **de hoy**: una devaluación reescribía el margen de las ventas
  -- del mes pasado. Es el estándar de cualquier ERP —Odoo, SAP B1, Dynamics—
  -- convertir una vez, en la transacción, y no volver a tocarlo.
  --
  -- Y para un producto cuyo costo es en pesos, `unit_cost_usd` es NULL: sin
  -- esta columna entraba al libro con costo cero.
  v_resuelto := public.costo_unitario_ars(p_org_id, p_product_id, p_variant_id);
  v_costo_ars := CASE
    -- Si vino un costo en dólares explícito en la llamada, manda ése: es el de
    -- la compra que se está registrando, no el del catálogo.
    WHEN COALESCE(p_unit_cost_usd, 0) > 0 AND (v_resuelto->>'moneda') = 'USD'
         AND COALESCE((v_resuelto->>'tipo_cambio')::numeric, 0) > 0
      THEN public.redondear_moneda(p_unit_cost_usd * (v_resuelto->>'tipo_cambio')::numeric, 'ARS')
    ELSE NULLIF(v_resuelto->>'costo_ars', '')::numeric
  END;

  INSERT INTO public.stock_movements (
    org_id, product_id, variant_id, product_name, variant_name,
    movement_type, quantity, stock_before, stock_after,
    reference_type, reference_id, unit_cost_usd, unit_cost_ars, unit_price_ars, notes, created_by,
    location_id
  ) VALUES (
    p_org_id, p_product_id, p_variant_id, p_product_name, p_variant_name,
    p_movement_type, p_quantity, v_stock_before, v_stock_after,
    p_reference_type, p_reference_id, p_unit_cost_usd, v_costo_ars, p_unit_price_ars, p_notes, p_created_by,
    v_location_id
  ) RETURNING id INTO v_mov_id;

  RETURN v_mov_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.record_stock_movement(uuid,uuid,uuid,text,text,text,numeric,text,uuid,numeric,numeric,text,uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_stock_movement(uuid,uuid,uuid,text,text,text,numeric,text,uuid,numeric,numeric,text,uuid,uuid) TO service_role;
COMMENT ON FUNCTION public.record_stock_movement(uuid,uuid,uuid,text,text,text,numeric,text,uuid,numeric,numeric,text,uuid,uuid) IS 'Único lugar que mueve stock. Mantiene el total, location_stock y el detalle location_variant_stock; sólo infiere ubicación cuando la organización tiene exactamente una sucursal activa.';

DROP FUNCTION public.adjust_stock(uuid,uuid,uuid,integer,text,uuid,uuid);
CREATE OR REPLACE FUNCTION public.adjust_stock(p_org_id uuid, p_product_id uuid, p_variant_id uuid, p_new_stock numeric, p_notes text, p_created_by uuid, p_location_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_current_stock numeric;
  v_delta numeric;
  v_product_name text;
  v_variant_name text;
  v_movement_type text;
  v_location_id uuid := p_location_id;
  v_active_locations integer;
BEGIN
  IF p_new_stock < 0 THEN
    RAISE EXCEPTION 'El stock objetivo no puede ser negativo';
  END IF;
  IF auth.uid() IS NULL THEN
    IF auth.role() IS DISTINCT FROM 'service_role' THEN
      RAISE EXCEPTION 'Unauthorized';
    END IF;
  ELSIF auth.uid() IS DISTINCT FROM p_created_by THEN
    RAISE EXCEPTION 'Unauthorized: el actor no coincide con la sesión';
  END IF;
  IF NOT public.is_org_member(p_org_id, p_created_by) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- P1-04: ser miembro no es tener el permiso. Sin esto, un vendedor con
  -- «Inventario» desmarcado en Admin → Permisos podía ajustar el stock a mano.
  PERFORM public.exigir_permiso(p_org_id, 'inventory', 'edit', 'ajustar el stock a mano');

  SELECT name INTO v_product_name
  FROM public.products
  WHERE id = p_product_id AND org_id = p_org_id;
  IF v_product_name IS NULL THEN
    RAISE EXCEPTION 'Producto no encontrado en la organización';
  END IF;
  IF p_variant_id IS NOT NULL THEN
    SELECT variant_name INTO v_variant_name
    FROM public.product_variants
    WHERE id = p_variant_id AND product_id = p_product_id AND org_id = p_org_id;
    IF v_variant_name IS NULL THEN
      RAISE EXCEPTION 'Variante no encontrada para el producto';
    END IF;
  END IF;

  SELECT count(*) INTO v_active_locations
  FROM public.locations
  WHERE org_id = p_org_id AND active;

  IF v_location_id IS NULL AND v_active_locations = 1 THEN
    SELECT min(id::text)::uuid INTO v_location_id
    FROM public.locations
    WHERE org_id = p_org_id AND active;
  END IF;
  IF v_location_id IS NULL AND p_variant_id IS NOT NULL AND v_active_locations > 1 THEN
    RAISE EXCEPTION 'Elegí el depósito para ajustar esta variante: hay % sucursales activas', v_active_locations
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_location_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.locations l
    WHERE l.id = v_location_id AND l.org_id = p_org_id AND l.active
  ) THEN
    RAISE EXCEPTION 'El depósito tiene que estar activo y pertenecer a la organización'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF v_location_id IS NOT NULL AND p_variant_id IS NOT NULL THEN
    SELECT stock INTO v_current_stock
    FROM public.location_variant_stock
    WHERE location_id = v_location_id AND product_id = p_product_id AND variant_id = p_variant_id
    FOR UPDATE;
  ELSIF v_location_id IS NOT NULL THEN
    SELECT stock INTO v_current_stock
    FROM public.location_stock
    WHERE location_id = v_location_id AND product_id = p_product_id
    FOR UPDATE;
  ELSIF p_variant_id IS NOT NULL THEN
    SELECT stock INTO v_current_stock
    FROM public.product_variants
    WHERE id = p_variant_id AND product_id = p_product_id;
  ELSE
    SELECT stock INTO v_current_stock
    FROM public.products
    WHERE id = p_product_id AND org_id = p_org_id;
  END IF;

  v_current_stock := COALESCE(v_current_stock, 0);
  v_delta := p_new_stock - v_current_stock;
  IF v_delta = 0 THEN
    RETURN NULL;
  END IF;
  v_movement_type := CASE WHEN v_delta > 0 THEN 'adjustment_in' ELSE 'adjustment_out' END;

  RETURN public.record_stock_movement(
    p_org_id => p_org_id,
    p_product_id => p_product_id,
    p_variant_id => p_variant_id,
    p_product_name => v_product_name,
    p_variant_name => v_variant_name,
    p_movement_type => v_movement_type,
    p_quantity => v_delta,
    p_reference_type => 'manual',
    p_notes => p_notes,
    p_created_by => p_created_by,
    p_location_id => v_location_id
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.adjust_stock(uuid,uuid,uuid,numeric,text,uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.adjust_stock(uuid,uuid,uuid,numeric,text,uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.adjust_stock(uuid,uuid,uuid,numeric,text,uuid,uuid) TO service_role;
COMMENT ON FUNCTION public.adjust_stock(uuid,uuid,uuid,numeric,text,uuid,uuid) IS 'Fija stock global o por depósito mediante Kardex. Para una variante con más de una sucursal activa, p_location_id es obligatorio: el sistema no inventa dónde quedó el ajuste.';

DROP FUNCTION public.record_manual_stock_movement(uuid,uuid,uuid,text,integer,text,uuid);
CREATE OR REPLACE FUNCTION public.record_manual_stock_movement(p_org_id uuid, p_product_id uuid, p_variant_id uuid, p_movement_type text, p_quantity numeric, p_notes text, p_created_by uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_product_name text;
  v_variant_name text;
BEGIN
  -- ⚠️ Endurecimiento: esta función es SECURITY DEFINER y recibe la
  -- organización por parámetro. Sin esto, cualquier usuario autenticado podía
  -- operar sobre OTRA organización pasándole el uuid — y los compradores de la
  -- tienda también son usuarios autenticados, así que la superficie era
  -- cualquiera que se hubiera registrado para comprar un perfume.
  IF NOT public.is_org_member(p_org_id, auth.uid())
     AND NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Sin permiso sobre esa organización' USING ERRCODE = '42501';
  END IF;

  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_created_by THEN
    RAISE EXCEPTION 'Unauthorized: el actor no coincide con la sesión';
  END IF;

  IF NOT public.has_org_role(p_org_id, auth.uid(), ARRAY['owner','admin']) THEN
    RAISE EXCEPTION 'Unauthorized: requires owner/admin role';
  END IF;

  IF p_quantity = 0 THEN
    RAISE EXCEPTION 'La cantidad del movimiento no puede ser cero';
  END IF;

  IF p_movement_type NOT IN ('breakage','gift','reservation','adjustment_in','adjustment_out') THEN
    RAISE EXCEPTION 'Invalid movement_type: %', p_movement_type;
  END IF;

  SELECT name INTO v_product_name
  FROM public.products
  WHERE id = p_product_id AND org_id = p_org_id;
  IF v_product_name IS NULL THEN
    RAISE EXCEPTION 'Product not found: %', p_product_id;
  END IF;

  IF p_variant_id IS NOT NULL THEN
    SELECT variant_name INTO v_variant_name
    FROM public.product_variants
    WHERE id = p_variant_id AND product_id = p_product_id;
    IF v_variant_name IS NULL THEN
      RAISE EXCEPTION 'Variant not found for product: %', p_variant_id;
    END IF;
  END IF;

  RETURN public.record_stock_movement(
    p_org_id => p_org_id,
    p_product_id => p_product_id,
    p_variant_id => p_variant_id,
    p_product_name => v_product_name,
    p_variant_name => v_variant_name,
    p_movement_type => p_movement_type,
    p_quantity => p_quantity,
    p_reference_type => 'manual',
    p_reference_id => NULL,
    p_notes => p_notes,
    p_created_by => auth.uid()
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.record_manual_stock_movement(uuid,uuid,uuid,text,numeric,text,uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_manual_stock_movement(uuid,uuid,uuid,text,numeric,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_manual_stock_movement(uuid,uuid,uuid,text,numeric,text,uuid) TO service_role;

DROP FUNCTION public.record_member_stock_movement(uuid,uuid,uuid,text,integer,text,uuid,numeric,numeric,text);
CREATE OR REPLACE FUNCTION public.record_member_stock_movement(p_org_id uuid, p_product_id uuid, p_variant_id uuid, p_movement_type text, p_quantity numeric, p_reference_type text DEFAULT NULL::text, p_reference_id uuid DEFAULT NULL::uuid, p_unit_cost_usd numeric DEFAULT NULL::numeric, p_unit_price_ars numeric DEFAULT NULL::numeric, p_notes text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_product_name text;
  v_variant_name text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_org_member(p_org_id, auth.uid()) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- P1-04: ser miembro no es tener el permiso. Sin esto, un vendedor con
  -- «Inventario» desmarcado en Admin → Permisos podía registrar un movimiento de stock.
  PERFORM public.exigir_permiso(p_org_id, 'inventory', 'edit', 'registrar un movimiento de stock');

  IF p_quantity = 0 THEN
    RAISE EXCEPTION 'La cantidad del movimiento no puede ser cero';
  END IF;

  IF p_movement_type NOT IN ('return', 'return_in', 'invoice_credit_note', 'influencer_exchange') THEN
    RAISE EXCEPTION 'Tipo de movimiento no permitido: %', p_movement_type;
  END IF;

  SELECT name INTO v_product_name
  FROM public.products
  WHERE id = p_product_id AND org_id = p_org_id;
  IF v_product_name IS NULL THEN
    RAISE EXCEPTION 'Producto no encontrado en la organización';
  END IF;

  IF p_variant_id IS NOT NULL THEN
    SELECT variant_name INTO v_variant_name
    FROM public.product_variants
    WHERE id = p_variant_id AND product_id = p_product_id;
    IF v_variant_name IS NULL THEN
      RAISE EXCEPTION 'Variante no encontrada para el producto';
    END IF;
  END IF;

  RETURN public.record_stock_movement(
    p_org_id => p_org_id,
    p_product_id => p_product_id,
    p_variant_id => p_variant_id,
    p_product_name => v_product_name,
    p_variant_name => v_variant_name,
    p_movement_type => p_movement_type,
    p_quantity => p_quantity,
    p_reference_type => p_reference_type,
    p_reference_id => p_reference_id,
    p_unit_cost_usd => p_unit_cost_usd,
    p_unit_price_ars => p_unit_price_ars,
    p_notes => p_notes,
    p_created_by => auth.uid()
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.record_member_stock_movement(uuid,uuid,uuid,text,numeric,text,uuid,numeric,numeric,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_member_stock_movement(uuid,uuid,uuid,text,numeric,text,uuid,numeric,numeric,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_member_stock_movement(uuid,uuid,uuid,text,numeric,text,uuid,numeric,numeric,text) TO service_role;

DROP FUNCTION public.transfer_stock_between_locations(uuid,uuid,uuid,integer,text,uuid);
CREATE OR REPLACE FUNCTION public.transfer_stock_between_locations(p_from_location_id uuid, p_to_location_id uuid, p_product_id uuid, p_quantity numeric, p_notes text DEFAULT NULL::text, p_variant_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_org          uuid;
  v_user         uuid := auth.uid();
  v_product_name text;
  v_variant_name text;
  v_disp         numeric;
  v_origen       numeric;
  v_destino      numeric;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'La cantidad a transferir tiene que ser mayor que cero'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_from_location_id = p_to_location_id THEN
    RAISE EXCEPTION 'El origen y el destino son la misma sucursal'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT p.org_id, p.name INTO v_org, v_product_name
  FROM public.products p
  WHERE p.id = p_product_id;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'El producto no existe' USING ERRCODE = 'no_data_found';
  END IF;
  IF NOT public.is_org_member(v_org, v_user) THEN
    RAISE EXCEPTION 'Sin permiso sobre este producto' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- P1-04: ser miembro no es tener el permiso. Sin esto, un vendedor con
  -- «Inventario» desmarcado en Admin → Permisos podía transferir stock entre sucursales.
  PERFORM public.exigir_permiso(v_org, 'inventory', 'edit', 'transferir stock entre sucursales');
  IF (
    SELECT count(*) FROM public.locations l
    WHERE l.id IN (p_from_location_id, p_to_location_id)
      AND l.org_id = v_org
      AND l.active
  ) <> 2 THEN
    RAISE EXCEPTION 'Origen y destino tienen que ser sucursales activas de esta organización'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_variant_id IS NULL AND EXISTS (
    SELECT 1 FROM public.product_variants v WHERE v.product_id = p_product_id
  ) THEN
    RAISE EXCEPTION 'Este producto tiene variantes: elegí el talle, sabor o presentación que vas a transferir'
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_variant_id IS NOT NULL THEN
    SELECT v.variant_name INTO v_variant_name
    FROM public.product_variants v
    WHERE v.id = p_variant_id
      AND v.product_id = p_product_id
      AND v.org_id = v_org;
    IF v_variant_name IS NULL THEN
      RAISE EXCEPTION 'La variante no pertenece al producto de esta organización'
        USING ERRCODE = 'invalid_parameter_value';
    END IF;

    -- La fila exacta de la variante es la cerradura. Dos transferencias de la
    -- misma presentación no leen el mismo saldo y no pueden gastar dos veces.
    SELECT lvs.stock INTO v_disp
    FROM public.location_variant_stock lvs
    WHERE lvs.location_id = p_from_location_id
      AND lvs.product_id = p_product_id
      AND lvs.variant_id = p_variant_id
    FOR UPDATE;
  ELSE
    SELECT ls.stock INTO v_disp
    FROM public.location_stock ls
    WHERE ls.location_id = p_from_location_id
      AND ls.product_id = p_product_id
    FOR UPDATE;
  END IF;

  IF COALESCE(v_disp, 0) < p_quantity THEN
    RAISE EXCEPTION 'En la sucursal de origen hay % unidades de "%" y se quieren mover %',
      COALESCE(v_disp, 0),
      CASE WHEN v_variant_name IS NULL THEN v_product_name
           ELSE v_product_name || ' (' || v_variant_name || ')' END,
      p_quantity
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  PERFORM public.record_stock_movement(
    p_org_id=>v_org, p_product_id=>p_product_id, p_variant_id=>p_variant_id,
    p_product_name=>v_product_name, p_variant_name=>v_variant_name,
    p_movement_type=>'transfer_out', p_quantity=>-p_quantity,
    p_reference_type=>'location_transfer', p_reference_id=>NULL,
    p_notes=>p_notes, p_created_by=>v_user,
    p_location_id=>p_from_location_id
  );
  PERFORM public.record_stock_movement(
    p_org_id=>v_org, p_product_id=>p_product_id, p_variant_id=>p_variant_id,
    p_product_name=>v_product_name, p_variant_name=>v_variant_name,
    p_movement_type=>'transfer_in', p_quantity=>p_quantity,
    p_reference_type=>'location_transfer', p_reference_id=>NULL,
    p_notes=>p_notes, p_created_by=>v_user,
    p_location_id=>p_to_location_id
  );

  INSERT INTO public.stock_transfers (
    org_id, from_location_id, to_location_id, product_id, variant_id,
    product_name, variant_name, quantity, notes, transferred_by
  ) VALUES (
    v_org, p_from_location_id, p_to_location_id, p_product_id, p_variant_id,
    v_product_name, v_variant_name, p_quantity, p_notes, v_user
  );

  IF p_variant_id IS NOT NULL THEN
    SELECT stock INTO v_origen FROM public.location_variant_stock
    WHERE location_id = p_from_location_id AND variant_id = p_variant_id;
    SELECT stock INTO v_destino FROM public.location_variant_stock
    WHERE location_id = p_to_location_id AND variant_id = p_variant_id;
  ELSE
    SELECT stock INTO v_origen FROM public.location_stock
    WHERE location_id = p_from_location_id AND product_id = p_product_id;
    SELECT stock INTO v_destino FROM public.location_stock
    WHERE location_id = p_to_location_id AND product_id = p_product_id;
  END IF;

  RETURN jsonb_build_object(
    'producto', CASE WHEN v_variant_name IS NULL THEN v_product_name
                     ELSE v_product_name || ' — ' || v_variant_name END,
    'variant_id', p_variant_id,
    'origen', COALESCE(v_origen, 0),
    'destino', COALESCE(v_destino, 0)
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.transfer_stock_between_locations(uuid,uuid,uuid,numeric,text,uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.transfer_stock_between_locations(uuid,uuid,uuid,numeric,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.transfer_stock_between_locations(uuid,uuid,uuid,numeric,text,uuid) TO service_role;
COMMENT ON FUNCTION public.transfer_stock_between_locations(uuid,uuid,uuid,numeric,text,uuid) IS 'Mueve un producto simple o una variante exacta entre dos sucursales activas. Un producto con variantes exige p_variant_id; valida y bloquea el saldo del origen, registra las dos puntas por record_stock_movement y conserva el Kardex.';

CREATE OR REPLACE FUNCTION public.cerrar_conteo(p_count_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_org uuid; v_loc uuid; v_estado text; v_user uuid := auth.uid();
  r record;
  v_actual numeric;
  v_ajuste numeric;
  v_ajustados int := 0;
  v_sin_contar int;
  v_unidades numeric := 0;
BEGIN
  SELECT c.org_id, c.location_id, c.status INTO v_org, v_loc, v_estado
    FROM public.stock_counts c WHERE c.id = p_count_id;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'El conteo no existe' USING ERRCODE = 'no_data_found';
  END IF;
  IF NOT public.is_org_member(v_org, v_user) THEN
    RAISE EXCEPTION 'Sin permiso sobre este conteo' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- P1-04: ser miembro no es tener el permiso. Sin esto, un vendedor con
  -- «Inventario» desmarcado en Admin → Permisos podía cerrar un conteo y ajustar el stock.
  PERFORM public.exigir_permiso(v_org, 'inventory', 'edit', 'cerrar un conteo y ajustar el stock');
  IF v_estado <> 'abierto' THEN
    RAISE EXCEPTION 'El conteo ya está %', v_estado USING ERRCODE = 'invalid_parameter_value';
  END IF;

  FOR r IN
    SELECT i.id, i.product_id, i.counted, i.expected, p.name
    FROM public.stock_count_items i
    JOIN public.products p ON p.id = i.product_id
    WHERE i.count_id = p_count_id AND i.counted IS NOT NULL
  LOOP
    -- Contra el stock del momento del cierre, no contra lo congelado: las
    -- ventas ocurridas mientras se contaba son reales y ya se descontaron.
    IF v_loc IS NULL THEN
      SELECT COALESCE(p.stock, 0) INTO v_actual FROM public.products p WHERE p.id = r.product_id;
    ELSE
      SELECT COALESCE(ls.stock, 0) INTO v_actual FROM public.location_stock ls
       WHERE ls.location_id = v_loc AND ls.product_id = r.product_id;
      v_actual := COALESCE(v_actual, 0);
    END IF;

    v_ajuste := r.counted - v_actual;

    UPDATE public.stock_count_items
       SET stock_al_cerrar = v_actual, ajuste = v_ajuste
     WHERE id = r.id;

    IF v_ajuste <> 0 THEN
      -- Por la única función que mueve stock. Escribirlo a mano acá sería
      -- repetir exactamente el error que hizo falta contar el inventario.
      PERFORM public.record_stock_movement(
        p_org_id=>v_org, p_product_id=>r.product_id, p_variant_id=>NULL,
        p_product_name=>r.name, p_variant_name=>NULL,
        p_movement_type=>'count_adjustment', p_quantity=>v_ajuste,
        p_reference_type=>'stock_count', p_reference_id=>p_count_id,
        p_notes=>format('Conteo físico: esperado %s, contado %s', r.expected, r.counted),
        p_created_by=>v_user, p_location_id=>v_loc
      );
      v_ajustados := v_ajustados + 1;
      v_unidades := v_unidades + abs(v_ajuste);
    END IF;
  END LOOP;

  SELECT count(*) INTO v_sin_contar
    FROM public.stock_count_items WHERE count_id = p_count_id AND counted IS NULL;

  UPDATE public.stock_counts
     SET status = 'cerrado', closed_at = now(), closed_by = v_user
   WHERE id = p_count_id;

  RETURN jsonb_build_object(
    'productos_ajustados', v_ajustados,
    'unidades_corregidas', v_unidades,
    -- Se informa a propósito: cerrar con la mitad sin contar es válido —un
    -- conteo cíclico cuenta un sector por vez— pero tiene que verse.
    'sin_contar', v_sin_contar
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_purchase_stock_movement()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_org_id UUID;
  v_fila   RECORD;
  v_viejo  numeric := 0;
  v_nuevo  numeric := 0;
BEGIN
  v_fila := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;

  v_org_id := v_fila.org_id;
  IF v_org_id IS NULL THEN
    SELECT m.org_id INTO v_org_id FROM public.memberships m
     WHERE m.user_id = v_fila.user_id ORDER BY m.joined_at LIMIT 1;
  END IF;
  IF v_org_id IS NULL THEN RETURN v_fila; END IF;

  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    v_viejo := CASE WHEN COALESCE(OLD.is_scheduled, false) THEN 0 ELSE COALESCE(OLD.quantity, 0) END;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    v_nuevo := CASE WHEN COALESCE(NEW.is_scheduled, false) THEN 0 ELSE COALESCE(NEW.quantity, 0) END;
  END IF;

  -- Cambio de producto: se revierte del viejo y se aplica al nuevo, porque una
  -- diferencia no significa nada entre dos productos distintos.
  IF TG_OP = 'UPDATE' AND OLD.product_id IS DISTINCT FROM NEW.product_id THEN
    IF OLD.product_id IS NOT NULL AND v_viejo <> 0 THEN
      PERFORM public.record_stock_movement(
        p_org_id=>v_org_id, p_product_id=>OLD.product_id, p_variant_id=>NULL,
        p_product_name=>OLD.product_name, p_variant_name=>NULL,
        p_movement_type=>'purchase_edited', p_quantity=>-v_viejo,
        p_reference_type=>'purchase', p_reference_id=>OLD.id,
        p_unit_cost_usd=>OLD.unit_cost_usd, p_created_by=>OLD.user_id,
        p_location_id=>OLD.location_id);
    END IF;
    IF NEW.product_id IS NOT NULL AND v_nuevo <> 0 THEN
      PERFORM public.record_stock_movement(
        p_org_id=>v_org_id, p_product_id=>NEW.product_id, p_variant_id=>NULL,
        p_product_name=>NEW.product_name, p_variant_name=>NULL,
        p_movement_type=>'purchase', p_quantity=>v_nuevo,
        p_reference_type=>'purchase', p_reference_id=>NEW.id,
        p_unit_cost_usd=>NEW.unit_cost_usd, p_created_by=>NEW.user_id,
        p_location_id=>NEW.location_id);
    END IF;
    RETURN NEW;
  END IF;

  -- Mismo producto: alcanza con la diferencia. Cubre alta (0 → q), recepción de
  -- una programada (0 → q), edición de cantidad y baja (q → 0).
  IF (v_nuevo - v_viejo) <> 0 AND v_fila.product_id IS NOT NULL THEN
    PERFORM public.record_stock_movement(
      p_org_id=>v_org_id, p_product_id=>v_fila.product_id, p_variant_id=>NULL,
      p_product_name=>v_fila.product_name, p_variant_name=>NULL,
      p_movement_type=>CASE
        WHEN TG_OP = 'DELETE' THEN 'purchase_deleted'
        WHEN TG_OP = 'UPDATE' THEN 'purchase_edited'
        ELSE 'purchase' END,
      p_quantity=>(v_nuevo - v_viejo),
      p_reference_type=>'purchase', p_reference_id=>v_fila.id,
      p_unit_cost_usd=>v_fila.unit_cost_usd, p_created_by=>v_fila.user_id,
      p_location_id=>v_fila.location_id);
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_sales_return_v1(p_org_id uuid, p_sale_id uuid, p_lines jsonb, p_refund_allocations jsonb, p_reason text, p_notes text DEFAULT NULL::text, p_restock boolean DEFAULT true, p_client_return_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_selected public.sales;
  v_existing public.sales_return_transactions;
  v_operation public.sales_return_transactions;
  v_line jsonb;
  v_allocation jsonb;
  v_sale public.sales;
  v_payment public.payment_transactions;
  v_return_id uuid;
  v_refund_id uuid;
  v_variant_name text;
  v_requested_qty numeric;
  v_returned_qty numeric;
  v_available_qty numeric;
  v_returned_amount numeric;
  v_returned_cost numeric;
  v_line_amount numeric;
  v_line_cost numeric;
  v_line_tax numeric;
  v_total numeric := 0;
  v_total_tax numeric := 0;
  v_total_cost numeric := 0;
  v_allocated numeric := 0;
  v_amount numeric;
  v_available_payment numeric;
  v_payment_refunded numeric;
  v_payment_id uuid;
  v_sale_method text;
  v_provider text;
  v_method text;
  v_execution text;
  v_status text;
  v_location_id uuid;
  v_location_count integer;
  v_cash_session uuid;
  v_cash_amount numeric := 0;
  v_fingerprint text;
  v_normalized_lines jsonb := '[]'::jsonb;
  v_normalized_allocations jsonb := '[]'::jsonb;
  v_tax_enabled boolean;
  v_tax_percent numeric;
  v_prices_include_tax boolean;
  v_issuer_type text;
  v_tax_breakdown jsonb;
  v_product_tax numeric;
  v_credit_note_required boolean := false;
  v_ledger_lines jsonb := '[]'::jsonb;
  v_account text;
  v_pending_count integer := 0;
  v_request_id uuid := COALESCE(p_client_return_id, gen_random_uuid());
BEGIN
  IF v_actor IS NULL OR NOT public.is_org_member(p_org_id, v_actor) THEN
    RAISE EXCEPTION 'Sin permiso sobre esta organización'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM public.exigir_permiso(p_org_id, 'sales', 'edit', 'registrar la devolución');
  PERFORM public.exigir_permiso(p_org_id, 'payments', 'edit', 'reintegrar el cobro');

  IF p_client_return_id IS NULL THEN
    RAISE EXCEPTION 'Falta la identidad idempotente de la devolución';
  END IF;
  IF COALESCE(btrim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'Elegí un motivo para la devolución';
  END IF;
  IF jsonb_typeof(p_lines) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_lines) = 0
     OR jsonb_array_length(p_lines) > 100 THEN
    RAISE EXCEPTION 'La devolución debe incluir entre 1 y 100 renglones';
  END IF;
  IF jsonb_typeof(p_refund_allocations) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_refund_allocations) = 0
     OR jsonb_array_length(p_refund_allocations) > 20 THEN
    RAISE EXCEPTION 'Indicá cómo se reparte el reintegro sobre el cobro original';
  END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(p_lines))
     <> (SELECT count(DISTINCT value->>'sale_id') FROM jsonb_array_elements(p_lines)) THEN
    RAISE EXCEPTION 'Un renglón de venta no puede repetirse en la devolución';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'sales-return:' || p_org_id::text || ':' || v_request_id::text, 0
  ));

  -- La identidad se resuelve antes de mirar saldos mutables. Un retry de una
  -- devolución total encuentra primero su resultado; no falla diciendo que ya
  -- no quedan unidades, que es justamente el efecto del primer intento.
  v_fingerprint := encode(extensions.digest(convert_to(jsonb_build_object(
    'sale_id', p_sale_id,
    'lines', (SELECT jsonb_agg(value ORDER BY value->>'sale_id') FROM jsonb_array_elements(p_lines)),
    'allocations', (SELECT jsonb_agg(value ORDER BY COALESCE(value->>'payment_transaction_id', value->>'sale_method')) FROM jsonb_array_elements(p_refund_allocations)),
    'reason', btrim(p_reason),
    'notes', NULLIF(btrim(COALESCE(p_notes, '')), ''),
    'restock', COALESCE(p_restock, true)
  )::text, 'UTF8'), 'sha256'::text), 'hex');

  SELECT * INTO v_existing
  FROM public.sales_return_transactions operation
  WHERE operation.org_id = p_org_id
    AND operation.client_return_id = v_request_id
  FOR UPDATE;
  IF v_existing.id IS NOT NULL THEN
    IF v_existing.request_fingerprint IS DISTINCT FROM v_fingerprint THEN
      RAISE EXCEPTION 'La identidad de devolución ya fue usada con otro contenido'
        USING ERRCODE = 'unique_violation';
    END IF;
    RETURN public.sales_return_response(v_existing.id)
      || jsonb_build_object('reused', true);
  END IF;

  SELECT * INTO v_selected
  FROM public.sales sale
  WHERE sale.id = p_sale_id AND sale.org_id = p_org_id
  FOR UPDATE;
  IF v_selected.id IS NULL THEN
    RAISE EXCEPTION 'La venta no existe en esta organización';
  END IF;
  IF v_selected.source = 'tienda_online' OR v_selected.ecommerce_order_id IS NOT NULL THEN
    RAISE EXCEPTION 'Las órdenes online se devuelven desde RMA';
  END IF;
  IF NOT v_selected.paid THEN
    RAISE EXCEPTION 'La venta no figura cobrada; corregí la cobranza antes de reintegrar';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'sales-return-ticket:' || COALESCE(v_selected.sale_transaction_id, v_selected.id)::text, 0
  ));

  SELECT count(DISTINCT sale.location_id), min(sale.location_id::text)::uuid
    INTO v_location_count, v_location_id
  FROM public.sales sale
  WHERE sale.org_id = p_org_id
    AND (
      (v_selected.sale_transaction_id IS NOT NULL AND sale.sale_transaction_id = v_selected.sale_transaction_id)
      OR (v_selected.sale_transaction_id IS NULL AND sale.id = v_selected.id)
    );
  IF v_location_count > 1 THEN
    RAISE EXCEPTION 'El ticket mezcla sucursales y requiere revisión antes de devolver';
  END IF;

  SELECT settings.tax_enabled, settings.tax_iva_percent,
         settings.tax_prices_include_iva, settings.afip_tipo_emisor
    INTO v_tax_enabled, v_tax_percent, v_prices_include_tax, v_issuer_type
  FROM public.settings settings
  WHERE settings.org_id = p_org_id;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    IF COALESCE(v_line->>'sale_id', '') !~* '^[0-9a-f-]{36}$'
       OR COALESCE(v_line->>'quantity', '') !~ '^[1-9][0-9]*$' THEN
      RAISE EXCEPTION 'Cada renglón necesita una venta y una cantidad entera positiva';
    END IF;
    v_requested_qty := (v_line->>'quantity')::numeric;
    SELECT * INTO v_sale
    FROM public.sales sale
    WHERE sale.id = (v_line->>'sale_id')::uuid
      AND sale.org_id = p_org_id
      AND (
        (v_selected.sale_transaction_id IS NOT NULL AND sale.sale_transaction_id = v_selected.sale_transaction_id)
        OR (v_selected.sale_transaction_id IS NULL AND sale.id = v_selected.id)
      )
    FOR UPDATE;
    IF v_sale.id IS NULL THEN
      RAISE EXCEPTION 'Un renglón no pertenece al ticket seleccionado';
    END IF;
    IF NOT v_sale.paid OR v_sale.quantity <= 0 OR v_sale.total_ars <= 0 THEN
      RAISE EXCEPTION 'El renglón % no tiene cantidad e importe cobrados válidos', v_sale.product_name;
    END IF;

    SELECT COALESCE(sum(line.quantity), 0),
           round(COALESCE(sum(line.amount_ars), 0), 2),
           round(COALESCE(sum(line.cost_amount_ars), 0), 2)
      INTO v_returned_qty, v_returned_amount, v_returned_cost
    FROM public.returns line
    WHERE line.org_id = p_org_id AND line.sale_id = v_sale.id;

    v_available_qty := v_sale.quantity - v_returned_qty;
    IF v_requested_qty > v_available_qty THEN
      RAISE EXCEPTION 'De % se vendieron %, ya se devolvieron % y quedan %',
        v_sale.product_name, v_sale.quantity, v_returned_qty, v_available_qty;
    END IF;

    v_line_amount := CASE WHEN v_requested_qty = v_available_qty
      THEN round(v_sale.total_ars - v_returned_amount, 2)
      ELSE round(v_sale.total_ars * v_requested_qty / v_sale.quantity, 2) END;
    v_line_cost := CASE WHEN v_requested_qty = v_available_qty
      THEN round(v_sale.cost_of_goods_ars - v_returned_cost, 2)
      ELSE round(v_sale.cost_of_goods_ars * v_requested_qty / v_sale.quantity, 2) END;
    IF v_line_amount <= 0 OR v_line_cost < 0 THEN
      RAISE EXCEPTION 'Los importes restantes de % no son conciliables', v_sale.product_name;
    END IF;

    SELECT product.tax_rate INTO v_product_tax
    FROM public.products product
    WHERE product.id = v_sale.product_id AND product.org_id = p_org_id;
    IF public.discrimina_iva(v_issuer_type) AND COALESCE(v_tax_enabled, false) THEN
      v_tax_breakdown := public.desglosar_iva(
        v_line_amount, COALESCE(v_product_tax, v_tax_percent, 0),
        COALESCE(v_prices_include_tax, true)
      );
      v_line_tax := round(COALESCE((v_tax_breakdown->>'iva')::numeric, 0), 2);
    ELSE
      v_line_tax := 0;
    END IF;

    v_total := v_total + v_line_amount;
    v_total_tax := v_total_tax + v_line_tax;
    v_total_cost := v_total_cost + v_line_cost;
    v_normalized_lines := v_normalized_lines || jsonb_build_array(jsonb_build_object(
      'sale_id', v_sale.id,
      'product_id', v_sale.product_id,
      'variant_id', v_sale.variant_id,
      'product_name', v_sale.product_name,
      'quantity', v_requested_qty,
      'amount', v_line_amount,
      'tax', v_line_tax,
      'cost', v_line_cost,
      'location_id', v_sale.location_id,
      'unit_price', v_sale.unit_price_ars
    ));
    v_credit_note_required := v_credit_note_required OR EXISTS (
      SELECT 1 FROM public.invoices invoice
      WHERE invoice.id = v_sale.invoice_id AND invoice.cae IS NOT NULL
    );
  END LOOP;

  v_total := round(v_total, 2);
  v_total_tax := round(v_total_tax, 2);
  v_total_cost := round(v_total_cost, 2);

  FOR v_allocation IN SELECT value FROM jsonb_array_elements(p_refund_allocations)
  LOOP
    IF COALESCE(v_allocation->>'amount', '') !~ '^[0-9]+([.][0-9]{1,2})?$' THEN
      RAISE EXCEPTION 'Cada parte del reintegro necesita un importe positivo con hasta dos decimales';
    END IF;
    v_amount := round((v_allocation->>'amount')::numeric, 2);
    IF v_amount <= 0 THEN RAISE EXCEPTION 'El importe a reintegrar debe ser mayor que cero'; END IF;

    v_payment_id := NULLIF(v_allocation->>'payment_transaction_id', '')::uuid;
    IF v_payment_id IS NOT NULL THEN
      SELECT * INTO v_payment
      FROM public.payment_transactions payment
      WHERE payment.id = v_payment_id
        AND payment.org_id = p_org_id
        AND payment.source = 'pos'
        AND payment.source_id = v_selected.sale_transaction_id
        AND payment.status NOT IN ('failed', 'cancelled')
      FOR UPDATE;
      IF v_payment.id IS NULL THEN
        RAISE EXCEPTION 'Una parte del reintegro no pertenece al cobro original';
      END IF;
      IF EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_normalized_allocations) normalized
        WHERE normalized->>'payment_transaction_id' = v_payment.id::text
      ) THEN
        RAISE EXCEPTION 'Una parte del cobro original no puede repetirse';
      END IF;
      SELECT round(COALESCE(sum(refund.amount), 0), 2)
        INTO v_payment_refunded
      FROM public.sales_return_refunds refund
      WHERE refund.payment_transaction_id = v_payment.id
        AND refund.status <> 'failed';
      v_available_payment := round(v_payment.gross_amount - v_payment_refunded, 2);
      v_sale_method := COALESCE(NULLIF(lower(btrim(v_payment.raw->>'sale_method')), ''), v_payment.method);
      v_provider := v_payment.provider;
      v_method := v_payment.method;
      v_execution := CASE
        WHEN v_provider = 'efectivo' OR v_method = 'cash' THEN 'cash'
        WHEN v_provider = 'mercadopago'
         AND COALESCE(v_payment.raw->>'provider_order_id', v_payment.external_id) IS NOT NULL
          THEN 'mercadopago_api'
        ELSE 'manual_external' END;
    ELSE
      v_sale_method := lower(btrim(COALESCE(v_allocation->>'sale_method', '')));
      IF v_sale_method = '' THEN
        RAISE EXCEPTION 'Falta el medio original del reintegro';
      END IF;
      IF EXISTS (
        SELECT 1 FROM public.payment_transactions payment
        WHERE payment.org_id = p_org_id
          AND payment.source = 'pos'
          AND payment.source_id = v_selected.sale_transaction_id
          AND payment.status NOT IN ('failed', 'cancelled')
      ) THEN
        RAISE EXCEPTION 'El ticket tiene evidencia de cobro: usá sus identificadores, no un medio manual';
      END IF;
      SELECT codes.provider, codes.method INTO v_provider, v_method
      FROM public.pos_payment_method_codes(v_sale_method) codes;
      SELECT round(COALESCE(sum(sale.total_ars), 0), 2)
        - round(COALESCE((
          SELECT sum(refund.amount)
          FROM public.sales_return_refunds refund
          JOIN public.sales_return_transactions operation
            ON operation.id = refund.return_transaction_id
          WHERE operation.org_id = p_org_id
            AND operation.sale_transaction_id IS NOT DISTINCT FROM v_selected.sale_transaction_id
            AND operation.legacy_sale_id IS NOT DISTINCT FROM CASE
              WHEN v_selected.sale_transaction_id IS NULL THEN v_selected.id ELSE NULL END
            AND refund.payment_transaction_id IS NULL
            AND refund.sale_method = v_sale_method
            AND refund.status <> 'failed'
        ), 0), 2)
        INTO v_available_payment
      FROM public.sales sale
      WHERE sale.org_id = p_org_id AND sale.paid
        AND lower(btrim(sale.payment_method)) = v_sale_method
        AND (
          (v_selected.sale_transaction_id IS NOT NULL AND sale.sale_transaction_id = v_selected.sale_transaction_id)
          OR (v_selected.sale_transaction_id IS NULL AND sale.id = v_selected.id)
        );
      v_execution := CASE WHEN v_method = 'cash' THEN 'cash' ELSE 'manual_external' END;
    END IF;

    IF v_amount > COALESCE(v_available_payment, 0) + 0.01 THEN
      RAISE EXCEPTION 'El reintegro por % supera el saldo original disponible de %',
        v_sale_method, v_available_payment;
    END IF;
    v_allocated := v_allocated + v_amount;
    v_normalized_allocations := v_normalized_allocations || jsonb_build_array(jsonb_build_object(
      'payment_transaction_id', v_payment_id,
      'sale_method', v_sale_method,
      'provider', v_provider,
      'method', v_method,
      'amount', v_amount,
      'execution_mode', v_execution
    ));
    IF v_execution = 'cash' THEN v_cash_amount := v_cash_amount + v_amount; END IF;
  END LOOP;

  IF abs(round(v_allocated, 2) - v_total) > 0.01 THEN
    RAISE EXCEPTION 'El reintegro suma % y los productos devueltos suman %',
      round(v_allocated, 2), v_total;
  END IF;

  IF v_cash_amount > 0 THEN
    IF v_location_id IS NULL THEN
      RAISE EXCEPTION 'El efectivo requiere una sucursal en la venta original';
    END IF;
    SELECT session.id INTO v_cash_session
    FROM public.cash_sessions session
    WHERE session.org_id = p_org_id
      AND session.location_id = v_location_id
      AND session.status = 'open'
    FOR UPDATE;
    IF v_cash_session IS NULL THEN
      RAISE EXCEPTION 'Abrí la caja de la sucursal antes de devolver efectivo';
    END IF;
  END IF;

  INSERT INTO public.sales_return_transactions (
    org_id, sale_transaction_id, legacy_sale_id, client_return_id,
    request_fingerprint, status, reason, notes, restock, refund_amount,
    currency, cash_session_id, credit_note_required, created_by
  ) VALUES (
    p_org_id, v_selected.sale_transaction_id,
    CASE WHEN v_selected.sale_transaction_id IS NULL THEN v_selected.id ELSE NULL END,
    v_request_id, v_fingerprint, 'pending_refund', left(btrim(p_reason), 300),
    NULLIF(left(btrim(COALESCE(p_notes, '')), 2000), ''),
    COALESCE(p_restock, true), v_total, 'ARS', v_cash_session,
    v_credit_note_required, v_actor
  ) RETURNING * INTO v_operation;

  FOR v_line IN SELECT value FROM jsonb_array_elements(v_normalized_lines)
  LOOP
    INSERT INTO public.returns (
      org_id, user_id, sale_id, product_id, variant_id, product_name,
      quantity, amount_ars, reason, refund_method, notes,
      return_transaction_id, tax_amount_ars, cost_amount_ars
    ) VALUES (
      p_org_id, v_actor, (v_line->>'sale_id')::uuid,
      NULLIF(v_line->>'product_id', '')::uuid,
      NULLIF(v_line->>'variant_id', '')::uuid,
      v_line->>'product_name', (v_line->>'quantity')::numeric,
      (v_line->>'amount')::numeric, left(btrim(p_reason), 300),
      'original_payment', NULLIF(left(btrim(COALESCE(p_notes, '')), 2000), ''),
      v_operation.id, (v_line->>'tax')::numeric, (v_line->>'cost')::numeric
    ) RETURNING id INTO v_return_id;

    IF COALESCE(p_restock, true) AND NULLIF(v_line->>'product_id', '') IS NOT NULL THEN
      SELECT variant.variant_name INTO v_variant_name
      FROM public.product_variants variant
      WHERE variant.id = NULLIF(v_line->>'variant_id', '')::uuid;
      PERFORM public.record_stock_movement(
        p_org_id => p_org_id,
        p_product_id => NULLIF(v_line->>'product_id', '')::uuid,
        p_variant_id => NULLIF(v_line->>'variant_id', '')::uuid,
        p_product_name => v_line->>'product_name',
        p_variant_name => v_variant_name,
        p_movement_type => 'return_in',
        p_quantity => (v_line->>'quantity')::numeric,
        p_reference_type => 'sales_return',
        p_reference_id => v_operation.id,
        p_unit_price_ars => (v_line->>'unit_price')::numeric,
        p_notes => 'Devolución: ' || left(btrim(p_reason), 300),
        p_created_by => v_actor,
        p_location_id => NULLIF(v_line->>'location_id', '')::uuid
      );
    END IF;

    SELECT COALESCE(sum(line.quantity), 0) INTO v_returned_qty
    FROM public.returns line
    WHERE line.org_id = p_org_id AND line.sale_id = (v_line->>'sale_id')::uuid;
    UPDATE public.sales
    SET returned_quantity = v_returned_qty,
        returned = v_returned_qty >= quantity,
        return_id = v_return_id
    WHERE id = (v_line->>'sale_id')::uuid AND org_id = p_org_id;
  END LOOP;

  FOR v_allocation IN SELECT value FROM jsonb_array_elements(v_normalized_allocations)
  LOOP
    v_execution := v_allocation->>'execution_mode';
    v_status := CASE WHEN v_execution = 'cash' THEN 'completed' ELSE 'pending_external' END;
    INSERT INTO public.sales_return_refunds (
      org_id, return_transaction_id, payment_transaction_id, sale_method,
      provider, method, amount, execution_mode, status,
      completed_by, completed_at
    ) VALUES (
      p_org_id, v_operation.id,
      NULLIF(v_allocation->>'payment_transaction_id', '')::uuid,
      v_allocation->>'sale_method', v_allocation->>'provider',
      v_allocation->>'method', (v_allocation->>'amount')::numeric,
      v_execution, v_status,
      CASE WHEN v_status = 'completed' THEN v_actor ELSE NULL END,
      CASE WHEN v_status = 'completed' THEN now() ELSE NULL END
    ) RETURNING id INTO v_refund_id;

    IF v_status = 'completed' THEN
      INSERT INTO public.cash_entries (
        org_id, session_id, entry_type, payment_method, amount_ars,
        reference_type, reference_id, sale_transaction_id,
        return_transaction_id, description, created_by
      ) VALUES (
        p_org_id, v_cash_session, 'refund_out', v_allocation->>'sale_method',
        (v_allocation->>'amount')::numeric, 'sales_return', v_operation.id,
        v_selected.sale_transaction_id, v_operation.id,
        'Reintegro de devolución · ticket ' || upper(right(COALESCE(v_selected.sale_transaction_id, v_selected.id)::text, 8)),
        v_actor
      )
      ON CONFLICT (return_transaction_id, payment_method, entry_type)
        WHERE entry_type = 'refund_out' AND return_transaction_id IS NOT NULL
      DO NOTHING;
    ELSE
      v_pending_count := v_pending_count + 1;
    END IF;
  END LOOP;

  PERFORM public.ledger_plan_default(p_org_id);
  IF v_total - v_total_tax > 0 THEN
    v_ledger_lines := v_ledger_lines || jsonb_build_array(jsonb_build_object(
      'cuenta', '4.1.01', 'debe', round(v_total - v_total_tax, 2),
      'detalle', 'Reversión de venta por devolución'));
  END IF;
  IF v_total_tax > 0 THEN
    v_ledger_lines := v_ledger_lines || jsonb_build_array(jsonb_build_object(
      'cuenta', '2.1.02', 'debe', v_total_tax,
      'detalle', 'Reversión de IVA débito fiscal'));
  END IF;
  FOR v_allocation IN SELECT value FROM jsonb_array_elements(v_normalized_allocations)
  LOOP
    v_account := CASE
      WHEN v_allocation->>'execution_mode' <> 'cash' THEN '2.1.04'
      WHEN v_allocation->>'method' = 'cash' THEN '1.1.01'
      WHEN v_allocation->>'method' = 'transfer' THEN '1.1.02'
      ELSE '1.1.03' END;
    v_ledger_lines := v_ledger_lines || jsonb_build_array(jsonb_build_object(
      'cuenta', v_account, 'haber', (v_allocation->>'amount')::numeric,
      'detalle', CASE WHEN v_account = '2.1.04'
        THEN 'Reintegro externo pendiente' ELSE 'Reintegro completado' END,
      'metadata', jsonb_build_object(
        'return_transaction_id', v_operation.id,
        'sale_method', v_allocation->>'sale_method'
      )
    ));
  END LOOP;
  IF COALESCE(p_restock, true) AND v_total_cost > 0 THEN
    v_ledger_lines := v_ledger_lines || jsonb_build_array(
      jsonb_build_object('cuenta', '1.3.01', 'debe', v_total_cost,
        'detalle', 'Mercadería repuesta por devolución'),
      jsonb_build_object('cuenta', '5.1.01', 'haber', v_total_cost,
        'detalle', 'Reversión del costo de mercadería vendida')
    );
  END IF;
  PERFORM public.ledger_asentar(
    p_org := p_org_id,
    p_descripcion := 'Devolución de ticket ' || upper(right(COALESCE(v_selected.sale_transaction_id, v_selected.id)::text, 8)),
    p_lineas := v_ledger_lines,
    p_fecha := CURRENT_DATE,
    p_ref_tipo := 'devolucion_pos',
    p_ref_id := v_operation.id
  );

  UPDATE public.sales_return_transactions
  SET status = CASE WHEN v_pending_count = 0 THEN 'completed' ELSE 'pending_refund' END,
      completed_at = CASE WHEN v_pending_count = 0 THEN now() ELSE NULL END
  WHERE id = v_operation.id;

  INSERT INTO public.audit_logs (
    user_id, org_id, action, entity_type, entity_id, details, severity, tags
  ) VALUES (
    v_actor, p_org_id, 'create', 'sales_return', v_operation.id::text,
    jsonb_build_object(
      'sale_transaction_id', v_selected.sale_transaction_id,
      'legacy_sale_id', CASE WHEN v_selected.sale_transaction_id IS NULL THEN v_selected.id ELSE NULL END,
      'refund_amount', v_total,
      'restock', COALESCE(p_restock, true),
      'pending_refunds', v_pending_count,
      'credit_note_required', v_credit_note_required,
      'line_count', jsonb_array_length(v_normalized_lines)
    ),
    CASE WHEN v_pending_count > 0 OR v_credit_note_required THEN 'warning' ELSE 'info' END,
    ARRAY['sales', 'return', 'payments', 'inventory']::text[]
  );

  PERFORM public.emitir_evento(
    p_org_id, 'sales_return', v_operation.id, 'venta.devolucion_registrada',
    jsonb_build_object(
      'return_transaction_id', v_operation.id,
      'sale_transaction_id', v_selected.sale_transaction_id,
      'refund_amount', v_total,
      'status', CASE WHEN v_pending_count = 0 THEN 'completed' ELSE 'pending_refund' END
    )
  );

  RETURN public.sales_return_response(v_operation.id)
    || jsonb_build_object('reused', false);
END
$function$;

