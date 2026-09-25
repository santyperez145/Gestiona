-- Contrato bidireccional: evidencia de aceptación de ambas partes.
-- Añade a `influencer_contracts` los campos que faltaban para la firma.

ALTER TABLE public.influencer_contracts
  ADD COLUMN IF NOT EXISTS accepted_by_brand uuid,
  ADD COLUMN IF NOT EXISTS accepted_by_influencer uuid,
  ADD COLUMN IF NOT EXISTS accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS contract_version int DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_contracts_accepted_at ON public.influencer_contracts(accepted_at) WHERE accepted_at IS NOT NULL;

UPDATE public.influencer_contracts
  SET accepted_at = updated_at
  WHERE is_signed = true AND accepted_at IS NULL;

COMMENT ON COLUMN public.influencer_contracts.accepted_by_brand IS 'User id que aceptó por la marca';
COMMENT ON COLUMN public.influencer_contracts.accepted_by_influencer IS 'User id del creador que aceptó';