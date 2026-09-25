-- ============================================================================
-- Verificación reversible: publicación verificable (20260925000200).
-- Correr con `supabase db query --linked --file <este archivo>`.
-- Todo corre dentro de un bloque con ROLLBACK: no deja datos.
-- ============================================================================

BEGIN;
DO $verify$
DECLARE
  v_org   uuid := gen_random_uuid();
  v_user  uuid;
  v_infl  uuid;
  v_camp  uuid;
  v_deliv uuid;
  v_url   text;
  v_lic   text;
BEGIN
  SELECT user_id INTO v_user FROM public.memberships WHERE role = 'owner' ORDER BY joined_at LIMIT 1;
  ASSERT v_user IS NOT NULL, 'requires existing user';

  -- ── Seed como postgres (la conexión admin no pasa por RLS) ────────────
  INSERT INTO public.organizations(id, name, slug, owner_user_id) VALUES
    (v_org, 'ZZ Publication verification', 'zz-pubproof-' || v_org, v_user);
  INSERT INTO public.memberships(org_id, user_id, role) VALUES (v_org, v_user, 'owner');

  -- Perfil de creador de prueba con el email de la cuenta dueña (los RPC del
  -- creador resuelven por email; acá sólo se usa el entregable de la marca).
  INSERT INTO public.influencers(id, org_id, user_id, name, email, referral_code, status)
  VALUES (gen_random_uuid(), v_org, v_user, 'QA Creador proof', 'qa-pubproof-' || v_org || '@example.com', 'qa' || substr(v_org::text, 1, 8), 'active')
  RETURNING id INTO v_infl;

  -- Plan de permisos: influencer con edit para el admin (roles válidos:
  -- admin/vendedor/viewer; el dueño actúa como admin de la org de prueba).
  INSERT INTO public.role_permissions(org_id, role, module, can_view, can_edit)
  VALUES (v_org, 'admin', 'influencers', true, true)
  ON CONFLICT (org_id, role, module) DO UPDATE SET can_view = true, can_edit = true;

  -- Campaña + asignación + entregable 'entregado' se crean como postgres
  -- (la escritura de campañas es server-side: authenticated sólo lee).
  INSERT INTO public.influencer_campaigns (org_id, title, brief, objective, channel, budget_ars, status, created_by)
  VALUES (v_org, 'QA proof campaña', 'prueba reversible', 'awareness', 'instagram', 0, 'active', v_user)
  RETURNING id INTO v_camp;

  INSERT INTO public.influencer_campaign_creators (org_id, campaign_id, influencer_id)
  VALUES (v_org, v_camp, v_infl);

  INSERT INTO public.influencer_deliverables
    (org_id, influencer_id, influencer_name, campaign_id, campaign_name, description, due_date, content_url, status)
  VALUES (v_org, v_infl, 'QA Creador proof', v_camp, 'QA proof campaña', 'entregable de prueba reversible', CURRENT_DATE, 'https://ejemplo.com/post', 'entregado')
  RETURNING id INTO v_deliv;

  -- ── Sesión autenticada: el dueño ejercita la RPC de proof ──────────────
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- 1) RPC: proof válido registra URL, licencia y verificador.
  SELECT pp.publication_url, pp.license_type INTO v_url, v_lic
  FROM public.register_publication_proof(
    v_deliv, 'instagram', 'https://ejemplo.com/reel-publicado', 'uso_campaña', NULL, 'QA reversible'
  ) pp;
  ASSERT v_url = 'https://ejemplo.com/reel-publicado', 'proof no devolvio la URL registrada';
  ASSERT v_lic = 'uso_campaña', 'proof no devolvio la licencia registrada';

  -- 2) URL insegura: rechazo.
  BEGIN
    PERFORM public.register_publication_proof(v_deliv, 'instagram', 'http://inseguro.com', 'organico');
    ASSERT false, 'se_acepto_url_http';
  EXCEPTION WHEN OTHERS THEN
    NULL; -- se esperaba el rechazo
  END;

  -- 3) Licencia pagada sin vencimiento: rechazo.
  BEGIN
    PERFORM public.register_publication_proof(v_deliv, 'tiktok', 'https://ejemplo.com/paid', 'paid_ampliado', NULL);
    ASSERT false, 'se_acepto_licencia_sin_vencimiento';
  EXCEPTION WHEN OTHERS THEN
    NULL; -- se esperaba el rechazo
  END;

  -- 4) Entregable pendiente: rechazo.
  INSERT INTO public.influencer_deliverables
    (org_id, influencer_id, influencer_name, campaign_id, campaign_name, description, due_date, status)
  VALUES (v_org, v_infl, 'QA Creador proof', v_camp, 'QA proof campaña', 'pendiente sin contenido', CURRENT_DATE, 'pendiente')
  RETURNING id INTO v_deliv;

  BEGIN
    PERFORM public.register_publication_proof(v_deliv, 'otro', 'https://ejemplo.com/x', 'organico');
    ASSERT false, 'se_acepto_entregable_pendiente';
  EXCEPTION WHEN OTHERS THEN
    NULL; -- se esperaba el rechazo
  END;

  -- 5) Vista del creador: columnas nuevas presentes en la firma.
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'creator_campaigns'
      AND pg_get_function_result(p.oid) LIKE '%publication_url%'
  ), 'creator_campaigns_sin_columnas_publicacion';

  RAISE NOTICE 'OK publication_proofs: validaciones y RPC verificadas';
END;
$verify$;
ROLLBACK;

SELECT count(*) AS remaining_test_organizations FROM public.organizations WHERE name = 'ZZ Publication verification';
