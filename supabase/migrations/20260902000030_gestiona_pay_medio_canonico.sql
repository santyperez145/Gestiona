-- ═══════════════════════════════════════════════════════════════════════════
-- Gestiona Pay canónico en la tienda (Pay ≠ Mercado Pago)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- El producto en checkout/Commerce es `gestiona_pay`. `mercadopago` queda
-- como alias de lectura (órdenes y arrays viejos). El rail OAuth sigue en
-- `payment_connections.provider = mercadopago` y `gestiona_pay_listo` no cambia.
--
-- medios_de_pago_vivos: acepta ambos, emite el canónico.
-- Trigger: no deja entrar gestiona_pay sin rail vivo.
-- Backfill: arrays y descuentos de la tienda pasan al canónico.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.medios_de_pago_vivos(p_org_id uuid, p_methods text[])
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
  SELECT COALESCE(
    ARRAY(
      SELECT DISTINCT
        CASE
          WHEN m IN ('mercadopago', 'gestiona_pay') THEN 'gestiona_pay'
          ELSE m
        END
        FROM unnest(COALESCE(p_methods, ARRAY[]::text[])) AS m
       WHERE m IS NOT NULL
         AND btrim(m) <> ''
         AND m NOT IN ('stripe', 'paypal')
         AND (
           m NOT IN ('mercadopago', 'gestiona_pay')
           OR public.gestiona_pay_listo(p_org_id)
         )
    ),
    ARRAY[]::text[]
  );
$$;

COMMENT ON FUNCTION public.medios_de_pago_vivos(uuid, text[]) IS
  'Medios que el checkout puede ofrecer de verdad. Canónico gestiona_pay; alias mercadopago; saca rails sin adapter y Pay si el rail no está listo.';

CREATE OR REPLACE FUNCTION public.trg_ecommerce_order_exige_pay()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
BEGIN
  IF NEW.payment_method IN ('stripe', 'paypal') THEN
    RAISE EXCEPTION 'Ese medio de pago no está disponible en esta tienda';
  END IF;
  IF NEW.payment_method IN ('mercadopago', 'gestiona_pay')
     AND NOT public.gestiona_pay_listo(NEW.org_id) THEN
    RAISE EXCEPTION 'Gestiona Pay no está activo. Elegí otro medio de pago.';
  END IF;
  -- Órdenes nuevas guardan el canónico; las viejas con mercadopago siguen válidas.
  IF NEW.payment_method = 'mercadopago' THEN
    NEW.payment_method := 'gestiona_pay';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.trg_ecommerce_order_exige_pay() IS
  'Impide crear una orden online con un rail que la tienda no puede cobrar. Acepta gestiona_pay y el alias mercadopago; normaliza al canónico.';

-- Arrays de tienda: mercadopago → gestiona_pay (sin duplicar).
UPDATE public.ecommerce_stores s
   SET payment_methods = (
         SELECT COALESCE(array_agg(DISTINCT canon ORDER BY canon), ARRAY[]::text[])
           FROM (
             SELECT CASE
                      WHEN m IN ('mercadopago', 'gestiona_pay') THEN 'gestiona_pay'
                      ELSE m
                    END AS canon
               FROM unnest(COALESCE(s.payment_methods, ARRAY[]::text[])) AS m
              WHERE m IS NOT NULL AND btrim(m) <> ''
           ) x
       )
 WHERE COALESCE(s.payment_methods, ARRAY[]::text[]) && ARRAY['mercadopago']::text[];

-- Descuentos: clave mercadopago → gestiona_pay.
UPDATE public.ecommerce_stores
   SET payment_discounts =
         (payment_discounts - 'mercadopago')
         || jsonb_build_object(
              'gestiona_pay',
              COALESCE(payment_discounts->'gestiona_pay', payment_discounts->'mercadopago')
            )
 WHERE payment_discounts ? 'mercadopago';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
     WHERE proname = 'medios_de_pago_vivos'
       AND pg_get_functiondef(oid) ILIKE '%gestiona_pay%'
  ) THEN
    RAISE EXCEPTION 'medios_de_pago_vivos no reconoce gestiona_pay';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
     WHERE proname = 'trg_ecommerce_order_exige_pay'
       AND pg_get_functiondef(oid) ILIKE '%gestiona_pay%'
  ) THEN
    RAISE EXCEPTION 'trg_ecommerce_order_exige_pay no reconoce gestiona_pay';
  END IF;
END $$;
