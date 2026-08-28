-- Una sola firma para avisar — contratar un plan estaba roto
--
-- ── El bloqueador ─────────────────────────────────────────────────────────
--
-- ⚠️ **Contratar un plan abortaba, y aplicar los límites del plan nunca
-- funcionó.** Encontrado el 2026-08-28 al insertar una suscripción de prueba:
--
--     ERROR: 42725: function public.avisar_a_los_que_mandan(
--            uuid, text, text, unknown, unknown, unknown) is not unique
--     CONTEXT: PL/pgSQL function aplicar_limites_del_plan(uuid) line 47
--              SQL statement "SELECT public.aplicar_limites_del_plan(NEW.org_id)"
--              PL/pgSQL function trg_aplicar_limites_del_plan()
--
-- ── Cómo se llegó ─────────────────────────────────────────────────────────
--
-- `20260827000210` creó `avisar_a_los_que_mandan` con **6** parámetros.
-- `20260827000230` le agregó `p_por_correo boolean DEFAULT false` y la volvió a
-- declarar con `CREATE OR REPLACE`.
--
-- 📌 **`CREATE OR REPLACE FUNCTION` no puede cambiar una firma: agrega una
-- sobrecarga.** Quedaron las dos, y como el séptimo parámetro tiene default, la
-- de 7 también acepta 6 argumentos. Toda llamada con 6 pasó a ser ambigua.
--
-- ⚠️ Y el efecto no se pareció en nada a la causa. Lo que se rompió fue:
--
--   - `aplicar_limites_del_plan`, que es lo que hace que **bajar de plan baje
--     los límites de verdad**. Nunca corrió una sola vez.
--   - `trg_aplicar_limites_del_plan`, que corre `AFTER INSERT OR UPDATE` sobre
--     `subscriptions` — así que **el alta de una suscripción abortaba entera**.
--
-- 📌 Ninguna pantalla decía «hay dos funciones con el mismo nombre». Decía que
-- no se pudo contratar el plan.
--
-- ── La corrección ─────────────────────────────────────────────────────────
--
-- Se dropea la de 6. Con una sola candidata, una llamada de 6 argumentos
-- resuelve a la de 7 con `p_por_correo` en su default, que es exactamente el
-- comportamiento que `20260827000210` tenía.
--
-- ⚠️ El orden importa: primero se comprueba que la de 7 exista. Dropear la de 6
-- sin eso dejaría a los cuatro llamadores sin ninguna.

DO $arreglo$
DECLARE
  v_tiene7 boolean;
BEGIN
  -- 📌 Se cuenta por `pronargs` y no comparando la firma como texto:
  -- `pg_get_function_identity_arguments` devuelve los **nombres** de los
  -- parámetros además de los tipos («p_org uuid, p_titulo text, …»), así que
  -- compararla contra una lista de tipos no coincide nunca. La primera versión
  -- de esta migración abortó por eso — y abortó bien: la guarda existe
  -- justamente para no dropear la de 6 sin confirmar que hay otra.
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'avisar_a_los_que_mandan'
       AND p.pronargs = 7
  ) INTO v_tiene7;

  IF NOT v_tiene7 THEN
    RAISE EXCEPTION 'no existe la versión de 7 parámetros: dropear la de 6 '
                    'dejaría a los avisos sin ninguna función';
  END IF;

  DROP FUNCTION IF EXISTS public.avisar_a_los_que_mandan(uuid, text, text, text, text, uuid);
END $arreglo$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Verificación — que la ambigüedad se fue Y que lo roto vuelve a andar
-- ═══════════════════════════════════════════════════════════════════════════

DO $verif$
DECLARE
  v_n      int;
  v_org    uuid;
  v_user   uuid;
  v_plan   uuid;
  v_orgzz  uuid := gen_random_uuid();
  v_restos int;
BEGIN
  -- ── a. Queda una sola firma ─────────────────────────────────────────────
  SELECT count(*) INTO v_n
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'avisar_a_los_que_mandan';
  ASSERT v_n = 1, 'quedaron ' || v_n || ' firmas de avisar_a_los_que_mandan';

  -- ── b. ⚠️ Lo que estaba roto vuelve a correr ────────────────────────────
  -- Sin esta parte, «se dropeó la duplicada» pasaría aunque los llamadores
  -- siguieran fallando por otra razón.
  SELECT org_id INTO v_org FROM public.memberships LIMIT 1;
  PERFORM public.aplicar_limites_del_plan(v_org);

  -- ── c. ⚠️ Y el alta de una suscripción deja de abortar ──────────────────
  -- Es lo que realmente se le rompía al comercio: contratar un plan.
  SELECT user_id INTO v_user FROM public.memberships LIMIT 1;
  SELECT id INTO v_plan FROM public.plans WHERE code = 'pro';

  INSERT INTO public.organizations (id, name, slug, owner_user_id, plan_id)
  VALUES (v_orgzz, 'ZZ contrata plan', 'zz-cp-'||substr(v_orgzz::text,1,8), v_user, v_plan);
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_orgzz, v_user, 'owner');
  INSERT INTO public.subscriptions (org_id, plan_id, status, provider)
  VALUES (v_orgzz, v_plan, 'past_due', 'mercadopago');

  ASSERT (SELECT count(*) FROM public.subscriptions WHERE org_id = v_orgzz) = 1,
    'el alta de la suscripción no quedó';

  -- ── d. Sin restos ───────────────────────────────────────────────────────
  DELETE FROM public.subscriptions WHERE org_id = v_orgzz;
  DELETE FROM public.memberships   WHERE org_id = v_orgzz;
  DELETE FROM public.organizations WHERE id = v_orgzz;
  SELECT count(*) INTO v_restos FROM public.organizations WHERE name = 'ZZ contrata plan';
  ASSERT v_restos = 0, 'quedaron restos ZZ';

  RAISE NOTICE 'OK: una sola firma, los límites del plan corren y contratar no aborta';
END $verif$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260828000020', 'una_sola_firma_para_avisar')
ON CONFLICT DO NOTHING;
