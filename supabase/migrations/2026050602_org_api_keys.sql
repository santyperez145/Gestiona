-- Rotatable API keys for the Public API
-- Keys are stored as SHA-256 hashes; the plaintext is only shown once at creation.
CREATE TABLE IF NOT EXISTS public.org_api_keys (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  key_hash     text NOT NULL UNIQUE,
  label        text,
  revoked      boolean NOT NULL DEFAULT false,
  revoked_at   timestamptz,
  last_used_at timestamptz,
  use_count    bigint NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.org_api_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_api_keys_org_access" ON public.org_api_keys;
CREATE POLICY "org_api_keys_org_access" ON public.org_api_keys FOR ALL USING (
  org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid())
);

CREATE INDEX IF NOT EXISTS org_api_keys_org_idx  ON public.org_api_keys(org_id);
CREATE INDEX IF NOT EXISTS org_api_keys_hash_idx ON public.org_api_keys(key_hash) WHERE NOT revoked;

-- Add source column to sales for API-created entries
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS source text DEFAULT 'manual';
