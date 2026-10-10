-- Matriz reversible de 20261010000400: en las tablas de gestión, un vendedor
-- lee pero no crea, edita ni borra; el dueño sí. Corre como usuarios reales
-- (rol authenticated con claims) y revierte todo.
--
--   node scripts/db.mjs --file scripts/management-writes-matrix.sql
--
-- Además de la prueba funcional en tres tablas representativas, cuenta
-- cuántas políticas de borrado exigen has_org_role.
--
-- 2026-10-10, sin la migración: el vendedor borraba la baja de email, editaba
-- el proveedor y creaba el tipo de producto (1, 1, 1). Con ella: 0, 0, 0.
BEGIN;
SET LOCAL statement_timeout = '120s';
CREATE TEMP TABLE zz_gestion (caso text, valor int, detalle text) ON COMMIT DROP;
GRANT ALL ON zz_gestion TO authenticated;

DO $d$
DECLARE
  v_owner uuid; v_vend uuid; v_org uuid; v_n int; v_prov uuid;
BEGIN
  SELECT id INTO v_owner FROM auth.users ORDER BY created_at LIMIT 1;
  SELECT id INTO v_vend FROM auth.users WHERE id <> v_owner ORDER BY created_at LIMIT 1;
  INSERT INTO public.organizations (name, slug, owner_user_id)
    VALUES ('ZZ gestion', 'zz-gestion-' || substr(md5(random()::text), 1, 10), v_owner) RETURNING id INTO v_org;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_owner, 'owner'), (v_org, v_vend, 'vendedor');
  INSERT INTO public.suppliers (org_id, name) VALUES (v_org, 'ZZ proveedor') RETURNING id INTO v_prov;
  INSERT INTO public.email_suppressions (org_id, email) VALUES (v_org, 'zz-baja@invalid.test');

  -- ── Vendedor ────────────────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_vend, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM public.suppliers WHERE org_id = v_org;
  INSERT INTO zz_gestion VALUES ('vendedor lee proveedores', v_n, '');
  DELETE FROM public.email_suppressions WHERE org_id = v_org; GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO zz_gestion VALUES ('vendedor borra una baja de email', v_n, '');
  UPDATE public.suppliers SET name = 'ZZ cambiado' WHERE id = v_prov; GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO zz_gestion VALUES ('vendedor edita un proveedor', v_n, '');
  BEGIN
    INSERT INTO public.product_types (org_id, name, slug) VALUES (v_org, 'ZZ tipo', 'zz-tipo');
    INSERT INTO zz_gestion VALUES ('vendedor crea un tipo de producto', 1, '');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO zz_gestion VALUES ('vendedor crea un tipo de producto', 0, SQLERRM);
  END;
  RESET ROLE;

  -- ── Dueño ───────────────────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO public.product_types (org_id, name, slug) VALUES (v_org, 'ZZ tipo del dueño', 'zz-tipo-dueno'); GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO zz_gestion VALUES ('dueño crea un tipo de producto', v_n, '');
  UPDATE public.suppliers SET name = 'ZZ cambiado' WHERE id = v_prov; GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO zz_gestion VALUES ('dueño edita un proveedor', v_n, '');
  DELETE FROM public.email_suppressions WHERE org_id = v_org; GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO zz_gestion VALUES ('dueño borra una baja de email', v_n, '');
  RESET ROLE;
END $d$;

-- Forma de las políticas: cuántas políticas de borrado exigen rol.
INSERT INTO zz_gestion
SELECT 'políticas de borrado con has_org_role', count(*)::int, ''
  FROM pg_policies WHERE schemaname = 'public' AND cmd = 'DELETE'
   AND policyname LIKE '%\_borrar' AND qual LIKE '%has_org_role%';

SELECT * FROM zz_gestion;
ROLLBACK;
