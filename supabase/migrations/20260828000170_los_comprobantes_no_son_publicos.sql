-- Los comprobantes de gastos contienen proveedores, importes, CUIT y a veces
-- datos bancarios. El bucket nació público y la UI además tenía dos caminos:
-- el escáner intentaba `receipts/{user}/...` en un bucket cuya policy esperaba
-- `{user}/...` (upload imposible), mientras la carga manual los guardaba en
-- `product-images`, que debe seguir público para el storefront.
--
-- Corte antes de aplicar (2026-08-28): 0 objetos en `expense-receipts`, 0
-- paths `receipts/%` en `product-images` y 0 expenses.receipt_url. Por eso se
-- puede fijar una convención tenant-safe sin migrar enlaces históricos:
--
--     {org_id}/{user_id}/{uuid}.{ext}
--
-- El navegador persiste ese path, nunca una URL firmada. La URL se emite por
-- 60 segundos al abrir y la SELECT policy vuelve a evaluar el permiso actual.

CREATE OR REPLACE FUNCTION public.expense_receipt_org_id(p_path text)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $fn$
  SELECT CASE
    WHEN split_part(COALESCE(p_path, ''), '/', 1)
      ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    THEN split_part(p_path, '/', 1)::uuid
    ELSE NULL
  END
$fn$;

COMMENT ON FUNCTION public.expense_receipt_org_id(text) IS
  'Extrae el tenant del primer segmento de un path de expense-receipts; paths inválidos devuelven NULL.';

REVOKE ALL ON FUNCTION public.expense_receipt_org_id(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.expense_receipt_org_id(text)
  TO authenticated, service_role;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'expense-receipts',
  'expense-receipts',
  false,
  10485760,
  ARRAY[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/heic',
    'image/heif'
  ]::text[]
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Public read access to receipts" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload their own receipts" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own receipts" ON storage.objects;
DROP POLICY IF EXISTS "expense receipts create authorized" ON storage.objects;
DROP POLICY IF EXISTS "expense receipts view authorized" ON storage.objects;
DROP POLICY IF EXISTS "expense receipts delete authorized" ON storage.objects;

CREATE POLICY "expense receipts create authorized"
  ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'expense-receipts'
    AND public.expense_receipt_org_id(name) IS NOT NULL
    AND (storage.foldername(name))[2] = auth.uid()::text
    AND public.has_permission(
      public.expense_receipt_org_id(name),
      'expenses',
      'create'
    )
  );

CREATE POLICY "expense receipts view authorized"
  ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'expense-receipts'
    AND public.expense_receipt_org_id(name) IS NOT NULL
    AND public.has_permission(
      public.expense_receipt_org_id(name),
      'expenses',
      'view'
    )
  );

CREATE POLICY "expense receipts delete authorized"
  ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'expense-receipts'
    AND public.expense_receipt_org_id(name) IS NOT NULL
    AND (
      public.has_permission(
        public.expense_receipt_org_id(name),
        'expenses',
        'delete'
      )
      OR public.has_permission(
        public.expense_receipt_org_id(name),
        'expenses',
        'edit'
      )
      OR (
        (storage.foldername(name))[2] = auth.uid()::text
        AND public.has_permission(
          public.expense_receipt_org_id(name),
          'expenses',
          'create'
        )
      )
    )
  );

-- No UPDATE policy: los nombres son UUID, cada reemplazo crea otro objeto y la
-- referencia del gasto cambia recién cuando el UPDATE de dominio termina.

DO $verification$
DECLARE
  v_public boolean;
  v_limit bigint;
  v_mimes text[];
BEGIN
  SELECT public, file_size_limit, allowed_mime_types
    INTO v_public, v_limit, v_mimes
  FROM storage.buckets
  WHERE id = 'expense-receipts';

  IF v_public IS DISTINCT FROM false OR v_limit IS DISTINCT FROM 10485760 THEN
    RAISE EXCEPTION 'expense-receipts no quedó privado con límite de 10 MiB';
  END IF;
  IF NOT ('application/pdf' = ANY(v_mimes))
     OR NOT ('image/jpeg' = ANY(v_mimes)) THEN
    RAISE EXCEPTION 'expense-receipts perdió un MIME admitido por la UI';
  END IF;
  IF public.expense_receipt_org_id(
       '42abf3d2-6650-407a-a5d2-9781c4ab6778/00000000-0000-4000-8000-000000000001/x.pdf'
     ) IS DISTINCT FROM '42abf3d2-6650-407a-a5d2-9781c4ab6778'::uuid
     OR public.expense_receipt_org_id('../otro-tenant/x.pdf') IS NOT NULL THEN
    RAISE EXCEPTION 'El parser de tenant admite un path inválido';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname IN (
        'Public read access to receipts',
        'Users can upload their own receipts',
        'Users can delete their own receipts'
      )
  ) THEN
    RAISE EXCEPTION 'Sobrevive una policy heredada de comprobantes';
  END IF;
  IF (SELECT count(*) FROM pg_policies
      WHERE schemaname = 'storage'
        AND tablename = 'objects'
        AND policyname LIKE 'expense receipts % authorized') IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'Falta una policy tenant-safe de comprobantes';
  END IF;
END;
$verification$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260828000170', 'los_comprobantes_no_son_publicos')
ON CONFLICT DO NOTHING;
