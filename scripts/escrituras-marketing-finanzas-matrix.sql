-- Matriz reversible de 20261011000100 (escrituras de marketing, finanzas e
-- historial de stock).
--   node scripts/db.mjs --file scripts/escrituras-marketing-finanzas-matrix.sql
-- Comercio ZZ con dueño, vendedor y visualizador (permisos por defecto):
-- el vendedor no crea campañas de WhatsApp ni a segmentos, no toca alertas de
-- presupuesto ni fabrica historial de stock, pero sigue inscribiendo contactos
-- en automatizaciones (CRM crear). El visualizador no inscribe. El dueño puede
-- todo. Todo se revierte.
BEGIN;
SET LOCAL statement_timeout = '60s';
CREATE TEMP TABLE zz_mf (caso text, valor text) ON COMMIT DROP;
GRANT ALL ON zz_mf TO authenticated;

CREATE FUNCTION pg_temp.intento(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN 'pudo';
EXCEPTION WHEN insufficient_privilege THEN
  RETURN 'rechazado';
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.intento(text) TO authenticated;

DO $d$
DECLARE
  v_owner uuid; v_vend uuid; v_viewer uuid; v_org uuid; v_seg uuid; v_seq uuid; v_rol text; v_u uuid;
BEGIN
  SELECT id INTO v_owner FROM auth.users ORDER BY created_at LIMIT 1;
  SELECT id INTO v_vend FROM auth.users WHERE id <> v_owner ORDER BY created_at LIMIT 1;
  SELECT id INTO v_viewer FROM auth.users WHERE id NOT IN (v_owner, v_vend) ORDER BY created_at LIMIT 1;
  INSERT INTO public.organizations (name, slug, owner_user_id)
    VALUES ('ZZ permisos', 'zz-permisos-' || substr(md5(random()::text), 1, 8), v_owner) RETURNING id INTO v_org;
  INSERT INTO public.memberships (org_id, user_id, role)
    VALUES (v_org, v_owner, 'owner'), (v_org, v_vend, 'vendedor'), (v_org, v_viewer, 'viewer') ON CONFLICT DO NOTHING;
  INSERT INTO public.customer_segments (org_id, name) VALUES (v_org, 'ZZ segmento') RETURNING id INTO v_seg;
  INSERT INTO public.drip_sequences (org_id, name) VALUES (v_org, 'ZZ secuencia') RETURNING id INTO v_seq;

  FOREACH v_rol IN ARRAY ARRAY['vendedor', 'viewer', 'owner'] LOOP
    v_u := CASE v_rol WHEN 'vendedor' THEN v_vend WHEN 'viewer' THEN v_viewer ELSE v_owner END;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_u, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    INSERT INTO zz_mf VALUES (v_rol || ': campaña de WhatsApp',
      pg_temp.intento(format('INSERT INTO public.whatsapp_campaigns (org_id, message) VALUES (%L, %L)', v_org, 'ZZ')));
    INSERT INTO zz_mf VALUES (v_rol || ': campaña a segmento',
      pg_temp.intento(format('INSERT INTO public.segment_campaigns (org_id, segment_id, name) VALUES (%L, %L, %L)', v_org, v_seg, 'ZZ')));
    INSERT INTO zz_mf VALUES (v_rol || ': inscribir en automatización',
      pg_temp.intento(format('INSERT INTO public.drip_enrollments (org_id, sequence_id, customer_email) VALUES (%L, %L, %L)', v_org, v_seq, v_rol || '@zz.invalid')));
    INSERT INTO zz_mf VALUES (v_rol || ': alerta de presupuesto',
      pg_temp.intento(format('INSERT INTO public.finance_budget_alerts (org_id, year, month, category_key) VALUES (%L, 2026, 10, %L)', v_org, 'zz-' || v_rol)));
    INSERT INTO zz_mf VALUES (v_rol || ': historial de stock',
      pg_temp.intento(format('INSERT INTO public.stock_history (org_id, product_name, change, new_stock) VALUES (%L, %L, 1, 1)', v_org, 'ZZ')));
    RESET ROLE;
  END LOOP;
END $d$;

SELECT * FROM zz_mf;
ROLLBACK;
