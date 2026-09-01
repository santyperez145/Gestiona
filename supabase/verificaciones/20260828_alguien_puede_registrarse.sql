-- ¿Alguien puede registrarse en Gestiona?
--
--     npm run db -- --file supabase/verificaciones/20260828_alguien_puede_registrarse.sql
--
-- ── Por qué existe ────────────────────────────────────────────────────────
--
-- ⚠️ El 2026-08-28 se descubrió que **nadie podía registrarse desde el día
-- anterior**. Una migración le agregó un parámetro a `avisar_a_los_que_mandan`
-- con `CREATE OR REPLACE` —que no cambia una firma, crea una sobrecarga—, y
-- toda llamada con la cantidad vieja de argumentos quedó ambigua (42725).
--
-- Uno de los que llamaban así era `aplicar_limites_del_plan`, que corre desde
-- un trigger `AFTER INSERT OR UPDATE` sobre `subscriptions`. Y
-- `handle_new_user_create_org` —el trigger del alta— **inserta una suscripción
-- de prueba**. Resultado: el alta entera abortaba.
--
-- 📌 **Nadie lo vio durante un día entero.** La última organización real es del
-- 4 de agosto, así que no había altas que fallaran a la vista, y la
-- verificación que sí existe —`20260827_comercio_nuevo_puede_vender.sql`—
-- arranca desde una organización **ya creada**: se saltea el registro por
-- completo.
--
-- Este archivo cubre ese hueco: el camino que va del alta de la persona a un
-- comercio listo para trabajar. Corre en una transacción que se revierte, así
-- que no deja usuarios ni organizaciones.
--
-- ⚠️ Se inserta en `auth.users` a propósito: es lo que dispara
-- `on_auth_user_created`. Probar la función a mano no verificaría el trigger,
-- que es justo la parte que se había roto.

BEGIN;

CREATE TEMP TABLE zz_alta(n int, paso text, esperado text, obtenido text)
  ON COMMIT DROP;

DO $$
DECLARE
  v_uid uuid := gen_random_uuid();
  v_org uuid;
  v_n   int;
  v_e   jsonb;
BEGIN
  -- ── El alta real ────────────────────────────────────────────────────────
  INSERT INTO auth.users (id, instance_id, aud, role, email,
                          encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data,
                          created_at, updated_at)
  VALUES (v_uid, '00000000-0000-0000-0000-000000000000', 'authenticated',
          'authenticated', 'zz-alta-'||substr(v_uid::text,1,8)||'@ejemplo.test',
          crypt('no-se-usa', gen_salt('bf')), now(),
          '{"provider":"email","providers":["email"]}'::jsonb,
          '{"full_name":"ZZ Alta"}'::jsonb, now(), now());

  SELECT id INTO v_org FROM public.organizations WHERE owner_user_id = v_uid;
  INSERT INTO zz_alta VALUES (1, 'se creó la organización', 'una',
    CASE WHEN v_org IS NULL THEN 'NINGUNA' ELSE 'una' END);

  SELECT count(*) INTO v_n FROM public.memberships
   WHERE user_id = v_uid AND role = 'owner';
  INSERT INTO zz_alta VALUES (2, 'queda como dueño', '1', v_n::text);

  -- Acá abortaba: el trigger de límites del plan corre sobre esta fila.
  SELECT count(*) INTO v_n FROM public.subscriptions WHERE org_id = v_org;
  INSERT INTO zz_alta VALUES (3, 'nace con suscripción de prueba', '1', v_n::text);

  v_e := public.org_entitlements(v_org);
  INSERT INTO zz_alta VALUES (4, 'el plan rige', 'true', v_e->>'vigente');
  INSERT INTO zz_alta VALUES (5, 'tiene IA', 'true', v_e->>'ia');
  INSERT INTO zz_alta VALUES (6, 'con cupo de IA', '100',
    COALESCE(v_e->>'ia_restante', 'NULL'));

  SELECT count(*) INTO v_n FROM public.settings WHERE org_id = v_org;
  INSERT INTO zz_alta VALUES (7, 'nace con settings', '1', v_n::text);

  -- ⚠️ El rubro NO viene puesto: elegirlo por el comercio siembra tipos de
  -- producto y atributos de un negocio que no es el suyo.
  SELECT count(*) INTO v_n FROM public.settings
   WHERE org_id = v_org AND industry_code IS NOT NULL;
  INSERT INTO zz_alta VALUES (8, 'el rubro no viene adivinado', '0', v_n::text);

  -- ⚠️ El canal tampoco: DEFAULT 'pos' hacía que la ruta a la primera venta
  -- diera el mostrador por elegido antes del wizard.
  INSERT INTO zz_alta
  SELECT 11, 'el canal no viene adivinado', 'explore', onboarding_goal
    FROM public.organizations WHERE id = v_org;
  INSERT INTO zz_alta
  SELECT 12, 'el formulario no está hecho', 'false', onboarding_completed::text
    FROM public.organizations WHERE id = v_org;

  -- La matriz de permisos tiene que existir, o Admin → Permisos abre vacío.
  SELECT count(*) INTO v_n FROM public.role_permissions WHERE org_id = v_org;
  INSERT INTO zz_alta VALUES (9, 'nace con la matriz de permisos', '>0',
    CASE WHEN v_n > 0 THEN '>0' ELSE '0' END);

  -- ⚠️ Y el comprador de una tienda NO se vuelve dueño de una organización.
  -- Sin esto, cada cliente que compra un perfume ensucia las métricas.
  DECLARE v_comprador uuid := gen_random_uuid();
  BEGIN
    INSERT INTO auth.users (id, instance_id, aud, role, email,
                            encrypted_password, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data,
                            created_at, updated_at)
    VALUES (v_comprador, '00000000-0000-0000-0000-000000000000', 'authenticated',
            'authenticated', 'zz-compra-'||substr(v_comprador::text,1,8)||'@ejemplo.test',
            crypt('no-se-usa', gen_salt('bf')), now(),
            '{"provider":"email","providers":["email"]}'::jsonb,
            '{"account_type":"store_customer"}'::jsonb, now(), now());

    SELECT count(*) INTO v_n FROM public.organizations
     WHERE owner_user_id = v_comprador;
    INSERT INTO zz_alta VALUES (10, 'un comprador no se vuelve dueño', '0', v_n::text);
  END;
END $$;

SELECT n, paso, esperado, obtenido,
       CASE WHEN obtenido = esperado THEN 'ok' ELSE 'FALLA' END AS veredicto
  FROM zz_alta ORDER BY n;

ROLLBACK;

-- La última fila cuenta los restos y tiene que dar 0.
SELECT (SELECT count(*) FROM auth.users
         WHERE email LIKE 'zz-alta-%' OR email LIKE 'zz-compra-%') AS restos_zz;
