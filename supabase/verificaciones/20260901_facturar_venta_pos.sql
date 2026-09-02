-- ¿El POS puede facturar un ticket cobrado, sin inventar identidad fiscal
-- y sin duplicar el comprobante?
--
--     npm run db -- --file supabase/verificaciones/20260901_facturar_venta_pos.sql
--
-- Alta real → wizard POS → SKU por Kardex → ticket efectivo → facturar dos
-- veces. Sin condición IVA no hay factura. Con monotributo declarado, Factura
-- C, mismos items, segunda llamada idempotente.
--
-- Corre en una transacción que se revierte. La última consulta cuenta
-- restos y tiene que dar 0. No toca datos reales.

BEGIN;

CREATE TEMP TABLE res(n int, paso text, esperado text, obtenido text) ON COMMIT DROP;
GRANT ALL ON res TO authenticated;
CREATE TEMP TABLE ctx(org uuid, usr uuid, prod uuid, loc uuid, tx uuid, inv uuid) ON COMMIT DROP;
GRANT ALL ON ctx TO authenticated;

DO $$
DECLARE
  v_uid uuid := gen_random_uuid();
  v_org uuid;
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email,
                          encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data,
                          created_at, updated_at)
  VALUES (v_uid, '00000000-0000-0000-0000-000000000000', 'authenticated',
          'authenticated', 'zz-arca-'||substr(v_uid::text,1,8)||'@ejemplo.test',
          crypt('no-se-usa', gen_salt('bf')), now(),
          '{"provider":"email","providers":["email"]}'::jsonb,
          '{"full_name":"ZZ ARCA POS"}'::jsonb, now(), now());

  SELECT id INTO v_org FROM public.organizations WHERE owner_user_id = v_uid;
  INSERT INTO ctx(org, usr, prod) VALUES (v_org, v_uid, gen_random_uuid());
END $$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  json_build_object('sub',(SELECT usr::text FROM ctx),'role','authenticated')::text, true);

DO $$
DECLARE
  v_out jsonb;
  v_loc uuid;
BEGIN
  v_out := public.complete_business_onboarding(
    (SELECT org FROM ctx),
    'ZZ facturar POS',
    '#7c3aed',
    'otro',
    'pos'
  );
  IF v_out->>'status' IS DISTINCT FROM 'succeeded' THEN
    INSERT INTO res VALUES (1, 'terminar el wizard POS', 'succeeded',
      COALESCE(v_out->>'status','NULL')||' '||COALESCE(v_out->>'error', v_out::text));
    RETURN;
  END IF;
  INSERT INTO res VALUES (1, 'terminar el wizard POS', 'succeeded', 'succeeded');

  SELECT id INTO v_loc
    FROM public.locations
   WHERE org_id = (SELECT org FROM ctx) AND active AND is_main
   LIMIT 1;
  UPDATE ctx SET loc = v_loc;
EXCEPTION WHEN OTHERS THEN
  INSERT INTO res VALUES (1, 'terminar el wizard POS', 'succeeded', 'FRENADO: '||SQLERRM);
END $$;

DO $$
BEGIN
  INSERT INTO public.products (id, org_id, user_id, name, sale_price_ars, is_active)
  SELECT prod, org, usr, 'ZZ perfume de prueba', 5000, true FROM ctx;
  PERFORM public.adjust_stock(
    (SELECT org FROM ctx), (SELECT prod FROM ctx), NULL, 3,
    'Stock inicial al crear producto', (SELECT usr FROM ctx), NULL);
  INSERT INTO res VALUES (2, 'cargar el SKU por Kardex', 'PUDO', 'PUDO');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO res VALUES (2, 'cargar el SKU por Kardex', 'PUDO', 'FRENADO: '||SQLERRM);
END $$;

DO $$
DECLARE
  v_out jsonb;
BEGIN
  v_out := public.create_sales_transaction_v3(
    (SELECT org FROM ctx),
    jsonb_build_array(jsonb_build_object(
      'product_id', (SELECT prod FROM ctx),
      'product_name', 'ZZ perfume de prueba',
      'quantity', 1,
      'unit_price_ars', 5000,
      'total_ars', 5000,
      'payment_method', 'efectivo',
      'paid', true,
      'location_id', (SELECT loc FROM ctx)
    )),
    'pos'
  );
  UPDATE ctx SET tx = NULLIF(v_out->>'transaction_id', '')::uuid;
  INSERT INTO res VALUES (3, 'cobrar el ticket', 'PUDO', 'PUDO');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO res VALUES (3, 'cobrar el ticket', 'PUDO', 'FRENADO: '||SQLERRM);
END $$;

INSERT INTO res
SELECT 4, 'el ticket tiene id', 'uuid',
       CASE WHEN tx IS NULL THEN 'NULL' ELSE 'uuid' END
  FROM ctx;

-- Sin identidad fiscal: vender sí, facturar no.
DO $$
DECLARE
  v_out jsonb;
BEGIN
  v_out := public.facturar_venta_pos((SELECT org FROM ctx), (SELECT tx FROM ctx));
  INSERT INTO res VALUES (
    5, 'sin IVA no se factura', 'false', COALESCE(v_out->>'ok', 'NULL'));
  INSERT INTO res VALUES (
    6, 'el motivo nombra al IVA', 'si',
    CASE WHEN v_out->>'motivo' ILIKE '%IVA%' THEN 'si' ELSE COALESCE(v_out->>'motivo','NULL') END
  );
END $$;

INSERT INTO res
SELECT 7, 'no quedó un comprobante inventado', '0',
       (SELECT count(*)::text FROM public.invoices WHERE org_id = (SELECT org FROM ctx));

-- El dueño declara monotributo. No se adivina: se escribe.
UPDATE public.settings
   SET afip_tipo_emisor = 'monotributo'
 WHERE org_id = (SELECT org FROM ctx);

DO $$
DECLARE
  v_out jsonb;
  v_otra jsonb;
BEGIN
  v_out := public.facturar_venta_pos((SELECT org FROM ctx), (SELECT tx FROM ctx));
  UPDATE ctx SET inv = NULLIF(v_out->>'invoice_id', '')::uuid;
  INSERT INTO res VALUES (8, 'con identidad se factura', 'true', COALESCE(v_out->>'ok', 'NULL'));
  INSERT INTO res VALUES (9, 'es Factura C', 'C', COALESCE(v_out->>'tipo', 'NULL'));
  INSERT INTO res VALUES (10, 'no es un replay', 'false', COALESCE(v_out->>'already', 'NULL'));

  v_otra := public.facturar_venta_pos((SELECT org FROM ctx), (SELECT tx FROM ctx));
  INSERT INTO res VALUES (
    11, 'la segunda vez es la misma', 'si',
    CASE WHEN v_otra->>'invoice_id' IS NOT DISTINCT FROM (SELECT inv::text FROM ctx)
              AND v_otra->>'already' = 'true'
         THEN 'si' ELSE COALESCE(v_otra->>'invoice_id','NULL') END
  );
END $$;

INSERT INTO res
SELECT 12, 'hay un solo comprobante', '1',
       (SELECT count(*)::text FROM public.invoices WHERE org_id = (SELECT org FROM ctx));

INSERT INTO res
SELECT 13, 'las líneas del ticket están en la factura', '1',
       (SELECT count(*)::text FROM public.invoice_items
         WHERE invoice_id = (SELECT inv FROM ctx));

INSERT INTO res
SELECT 14, 'el IVA de una C es cero', '0',
       CASE WHEN (SELECT tax_amount FROM public.invoices WHERE id = (SELECT inv FROM ctx)) = 0
            THEN '0' ELSE COALESCE((SELECT tax_amount::text FROM public.invoices WHERE id = (SELECT inv FROM ctx)), 'NULL') END;

INSERT INTO res
SELECT 15, 'el total es el del ticket', 'igual',
       CASE WHEN (SELECT i.total FROM public.invoices i WHERE i.id = (SELECT inv FROM ctx))
              = (SELECT SUM(s.total_ars) FROM public.sales s WHERE s.sale_transaction_id = (SELECT tx FROM ctx))
            THEN 'igual'
            ELSE COALESCE((SELECT i.total::text FROM public.invoices i WHERE i.id = (SELECT inv FROM ctx)), 'NULL')
                 || ' vs '
                 || COALESCE((SELECT SUM(s.total_ars)::text FROM public.sales s WHERE s.sale_transaction_id = (SELECT tx FROM ctx)), 'NULL')
       END;

RESET ROLE;

SELECT n, paso, esperado, obtenido,
       CASE WHEN obtenido = esperado THEN 'ok' ELSE '← MIRAR' END AS veredicto
  FROM res ORDER BY n;

ROLLBACK;

SELECT
  (SELECT count(*) FROM auth.users WHERE email LIKE 'zz-arca-%@ejemplo.test')
  + (SELECT count(*) FROM public.organizations WHERE name = 'ZZ facturar POS')
  AS restos_zz;
