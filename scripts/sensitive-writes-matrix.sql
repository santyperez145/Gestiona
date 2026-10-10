-- Matriz reversible de escrituras sensibles (20261010000300). Un vendedor y
-- un dueño reales (rol authenticated con claims) intentan lo que la política
-- tiene que frenar y lo que tiene que permitir. Revierte todo.
--
--   node scripts/db.mjs --file scripts/sensitive-writes-matrix.sql
--
-- 2026-10-10, antes del arreglo: el vendedor borraba un comprobante de ARCA,
-- creaba una clave de API y configuraba cobros (1, 1, 1). Después: 0, 0, 0;
-- el dueño no puede borrar un comprobante con CAE y sí un borrador.
BEGIN;
CREATE TEMP TABLE zz_rls (caso text, filas int, detalle text) ON COMMIT DROP;
GRANT ALL ON zz_rls TO authenticated;
DO $d$
DECLARE v_owner uuid; v_vend uuid; v_org uuid; v_n int;
BEGIN
  SELECT id INTO v_owner FROM auth.users ORDER BY created_at LIMIT 1;
  SELECT id INTO v_vend FROM auth.users WHERE id <> v_owner ORDER BY created_at LIMIT 1;
  INSERT INTO public.organizations (name, slug, owner_user_id)
    VALUES ('ZZ rls', 'zz-rls-' || substr(md5(random()::text),1,10), v_owner) RETURNING id INTO v_org;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_owner, 'owner'), (v_org, v_vend, 'vendedor');
  INSERT INTO public.afip_comprobantes (org_id, tipo_cbte, punto_venta, nro_cbte) VALUES (v_org, 6, 9999, 1);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_vend, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    DELETE FROM public.afip_comprobantes WHERE org_id = v_org; GET DIAGNOSTICS v_n = ROW_COUNT;
    INSERT INTO zz_rls VALUES ('vendedor borra comprobante ARCA', v_n, '');
  EXCEPTION WHEN OTHERS THEN INSERT INTO zz_rls VALUES ('vendedor borra comprobante ARCA', 0, SQLERRM); END;
  BEGIN
    INSERT INTO public.org_api_keys (org_id, key_hash) VALUES (v_org, 'zz-hash'); GET DIAGNOSTICS v_n = ROW_COUNT;
    INSERT INTO zz_rls VALUES ('vendedor crea clave de API', v_n, '');
  EXCEPTION WHEN OTHERS THEN INSERT INTO zz_rls VALUES ('vendedor crea clave de API', 0, SQLERRM); END;
  BEGIN
    INSERT INTO public.org_payment_providers (org_id, provider) VALUES (v_org, 'mercadopago'); GET DIAGNOSTICS v_n = ROW_COUNT;
    INSERT INTO zz_rls VALUES ('vendedor configura cobros', v_n, '');
  EXCEPTION WHEN OTHERS THEN INSERT INTO zz_rls VALUES ('vendedor configura cobros', 0, SQLERRM); END;
  BEGIN
    DELETE FROM public.stock_history WHERE org_id = v_org; GET DIAGNOSTICS v_n = ROW_COUNT;
    INSERT INTO zz_rls VALUES ('vendedor borra auditoría (0 filas ZZ: sólo no debe fallar)', v_n, '');
  EXCEPTION WHEN OTHERS THEN INSERT INTO zz_rls VALUES ('vendedor borra auditoría', 0, SQLERRM); END;
  BEGIN
    PERFORM 1 FROM public.org_payment_providers WHERE org_id = v_org;
    SELECT count(*) INTO v_n FROM public.afip_comprobantes WHERE org_id = v_org;
    INSERT INTO zz_rls VALUES ('vendedor lee comprobantes', v_n, '');
  EXCEPTION WHEN OTHERS THEN INSERT INTO zz_rls VALUES ('vendedor lee comprobantes', -1, SQLERRM); END;
  RESET ROLE;

  -- El dueño sigue pudiendo todo lo legítimo.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO public.org_api_keys (org_id, key_hash) VALUES (v_org, 'zz-hash-owner'); GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO zz_rls VALUES ('dueño crea clave de API', v_n, '');
  UPDATE public.afip_comprobantes SET cae = '12345678901234' WHERE org_id = v_org;
  DELETE FROM public.afip_comprobantes WHERE org_id = v_org; GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO zz_rls VALUES ('dueño borra comprobante CON CAE', v_n, '');
  UPDATE public.afip_comprobantes SET cae = NULL WHERE org_id = v_org;
  DELETE FROM public.afip_comprobantes WHERE org_id = v_org; GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO zz_rls VALUES ('dueño borra borrador sin CAE', v_n, '');
  RESET ROLE;
END $d$;
SELECT * FROM zz_rls;
ROLLBACK;
