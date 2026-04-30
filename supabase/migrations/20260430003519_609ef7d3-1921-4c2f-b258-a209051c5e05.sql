-- Agregar soporte de múltiples imágenes por producto
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS image_urls TEXT[] DEFAULT '{}'::text[];

-- Backfill: copiar image_url existente al array si está vacío
UPDATE public.products
SET image_urls = ARRAY[image_url]
WHERE image_url IS NOT NULL
  AND image_url <> ''
  AND (image_urls IS NULL OR array_length(image_urls, 1) IS NULL);