BEGIN;
CREATE TABLE IF NOT EXISTS public.catalog_image_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  provider_id uuid NOT NULL,
  source_url text NOT NULL CHECK (source_url LIKE 'https://%'),
  license text NOT NULL CHECK (license IN ('cc0','pdm')),
  license_url text NOT NULL CHECK (license_url LIKE 'https://%'),
  provenance jsonb NOT NULL CHECK (jsonb_typeof(provenance) = 'object'),
  storage_path text NOT NULL UNIQUE,
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  width integer NOT NULL CHECK (width BETWEEN 100 AND 1600),
  height integer NOT NULL CHECK (height BETWEEN 100 AND 1600),
  byte_size integer NOT NULL CHECK (byte_size BETWEEN 1 AND 4194304),
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(org_id,provider_id,sha256),
  CHECK (storage_path LIKE org_id::text || '/catalog/%')
);
ALTER TABLE public.catalog_image_sources ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.catalog_image_sources FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.catalog_image_sources TO authenticated;
GRANT ALL ON public.catalog_image_sources TO service_role;
DROP POLICY IF EXISTS catalog_image_sources_read ON public.catalog_image_sources;
CREATE POLICY catalog_image_sources_read ON public.catalog_image_sources FOR SELECT TO authenticated
  USING (public.has_permission(org_id,'products','view'));

-- These paths are service-created immutable assets, never browser uploads.
DROP POLICY IF EXISTS catalog_image_storage_insert ON storage.objects;
CREATE POLICY catalog_image_storage_insert ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (bucket_id <> 'product-images' OR COALESCE((storage.foldername(name))[2],'') <> 'catalog');
DROP POLICY IF EXISTS catalog_image_storage_update ON storage.objects;
CREATE POLICY catalog_image_storage_update ON storage.objects AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (bucket_id <> 'product-images' OR COALESCE((storage.foldername(name))[2],'') <> 'catalog')
  WITH CHECK (bucket_id <> 'product-images' OR COALESCE((storage.foldername(name))[2],'') <> 'catalog');
DROP POLICY IF EXISTS catalog_image_storage_delete ON storage.objects;
CREATE POLICY catalog_image_storage_delete ON storage.objects AS RESTRICTIVE FOR DELETE TO authenticated
  USING (bucket_id <> 'product-images' OR COALESCE((storage.foldername(name))[2],'') <> 'catalog');
COMMIT;
