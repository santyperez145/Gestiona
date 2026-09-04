-- Verificación reversible del ciclo borrador → preview → publicación → rollback.
-- No usa productos, stock, clientes ni órdenes reales.

BEGIN;

DO $verify$
DECLARE
  v_org uuid := gen_random_uuid();
  v_store uuid := gen_random_uuid();
  v_user uuid;
  v_slug text := 'zz-theme-' || substr(v_store::text, 1, 8);
  v_result jsonb;
  v_draft uuid;
  v_draft_updated timestamptz;
  v_initial uuid;
  v_theme text;
  v_count integer;
  v_denied boolean := false;
  v_conflict boolean := false;
BEGIN
  SELECT user_id INTO v_user
    FROM public.memberships
   WHERE role = 'owner'
   ORDER BY joined_at
   LIMIT 1;
  ASSERT v_user IS NOT NULL, 'la verificación necesita un owner existente';

  INSERT INTO public.organizations (id, name, slug, owner_user_id)
  VALUES (v_org, 'ZZ Theme versions', v_slug, v_user);
  INSERT INTO public.memberships (org_id, user_id, role)
  VALUES (v_org, v_user, 'owner');
  INSERT INTO public.ecommerce_stores (
    id, org_id, name, slug, theme, primary_color, is_active,
    payment_methods, storefront_layout
  ) VALUES (
    v_store, v_org, 'ZZ Theme store', v_slug, 'minimal', '#111111', true,
    ARRAY['transferencia'], '{"sections":[]}'::jsonb
  );

  SELECT id INTO v_initial FROM public.store_theme_versions
   WHERE store_id = v_store AND version = 1 AND status = 'published';
  ASSERT v_initial IS NOT NULL, 'una tienda nueva no sembró su versión inicial';

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'authenticated')::text, true);

  v_result := public.save_store_theme_draft(
    v_store,
    jsonb_build_object(
      'theme', 'bold',
      'primary_color', '#FFCC00',
      'font', 'inter',
      'logo_url', NULL,
      'banner_url', NULL,
      'storefront_layout', '{"sections":[{"id":"featured","enabled":true}]}'::jsonb
    ),
    'Hot Sale',
    NULL
  );
  v_draft := (v_result ->> 'id')::uuid;
  v_draft_updated := (v_result ->> 'updated_at')::timestamptz;
  ASSERT (v_result ->> 'version')::integer = 2, 'el primer borrador no fue v2';

  SELECT theme INTO v_theme FROM public.get_store_by_slug(v_slug);
  ASSERT v_theme = 'minimal', 'guardar borrador alteró la tienda pública';
  SELECT theme INTO v_theme FROM public.get_store_theme_preview(v_slug, v_draft);
  ASSERT v_theme = 'bold', 'la preview no leyó el borrador';

  v_result := public.publish_store_theme_draft(v_store, v_draft, v_draft_updated);
  SELECT theme INTO v_theme FROM public.get_store_by_slug(v_slug);
  ASSERT v_theme = 'bold', 'publicar no cambió la autoridad pública';
  SELECT count(*) INTO v_count FROM public.store_theme_versions
   WHERE store_id = v_store AND status = 'published';
  ASSERT v_count = 1, 'hay más de una versión publicada';

  v_result := public.save_store_theme_draft(
    v_store,
    jsonb_build_object(
      'theme', 'pastel', 'primary_color', '#AA44CC', 'font', 'lora',
      'logo_url', NULL, 'banner_url', NULL, 'storefront_layout', NULL
    ),
    'Primavera',
    NULL
  );
  v_draft := (v_result ->> 'id')::uuid;
  v_draft_updated := (v_result ->> 'updated_at')::timestamptz;
  PERFORM public.save_store_theme_draft(
    v_store,
    jsonb_build_object(
      'theme', 'pastel', 'primary_color', '#BB55DD', 'font', 'lora',
      'logo_url', NULL, 'banner_url', NULL, 'storefront_layout', NULL
    ),
    'Primavera',
    v_draft_updated
  );
  BEGIN
    PERFORM public.save_store_theme_draft(
      v_store,
      jsonb_build_object(
        'theme', 'pastel', 'primary_color', '#CC66EE', 'font', 'lora',
        'logo_url', NULL, 'banner_url', NULL, 'storefront_layout', NULL
      ),
      'Primavera',
      v_draft_updated
    );
  EXCEPTION WHEN serialization_failure THEN
    v_conflict := true;
  END;
  ASSERT v_conflict, 'un guardado obsoleto pisó el borrador de otra sesión';

  PERFORM public.restore_store_theme_version(v_store, v_initial);
  SELECT theme INTO v_theme FROM public.get_store_by_slug(v_slug);
  ASSERT v_theme = 'minimal', 'rollback no restauró el diseño inicial';
  SELECT count(*) INTO v_count FROM public.store_theme_versions
   WHERE store_id = v_store AND status = 'draft';
  ASSERT v_count = 1, 'rollback borró el trabajo en borrador';

  RESET ROLE;
  UPDATE public.memberships SET role = 'vendedor'
   WHERE org_id = v_org AND user_id = v_user;
  INSERT INTO public.role_permissions (
    org_id, role, module, can_view, can_create, can_edit, can_delete, can_export
  ) VALUES (
    v_org, 'vendedor', 'ecommerce', true, false, false, false, false
  )
  ON CONFLICT (org_id, role, module) DO UPDATE SET can_edit = false;
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM public.restore_store_theme_version(v_store, v_initial);
  EXCEPTION WHEN insufficient_privilege THEN
    v_denied := true;
  END;
  ASSERT v_denied, 'un usuario sin ecommerce.edit pudo restaurar';
  RESET ROLE;

  DELETE FROM public.audit_logs WHERE org_id = v_org;
  DELETE FROM public.organizations WHERE id = v_org;
  SELECT count(*) INTO v_count FROM public.store_theme_versions WHERE store_id = v_store;
  ASSERT v_count = 0, 'quedaron versiones ZZ luego del cleanup';
  SELECT count(*) INTO v_count FROM public.audit_logs WHERE org_id = v_org;
  ASSERT v_count = 0, 'quedó auditoría ZZ luego del cleanup';

  RAISE NOTICE 'OK: draft privado, preview, publish, conflicto, rollback, permiso y 0 restos';
END
$verify$;

ROLLBACK;
