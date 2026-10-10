-- Realtime por Broadcast. Datos ZZ; ROLLBACK.
BEGIN;
CREATE TEMP TABLE zz_rt_ctx(org_id uuid, owner_id uuid, otro_id uuid);
DO $$
DECLARE v_org uuid := gen_random_uuid(); v_owner uuid; v_otro uuid;
BEGIN
  SELECT user_id INTO v_owner FROM public.memberships WHERE role = 'owner' ORDER BY joined_at LIMIT 1;
  SELECT id INTO v_otro FROM auth.users WHERE id <> v_owner AND id NOT IN (SELECT user_id FROM public.platform_admins) ORDER BY created_at LIMIT 1;
  INSERT INTO public.organizations(id, name, slug, owner_user_id) VALUES (v_org, 'ZZ Realtime', 'zz-rt-' || v_org, v_owner);
  INSERT INTO public.memberships(org_id, user_id, role) VALUES (v_org, v_owner, 'owner');
  INSERT INTO zz_rt_ctx VALUES (v_org, v_owner, v_otro);

  -- Dos productos en una sola sentencia: un único aviso de stock bajo.
  INSERT INTO public.products(org_id, user_id, name, sale_price_ars, maneja_stock) VALUES
    (v_org, v_owner, 'ZZ A', 10, false), (v_org, v_owner, 'ZZ B', 10, false);
  UPDATE public.products SET maneja_stock = true WHERE org_id = v_org;
  PERFORM public.rt_enviar('org:' || v_org, 'zz_prueba', '{"ok": true}'::jsonb);
  ASSERT (SELECT count(*) FROM realtime.messages WHERE topic = 'org:' || v_org AND event = 'zz_prueba') = 1, 'No se envió el aviso';
  ASSERT NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime'), 'Quedaron tablas publicadas';
END;
$$;
GRANT SELECT ON zz_rt_ctx TO authenticated;
SET LOCAL ROLE authenticated;
DO $$
DECLARE c record; n int;
BEGIN
  SELECT * INTO c FROM zz_rt_ctx;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', c.owner_id, 'role', 'authenticated')::text, true);
  PERFORM set_config('realtime.topic', 'org:' || c.org_id, true);
  SELECT count(*) INTO n FROM realtime.messages WHERE topic = 'org:' || c.org_id;
  ASSERT n >= 1, 'El miembro no ve su topic';
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', c.otro_id, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO n FROM realtime.messages WHERE topic = 'org:' || c.org_id;
  ASSERT n = 0, 'Un usuario ajeno ve el topic de otra organización';
END;
$$;
RESET ROLE;
SELECT 'realtime_broadcast OK' AS resultado;
ROLLBACK;
