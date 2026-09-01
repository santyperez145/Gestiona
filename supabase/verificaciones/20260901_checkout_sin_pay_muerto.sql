-- Verificación reversible: el checkout no ofrece un rail que no cobra.
-- No imprime emails, tokens ni datos de compradores. No deja filas.

BEGIN;

CREATE TEMP TABLE zz_pay_vivo (
  stores int,
  mp_marcado_sin_pay int,
  mp_ofrecido_sin_pay int,
  stripe_en_vivos int,
  paypal_en_vivos int,
  helper_saca_muertos boolean,
  helper_vacio_sin_org boolean,
  trigger_existe boolean,
  anon_pay_listo boolean,
  anon_medios_vivos boolean
) ON COMMIT DROP;

DO $$
DECLARE
  v_org uuid;
  v_filtrado text[];
  v_stores int;
  v_marcado_sin int;
  v_ofrecido_sin int;
  v_stripe int;
  v_paypal int;
  v_anon_pay boolean;
  v_anon_medios boolean;
  v_trigger boolean;
BEGIN
  SELECT count(*) INTO v_stores FROM public.ecommerce_stores;

  SELECT count(*) INTO v_marcado_sin
    FROM public.ecommerce_stores s
   WHERE 'mercadopago' = ANY(COALESCE(s.payment_methods, ARRAY[]::text[]))
     AND NOT public.gestiona_pay_listo(s.org_id);

  SELECT count(*) INTO v_ofrecido_sin
    FROM public.ecommerce_stores s
   WHERE 'mercadopago' = ANY(public.medios_de_pago_vivos(s.org_id, s.payment_methods))
     AND NOT public.gestiona_pay_listo(s.org_id);

  SELECT count(*) INTO v_stripe
    FROM public.ecommerce_stores s
   WHERE 'stripe' = ANY(public.medios_de_pago_vivos(s.org_id, s.payment_methods));

  SELECT count(*) INTO v_paypal
    FROM public.ecommerce_stores s
   WHERE 'paypal' = ANY(public.medios_de_pago_vivos(s.org_id, s.payment_methods));

  SELECT org_id INTO v_org FROM public.ecommerce_stores LIMIT 1;
  v_filtrado := public.medios_de_pago_vivos(
    COALESCE(v_org, '00000000-0000-0000-0000-000000000000'::uuid),
    ARRAY['mercadopago', 'stripe', 'paypal', 'transferencia']
  );

  SELECT has_function_privilege('anon', 'public.gestiona_pay_listo(uuid)', 'EXECUTE')
    INTO v_anon_pay;
  SELECT has_function_privilege('anon', 'public.medios_de_pago_vivos(uuid, text[])', 'EXECUTE')
    INTO v_anon_medios;

  SELECT EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'ecommerce_orders'
      AND t.tgname = 'trg_ecommerce_order_exige_pay'
      AND NOT t.tgisinternal
  ) INTO v_trigger;

  INSERT INTO zz_pay_vivo VALUES (
    v_stores,
    v_marcado_sin,
    v_ofrecido_sin,
    v_stripe,
    v_paypal,
    (v_filtrado = ARRAY['transferencia'] OR (
      public.gestiona_pay_listo(COALESCE(v_org, '00000000-0000-0000-0000-000000000000'::uuid))
      AND v_filtrado = ARRAY['mercadopago', 'transferencia']
    )),
    public.medios_de_pago_vivos(NULL, ARRAY['mercadopago', 'stripe']) = ARRAY[]::text[],
    v_trigger,
    COALESCE(v_anon_pay, false),
    COALESCE(v_anon_medios, false)
  );

  IF v_ofrecido_sin <> 0 THEN
    RAISE EXCEPTION 'get/vivos ofrece Mercado Pago sin Gestiona Pay en % tiendas', v_ofrecido_sin;
  END IF;
  IF v_stripe <> 0 OR v_paypal <> 0 THEN
    RAISE EXCEPTION 'vivos dejó pasar stripe=% paypal=%', v_stripe, v_paypal;
  END IF;
  IF NOT v_trigger THEN
    RAISE EXCEPTION 'falta el trigger trg_ecommerce_order_exige_pay';
  END IF;
  IF COALESCE(v_anon_pay, false) OR COALESCE(v_anon_medios, false) THEN
    RAISE EXCEPTION 'anon puede ejecutar helpers internos';
  END IF;
END $$;

SELECT * FROM zz_pay_vivo;

ROLLBACK;
