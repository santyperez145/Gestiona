-- Verificación de infraestructura del Document Inbox. Sólo lee catálogo y
-- políticas; no crea organizaciones, usuarios ni archivos de prueba.
DO $verify$
DECLARE
  v_public boolean;
  v_rls_documents boolean;
  v_rls_versions boolean;
  v_rls_events boolean;
  v_policy_count integer;
BEGIN
  SELECT public INTO v_public
  FROM storage.buckets
  WHERE id = 'finance-documents';
  IF v_public IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'El bucket finance-documents no es privado';
  END IF;

  SELECT relrowsecurity INTO v_rls_documents FROM pg_class WHERE oid = 'public.finance_documents'::regclass;
  SELECT relrowsecurity INTO v_rls_versions FROM pg_class WHERE oid = 'public.finance_document_versions'::regclass;
  SELECT relrowsecurity INTO v_rls_events FROM pg_class WHERE oid = 'public.finance_document_events'::regclass;
  IF NOT COALESCE(v_rls_documents, false) OR NOT COALESCE(v_rls_versions, false) OR NOT COALESCE(v_rls_events, false) THEN
    RAISE EXCEPTION 'La bandeja documental no tiene RLS en todas sus tablas';
  END IF;

  SELECT count(*) INTO v_policy_count
  FROM pg_policies
  WHERE schemaname = 'storage'
    AND tablename = 'objects'
    AND policyname = 'finance documents delete original';
  IF v_policy_count > 0 THEN
    RAISE EXCEPTION 'Existe una policy de borrado para originales Finance';
  END IF;

  IF has_table_privilege('anon', 'public.finance_documents', 'SELECT')
     OR has_table_privilege('anon', 'public.finance_document_versions', 'SELECT') THEN
    RAISE EXCEPTION 'anon recibió acceso a la bandeja documental';
  END IF;
END;
$verify$;

SELECT
  'finance_document_inbox' AS check_name,
  (SELECT public = false FROM storage.buckets WHERE id = 'finance-documents') AS private_bucket,
  (SELECT count(*) FROM public.finance_documents) AS documents,
  (SELECT count(*) FROM public.finance_document_versions) AS versions,
  (SELECT count(*) FROM public.finance_document_events) AS events;
