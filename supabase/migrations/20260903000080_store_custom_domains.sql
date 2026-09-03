-- Dominio propio de una tienda sin crear otro storefront.
--
-- `ecommerce_stores.custom_domain` existía desde la primera tabla, pero era un
-- string sin ciclo de vida y ninguna ruta lo usaba. Este slice conserva esa
-- autoridad y agrega sólo el estado operativo que necesita la integración con
-- Vercel: ownership, DNS, TLS y último chequeo.

ALTER TABLE public.ecommerce_stores
  ADD COLUMN IF NOT EXISTS custom_domain_status text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS custom_domain_verification jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS custom_domain_claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS custom_domain_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS custom_domain_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS custom_domain_error_code text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.ecommerce_stores'::regclass
      AND conname = 'ecommerce_stores_custom_domain_status_check'
  ) THEN
    ALTER TABLE public.ecommerce_stores
      ADD CONSTRAINT ecommerce_stores_custom_domain_status_check
      CHECK (custom_domain_status IN (
        'none',
        'pending_verification',
        'pending_dns',
        'active',
        'misconfigured',
        'provider_error'
      ));
  END IF;
END $$;

-- Un host sólo puede resolver una organización. La comparación no depende de
-- mayúsculas y el NULL conserva a las tiendas que usan sólo slug.nerqia.app.
CREATE UNIQUE INDEX IF NOT EXISTS ecommerce_stores_custom_domain_key
  ON public.ecommerce_stores (lower(custom_domain))
  WHERE custom_domain IS NOT NULL;

COMMENT ON COLUMN public.ecommerce_stores.custom_domain IS
  'Hostname exacto del dominio propio del comercio, sin protocolo, path ni puerto.';
COMMENT ON COLUMN public.ecommerce_stores.custom_domain_status IS
  'Estado server-side de ownership, DNS y TLS informado por el proveedor de hosting.';
COMMENT ON COLUMN public.ecommerce_stores.custom_domain_verification IS
  'Sólo desafíos y registros DNS sanitizados; nunca tokens ni respuesta cruda del proveedor.';
COMMENT ON COLUMN public.ecommerce_stores.custom_domain_error_code IS
  'Código seguro para soporte. No almacena credenciales ni payloads del proveedor.';

-- El comprador llega por un hostname, pero todo el storefront ya está
-- modelado por slug. Esta RPC pública devuelve únicamente ese identificador y
-- sólo para una tienda publicada cuyo dominio quedó verificado y bien ruteado.
CREATE OR REPLACE FUNCTION public.get_store_slug_by_host(p_host text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.slug
  FROM public.ecommerce_stores s
  WHERE p_host IS NOT NULL
    AND s.custom_domain IS NOT NULL
    AND lower(trim(trailing '.' FROM s.custom_domain)) =
        lower(trim(trailing '.' FROM btrim(p_host)))
    AND s.custom_domain_status = 'active'
    AND s.is_active = true
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_store_slug_by_host(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_store_slug_by_host(text) TO anon, authenticated;

COMMENT ON FUNCTION public.get_store_slug_by_host(text) IS
  'Resuelve un dominio propio activo al slug público; no expone org_id ni configuración interna.';

-- Verificación estructural. No toca datos reales y aborta la migración si el
-- contrato quedó a medias.
DO $$
DECLARE
  v_columnas integer;
  v_funcion regprocedure;
BEGIN
  SELECT count(*) INTO v_columnas
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'ecommerce_stores'
    AND column_name IN (
      'custom_domain_status',
      'custom_domain_verification',
      'custom_domain_claimed_at',
      'custom_domain_checked_at',
      'custom_domain_verified_at',
      'custom_domain_error_code'
    );

  v_funcion := to_regprocedure('public.get_store_slug_by_host(text)');
  IF v_columnas <> 6 OR v_funcion IS NULL THEN
    RAISE EXCEPTION 'dominios propios incompletos: columnas %, funcion %', v_columnas, v_funcion;
  END IF;
END $$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260903000080', 'store_custom_domains')
ON CONFLICT DO NOTHING;
