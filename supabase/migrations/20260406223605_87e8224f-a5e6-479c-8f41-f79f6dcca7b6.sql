ALTER TABLE public.settings
ADD COLUMN IF NOT EXISTS business_name text DEFAULT 'Exentry Imports',
ADD COLUMN IF NOT EXISTS logo_url text DEFAULT NULL,
ADD COLUMN IF NOT EXISTS primary_color text DEFAULT '#D4A843',
ADD COLUMN IF NOT EXISTS secondary_color text DEFAULT '#1A1A2E';