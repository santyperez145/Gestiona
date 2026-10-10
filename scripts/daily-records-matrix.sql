-- Matriz reversible de 20261010001500: los registros del día a día se agregan,
-- no se reescriben. Un vendedor y un dueño reales (rol authenticated con
-- claims) registran, editan y borran; todo se revierte.
--
--   node scripts/db.mjs --file scripts/daily-records-matrix.sql
--
-- 2026-10-10, sin la migración: el vendedor borraba el uso de un cupón (le
-- devolvía el uso a la promoción) y una actividad del CRM.
BEGIN;
SET LOCAL statement_timeout = '120s';
CREATE TEMP TABLE zz_registros (caso text, valor int, detalle text) ON COMMIT DROP;
GRANT ALL ON zz_registros TO authenticated;

DO $d$
DECLARE
  v_owner uuid; v_vend uuid; v_org uuid; v_n int; v_promo uuid; v_deal uuid;
BEGIN
  SELECT id INTO v_owner FROM auth.users ORDER BY created_at LIMIT 1;
  SELECT id INTO v_vend FROM auth.users WHERE id <> v_owner ORDER BY created_at LIMIT 1;
  INSERT INTO public.organizations (name, slug, owner_user_id)
    VALUES ('ZZ registros', 'zz-registros-' || substr(md5(random()::text), 1, 10), v_owner) RETURNING id INTO v_org;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_owner, 'owner'), (v_org, v_vend, 'vendedor');
  INSERT INTO public.promotions (org_id, name) VALUES (v_org, 'ZZ promo') RETURNING id INTO v_promo;
  INSERT INTO public.deals (org_id, user_id, title) VALUES (v_org, v_owner, 'ZZ oportunidad') RETURNING id INTO v_deal;
  INSERT INTO public.deal_activities (org_id, deal_id, type, content) VALUES (v_org, v_deal, 'note', 'ZZ nota');

  -- ── Vendedor ────────────────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_vend, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO public.promotion_usages (promotion_id, org_id) VALUES (v_promo, v_org); GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO zz_registros VALUES ('vendedor registra el uso de un cupón', v_n, '');
  DELETE FROM public.promotion_usages WHERE org_id = v_org; GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO zz_registros VALUES ('vendedor borra el uso de un cupón', v_n, '');
  DELETE FROM public.deal_activities WHERE org_id = v_org; GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO zz_registros VALUES ('vendedor borra una actividad del CRM', v_n, '');
  RESET ROLE;

  -- ── Dueño ───────────────────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  DELETE FROM public.promotion_usages WHERE org_id = v_org; GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO zz_registros VALUES ('dueño borra el uso de un cupón (debe ser 0)', v_n, '');
  DELETE FROM public.deal_activities WHERE org_id = v_org; GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO zz_registros VALUES ('dueño corrige una actividad del CRM', v_n, '');
  RESET ROLE;
END $d$;

SELECT * FROM zz_registros;
ROLLBACK;
