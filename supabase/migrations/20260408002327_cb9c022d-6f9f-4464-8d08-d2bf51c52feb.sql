ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS whatsapp_number text DEFAULT NULL;

CREATE OR REPLACE VIEW public.settings_public AS
SELECT id, user_id, business_name, logo_url, primary_color, secondary_color, whatsapp_number
FROM public.settings;