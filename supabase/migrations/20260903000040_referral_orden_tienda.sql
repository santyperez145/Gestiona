-- Referral de la tienda online → comisión de influencer
--
-- El checkout ya deja `[ref:CODE]` en notes (cliente). Acá:
-- 1) columna propia en la orden
-- 2) trigger que asienta el código desde notes o desde la columna
-- 3) al insertar sales de tienda, copia referral_code desde la orden
--    (process_referral_sale ya existe y dispara la comisión)

ALTER TABLE public.ecommerce_orders
  ADD COLUMN IF NOT EXISTS referral_code text;

COMMENT ON COLUMN public.ecommerce_orders.referral_code IS
  'Código de influencer/afiliado (?ref=). Se copia a sales.referral_code al pagar.';

CREATE OR REPLACE FUNCTION public.normalize_store_referral_code(p_raw text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v text;
BEGIN
  v := upper(regexp_replace(btrim(coalesce(p_raw, '')), '\s+', '', 'g'));
  IF v = '' OR char_length(v) > 32 THEN
    RETURN NULL;
  END IF;
  IF v !~ '^[A-Z0-9_-]+$' THEN
    RETURN NULL;
  END IF;
  RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_ecommerce_order_referral()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_code text;
  v_from_notes text;
BEGIN
  v_code := public.normalize_store_referral_code(NEW.referral_code);
  IF v_code IS NULL AND NEW.notes IS NOT NULL THEN
    v_from_notes := substring(NEW.notes from '\[ref:([A-Za-z0-9_-]+)\]');
    v_code := public.normalize_store_referral_code(v_from_notes);
  END IF;
  NEW.referral_code := v_code;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ecommerce_order_referral ON public.ecommerce_orders;
CREATE TRIGGER trg_ecommerce_order_referral
  BEFORE INSERT OR UPDATE OF notes, referral_code
  ON public.ecommerce_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_ecommerce_order_referral();

CREATE OR REPLACE FUNCTION public.trg_sales_referral_from_store_order()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_code text;
BEGIN
  IF NEW.ecommerce_order_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF public.normalize_store_referral_code(NEW.referral_code) IS NOT NULL THEN
    NEW.referral_code := public.normalize_store_referral_code(NEW.referral_code);
    RETURN NEW;
  END IF;
  SELECT public.normalize_store_referral_code(o.referral_code)
    INTO v_code
  FROM public.ecommerce_orders o
  WHERE o.id = NEW.ecommerce_order_id;
  IF v_code IS NOT NULL THEN
    NEW.referral_code := v_code;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sales_referral_from_store_order ON public.sales;
CREATE TRIGGER trg_sales_referral_from_store_order
  BEFORE INSERT ON public.sales
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_sales_referral_from_store_order();

-- Verificación: columna y funciones existen
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ecommerce_orders'
      AND column_name = 'referral_code'
  ) THEN
    RAISE EXCEPTION 'falta ecommerce_orders.referral_code';
  END IF;
  IF public.normalize_store_referral_code(' ana-10 ') IS DISTINCT FROM 'ANA-10' THEN
    RAISE EXCEPTION 'normalize_store_referral_code falló';
  END IF;
  IF public.normalize_store_referral_code('bad@x') IS NOT NULL THEN
    RAISE EXCEPTION 'normalize_store_referral_code debió rechazar bad@x';
  END IF;
END $$;
