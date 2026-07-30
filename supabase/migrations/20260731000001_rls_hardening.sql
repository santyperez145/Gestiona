-- ═══════════════════════════════════════════════════════════════════════════
-- Cierre de fugas de datos entre organizaciones
--
-- El sistema arrastraba políticas `USING (true)` de cuando era una app de un
-- solo negocio. Al volverse multi-tenant esas políticas quedaron, y cualquiera
-- con la clave anónima — que viaja en el bundle del navegador, o sea cualquier
-- visitante — podía leer datos de TODAS las organizaciones.
--
-- Lo que estaba expuesto, de peor a menos grave:
--
--   1. `settings` con SELECT USING(true), incluido TO anon.
--      La tabla tiene mp_access_token, smtp_pass, api_key, webhook_secret,
--      mp_webhook_secret, afip_ta_token y evolution_api_key. Es decir: se
--      podían leer los tokens de MercadoPago y las contraseñas SMTP de todos
--      los comercios de la plataforma. Con eso se cobra en nombre de otro y se
--      mandan mails desde su dominio.
--
--   2. `products` con SELECT USING(true).
--      Expone total_cost_usd, cost_usd, customs_fee y profit_per_unit_*: el
--      costo de importación y el margen de cada comercio, para cualquiera.
--
--   3. `payment_links` con SELECT USING(true) y UPDATE USING(true).
--      Se podían listar todos los links de pago de la plataforma (montos,
--      clientes) y además marcar cualquiera como "pago informado" sin haber
--      pagado nada.
--
--   4. `profiles` con SELECT USING(true) TO authenticated.
--      Cualquier usuario logueado leía nombre y datos de todos los usuarios de
--      todos los tenants.
--
--   5. `organizations` con SELECT USING(true) TO anon: catálogo completo de
--      clientes de la plataforma, útil para competencia y para phishing.
--
--   6. `coupons`, `product_variants`, `product_combos`, `catalog_banners` e
--      `influencers` con lecturas anónimas sin filtrar por tenant.
--
-- Criterio del arreglo: las tablas quedan cerradas al tenant, y lo que una
-- superficie pública necesita se expone por vistas/RPCs SECURITY DEFINER con
-- un WHERE explícito y sólo las columnas necesarias. La vista ES el control de
-- acceso, así que ningún WHERE de acá es opcional.
--
-- Nota sobre las vistas: se crean SIN `security_invoker`, o sea que evalúan RLS
-- como su dueño (postgres). Eso es deliberado — es el patrón "security definer
-- view". Por eso cada una filtra explícitamente y no expone columnas de costo.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
-- 1. settings — CREDENCIALES
-- ───────────────────────────────────────────────────────────────────────────

-- Se dropea por ROL, no por nombre: estas políticas se recrearon con nombres
-- distintos en cuatro migraciones a lo largo del tiempo, y acertar la lista de
-- nombres a mano es justamente cómo la fuga sobrevivió tanto. Ninguna política
-- anónima sobre `settings` es legítima: el branding público sale de la vista
-- `settings_public`, que no expone credenciales.
DO $$
DECLARE pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'settings'
      AND 'anon' = ANY(roles)
  LOOP
    EXECUTE format('DROP POLICY %I ON public.settings', pol.policyname);
    RAISE NOTICE 'settings: dropeada política anónima %', pol.policyname;
  END LOOP;
END $$;

-- Y las que no declaran rol pero tampoco filtran por tenant (aplican a public,
-- que incluye anon).
DO $$
DECLARE pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'settings'
      AND cmd = 'SELECT'
      AND (qual IS NULL OR btrim(qual) IN ('true', '(true)'))
  LOOP
    EXECUTE format('DROP POLICY %I ON public.settings', pol.policyname);
    RAISE NOTICE 'settings: dropeada política sin filtro de tenant %', pol.policyname;
  END LOOP;
END $$;

-- Las políticas de miembro de org ("Org members read settings" y
-- "Org admins manage settings", de 20260421111259) quedan como están: son las
-- correctas. Se recrea sólo si faltara, para que la migración sea autosuficiente.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'settings' AND cmd = 'SELECT'
  ) THEN
    CREATE POLICY "org_members_read_settings" ON public.settings
      FOR SELECT TO authenticated
      USING (org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid()));
  END IF;
END $$;

-- Branding público del catálogo. Sólo lo que hace falta para dibujar la
-- vidriera: ni un token, ni un margen, ni un dato bancario.
DROP VIEW IF EXISTS public.settings_public;
CREATE VIEW public.settings_public AS
SELECT
  s.id,
  s.user_id,
  s.org_id,
  s.business_name,
  s.logo_url,
  s.primary_color,
  s.secondary_color,
  s.whatsapp_number
FROM public.settings s;

COMMENT ON VIEW public.settings_public IS
  'Branding público. NUNCA agregar acá columnas de credenciales (mp_access_token, smtp_pass, api_key, webhook_secret, afip_ta_token) ni de márgenes.';

-- Parámetros de precio que el catálogo sí necesita mostrar al comprador.
-- `volume_discount_*` es la oferta mayorista que se publica; `exchange_rate` es
-- el tipo de cambio con el que se muestran precios. Quedan AFUERA a propósito
-- `customs_percent` y los `decant_margin_*`: son la estructura de margen.
DROP VIEW IF EXISTS public.catalog_settings;
CREATE VIEW public.catalog_settings AS
SELECT
  s.user_id,
  s.org_id,
  s.exchange_rate,
  s.volume_discount_threshold,
  s.volume_discount_percent
FROM public.settings s;

COMMENT ON VIEW public.catalog_settings IS
  'Parámetros de precio de cara al comprador. No incluye customs_percent ni decant_margin_*: son margen del comercio.';

GRANT SELECT ON public.settings_public  TO anon, authenticated;
GRANT SELECT ON public.catalog_settings TO anon, authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 2. products — COSTOS Y MÁRGENES
-- ───────────────────────────────────────────────────────────────────────────

-- Mismo criterio que con settings: por rol y por falta de filtro, no por nombre.
DO $$
DECLARE pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'products'
      AND (
        'anon' = ANY(roles)
        OR (cmd = 'SELECT' AND (qual IS NULL OR btrim(qual) IN ('true', '(true)')))
      )
  LOOP
    EXECUTE format('DROP POLICY %I ON public.products', pol.policyname);
    RAISE NOTICE 'products: dropeada política sin filtro de tenant %', pol.policyname;
  END LOOP;
END $$;

-- Catálogo público. Los precios de decant vienen YA CALCULADOS: antes el
-- navegador recibía total_cost_usd y los márgenes para hacer la cuenta del
-- lado del cliente, o sea que publicaba el costo de cada producto.
DROP VIEW IF EXISTS public.catalog_products;
CREATE VIEW public.catalog_products AS
SELECT
  p.id,
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
  -- Espejo de calculateDecantPrice() en src/lib/supabaseStore.ts:
  --   costo proporcional al ml → a pesos → más el margen del fraccionado
  CASE WHEN COALESCE(p.content_ml, 0) > 0 THEN
    round(
      (COALESCE(p.total_cost_usd, p.cost_usd, 0) / p.content_ml) * 10
      * COALESCE(s.exchange_rate, 0)
      * (1 + COALESCE(s.decant_margin_10ml, 250) / 100.0)
    )
  END AS decant_price_10ml,
  CASE WHEN COALESCE(p.content_ml, 0) > 0 THEN
    round(
      (COALESCE(p.total_cost_usd, p.cost_usd, 0) / p.content_ml) * 5
      * COALESCE(s.exchange_rate, 0)
      * (1 + COALESCE(s.decant_margin_5ml, 350) / 100.0)
    )
  END AS decant_price_5ml,
  CASE WHEN COALESCE(p.content_ml, 0) > 0 THEN
    round(
      (COALESCE(p.total_cost_usd, p.cost_usd, 0) / p.content_ml) * 2.5
      * COALESCE(s.exchange_rate, 0)
      * (1 + COALESCE(s.decant_margin_2_5ml, 500) / 100.0)
    )
  END AS decant_price_2_5ml
FROM public.products p
LEFT JOIN public.settings s ON s.org_id = p.org_id
WHERE p.stock > 0
  AND COALESCE(p.sale_price_ars, 0) > 0
  AND COALESCE(p.is_active, true) = true;

COMMENT ON VIEW public.catalog_products IS
  'Catálogo público. NUNCA agregar columnas de costo (cost_usd, total_cost_usd, customs_fee, profit_per_unit_*): los decants ya vienen calculados justamente para no tener que exponerlas.';

-- Compat: products_public seguía siendo security_invoker y quedaba vacía al
-- cerrar la tabla. Se reapunta al catálogo saneado.
DROP VIEW IF EXISTS public.products_public;
CREATE VIEW public.products_public AS
SELECT id, user_id, org_id, name, brand, category, gender, description,
       image_url, sale_price_ars, discount_price_ars, stock
FROM public.catalog_products;

-- Variantes de productos publicados. Antes era `USING (active = true)` sin
-- filtrar por tenant: se leían las variantes de cualquier comercio.
DROP POLICY IF EXISTS "Public read active variants" ON public.product_variants;
DROP POLICY IF EXISTS "Anon read active variants"   ON public.product_variants;

DROP VIEW IF EXISTS public.catalog_product_variants;
CREATE VIEW public.catalog_product_variants AS
SELECT v.id, v.product_id, v.variant_name, v.stock, v.image_url
FROM public.product_variants v
JOIN public.catalog_products p ON p.id = v.product_id
WHERE COALESCE(v.active, true) = true;

GRANT SELECT ON public.catalog_products         TO anon, authenticated;
GRANT SELECT ON public.products_public          TO anon, authenticated;
GRANT SELECT ON public.catalog_product_variants TO anon, authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 3. payment_links — LECTURA MASIVA Y ESCRITURA ABIERTA
-- ───────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "payment_links_public_read"     ON public.payment_links;
DROP POLICY IF EXISTS "payment_links_customer_update" ON public.payment_links;
DROP POLICY IF EXISTS "payment_links_public_update"   ON public.payment_links;
DROP POLICY IF EXISTS "payment_links_public_confirm"  ON public.payment_links;

-- El link se accede por su uuid, que es el secreto. Eso no se puede expresar
-- en RLS ("sólo si ya sabés el id"), así que se resuelve con un RPC: recibe el
-- id y devuelve ese link, sin permitir enumerar el resto.
--
-- Un link vencido se devuelve igual: el comprador tiene que poder ver "esto
-- venció" en vez de un 404 confuso. Lo que no se puede es pagarlo.
CREATE OR REPLACE FUNCTION public.get_public_payment_link(p_id uuid)
RETURNS TABLE (
  id uuid, org_id uuid, quote_number text, customer_name text,
  customer_phone text, items jsonb, total_ars numeric, mp_link text,
  status text, paid_at timestamptz, notes text, expires_at date,
  created_at timestamptz,
  business_name text, logo_url text, whatsapp_number text,
  bank_cbu text, bank_alias text, bank_name text, bank_holder text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    pl.id, pl.org_id, pl.quote_number, pl.customer_name,
    pl.customer_phone, pl.items, pl.total_ars, pl.mp_link,
    pl.status, pl.paid_at, pl.notes, pl.expires_at,
    pl.created_at,
    COALESCE(s.business_name, o.name) AS business_name,
    s.logo_url, s.whatsapp_number,
    -- Datos bancarios: los necesita quien va a transferir. Se entregan sólo
    -- para ESTE link, no para toda la plataforma como antes.
    s.bank_cbu, s.bank_alias, s.bank_name, s.bank_holder
  FROM public.payment_links pl
  LEFT JOIN public.settings s      ON s.org_id = pl.org_id
  LEFT JOIN public.organizations o ON o.id = pl.org_id
  WHERE pl.id = p_id;
$$;

-- Informar una transferencia. Sólo avanza pending → pending_confirmation de
-- ESE link: antes la política de UPDATE permitía tocar cualquier fila de la
-- tabla, o sea marcar como pagado cualquier link de cualquier comercio.
CREATE OR REPLACE FUNCTION public.confirm_payment_link_transfer(p_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_updated int;
BEGIN
  UPDATE public.payment_links
     SET status = 'pending_confirmation'
   WHERE id = p_id
     AND status = 'pending'
     AND (expires_at IS NULL OR expires_at >= CURRENT_DATE);
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.get_public_payment_link(uuid)      FROM public;
REVOKE ALL ON FUNCTION public.confirm_payment_link_transfer(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_public_payment_link(uuid)      TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_payment_link_transfer(uuid) TO anon, authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 4. profiles — PII ENTRE TENANTS
-- ───────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Users can view all profiles" ON public.profiles;

DROP POLICY IF EXISTS "read_own_and_teammate_profiles" ON public.profiles;
CREATE POLICY "read_own_and_teammate_profiles" ON public.profiles
  FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    -- Compañeros de equipo: se comparte al menos una organización
    OR EXISTS (
      SELECT 1
      FROM public.memberships me
      JOIN public.memberships them ON them.org_id = me.org_id
      WHERE me.user_id = auth.uid() AND them.user_id = public.profiles.id
    )
    -- El staff de plataforma da soporte sobre cualquier cuenta
    OR public.has_platform_role(ARRAY['support', 'finance'])
  );

-- ───────────────────────────────────────────────────────────────────────────
-- 5. organizations — ENUMERACIÓN DE CLIENTES
-- ───────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Anyone can view org by slug for public catalog" ON public.organizations;

-- Un visitante sólo puede ver una organización si ésta publicó una tienda.
-- El resto de la cartera de clientes de la plataforma deja de ser listable.
DROP POLICY IF EXISTS "anon_read_orgs_with_published_store" ON public.organizations;
CREATE POLICY "anon_read_orgs_with_published_store" ON public.organizations
  FOR SELECT TO anon
  USING (EXISTS (
    SELECT 1 FROM public.ecommerce_stores st
    WHERE st.org_id = public.organizations.id AND st.is_active = true
  ));

-- ───────────────────────────────────────────────────────────────────────────
-- 6. Lecturas anónimas sin dueño
-- ───────────────────────────────────────────────────────────────────────────

-- Cupones: los códigos de descuento de todos los comercios eran legibles, así
-- que se podían usar en cualquier tienda sin que nadie los publique. La
-- validación de cupones ya ocurre server-side en el checkout, con service_role.
DROP POLICY IF EXISTS "Anon read active coupons"   ON public.coupons;
DROP POLICY IF EXISTS "Anon can read active coupons" ON public.coupons;

-- Combos, banners e influencers: no hay ninguna superficie pública que los lea
-- hoy; las políticas quedaron de la app de un solo negocio.
DROP POLICY IF EXISTS "Public read active combos"      ON public.product_combos;
DROP POLICY IF EXISTS "Public read active banners"     ON public.catalog_banners;
DROP POLICY IF EXISTS "Public read active influencers" ON public.influencers;

-- ───────────────────────────────────────────────────────────────────────────
-- 7. Red de seguridad: detectar la próxima fuga antes de que salga a prod
-- ───────────────────────────────────────────────────────────────────────────

-- Lista las políticas permisivas que dejan ver una tabla entera sin filtrar por
-- tenant. Es para auditar a mano (`SELECT * FROM public.rls_audit_open_policies`)
-- y para que una política nueva de este tipo se vea en una revisión.
CREATE OR REPLACE VIEW public.rls_audit_open_policies AS
SELECT
  schemaname,
  tablename,
  policyname,
  roles::text  AS applies_to,
  cmd          AS command,
  qual         AS using_expression
FROM pg_policies
WHERE schemaname = 'public'
  AND cmd IN ('SELECT', 'ALL', 'UPDATE', 'DELETE', 'INSERT')
  AND (
    qual IS NULL
    OR btrim(qual) = 'true'
    OR btrim(qual) = '(true)'
  );

COMMENT ON VIEW public.rls_audit_open_policies IS
  'Políticas que no filtran por tenant. Debería estar vacía salvo tablas globales legítimas (plans). Revisar antes de cada deploy.';

REVOKE ALL ON public.rls_audit_open_policies FROM anon, authenticated;

-- Las tablas globales legítimas quedan documentadas para que no confundan al
-- auditar: `plans` es el pricing público de la plataforma.
COMMENT ON TABLE public.plans IS
  'Planes de la plataforma. Lectura pública a propósito: es el pricing que se muestra en /precios.';
