-- Add image_url to product_variants so each flavor/variant can have its own photo
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS image_url TEXT;
