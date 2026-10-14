-- product-images: cada uno sube sólo a la carpeta de un negocio propio o a la
-- suya. Medido 2026-10-13 con un usuario real de Famatina: podía subir a la
-- carpeta de otro negocio y a rutas sueltas. La única restricción existente
-- (`catalog_image_storage_insert`) cuidaba la subcarpeta `catalog/` y nada
-- más. Rutas que usa la app: `<user_id>/<uuid>.<ext>` (Productos) y
-- `<org_id>/…` (imágenes del catálogo). La copia de imágenes del catálogo
-- corre con service_role y no pasa por RLS.
-- Mismo criterio que marketing-images (20261013000300).
BEGIN;

DROP POLICY IF EXISTS "product images solo en carpeta propia" ON storage.objects;
CREATE POLICY "product images solo en carpeta propia" ON storage.objects
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (bucket_id <> 'product-images' OR public._carpeta_de_marketing_propia(name));

DROP POLICY IF EXISTS "product images actualizar solo carpeta propia" ON storage.objects;
CREATE POLICY "product images actualizar solo carpeta propia" ON storage.objects
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (bucket_id <> 'product-images' OR public._carpeta_de_marketing_propia(name))
  WITH CHECK (bucket_id <> 'product-images' OR public._carpeta_de_marketing_propia(name));

COMMENT ON FUNCTION public._carpeta_de_marketing_propia(text) IS
  'Primera carpeta = el usuario o un negocio del que es miembro. La usan marketing-images y product-images.';

COMMIT;
