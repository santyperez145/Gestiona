-- Transferencia viva en la vitrina + publicar no es un interruptor vacío.
--
-- Medido 2026-09-02: el botón «Publicar» exige canPublish; el toggle
-- «Tienda Activa» + Guardar podía dejar is_active=true sin CBU/legales/
-- dirección. medios_de_pago_vivos ya sacaba Pay muerto; transferencia
-- sin CBU/alias seguía saliendo y el pedido decía «te vamos a escribir».
-- Espejo de storeBankTransferReady / readiness bank-transfer.

CREATE OR REPLACE FUNCTION public.transferencia_tienda_lista(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.settings st
     WHERE st.org_id = p_org_id
       AND (
         NULLIF(btrim(COALESCE(st.bank_cbu, '')), '') IS NOT NULL
         OR NULLIF(btrim(COALESCE(st.bank_alias, '')), '') IS NOT NULL
       )
  );
$$;

REVOKE ALL ON FUNCTION public.transferencia_tienda_lista(uuid) FROM PUBLIC;
-- Sólo la llama medios_de_pago_vivos / triggers (security definer).

COMMENT ON FUNCTION public.transferencia_tienda_lista(uuid) IS
  'CBU o alias cargados: sin eso el checkout no puede ofrecer transferencia.';

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
         AND (
           m <> 'transferencia'
           OR public.transferencia_tienda_lista(p_org_id)
         )
    ),
    ARRAY[]::text[]
  );
$$;

COMMENT ON FUNCTION public.medios_de_pago_vivos(uuid, text[]) IS
  'Medios que el checkout puede ofrecer de verdad. Saca Pay sin rail y transferencia sin CBU/alias.';

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
  IF NEW.payment_method = 'transferencia'
     AND NOT public.transferencia_tienda_lista(NEW.org_id) THEN
    RAISE EXCEPTION 'Faltan CBU o alias para cobrar por transferencia.';
  END IF;
  IF NEW.payment_method = 'mercadopago' THEN
    NEW.payment_method := 'gestiona_pay';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.trg_ecommerce_order_exige_pay() IS
  'Impide crear una orden online con un rail que la tienda no puede cobrar (Pay o transferencia).';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'transferencia_tienda_lista'
  ) THEN
    RAISE EXCEPTION 'transferencia_tienda_lista no existe';
  END IF;

  IF NOT (
    SELECT pg_get_functiondef(p.oid) ILIKE '%transferencia_tienda_lista%'
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'medios_de_pago_vivos'
  ) THEN
    RAISE EXCEPTION 'medios_de_pago_vivos no filtra transferencia';
  END IF;

  IF NOT (
    SELECT pg_get_functiondef(p.oid) ILIKE '%Faltan CBU o alias%'
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'trg_ecommerce_order_exige_pay'
  ) THEN
    RAISE EXCEPTION 'el trigger no rechaza transferencia sin datos';
  END IF;
END $$;
