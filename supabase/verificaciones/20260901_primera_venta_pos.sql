-- ¿Un comercio que eligió POS puede cobrar el primer ticket de verdad?
--
--     npm run db -- --file supabase/verificaciones/20260901_primera_venta_pos.sql
--
-- ── Por qué existe ──────────────────────────────────────────────────────
--
-- `20260827_comercio_nuevo_puede_vender.sql` arranca desde una organización
-- ya insertada, escribe `products.stock` en el INSERT y vende. Eso no es el
-- camino de la UI: el wizard llama `complete_business_onboarding`, siembra
-- Casa central, el alta del producto deja el stock en 0 y `adjust_stock`
-- escribe el Kardex, y el POS cobra sin turno abierto.
--
-- Un verde de aquella verificación no prueba que un comercio que sale del
-- wizard cobre. Esta sí: alta real → wizard POS → primer SKU por Kardex →
-- ticket `efectivo` cobrado, sin sesión de caja, como el rol `authenticated`.
--
-- Corre en una transacción que se revierte. La última consulta cuenta
-- restos y tiene que dar 0.

BEGIN;

CREATE TEMP TABLE res(n int, paso text, esperado text, obtenido text) ON COMMIT DROP;
GRANT ALL ON res TO authenticated;
CREATE TEMP TABLE ctx(org uuid, usr uuid, prod uuid, loc uuid) ON COMMIT DROP;
GRANT ALL ON ctx TO authenticated;

-- ═══ Alta real: el trigger de registro, no un INSERT a organizations ════
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
          'authenticated', 'zz-pos-'||substr(v_uid::text,1,8)||'@ejemplo.test',
          crypt('no-se-usa', gen_salt('bf')), now(),
          '{"provider":"email","providers":["email"]}'::jsonb,
          '{"full_name":"ZZ POS"}'::jsonb, now(), now());

  SELECT id INTO v_org FROM public.organizations WHERE owner_user_id = v_uid;
  INSERT INTO ctx(org, usr, prod) VALUES (v_org, v_uid, gen_random_uuid());
END $$;

INSERT INTO res
SELECT 1, 'nace la organización', 'una',
       CASE WHEN org IS NULL THEN 'NINGUNA' ELSE 'una' END
  FROM ctx;

INSERT INTO res
SELECT 2, 'el canal no viene adivinado', 'explore', onboarding_goal
  FROM public.organizations WHERE id = (SELECT org FROM ctx);

INSERT INTO res
SELECT 3, 'el formulario no está hecho', 'false', onboarding_completed::text
  FROM public.organizations WHERE id = (SELECT org FROM ctx);

-- ═══ El dueño termina el wizard eligiendo mostrador ═════════════════════
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
    'ZZ primera venta POS',
    '#7c3aed',
    'otro',
    'pos'
  );
  IF v_out->>'status' IS DISTINCT FROM 'succeeded' THEN
    INSERT INTO res VALUES (4, 'terminar el wizard POS', 'succeeded',
      COALESCE(v_out->>'status','NULL')||' '||COALESCE(v_out->>'error', v_out::text));
    RETURN;
  END IF;
  INSERT INTO res VALUES (4, 'terminar el wizard POS', 'succeeded', 'succeeded');

  SELECT id INTO v_loc
    FROM public.locations
   WHERE org_id = (SELECT org FROM ctx) AND active AND is_main
   LIMIT 1;
  UPDATE ctx SET loc = v_loc;
EXCEPTION WHEN OTHERS THEN
  INSERT INTO res VALUES (4, 'terminar el wizard POS', 'succeeded', 'FRENADO: '||SQLERRM);
END $$;

INSERT INTO res
SELECT 5, 'eligió mostrador', 'pos', onboarding_goal
  FROM public.organizations WHERE id = (SELECT org FROM ctx);

INSERT INTO res
SELECT 6, 'Casa central sembrada', '1',
       (SELECT count(*)::text FROM public.locations
         WHERE org_id = (SELECT org FROM ctx) AND active AND is_main AND name = 'Casa central');

INSERT INTO res
SELECT 7, 'el rubro quedó elegido, no adivinado', 'otro',
       COALESCE((SELECT industry_code FROM public.settings WHERE org_id=(SELECT org FROM ctx)), 'NULL');

INSERT INTO res
SELECT 8, 'hay fila de perfil', '1',
       (SELECT count(*)::text FROM public.organization_business_profiles
         WHERE org_id = (SELECT org FROM ctx) AND industry_code = 'otro');

-- ═══ Primer producto: el cliente no escribe products.stock ═════════════
DO $$
BEGIN
  INSERT INTO public.products (id, org_id, user_id, name, sale_price_ars, is_active)
  SELECT prod, org, usr, 'ZZ primer producto', 5000, true FROM ctx;

  PERFORM public.adjust_stock(
    (SELECT org FROM ctx),
    (SELECT prod FROM ctx),
    NULL,
    3,
    'Stock inicial al crear producto',
    (SELECT usr FROM ctx),
    NULL
  );
  INSERT INTO res VALUES (9, 'cargar el primer SKU por Kardex', 'PUDO', 'PUDO');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO res VALUES (9, 'cargar el primer SKU por Kardex', 'PUDO', 'FRENADO: '||SQLERRM);
END $$;

INSERT INTO res
SELECT 10, 'el stock quedó en Casa central', '3',
       COALESCE((
         SELECT ls.stock::text
           FROM public.location_stock ls
          WHERE ls.product_id = (SELECT prod FROM ctx)
            AND ls.location_id = (SELECT loc FROM ctx)
       ), 'sin fila');

INSERT INTO res
SELECT 11, 'el stock global coincide', '3',
       COALESCE((SELECT stock::text FROM public.products WHERE id=(SELECT prod FROM ctx)), 'NULL');

-- ═══ Primer ticket: efectivo cobrado, sin turno ═══════════════════════════
DO $$
DECLARE
  v_out jsonb;
BEGIN
  v_out := public.create_sales_transaction_v3(
    (SELECT org FROM ctx),
    jsonb_build_array(jsonb_build_object(
      'product_id', (SELECT prod FROM ctx),
      'product_name', 'ZZ primer producto',
      'quantity', 1,
      'unit_price_ars', 5000,
      'total_ars', 5000,
      'payment_method', 'efectivo',
      'paid', true,
      'location_id', (SELECT loc FROM ctx)
    )),
    'pos'
  );
  INSERT INTO res VALUES (12, 'cobrar el primer ticket', 'PUDO', 'PUDO');
  INSERT INTO res VALUES (
    13,
    'el turno no es la puerta',
    'no_open_session',
    COALESCE(v_out->'cash_session'->>'reason', 'NULL')
  );
  INSERT INTO res VALUES (
    14,
    'no inventó un turno',
    'false',
    COALESCE(v_out->'cash_session'->>'linked', 'NULL')
  );
EXCEPTION WHEN OTHERS THEN
  INSERT INTO res VALUES (12, 'cobrar el primer ticket', 'PUDO', 'FRENADO: '||SQLERRM);
  INSERT INTO res VALUES (13, 'el turno no es la puerta', 'no_open_session', 'no se llegó');
  INSERT INTO res VALUES (14, 'no inventó un turno', 'false', 'no se llegó');
END $$;

RESET ROLE;

INSERT INTO res
SELECT 15, 'quedó cobrada', 'true',
       COALESCE((SELECT paid::text FROM public.sales
                  WHERE org_id=(SELECT org FROM ctx) AND product_id=(SELECT prod FROM ctx)
                  LIMIT 1), 'NULL');

INSERT INTO res
SELECT 16, 'el stock bajó', '2',
       COALESCE((SELECT stock::text FROM public.products WHERE id=(SELECT prod FROM ctx)), 'NULL');

INSERT INTO res
SELECT 17, 'Casa central también bajó', '2',
       COALESCE((
         SELECT ls.stock::text FROM public.location_stock ls
          WHERE ls.product_id = (SELECT prod FROM ctx)
            AND ls.location_id = (SELECT loc FROM ctx)
       ), 'sin fila');

INSERT INTO res
SELECT 18, 'la venta llegó al libro', '>0',
       CASE WHEN (SELECT count(*) FROM public.ledger_entries WHERE org_id=(SELECT org FROM ctx)) > 0
            THEN '>0' ELSE '0 ← la venta no se asentó' END;

INSERT INTO res
SELECT 19, 'no se abrió un turno', '0',
       (SELECT count(*)::text FROM public.cash_sessions WHERE org_id=(SELECT org FROM ctx));

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  json_build_object('sub',(SELECT usr::text FROM ctx),'role','authenticated')::text, true);

INSERT INTO res
SELECT 20, 'la activación cuenta la venta POS', 'una',
       CASE WHEN EXISTS (
         SELECT 1 FROM public.organization_activation_readiness
          WHERE org_id = (SELECT org FROM ctx)
            AND first_pos_sale_at IS NOT NULL
            AND pos_sales_total >= 1
       ) THEN 'una' ELSE 'ninguna' END;

RESET ROLE;

SELECT n, paso, esperado, obtenido,
       CASE WHEN obtenido = esperado THEN 'ok' ELSE '← MIRAR' END AS veredicto
  FROM res ORDER BY n;

ROLLBACK;

SELECT
  (SELECT count(*) FROM auth.users WHERE email LIKE 'zz-pos-%@ejemplo.test')
  + (SELECT count(*) FROM public.organizations WHERE name = 'ZZ primera venta POS')
  AS restos_zz;
