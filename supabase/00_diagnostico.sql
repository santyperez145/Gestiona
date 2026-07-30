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


-- ── 3. ⚠️ Números de pedido duplicados ─────────────────────────────────────
-- El bundle crea un índice único en (org_id, order_number). Si esta consulta
-- devuelve filas, el índice va a FALLAR y hay que arreglar esos pedidos primero.
-- Si no devuelve nada, se puede aplicar tranquilo.
SELECT org_id, order_number, count(*) AS repetidos
FROM public.ecommerce_orders
GROUP BY org_id, order_number
HAVING count(*) > 1
ORDER BY repetidos DESC;
