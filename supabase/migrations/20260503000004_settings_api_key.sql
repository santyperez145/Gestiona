-- API key for public REST API
ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS api_key text UNIQUE DEFAULT NULL;

CREATE INDEX IF NOT EXISTS settings_api_key_idx ON public.settings(api_key) WHERE api_key IS NOT NULL;
