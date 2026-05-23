-- Create expense-receipts storage bucket for AI receipt scanner uploads
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'expense-receipts',
  'expense-receipts',
  true,
  10485760,  -- 10 MB max
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif']
)
ON CONFLICT (id) DO NOTHING;

-- RLS policy: authenticated users can upload to their own folder
CREATE POLICY "Users can upload their own receipts"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'expense-receipts' AND
  (storage.foldername(name))[1] = auth.uid()::text
);

-- RLS policy: public read (receipts are shared via URL)
CREATE POLICY "Public read access to receipts"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'expense-receipts');

-- RLS policy: users can delete their own receipts
CREATE POLICY "Users can delete their own receipts"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'expense-receipts' AND
  (storage.foldername(name))[1] = auth.uid()::text
);
