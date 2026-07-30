-- ═══════════════════════════════════════════════════════════════════════════
-- DIAGNÓSTICO — correr ANTES de aplicar nada
--
-- Pegar todo esto en el SQL Editor de Supabase y mirar los tres resultados.
-- No modifica nada: sólo consulta.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. ¿Qué falta de lo nuevo? ─────────────────────────────────────────────
-- Todo lo que diga FALTA es lo que va a crear el bundle.
SELECT
  objeto,
  CASE WHEN existe THEN 'ok' ELSE 'FALTA' END AS estado
FROM (
  VALUES
    ('platform_admins.role (columna)',
     EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='platform_admins' AND column_name='role')),
    ('has_platform_role() (función)',
     EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
             WHERE n.nspname='public' AND p.proname='has_platform_role')),
    ('shipping_zones (tabla)',
     EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='shipping_zones')),
    ('shipping_rates (tabla)',
     EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='shipping_rates')),
    ('products.weight_kg (columna)',
     EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='products' AND column_name='weight_kg')),
    ('ecommerce_stores.shipping_mode (columna)',
     EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='ecommerce_stores' AND column_name='shipping_mode')),
    ('payment_transactions (tabla)',
     EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='payment_transactions')),
    ('platform_commission_rules (tabla)',
     EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='platform_commission_rules')),
    ('catalog_products (vista)',
     EXISTS (SELECT 1 FROM information_schema.views
             WHERE table_schema='public' AND table_name='catalog_products')),
    ('get_public_payment_link() (función)',
     EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
             WHERE n.nspname='public' AND p.proname='get_public_payment_link')),
    ('quote_store_shipping() (función)',
     EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
             WHERE n.nspname='public' AND p.proname='quote_store_shipping')),
    ('record_payment_settlement() (función)',
     EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
             WHERE n.nspname='public' AND p.proname='record_payment_settlement'))
) AS t(objeto, existe)
ORDER BY estado DESC, objeto;


-- ── 2. Fugas que todavía están abiertas ────────────────────────────────────
-- Estas son las políticas que dejan ver una tabla entera sin filtrar por
-- organización. Después de aplicar el bundle, `settings`, `products`,
-- `payment_links`, `profiles` y `coupons` NO deberían aparecer más acá.
-- `plans` sí: es el pricing público, está bien que sea abierto.
SELECT tablename, policyname, cmd, roles::text AS aplica_a
FROM pg_policies
WHERE schemaname = 'public'
  AND (qual IS NULL OR btrim(qual) IN ('true','(true)'))
ORDER BY tablename, policyname;


-- ── 2b. Colisión con la logística vieja ────────────────────────────────────
-- `20260523000075_logistics.sql` creó `shipping_zones` y `shipping_rates` con
-- otra forma. El bundle las reconcilia solo, pero acá se ve qué va a hacer:
--   · forma_vieja + 0 filas  → recrea la tabla limpia
--   · forma_vieja + N filas  → conserva los datos y le agrega las columnas
--   · forma_nueva            → nada que hacer
SELECT
  CASE
    WHEN NOT EXISTS (SELECT 1 FROM information_schema.tables
                     WHERE table_schema='public' AND table_name='shipping_rates')
      THEN 'no existe — se crea'
    WHEN EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='shipping_rates' AND column_name='carrier')
      THEN 'forma nueva — nada que hacer'
    ELSE 'forma vieja (logistics)'
  END AS shipping_rates_estado,
  (SELECT count(*) FROM public.shipping_rates)  AS tarifas_cargadas,
  (SELECT count(*) FROM public.shipping_zones)  AS zonas_cargadas;

-- Nombres de zona repetidos por organización: el bundle necesita agregar una
-- UNIQUE (org_id, name) y fallaría. Esperado: sin filas.
SELECT org_id, name, count(*) AS repetidos
FROM public.shipping_zones
GROUP BY org_id, name
HAVING count(*) > 1;


-- ── 2c. ⚠️ PRE-FLIGHT: columnas de las que dependen las vistas y funciones ─
--
-- Postgres valida las vistas y las funciones `LANGUAGE sql` al CREARLAS: si
-- referencian una columna que no existe, el bundle falla en el medio. Esta
-- consulta lo detecta antes.
--
-- Esperado: SIN FILAS. Cualquier fila acá es algo que hay que resolver primero
-- (probablemente una migración vieja que nunca se aplicó).
SELECT tabla, columna
FROM (
  VALUES
    -- catalog_products
    ('products','sale_price_ars'), ('products','discount_price_ars'),
    ('products','price_2x_ars'), ('products','stock'), ('products','content_ml'),
    ('products','total_sold'), ('products','featured'), ('products','offer_expires_at'),
    ('products','image_urls'), ('products','is_active'),
    ('products','cost_usd'), ('products','total_cost_usd'),
    ('products','brand'), ('products','category'), ('products','gender'),
    ('products','org_id'), ('products','user_id'),
    -- settings_public / catalog_settings / catalog_products (decants)
    ('settings','org_id'), ('settings','user_id'), ('settings','business_name'),
    ('settings','logo_url'), ('settings','primary_color'), ('settings','secondary_color'),
    ('settings','whatsapp_number'), ('settings','exchange_rate'),
    ('settings','volume_discount_threshold'), ('settings','volume_discount_percent'),
    ('settings','decant_margin_10ml'), ('settings','decant_margin_5ml'),
    ('settings','decant_margin_2_5ml'),
    -- get_public_payment_link
    ('settings','bank_cbu'), ('settings','bank_alias'),
    ('settings','bank_name'), ('settings','bank_holder'),
    ('payment_links','quote_number'), ('payment_links','customer_name'),
    ('payment_links','customer_phone'), ('payment_links','items'),
    ('payment_links','total_ars'), ('payment_links','mp_link'),
    ('payment_links','paid_at'), ('payment_links','notes'),
    ('payment_links','expires_at'),
    -- catalog_product_variants
    ('product_variants','variant_name'), ('product_variants','active'),
    ('product_variants','product_id'),
    -- get_store_by_slug / create_store_order
    ('ecommerce_stores','payment_methods'), ('ecommerce_stores','social_links'),
    ('ecommerce_stores','meta_title'), ('ecommerce_stores','meta_description'),
    ('ecommerce_orders','carrier'), ('ecommerce_orders','store_customer_id'),
    ('ecommerce_orders','coupon_code'), ('ecommerce_orders','order_number'),
    ('ecommerce_orders','items'), ('ecommerce_orders','subtotal'),
    ('ecommerce_orders','discount_amount'), ('ecommerce_orders','tax_amount'),
    -- cupones
    ('coupons','discount_percent'), ('coupons','discount_fixed_ars'),
    ('coupons','current_uses'), ('coupons','max_uses'),
    ('coupons','valid_from'), ('coupons','valid_until'), ('coupons','active'),
    -- platform_roles / profiles
    ('platform_admins','user_id'), ('profiles','id'),
    ('memberships','joined_at'), ('memberships','role'),
    ('organizations','plan_id')
) AS req(tabla, columna)
WHERE NOT EXISTS (
  SELECT 1 FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = req.tabla
    AND c.column_name = req.columna
)
ORDER BY tabla, columna;


-- ── 3. ⚠️ Números de pedido duplicados ─────────────────────────────────────
-- El bundle crea un índice único en (org_id, order_number). Si esta consulta
-- devuelve filas, el índice va a FALLAR y hay que arreglar esos pedidos primero.
-- Si no devuelve nada, se puede aplicar tranquilo.
SELECT org_id, order_number, count(*) AS repetidos
FROM public.ecommerce_orders
GROUP BY org_id, order_number
HAVING count(*) > 1
ORDER BY repetidos DESC;
