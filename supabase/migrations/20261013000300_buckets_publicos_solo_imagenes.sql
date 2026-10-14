-- Buckets públicos: sólo imágenes, con tope de tamaño, y cada uno escribe en
-- su carpeta. Medido 2026-10-13:
--   · marketing-images aceptaba cualquier archivo, en cualquier ruta, de
--     cualquier usuario logueado (la política de INSERT sólo miraba el
--     bucket). Con el registro abierto, cualquiera podía alojar HTML o SVG con
--     código en una URL pública nuestra.
--   · product-images y marketing-images no tenían tipo ni tamaño máximo.
--     Hoy sólo guardan PNG/JPEG de hasta 760 KB (54 archivos).
--   · `avatars` no existía: «Cambiar foto» en Mi perfil fallaba siempre.
-- SVG queda afuera a propósito: puede llevar scripts.
-- Idempotente.
BEGIN;

UPDATE storage.buckets
   SET allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp','image/gif','image/avif'],
       file_size_limit = 10 * 1024 * 1024
 WHERE id IN ('product-images', 'marketing-images');

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('avatars', 'avatars', true, 2 * 1024 * 1024,
        ARRAY['image/jpeg','image/png','image/webp','image/gif','image/avif'])
ON CONFLICT (id) DO UPDATE
  SET public = true,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- La primera carpeta tiene que ser un negocio del usuario o el propio usuario
-- (el logo de Ajustes se guarda en `<user_id>/logo.<ext>`). Restrictiva: se
-- suma (AND) a la permisiva existente.
CREATE OR REPLACE FUNCTION public._carpeta_de_marketing_propia(p_nombre text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT auth.uid() IS NOT NULL AND (
    split_part(p_nombre, '/', 1) = auth.uid()::text
    OR (split_part(p_nombre, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        AND public.is_org_member(split_part(p_nombre, '/', 1)::uuid, auth.uid()))
  );
$$;
REVOKE ALL ON FUNCTION public._carpeta_de_marketing_propia(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._carpeta_de_marketing_propia(text) TO authenticated, service_role;

DROP POLICY IF EXISTS "marketing images solo en carpeta propia" ON storage.objects;
CREATE POLICY "marketing images solo en carpeta propia" ON storage.objects
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (bucket_id <> 'marketing-images' OR public._carpeta_de_marketing_propia(name));

-- El logo se sube con upsert: sin UPDATE, el segundo cambio de logo fallaba.
DROP POLICY IF EXISTS "marketing images actualizar carpeta propia" ON storage.objects;
CREATE POLICY "marketing images actualizar carpeta propia" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'marketing-images' AND public._carpeta_de_marketing_propia(name))
  WITH CHECK (bucket_id = 'marketing-images' AND public._carpeta_de_marketing_propia(name));

-- Avatares: cada usuario escribe sólo `avatars/<su id>.<ext>`.
DROP POLICY IF EXISTS "avatar propio subir" ON storage.objects;
CREATE POLICY "avatar propio subir" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'avatars' AND name ~ ('^avatars/' || auth.uid()::text || '\.[a-z0-9]+$'));
DROP POLICY IF EXISTS "avatar propio actualizar" ON storage.objects;
CREATE POLICY "avatar propio actualizar" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'avatars' AND name ~ ('^avatars/' || auth.uid()::text || '\.[a-z0-9]+$'))
  WITH CHECK (bucket_id = 'avatars' AND name ~ ('^avatars/' || auth.uid()::text || '\.[a-z0-9]+$'));
DROP POLICY IF EXISTS "avatar propio leer" ON storage.objects;
CREATE POLICY "avatar propio leer" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'avatars' AND name ~ ('^avatars/' || auth.uid()::text || '\.[a-z0-9]+$'));
DROP POLICY IF EXISTS "avatar propio borrar" ON storage.objects;
CREATE POLICY "avatar propio borrar" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'avatars' AND name ~ ('^avatars/' || auth.uid()::text || '\.[a-z0-9]+$'));

COMMIT;
