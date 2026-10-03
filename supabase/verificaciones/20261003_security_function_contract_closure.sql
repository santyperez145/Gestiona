-- Ejecutar contra la base vinculada. Toda escritura queda dentro del rollback.
BEGIN;

DO $verify$
DECLARE
  v_slug text;
  v_store uuid;
  v_email text := 'security-contract-' || replace(gen_random_uuid()::text, '-', '') || '@invalid.example';
  v_first jsonb;
  v_second jsonb;
  v_exposed integer;
BEGIN
  SELECT id, slug INTO v_store, v_slug
  FROM public.ecommerce_stores
  WHERE is_active
  ORDER BY created_at
  LIMIT 1;
  IF v_store IS NULL THEN
    RAISE EXCEPTION 'La verificación requiere una tienda activa';
  END IF;

  v_first := public.register_store_newsletter(v_slug, v_email);
  v_second := public.register_store_newsletter(v_slug, v_email);
  IF v_first->>'estado' <> 'procesado' OR v_second->>'estado' <> 'procesado' THEN
    RAISE EXCEPTION 'El alta no es idempotente o revela existencia: % / %', v_first, v_second;
  END IF;

  UPDATE public.store_newsletter_subscribers
     SET unsubscribed_at = now()
   WHERE store_id = v_store AND email = v_email;
  v_second := public.register_store_newsletter(v_slug, v_email);
  IF v_second->>'estado' <> 'procesado' OR NOT EXISTS (
    SELECT 1 FROM public.store_newsletter_subscribers
    WHERE store_id = v_store AND email = v_email AND unsubscribed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'La respuesta reveló o reactivó una baja previa: %', v_second;
  END IF;

  IF has_function_privilege('public', 'public.register_store_newsletter(text,text)', 'EXECUTE')
     OR NOT has_function_privilege('anon', 'public.register_store_newsletter(text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ACL pública del newsletter incorrecta';
  END IF;

  SELECT count(*) INTO v_exposed FROM public.audit_funciones_expuestas;
  IF v_exposed <> 0 THEN
    RAISE EXCEPTION 'Persisten % funciones web sin contrato', v_exposed;
  END IF;
  IF (SELECT count(*) FROM public.audit_costo_expuesto) <> 0
     OR (SELECT count(*) FROM public.audit_policies_sin_tenant) <> 0
     OR (SELECT count(*) FROM public.audit_rpc_sin_permiso) <> 0 THEN
    RAISE EXCEPTION 'Otra auditoría de seguridad dejó de estar vacía';
  END IF;
  IF (SELECT count(*) FROM public.rls_audit_open_policies) <> 3 OR EXISTS (
    SELECT 1 FROM public.rls_audit_open_policies
    WHERE tablename NOT IN ('plans', 'payment_providers', 'payment_provider_fees')
  ) THEN
    RAISE EXCEPTION 'Cambió la allowlist de catálogos públicos';
  END IF;
END;
$verify$;

ROLLBACK;
