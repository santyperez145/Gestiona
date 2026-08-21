-- P0.2: canonical identity keys for review across POS, store and channels.
-- This migration only adds immutable functions and protected read-only views.
-- It does not backfill, rewrite, merge or delete business records.

CREATE OR REPLACE FUNCTION public.normalize_identity_text(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT NULLIF(
    btrim(regexp_replace(
      regexp_replace(
        translate(lower(COALESCE(p_value, '')),
          'áàäâãéèëêíìïîóòöôõúùüûñç',
          'aaaaaeeeeiiiiooooouuuunc'),
        '[^a-z0-9]+', ' ', 'g'
      ),
      '\s+', ' ', 'g'
    )), ''
  );
$$;

CREATE OR REPLACE FUNCTION public.normalize_identity_email(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT NULLIF(regexp_replace(lower(btrim(COALESCE(p_value, ''))), '\s+', '', 'g'), '');
$$;

CREATE OR REPLACE FUNCTION public.normalize_identity_phone(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT NULLIF(regexp_replace(COALESCE(p_value, ''), '[^0-9]', '', 'g'), '');
$$;

CREATE OR REPLACE FUNCTION public.normalize_product_sku(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT NULLIF(regexp_replace(upper(btrim(COALESCE(p_value, ''))), '[^A-Z0-9]', '', 'g'), '');
$$;

CREATE OR REPLACE FUNCTION public.normalize_product_barcode(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT public.normalize_identity_phone(p_value);
$$;

DROP VIEW IF EXISTS public.product_identity_review;
CREATE VIEW public.product_identity_review
WITH (security_invoker = true)
AS
WITH keyed AS (
  SELECT
    p.id,
    p.org_id,
    p.name,
    p.brand,
    p.sku,
    p.barcode,
    public.normalize_product_sku(p.sku) AS sku_key,
    public.normalize_product_barcode(p.barcode) AS barcode_key,
    NULLIF(
      concat_ws('|', public.normalize_identity_text(p.brand), public.normalize_identity_text(p.name), p.content_ml::text),
      ''
    ) AS name_brand_key
  FROM public.products p
), counted AS (
  SELECT
    k.*,
    count(k.sku_key) OVER (PARTITION BY k.org_id, k.sku_key) AS sku_match_count,
    count(k.barcode_key) OVER (PARTITION BY k.org_id, k.barcode_key) AS barcode_match_count,
    count(k.name_brand_key) OVER (PARTITION BY k.org_id, k.name_brand_key) AS name_brand_match_count
  FROM keyed k
)
SELECT
  c.*,
  (c.sku_match_count > 1 OR c.barcode_match_count > 1) AS exact_conflict,
  (c.sku_match_count > 1 OR c.barcode_match_count > 1 OR c.name_brand_match_count > 1) AS review_required,
  NULLIF(concat_ws(', ',
    CASE WHEN c.sku_match_count > 1 THEN 'SKU compartido' END,
    CASE WHEN c.barcode_match_count > 1 THEN 'EAN compartido' END,
    CASE WHEN c.name_brand_match_count > 1 THEN 'nombre y marca compartidos' END
  ), '') AS identity_issue
FROM counted c;

DROP VIEW IF EXISTS public.customer_identity_review;
CREATE VIEW public.customer_identity_review
WITH (security_invoker = true)
AS
WITH keyed AS (
  SELECT
    c.id,
    c.org_id,
    c.name,
    c.email,
    c.phone,
    c.whatsapp_number,
    public.normalize_identity_text(c.name) AS name_key,
    public.normalize_identity_email(c.email) AS email_key,
    public.normalize_identity_phone(c.phone) AS phone_key,
    public.normalize_identity_phone(c.whatsapp_number) AS whatsapp_key
  FROM public.customers c
), counted AS (
  SELECT
    k.*,
    count(k.name_key) OVER (PARTITION BY k.org_id, k.name_key) AS name_match_count,
    count(k.email_key) OVER (PARTITION BY k.org_id, k.email_key) AS email_match_count,
    count(k.phone_key) OVER (PARTITION BY k.org_id, k.phone_key) AS phone_match_count,
    count(k.whatsapp_key) OVER (PARTITION BY k.org_id, k.whatsapp_key) AS whatsapp_match_count
  FROM keyed k
)
SELECT
  c.*,
  (c.email_match_count > 1 OR c.phone_match_count > 1 OR c.whatsapp_match_count > 1) AS exact_conflict,
  (c.email_match_count > 1 OR c.phone_match_count > 1 OR c.whatsapp_match_count > 1 OR c.name_match_count > 1) AS review_required,
  (c.email_key IS NULL AND c.phone_key IS NULL AND c.whatsapp_key IS NULL) AS missing_contact,
  NULLIF(concat_ws(', ',
    CASE WHEN c.email_match_count > 1 THEN 'email compartido' END,
    CASE WHEN c.phone_match_count > 1 THEN 'teléfono compartido' END,
    CASE WHEN c.whatsapp_match_count > 1 THEN 'WhatsApp compartido' END,
    CASE WHEN c.name_match_count > 1 THEN 'nombre compartido' END
  ), '') AS identity_issue
FROM counted c;

REVOKE ALL ON public.product_identity_review FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.customer_identity_review FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.product_identity_review TO authenticated;
GRANT SELECT ON public.customer_identity_review TO authenticated;

-- Fail early if a remote object has an incompatible shape.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'sku'
  ) THEN
    RAISE EXCEPTION 'products no tiene sku; no se puede crear el reporte de identidad';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'customers' AND column_name = 'email'
  ) THEN
    RAISE EXCEPTION 'customers no tiene email; no se puede crear el reporte de identidad';
  END IF;
END $$;
