-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICACIÓN — correr DESPUÉS de 01_aplicar_pendientes.sql
--
-- Cuatro chequeos. Los cuatro tienen que dar el resultado esperado que está
-- escrito en cada uno. No modifica nada.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. ¿Se cerraron las fugas? ─────────────────────────────────────────────
-- Esperado: NINGUNA fila para settings, products, payment_links, profiles ni
-- coupons. `plans` puede aparecer: es el pricing público, está bien.
--
-- Los nombres de columna son los de la vista (`command`, `applies_to`), no los
-- de pg_policies (`cmd`, `roles`).
SELECT tablename, policyname, command, applies_to
FROM public.rls_audit_open_policies
ORDER BY tablename;


-- ── 2. ¿Las credenciales dejaron de ser legibles públicamente? ─────────────
-- Esperado: 0. Si da más de 0, quedó una política anónima sobre settings.
SELECT count(*) AS politicas_anonimas_sobre_settings
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'settings' AND 'anon' = ANY(roles);


-- ── 3. ¿La vista pública del catálogo NO expone costos? ────────────────────
-- Esperado: 0 filas. Cualquier fila acá es una filtración de márgenes.
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('catalog_products', 'products_public', 'settings_public', 'catalog_settings')
  AND column_name IN (
    'cost_usd','total_cost_usd','customs_fee','customs_percent',
    'profit_per_unit_ars','profit_per_unit_usd',
    'mp_access_token','smtp_pass','api_key','webhook_secret','afip_ta_token'
  );


-- ── 4. ¿Quedó todo lo nuevo creado? ────────────────────────────────────────
-- Esperado: los 12 en 'ok'. Es el mismo chequeo de 00_diagnostico.sql.
SELECT objeto, CASE WHEN existe THEN 'ok' ELSE 'FALTA' END AS estado
FROM (
  VALUES
    ('platform_admins.role',
     EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='platform_admins' AND column_name='role')),
    ('has_platform_role()',
     EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
             WHERE n.nspname='public' AND p.proname='has_platform_role')),
    ('shipping_zones',
     EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='shipping_zones')),
    ('shipping_rates',
     EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='shipping_rates')),
    ('products.weight_kg',
     EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='products' AND column_name='weight_kg')),
    ('ecommerce_stores.shipping_mode',
     EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='ecommerce_stores' AND column_name='shipping_mode')),
    ('payment_transactions',
     EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='payment_transactions')),
    ('platform_commission_rules',
     EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='platform_commission_rules')),
    ('catalog_products',
     EXISTS (SELECT 1 FROM information_schema.views
             WHERE table_schema='public' AND table_name='catalog_products')),
    ('get_public_payment_link()',
     EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
             WHERE n.nspname='public' AND p.proname='get_public_payment_link')),
    ('quote_store_shipping()',
     EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
             WHERE n.nspname='public' AND p.proname='quote_store_shipping')),
    ('record_payment_settlement()',
     EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
             WHERE n.nspname='public' AND p.proname='record_payment_settlement'))
) AS t(objeto, existe)
ORDER BY estado DESC, objeto;


-- ── 5. Sanity check del catálogo ───────────────────────────────────────────
-- Esperado: un número parecido a tus productos con stock y precio. Si da 0 con
-- productos cargados, revisar que tengan stock > 0 y sale_price_ars > 0.
SELECT count(*) AS productos_visibles_en_catalogo FROM public.catalog_products;


-- ── 6. ¿Quedó resuelta la colisión con la logística vieja? ──────────────────
-- Esperado: shipping_rates con `carrier` y SIN `carrier_id` obligatorio, y las
-- políticas viejas `org_zones` / `org_rates` ya no existen.
SELECT
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name='shipping_rates'
            AND column_name='carrier')                        AS tiene_carrier,
  COALESCE((SELECT is_nullable = 'YES' FROM information_schema.columns
            WHERE table_schema='public' AND table_name='shipping_rates'
              AND column_name='carrier_id'), true)            AS carrier_id_opcional,
  NOT EXISTS (SELECT 1 FROM pg_policies
              WHERE schemaname='public' AND policyname IN ('org_zones','org_rates'))
                                                              AS politicas_viejas_cerradas,
  (SELECT count(*) FROM public.shipping_zones)                AS zonas,
  (SELECT count(*) FROM public.shipping_rates)                AS tarifas;


-- ── 7. ¿Está lista la plomería de comisiones? ──────────────────────────────
-- Esperado: aranceles_cargados con ~10 filas (el seed de MercadoPago) y
-- regla_base_pct en 0. Ese 0 es a propósito: activar la comisión es una
-- decisión de negocio, se cambia desde /platform/comisiones.
SELECT
  (SELECT count(*) FROM public.payment_provider_fees)          AS aranceles_cargados,
  (SELECT percent FROM public.platform_commission_rules
    WHERE org_id IS NULL AND plan_id IS NULL LIMIT 1)          AS regla_base_pct,
  (SELECT count(*) FROM public.payment_transactions)           AS cobros_registrados;
