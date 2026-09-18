-- supabase/migrations/20260918000000_alter_organization_product_access_for_influencers.sql

-- Alter organization_product_access to allow 'influencers' in product_key CHECK
ALTER TABLE public.organization_product_access
DROP CONSTRAINT IF EXISTS organization_product_access_product_key_check,
ADD CONSTRAINT organization_product_access_product_key_check
CHECK (product_key IN ('business', 'finance', 'influencers'));

-- Alter organization_product_access_events similarly
ALTER TABLE public.organization_product_access_events
DROP CONSTRAINT IF EXISTS organization_product_access_events_product_key_check,
ADD CONSTRAINT organization_product_access_events_product_key_check
CHECK (product_key IN ('business', 'finance', 'influencers'));

-- Update the seed function to also insert a row for influencers with status 'available'
-- We replace the existing function
DROP FUNCTION IF EXISTS public.seed_organization_product_access();
CREATE OR REPLACE FUNCTION public.seed_organization_product_access()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
  INSERT INTO public.organization_product_access(org_id, product_key, status)
  VALUES
    (NEW.id, 'business', 'enabled'),
    (NEW.id, 'finance', 'available'),
    (NEW.id, 'influencers', 'available')
  ON CONFLICT (org_id, product_key) DO NOTHING;
  RETURN NEW;
END;
$fn$;

-- Update the trigger to use the new function
DROP TRIGGER IF EXISTS trg_seed_organization_product_access ON public.organizations;
CREATE TRIGGER trg_seed_organization_product_access
AFTER INSERT ON public.organizations
FOR EACH ROW EXECUTE FUNCTION public.seed_organization_product_access();