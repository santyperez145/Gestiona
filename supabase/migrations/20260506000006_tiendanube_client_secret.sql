-- Add client_secret to tiendanube_connections for webhook HMAC verification
ALTER TABLE public.tiendanube_connections ADD COLUMN IF NOT EXISTS client_secret text;
